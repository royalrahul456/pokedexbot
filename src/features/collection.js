const { Markup } = require('telegraf');
const users = require('../db/users');
const inventoryDb = require('../db/inventory');
const pokemonCollection = require('../db/pokemonCollection');
const eggsDb = require('../db/eggs');
const { formatDuration } = require('../utils/format');
const { getItemInfo } = require('../data/items');
const { getArtworkUrl, getPokedexEntry, formatTypeLine, RARITY_STARS } = require('../data/pokemon');
const { bold, HTML, brandTag } = require('../utils/text');

const LIST_PER_PAGE = 8; // items/badges/etc — plain text, several per page
const IDLE_EXPIRY_MS = 15 * 60 * 1000; // menu goes stale after 15 min of no taps

const SORT_MODES = ['rarity', 'quantity', 'alpha'];
const SORT_LABELS = { rarity: '🔀 Sort: Rarity', quantity: '🔀 Sort: Most Caught', alpha: '🔀 Sort: A-Z' };
const RARITY_ORDER = { mythical: 0, legendary: 1, rare: 2, common: 3 };

// Maps a bot message_id -> { ownerId, chatId } while a search prompt (force-reply) is
// awaiting an answer. Cleared once used; this is intentionally in-memory (not DB) since
// it's a short-lived UI interaction, not persistent state.
const pendingSearches = new Map();

function now() {
  return Math.floor(Date.now() / 1000);
}

// Every button embeds the owner's ID and a render timestamp: `coll:<ownerId>:<ts>:...`.
// The owner check stops anyone else from browsing this menu; the timestamp gives a
// sliding 15-minute idle expiry (refreshed on every real interaction).
function tag(ownerId) {
  return `${ownerId}:${now()}`;
}

function mainMenuKeyboard(ownerId) {
  const t = tag(ownerId);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🐾 Pokémon', `coll:${t}:pkmn:summary`),
      Markup.button.callback('🎒 Items', `coll:${t}:items:0`),
    ],
    [
      Markup.button.callback('💰 Coins & Currency', `coll:${t}:coins`),
      Markup.button.callback('🥚 Eggs', `coll:${t}:eggs`),
    ],
    [
      Markup.button.callback('🍬 Candy', `coll:${t}:candy`),
      Markup.button.callback('🏅 Badges', `coll:${t}:badges`),
    ],
    [
      Markup.button.callback('🎁 Event Items', `coll:${t}:event`),
      Markup.button.callback('⭐ Special & Rare', `coll:${t}:special:0`),
    ],
  ]);
}

function backButtonRow(ownerId, extra = []) {
  return [...extra, [Markup.button.callback('⬅️ Back to Collection Menu', `coll:${tag(ownerId)}:menu`)]];
}

function mainMenuText() {
  return [brandTag(), bold('📂 My Collection'), '', 'Choose a category to browse:'].join('\n');
}

// Returns true and proceeds only if the tapper is the menu's owner AND the button hasn't
// gone idle-stale. Otherwise answers privately and leaves the message untouched.
async function requireOwnerAndFresh(ctx, ownerId, ts) {
  if (ctx.from.id !== ownerId) {
    await ctx.answerCbQuery("🔒 This isn't your collection — run /collection yourself to see your own!", {
      show_alert: true,
    });
    return false;
  }
  if (now() - ts > IDLE_EXPIRY_MS / 1000) {
    await ctx.answerCbQuery('⌛ This menu has been idle too long — run /collection again for a fresh one.', {
      show_alert: true,
    });
    return false;
  }
  return true;
}

function sortCollection(entries, sortMode) {
  const copy = [...entries];
  if (sortMode === 'quantity') {
    copy.sort((a, b) => b.quantity - a.quantity);
  } else if (sortMode === 'alpha') {
    copy.sort((a, b) => a.species_name.localeCompare(b.species_name));
  } else {
    copy.sort((a, b) => {
      const rarityDiff = (RARITY_ORDER[a.base_rarity] ?? 9) - (RARITY_ORDER[b.base_rarity] ?? 9);
      return rarityDiff !== 0 ? rarityDiff : a.species_name.localeCompare(b.species_name);
    });
  }
  return copy;
}

