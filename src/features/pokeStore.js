const { Markup } = require('telegraf');
const goldWallet = require('../db/goldWallet');
const storeListings = require('../db/storeListings');
const pokemonInstances = require('../db/pokemonInstances');
const users = require('../db/users');
const { getArtworkUrl, getPokedexEntry, getBaseRarity, RARITY_STARS, TYPE_EMOJI } = require('../data/pokemon');
const { computeStats, movesFor } = require('../data/battleData');
const { getPowerTier } = require('../data/speciesPower');
const { bold, italic, escapeHtml, HTML, brandTag } = require('../utils/text');

const TIER_BADGE = { S: '🏆 S-Tier', A: '🥇 A-Tier', B: '🥈 B-Tier', C: '🥉 C-Tier' };

// Gold's own icon — deliberately NOT 🪙, which is already used everywhere for regular per-group
// Coins (battle bets, /shop, mini-game wagers). Gold is the premium, real-money-only currency, so
// it needs a visually distinct identity — a gem reads as "premium" the way coins don't, matching
// the common mobile-game convention (grindable Coins vs. paid Gems).
const GOLD_ICON = '💎';

const CATEGORY_LABEL = {
  rare: '🔹 Rare',
  legendary: '🐉 Legendary',
  mythical: '🌟 Mythical',
  shiny: '✨ Shiny',
  shiny_legendary: '✨🐉 Shiny Legendary',
  shiny_mythical: '✨🌟 Shiny Mythical',
  gigantamax: '🔴 Gigantamax',
  dynamax: '🟣 Dynamax',
};

// Flavor quotes per category — purely cosmetic, picked at random on each render, no state.
// Kept in the bot's own voice/mechanics (no fake IVs/nature — this bot doesn't have those;
// stats shown below are the same computeStats()/movesFor() the real /battle system uses).
const CATEGORY_QUOTES = {
  rare: [
    'A cut above the common crowd — hard to find, harder to forget.',
    'Not every trainer gets one of these in their party.',
    'Rare for a reason — power that shows the moment it steps out.',
  ],
  legendary: [
    'Legends are not found — they are earned.',
    'Some Pokémon are whispered about in every region. This is one of them.',
    'A being that reshapes the battlefield the instant it appears.',
  ],
  mythical: [
    'Myth made real — few trainers will ever hold one of these.',
    'Said to exist only in stories. You could own the proof otherwise.',
    'A Pokémon so rare, most trainers only ever read about it.',
  ],
  shiny: [
    'A shimmer that only shows up once in thousands of encounters.',
    'Same species, impossible odds — a color no one else in your group has.',
    'Rarity isn\'t just power here — it\'s the shine everyone notices first.',
  ],
  shiny_legendary: [
    'Legendary rarity wearing colors almost nobody has ever seen.',
    'The rarest of the rare — a legend, and a shiny one at that.',
    'Two miracles stacked into one Pokémon.',
  ],
  shiny_mythical: [
    'A myth wrapped in a shine most trainers will never witness.',
    'The single hardest kind of Pokémon to ever come by — mythical AND shiny.',
    'If it exists in your collection, it belongs on your profile front and center.',
  ],
  gigantamax: ['Coming soon.'],
  dynamax: ['Coming soon.'],
};