// ── Pokémon summary screen ──────────────────────────────────────────────────
function buildSummaryText(userId) {
  const stats = pokemonCollection.getCollectionStats(userId);
  const lines = [
    bold('🐾 Pokémon Collection'),
    '',
    `📋 Distinct species: ${bold(stats.distinctSpecies)}`,
    `🎯 Total caught: ${bold(stats.totalCaught)}`,
  ];
  if (stats.distinctSpecies === 0) {
    const legacyCatches = users.getTotalCatchesAcrossGroups(userId);
    lines.push('', "No tracked catches yet — go catch some!");
    if (legacyCatches > 0) {
      lines.push(
        '',
        `(You have ${bold(legacyCatches)} earlier catches from before this collection existed — those weren't recorded by species, so they can't be listed here. Everything you catch from now on will show up.)`
      );
    }
  }
  return lines.join('\n');
}

function summaryKeyboard(ownerId) {
  const t = tag(ownerId);
  const rows = [];
  const stats = pokemonCollection.getCollectionStats(ownerId);
  if (stats.distinctSpecies > 0) {
    rows.push([Markup.button.callback('📖 View Collection ➡️', `coll:${t}:pkmn:list:rarity:0`)]);
    rows.push([Markup.button.callback('🔍 Search by Name', `coll:${t}:pkmn:search`)]);
  }
  return Markup.inlineKeyboard(backButtonRow(ownerId, rows));
}

// ── Pokémon list: one entry per page, with real artwork, sortable ──────────
function buildPokemonPage(userId, sortMode, page) {
  const all = sortCollection(pokemonCollection.listCollection(userId), sortMode);
  if (all.length === 0) return { empty: true };

  const clampedPage = Math.max(0, Math.min(page, all.length - 1));
  const entry = all[clampedPage];
  const pokedex = getPokedexEntry(entry.species_name);
  const shinyLabel = entry.shiny ? ' ✨ Shiny' : '';
  const caption = [
    bold(`${entry.species_name}${shinyLabel} x${entry.quantity}`),
    '',
    bold(formatTypeLine(pokedex.types)),
    `Rarity: ${RARITY_STARS[entry.base_rarity] ?? '⭐'} (${entry.base_rarity})`,
    '',
    `Page ${clampedPage + 1} / ${all.length}`,
  ].join('\n');
  const imageUrl = getArtworkUrl(pokedex.dexNumber, !!entry.shiny);
  return { empty: false, caption, imageUrl, page: clampedPage, total: all.length };
}

function pokemonListKeyboard(ownerId, sortMode, page, total) {
  const t = tag(ownerId);
  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Prev', `coll:${t}:pkmn:list:${sortMode}:${page - 1}`));
  if (page < total - 1) navRow.push(Markup.button.callback('Next ➡️', `coll:${t}:pkmn:list:${sortMode}:${page + 1}`));

  const nextSort = SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length];
  const toolRow = [
    Markup.button.callback(SORT_LABELS[sortMode], `coll:${t}:pkmn:list:${nextSort}:0`),
    Markup.button.callback('🔍 Search', `coll:${t}:pkmn:search`),
  ];

  const rows = [];
  if (navRow.length) rows.push(navRow);
  rows.push(toolRow);
  return Markup.inlineKeyboard(backButtonRow(ownerId, rows));
}

// ── Items category: plain paginated text list ───────────────────────────────
function buildItemsPage(userId, page) {
  const items = inventoryDb.listInventory(userId);
  if (items.length === 0) return { empty: true };

  const totalPages = Math.ceil(items.length / LIST_PER_PAGE);
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = items.slice(clampedPage * LIST_PER_PAGE, (clampedPage + 1) * LIST_PER_PAGE);

  const lines = [bold('🎒 Your Items'), ''];
  for (const { item_key, quantity } of pageItems) {
    const info = getItemInfo(item_key);
    lines.push(`${info.emoji} ${bold(info.label)} x${bold(quantity)}`);
  }
  lines.push('', `Page ${clampedPage + 1} / ${totalPages}`);
  return { empty: false, text: lines.join('\n'), page: clampedPage, totalPages };
}

// ── Special & Rare: legendary/mythical/shiny catches only ──────────────────
function buildSpecialPage(userId, page) {
  const all = pokemonCollection
    .listCollection(userId)
    .filter((e) => e.shiny || e.base_rarity === 'legendary' || e.base_rarity === 'mythical');
  if (all.length === 0) return { empty: true };

  const clampedPage = Math.max(0, Math.min(page, all.length - 1));
  const entry = all[clampedPage];
  const pokedex = getPokedexEntry(entry.species_name);
  const shinyLabel = entry.shiny ? ' ✨ Shiny' : '';
  const caption = [
    bold('⭐ Special & Rare Collectibles'),
    '',
    bold(`${entry.species_name}${shinyLabel} x${entry.quantity}`),
    `Rarity: ${entry.base_rarity}`,
    '',
    `Page ${clampedPage + 1} / ${all.length}`,
  ].join('\n');
  const imageUrl = getArtworkUrl(pokedex.dexNumber, !!entry.shiny);
  return { empty: false, caption, imageUrl, page: clampedPage, total: all.length };
}