function pickQuote(category) {
  const pool = CATEGORY_QUOTES[category] || ['A prized addition to any collection.'];
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildListingDescription(listing) {
  const pokedex = getPokedexEntry(listing.species_name);
  const stats = computeStats(getBaseRarity(listing.species_name), !!listing.shiny, listing.species_name);
  const moves = movesFor(pokedex.types).map((m) => m.name);
  const shinyLabel = listing.shiny ? ' ✨' : '';
  const lines = [
    italic(`"${escapeHtml(pickQuote(listing.category))}"`),
    '',
    `🐾 Name: ${bold(`${escapeHtml(listing.species_name)}${shinyLabel}`)}`,
    `🧬 Type: ${bold(pokedex.types.map((t) => `${t} ${TYPE_EMOJI[t] ?? ''}`).join(' / '))}`,
    `⭐ Rarity: ${bold(`${RARITY_STARS[listing.category] || RARITY_STARS[getBaseRarity(listing.species_name)]} ${listing.category}`)}`,
    `💪 Power: ${bold(TIER_BADGE[getPowerTier(listing.species_name)])}`,
    `❤️ HP: ${bold(stats.maxHp)}`,
    `⚔️ Attack: ${bold(stats.atk)}`,
    `🎯 Known Moves: ${bold(moves.join(', '))}`,
    `${GOLD_ICON} Price: ${bold(`${listing.price_gold} Gold`)}`,
  ];
  if (listing.event_label) lines.push(`🎉 Event: ${escapeHtml(listing.event_label)}`);
  return lines.join('\n');
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function tag(ownerId) {
  return `${ownerId}:${now()}`;
}

async function requireOwner(ctx, ownerId) {
  if (ctx.from.id !== ownerId) {
    await ctx.answerCbQuery("🔒 This isn't your store session — run /store yourself.", { show_alert: true });
    return false;
  }
  return true;
}

function mainMenuText(userId) {
  const gold = goldWallet.getBalance(userId);
  return [
    brandTag(),
    bold('👑 Gold Store — Premium Collection'),
    '',
    `${GOLD_ICON} Your Gold Balance: ${bold(gold)}`,
    '',
    italic('Gold is our premium currency — separate from regular Coins, and never farmable through gameplay. Every listing here is hand-picked and stocked in limited supply.'),
    '',
    'Pick a category to browse the collection:',
  ].join('\n');
}

function mainMenuKeyboard(ownerId) {
  const t = tag(ownerId);
  const rows = storeListings.CATEGORIES.reduce((acc, cat, i) => {
    const btn = Markup.button.callback(CATEGORY_LABEL[cat], `store:${t}:cat:${cat}:0`);
    if (i % 2 === 0) acc.push([btn]);
    else acc[acc.length - 1].push(btn);
    return acc;
  }, []);
  return Markup.inlineKeyboard(rows);
}

function backToMenuKeyboard(ownerId, extraRows = []) {
  const t = tag(ownerId);
  return Markup.inlineKeyboard([...extraRows, [Markup.button.callback('⬅️ Back to Categories', `store:${t}:menu`)]]);
}

function buildCategoryPage(category, page) {
  const listings = storeListings.listAvailableByCategory(category);
  if (listings.length === 0) return { empty: true };
  const clampedPage = Math.max(0, Math.min(page, listings.length - 1));
  const listing = listings[clampedPage];
  const pokedex = getPokedexEntry(listing.species_name);
  const caption = [
    bold(CATEGORY_LABEL[category]),
    '',
    buildListingDescription(listing),
    '',
    `Listing ${clampedPage + 1} / ${listings.length}`,
  ].join('\n');
  return {
    empty: false,
    caption,
    imageUrl: getArtworkUrl(pokedex.dexNumber, !!listing.shiny),
    page: clampedPage,
    total: listings.length,
    listing,
  };
}

function categoryPageKeyboard(ownerId, category, page, total, listingId) {
  const t = tag(ownerId);
  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Prev', `store:${t}:cat:${category}:${page - 1}`));
  if (page < total - 1) navRow.push(Markup.button.callback('Next ➡️', `store:${t}:cat:${category}:${page + 1}`));
  const rows = [];
  if (navRow.length) rows.push(navRow);
  rows.push([Markup.button.callback('🛒 Buy', `store:${t}:buy:${listingId}`)]);
  return backToMenuKeyboard(ownerId, rows);
}

function confirmKeyboard(ownerId, listingId) {
  const t = tag(ownerId);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm Purchase', `store:${t}:confirm:${listingId}`),
      Markup.button.callback('❌ Cancel', `store:${t}:menu`),
    ],
  ]);
}

async function sendMenu(ctx, ownerId) {
  const payload = { ...HTML, ...mainMenuKeyboard(ownerId) };
  try {
    await ctx.editMessageText(mainMenuText(ownerId), payload);
  } catch (err) {
    await ctx.reply(mainMenuText(ownerId), payload);
  }
}

async function sendPhotoPage(ctx, caption, imageUrl, keyboard) {
  try {
    await ctx.editMessageMedia({ type: 'photo', media: imageUrl, caption, parse_mode: 'HTML' }, keyboard);
  } catch (err) {
    await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'HTML', ...keyboard });
  }
}

async function sendEmptyCategory(ctx, ownerId, category) {
  const text = [bold(CATEGORY_LABEL[category]), '', 'Nothing in stock right now — check back later.'].join('\n');
  const keyboard = backToMenuKeyboard(ownerId);
  try {
    await ctx.editMessageText(text, { ...HTML, ...keyboard });
  } catch (err) {
    await ctx.reply(text, { ...HTML, ...keyboard });
  }
}

function register(bot) {
  bot.command('store', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('🛒 The Gold Store is DM-only — message me directly to browse and buy.');
      return;
    }
    const ownerId = ctx.from.id;
    users.getOrCreateUser(ctx.chat.id, ownerId, ctx.from.username || ctx.from.first_name);
    await ctx.reply(mainMenuText(ownerId), { ...HTML, ...mainMenuKeyboard(ownerId) });
  });

  bot.action(/^store:(\d+):(\d+):menu$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwner(ctx, ownerId))) return;
    await ctx.answerCbQuery();
    await sendMenu(ctx, ownerId);
  });

  bot.action(/^store:(\d+):(\d+):cat:([a-z_]+):(\d+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwner(ctx, ownerId))) return;
    await ctx.answerCbQuery();
    const category = ctx.match[3];
    const page = Number(ctx.match[4]);
    const result = buildCategoryPage(category, page);
    if (result.empty) {
      await sendEmptyCategory(ctx, ownerId, category);
      return;
    }
    await sendPhotoPage(
      ctx,
      result.caption,
      result.imageUrl,
      categoryPageKeyboard(ownerId, category, result.page, result.total, result.listing.id)
    );
  });

  bot.action(/^store:(\d+):(\d+):buy:(\d+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwner(ctx, ownerId))) return;
    const listingId = Number(ctx.match[3]);
    const listing = storeListings.getListing(listingId);
    if (!listing || !listing.enabled) {
      await ctx.answerCbQuery('That listing is no longer available.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const gold = goldWallet.getBalance(ownerId);
    const pokedex = getPokedexEntry(listing.species_name);
    const text = [
      bold('👑 Confirm Your Premium Purchase'),
      '',
      buildListingDescription(listing),
      '',
      `${GOLD_ICON} Your Gold Balance: ${bold(gold)}`,
      '',
      gold >= listing.price_gold
        ? '✨ Confirm below to add this exclusive Pokémon to your collection.'
        : `⚠️ Not enough Gold — you need ${bold(listing.price_gold - gold)} more.`,
    ].join('\n');
    try {
      await ctx.editMessageMedia(
        { type: 'photo', media: getArtworkUrl(pokedex.dexNumber, !!listing.shiny), caption: text, parse_mode: 'HTML' },
        confirmKeyboard(ownerId, listingId)
      );
    } catch (err) {
      await ctx.reply(text, { ...HTML, ...confirmKeyboard(ownerId, listingId) });
    }
  });

  bot.action(/^store:(\d+):(\d+):confirm:(\d+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwner(ctx, ownerId))) return;
    const listingId = Number(ctx.match[3]);
    const listing = storeListings.getListing(listingId);
    if (!listing || !listing.enabled) {
      await ctx.answerCbQuery('That listing is no longer available.', { show_alert: true });
      return;
    }

    const debited = goldWallet.debit(
      ownerId,
      listing.price_gold,
      'store_purchase',
      `listing #${listing.id}: ${listing.species_name}`,
      listing.id
    );
    if (!debited) {
      await ctx.answerCbQuery('Insufficient Gold.', { show_alert: true });
      return;
    }

    const instanceId = pokemonInstances.createInstance(
      ownerId,
      listing.species_name,
      getBaseRarity(listing.species_name),
      !!listing.shiny,
      'purchase'
    );

    await ctx.answerCbQuery('🎉 Purchase complete!');
    const pokedex = getPokedexEntry(listing.species_name);
    const shinyLabel = listing.shiny ? ' ✨ Shiny' : '';
    const tierBadge = TIER_BADGE[getPowerTier(listing.species_name)];
    const text = [
      bold('🎉 Congratulations! 🎉'),
      '',
      italic(`${escapeHtml(listing.species_name)}${shinyLabel} has joined your collection.`),
      '',
      `👑 Rarity: ${bold(RARITY_STARS[listing.category] || RARITY_STARS[getBaseRarity(listing.species_name)])}`,
      `${tierBadge.split(' ')[0]} Power Tier: ${bold(tierBadge)}`,
      `🔖 Certificate of Authenticity: ${bold(instanceId)}`,
      '',
      `${GOLD_ICON} Remaining Gold Balance: ${bold(goldWallet.getBalance(ownerId))}`,
      '',
      italic('Thank you for shopping the Gold Store — this exclusive is now yours to battle, breed, and show off.'),
    ].join('\n');
    try {
      await ctx.editMessageCaption(text, { ...HTML, ...backToMenuKeyboard(ownerId) });
    } catch (err) {
      await ctx.reply(text, { ...HTML, ...backToMenuKeyboard(ownerId) });
    }
  });
}

module.exports = { register };