async function sendMainMenu(ctx, ownerId) {
  const payload = { ...HTML, ...mainMenuKeyboard(ownerId) };
  try {
    await ctx.editMessageText(mainMenuText(), payload);
  } catch (err) {
    await ctx.reply(mainMenuText(), payload);
  }
}

async function sendCategoryText(ctx, ownerId, text, extraRows) {
  const keyboard = Markup.inlineKeyboard(backButtonRow(ownerId, extraRows));
  try {
    await ctx.editMessageText(text, { ...HTML, ...keyboard });
  } catch (err) {
    await ctx.reply(text, { ...HTML, ...keyboard });
  }
}

async function sendPhotoPage(ctx, caption, imageUrl, keyboard) {
  try {
    await ctx.editMessageMedia({ type: 'photo', media: imageUrl, caption, parse_mode: 'HTML' }, keyboard);
  } catch (err) {
    await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'HTML', ...keyboard });
  }
}

function register(bot) {
  bot.command(['collection', 'mycollection'], async (ctx) => {
    const ownerId = ctx.from.id;
    users.getOrCreateUser(ctx.chat.id, ownerId, ctx.from.username || ctx.from.first_name);
    await ctx.reply(mainMenuText(), { ...HTML, ...mainMenuKeyboard(ownerId) });
  });

  bot.action(/^coll:(\d+):(\d+):menu$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();
    await sendMainMenu(ctx, ownerId);
  });

  bot.action(/^coll:(\d+):(\d+):pkmn:summary$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();
    await sendCategoryTextRaw(ctx, buildSummaryText(ownerId), summaryKeyboard(ownerId));
  });

  bot.action(/^coll:(\d+):(\d+):pkmn:list:(rarity|quantity|alpha):(\d+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const sortMode = ctx.match[3];
    const page = Number(ctx.match[4]);
    const result = buildPokemonPage(ownerId, sortMode, page);
    if (result.empty) {
      await sendCategoryTextRaw(ctx, buildSummaryText(ownerId), summaryKeyboard(ownerId));
      return;
    }
    await sendPhotoPage(ctx, result.caption, result.imageUrl, pokemonListKeyboard(ownerId, sortMode, result.page, result.total));
  });

  bot.action(/^coll:(\d+):(\d+):pkmn:search$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const prompt = await ctx.reply(
      '🔍 Reply to this message with the Pokémon name you want to find in your collection.',
      Markup.forceReply()
    );
    pendingSearches.set(prompt.message_id, { ownerId, chatId: ctx.chat.id });
  });

  bot.on('text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !pendingSearches.has(replyTo.message_id)) return next ? next() : undefined;

    const pending = pendingSearches.get(replyTo.message_id);
    pendingSearches.delete(replyTo.message_id);
    if (ctx.from.id !== pending.ownerId) return next ? next() : undefined; // not the searcher

    const query = ctx.message.text.trim().toLowerCase();
    const all = pokemonCollection.listCollection(pending.ownerId);
    const sorted = sortCollection(all, 'rarity');
    const foundIndex = sorted.findIndex((e) => e.species_name.toLowerCase().includes(query));

    if (foundIndex === -1) {
      await ctx.reply(`No Pokémon matching "${query}" found in your collection.`);
      return;
    }
    const result = buildPokemonPage(pending.ownerId, 'rarity', foundIndex);
    const keyboard = pokemonListKeyboard(pending.ownerId, 'rarity', result.page, result.total);
    await ctx.replyWithPhoto(result.imageUrl, { caption: result.caption, parse_mode: 'HTML', ...keyboard });
  });

  bot.action(/^coll:(\d+):(\d+):items:(\d+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const page = Number(ctx.match[3]);
    const result = buildItemsPage(ownerId, page);
    if (result.empty) {
      await sendCategoryText(
        ctx,
        ownerId,
        [bold('🎒 Your Items'), '', 'No items yet — try /spin, /chest, or catching Pokémon!'].join('\n'),
        []
      );
      return;
    }
    const t = tag(ownerId);
    const navRow = [];
    if (result.page > 0) navRow.push(Markup.button.callback('⬅️ Prev', `coll:${t}:items:${result.page - 1}`));
    if (result.page < result.totalPages - 1)
      navRow.push(Markup.button.callback('Next ➡️', `coll:${t}:items:${result.page + 1}`));
    await sendCategoryText(ctx, ownerId, result.text, navRow.length ? [navRow] : []);
  });

  bot.action(/^coll:(\d+):(\d+):special:(\d+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const page = Number(ctx.match[3]);
    const result = buildSpecialPage(ownerId, page);
    if (result.empty) {
      await sendCategoryText(
        ctx,
        ownerId,
        [bold('⭐ Special & Rare Collectibles'), '', 'No shiny, legendary, or mythical catches yet — keep hunting!'].join(
          '\n'
        ),
        []
      );
      return;
    }
    const t = tag(ownerId);
    const navRow = [];
    if (result.page > 0) navRow.push(Markup.button.callback('⬅️ Prev', `coll:${t}:special:${result.page - 1}`));
    if (result.page < result.total - 1)
      navRow.push(Markup.button.callback('Next ➡️', `coll:${t}:special:${result.page + 1}`));
    await sendPhotoPage(
      ctx,
      result.caption,
      result.imageUrl,
      Markup.inlineKeyboard(backButtonRow(ownerId, navRow.length ? [navRow] : []))
    );
  });

  bot.action(/^coll:(\d+):(\d+):coins$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const profile = users.getProfile(ctx.chat.id, ownerId) || { coins: 0, xp: 0, level: 1 };
    const text = [
      bold('💰 Coins & Currency (this group)'),
      '',
      `🪙 Coins: ${bold(profile.coins)}`,
      `✨ XP: ${bold(profile.xp)}`,
      `🏆 Level: ${bold(profile.level)}`,
      '',
      '(Coins/XP/Level are separate per group — this shows your balance here.)',
    ].join('\n');
    await sendCategoryText(ctx, ownerId, text, []);
  });

  bot.action(/^coll:(\d+):(\d+):eggs$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const commonQty = inventoryDb.getItemQuantity(ownerId, 'egg_common');
    const rareQty = inventoryDb.getItemQuantity(ownerId, 'egg_rare');
    const incubation = eggsDb.getIncubation(ownerId);

    const lines = [bold('🥚 Eggs'), '', `Common Eggs: ${bold(commonQty)}`, `Rare Eggs: ${bold(rareQty)}`, ''];
    if (incubation) {
      lines.push(
        eggsDb.isReady(incubation)
          ? '🐣 An egg is ready to hatch — run /egg!'
          : `🥚 Incubating — ready in ${bold(formatDuration(Date.parse(incubation.ready_at) - Date.now()))}.`
      );
    } else {
      lines.push('No egg currently incubating — run /egg to start one.');
    }
    await sendCategoryText(ctx, ownerId, lines.join('\n'), []);
  });

  bot.action(/^coll:(\d+):(\d+):candy$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();
    const qty = inventoryDb.getItemQuantity(ownerId, 'rare_candy');
    await sendCategoryText(
      ctx,
      ownerId,
      [bold('🍬 Candy'), '', `Rare Candy: ${bold(qty)}`, '', 'Use /use rare_candy to redeem it for XP.'].join('\n'),
      []
    );
  });

  bot.action(/^coll:(\d+):(\d+):badges$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const badgeKeys = ['avatar_frame', 'avatar_badge', 'mythical_reward'];
    const lines = [bold('🏅 Badges & Achievements'), ''];
    let any = false;
    for (const key of badgeKeys) {
      const qty = inventoryDb.getItemQuantity(ownerId, key);
      if (qty > 0) {
        any = true;
        const info = getItemInfo(key);
        lines.push(`${info.emoji} ${bold(info.label)} x${bold(qty)}`);
      }
    }
    if (!any) lines.push("You haven't earned any badges yet — try /spin and /chest!");
    await sendCategoryText(ctx, ownerId, lines.join('\n'), []);
  });

  bot.action(/^coll:(\d+):(\d+):event$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();

    const qty = inventoryDb.getItemQuantity(ownerId, 'event_key');
    await sendCategoryText(
      ctx,
      ownerId,
      [bold('🎁 Event Items'), '', `Event Key: ${bold(qty)}`, '', 'Seasonal events are coming in a future update!'].join(
        '\n'
      ),
      []
    );
  });
}

async function sendCategoryTextRaw(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, { ...HTML, ...keyboard });
  } catch (err) {
    await ctx.reply(text, { ...HTML, ...keyboard });
  }
}

module.exports = { register };
