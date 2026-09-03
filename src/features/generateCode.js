const { Markup } = require('telegraf');
const { ADMIN_IDS } = require('../config');
const promoCodesDb = require('../db/promoCodes');
const { ITEMS, getItemInfo } = require('../data/items');
const { COMMON, RARE, LEGENDARY, MYTHICAL, getBaseRarity } = require('../data/pokemon');
const { bold, HTML, brandTag } = require('../utils/text');

const PAGE_SIZE = 8;
const TIERS = { common: COMMON, rare: RARE, legendary: LEGENDARY, mythical: MYTHICAL };
const TIER_LABELS = { common: '⚪ Common', rare: '⭐ Rare', legendary: '🐉 Legendary', mythical: '🌟 Mythical' };

// adminId -> { data: {...}, rewardMode, multiStage }
const sessions = new Map();
// force-reply prompt message_id -> { adminId, field }
const pendingPrompts = new Map();

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

function newSession() {
  return {
    data: {
      code: null,
      coins: 0,
      itemKey: null,
      itemQty: null,
      pokemonName: null,
      pokemonShiny: false,
      maxUses: null,
      expiresAt: null,
    },
    rewardMode: null,
    multiStage: null,
  };
}

async function promptText(ctx, adminId, field, text) {
  const prompt = await ctx.reply(text, { ...HTML, ...Markup.forceReply() });
  pendingPrompts.set(prompt.message_id, { adminId, field });
}

function rewardTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💰 Poké Coins', 'gc:type:coins')],
    [Markup.button.callback('🎒 Inventory Item', 'gc:type:item')],
    [Markup.button.callback('🐾 Pokémon', 'gc:type:pokemon')],
    [Markup.button.callback('🎁 Multiple Rewards', 'gc:type:multi')],
  ]);
}

function paginate(arr, page) {
  const start = page * PAGE_SIZE;
  return { slice: arr.slice(start, start + PAGE_SIZE), hasPrev: page > 0, hasNext: start + PAGE_SIZE < arr.length };
}

function itemPickerKeyboard(page, showSkip) {
  const keys = Object.keys(ITEMS);
  const { slice, hasPrev, hasNext } = paginate(keys, page);
  const rows = slice.map((key) => [Markup.button.callback(`${ITEMS[key].emoji} ${ITEMS[key].label}`, `gc:item:choose:${key}`)]);
  const nav = [];
  if (hasPrev) nav.push(Markup.button.callback('⬅️ Prev', `gc:item:page:${page - 1}`));
  if (hasNext) nav.push(Markup.button.callback('Next ➡️', `gc:item:page:${page + 1}`));
  if (nav.length) rows.push(nav);
  if (showSkip) rows.push([Markup.button.callback('⏭️ Skip item reward', 'gc:item:skip')]);
  return Markup.inlineKeyboard(rows);
}

function pokeTierKeyboard(showSkip) {
  const rows = Object.keys(TIERS).map((tier) => [Markup.button.callback(TIER_LABELS[tier], `gc:poke:tier:${tier}`)]);
  if (showSkip) rows.push([Markup.button.callback('⏭️ Skip Pokémon reward', 'gc:poke:skip')]);
  return Markup.inlineKeyboard(rows);
}

function pokeNamePickerKeyboard(tier, page) {
  const names = TIERS[tier];
  const { slice, hasPrev, hasNext } = paginate(names, page);
  const rows = slice.map((name) => [Markup.button.callback(name, `gc:poke:choose:${name}`)]);
  const nav = [];
  if (hasPrev) nav.push(Markup.button.callback('⬅️ Prev', `gc:poke:page:${tier}:${page - 1}`));
  if (hasNext) nav.push(Markup.button.callback('Next ➡️', `gc:poke:page:${tier}:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('⬅️ Back to Tiers', 'gc:poke:tiers')]);
  return Markup.inlineKeyboard(rows);
}

function shinyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✨ Shiny', 'gc:poke:shiny:yes'), Markup.button.callback('Normal', 'gc:poke:shiny:no')],
  ]);
}

function limitKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('5', 'gc:limit:5'),
      Markup.button.callback('10', 'gc:limit:10'),
      Markup.button.callback('100', 'gc:limit:100'),
    ],
    [Markup.button.callback('♾️ Unlimited', 'gc:limit:unlimited'), Markup.button.callback('✏️ Custom', 'gc:limit:custom')],
  ]);
}

function expiryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Never', 'gc:expiry:never')],
    [Markup.button.callback('1 Hour', 'gc:expiry:1h'), Markup.button.callback('24 Hours', 'gc:expiry:24h')],
    [Markup.button.callback('7 Days', 'gc:expiry:7d'), Markup.button.callback('30 Days', 'gc:expiry:30d')],
    [Markup.button.callback('✏️ Custom Date', 'gc:expiry:custom')],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirm', 'gc:confirm'), Markup.button.callback('❌ Cancel', 'gc:cancel')],
  ]);
}

function formatRewardLines(data) {
  const lines = [];
  if (data.coins > 0) lines.push(`💰 ${bold(data.coins)} coins`);
  if (data.itemKey) lines.push(`🎒 ${getItemInfo(data.itemKey).emoji} ${bold(getItemInfo(data.itemKey).label)} x${data.itemQty}`);
  if (data.pokemonName) lines.push(`🐾 ${data.pokemonShiny ? '✨ Shiny ' : ''}${bold(data.pokemonName)}`);
  return lines.length ? lines.join('\n') : 'No reward configured';
}

function formatSummary(data) {
  const limitText = data.maxUses === null ? 'Unlimited' : `${data.maxUses} uses`;
  const expiryText = data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Never';
  return [
    bold('🎁 Confirm New Code'),
    '',
    `Code: ${bold(data.code)}`,
    '',
    'Reward(s):',
    formatRewardLines(data),
    '',
    `Usage limit: ${bold(limitText)}`,
    `Expires: ${bold(expiryText)}`,
  ].join('\n');
}

async function goToUsageLimitStep(ctx, adminId) {
  await ctx.reply(
    [bold('👥 Usage Limit'), '', 'How many players can redeem this code?'].join('\n'),
    { ...HTML, ...limitKeyboard() }
  );
}

async function goToExpiryStep(ctx) {
  await ctx.reply(
    [bold('⏳ Expiration'), '', 'When should this code stop working?'].join('\n'),
    { ...HTML, ...expiryKeyboard() }
  );
}

async function goToConfirmStep(ctx, session) {
  await ctx.reply(formatSummary(session.data), { ...HTML, ...confirmKeyboard() });
}

function register(bot) {
  const cancelWizard = async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    if (sessions.has(ctx.from.id)) {
      sessions.delete(ctx.from.id);
      await ctx.reply('❌ Code creation cancelled.');
    }
  };

  bot.command('generatecode', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('🛠 You must be an admin to do this.');
      return;
    }
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    sessions.set(ctx.from.id, newSession());
    await promptText(ctx, ctx.from.id, 'code', [
      bold('🎁 Create a Redeem Code'),
      '',
      'Reply to this message with a unique code (e.g. FF2026, DRAGON, EVENT01).',
    ].join('\n'));
  });

  bot.command('cancel', cancelWizard);

  bot.action('gc:cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.');
    sessions.delete(ctx.from.id);
    await ctx.editMessageText('❌ Code creation cancelled.');
  });

  // ---- Reward type selection ----
  bot.action(/^gc:type:(coins|item|pokemon|multi)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) {
      await ctx.answerCbQuery('No active wizard — run /generatecode again.', { show_alert: true });
      return;
    }
    const type = ctx.match[1];
    session.rewardMode = type;
    await ctx.answerCbQuery();

    if (type === 'coins') {
      await promptText(ctx, ctx.from.id, 'coins', '💰 Reply with the coin amount for this code.');
    } else if (type === 'item') {
      await ctx.reply(bold('🎒 Pick an item:'), { ...HTML, ...itemPickerKeyboard(0, false) });
    } else if (type === 'pokemon') {
      await ctx.reply(bold('🐾 Pick a rarity tier:'), { ...HTML, ...pokeTierKeyboard(false) });
    } else if (type === 'multi') {
      session.multiStage = 'coins';
      await promptText(ctx, ctx.from.id, 'coins', '💰 Reply with a coin amount (or 0 to skip coins for this code).');
    }
  });

  // ---- Item picker ----
  bot.action(/^gc:item:page:(\d+)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(bold('🎒 Pick an item:'), {
      ...HTML,
      ...itemPickerKeyboard(Number(ctx.match[1]), session.rewardMode === 'multi'),
    });
  });

  bot.action(/^gc:item:choose:(\w+)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    session.data.itemKey = ctx.match[1];
    await ctx.answerCbQuery();
    await promptText(ctx, ctx.from.id, 'item_qty', `🎒 Reply with the quantity of ${bold(getItemInfo(session.data.itemKey).label)} to grant.`);
  });

  bot.action('gc:item:skip', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery('Skipped.');
    session.multiStage = 'pokemon';
    await ctx.reply(bold('🐾 Pick a rarity tier (or skip):'), { ...HTML, ...pokeTierKeyboard(true) });
  });

  // ---- Pokémon picker ----
  bot.action('gc:poke:tiers', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(bold('🐾 Pick a rarity tier:'), {
      ...HTML,
      ...pokeTierKeyboard(session.rewardMode === 'multi'),
    });
  });

  bot.action(/^gc:poke:tier:(common|rare|legendary|mythical)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(`${TIER_LABELS[ctx.match[1]]} — pick a Pokémon:`, {
      ...HTML,
      ...pokeNamePickerKeyboard(ctx.match[1], 0),
    });
  });

  bot.action(/^gc:poke:page:(common|rare|legendary|mythical):(\d+)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageText(`${TIER_LABELS[ctx.match[1]]} — pick a Pokémon:`, {
      ...HTML,
      ...pokeNamePickerKeyboard(ctx.match[1], Number(ctx.match[2])),
    });
  });

  bot.action(/^gc:poke:choose:(.+)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    session.data.pokemonName = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply(`Is ${bold(session.data.pokemonName)} shiny?`, { ...HTML, ...shinyKeyboard() });
  });

  bot.action('gc:poke:skip', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery('Skipped.');
    await goToUsageLimitStep(ctx, ctx.from.id);
  });

  bot.action(/^gc:poke:shiny:(yes|no)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    session.data.pokemonShiny = ctx.match[1] === 'yes';
    await ctx.answerCbQuery();
    await goToUsageLimitStep(ctx, ctx.from.id);
  });

  // ---- Usage limit ----
  bot.action(/^gc:limit:(5|10|100|unlimited)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    session.data.maxUses = ctx.match[1] === 'unlimited' ? null : Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await goToExpiryStep(ctx);
  });

  bot.action('gc:limit:custom', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await promptText(ctx, ctx.from.id, 'limit_custom', '✏️ Reply with the maximum number of redemptions (a positive whole number).');
  });

  // ---- Expiry ----
  bot.action(/^gc:expiry:(never|1h|24h|7d|30d)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    const preset = ctx.match[1];
    const durations = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
    session.data.expiresAt = preset === 'never' ? null : new Date(Date.now() + durations[preset]).toISOString();
    await ctx.answerCbQuery();
    await goToConfirmStep(ctx, session);
  });

  bot.action('gc:expiry:custom', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await promptText(ctx, ctx.from.id, 'expiry_custom', '✏️ Reply with a date/time, e.g. "2026-08-01 18:00".');
  });

  // ---- Confirm ----
  bot.action('gc:confirm', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();

    let created;
    try {
      created = promoCodesDb.createCode(session.data.code, {
        coins: session.data.coins,
        itemKey: session.data.itemKey,
        itemQty: session.data.itemQty,
        pokemonName: session.data.pokemonName,
        pokemonShiny: session.data.pokemonShiny,
        maxUses: session.data.maxUses,
        expiresAt: session.data.expiresAt,
        createdBy: ctx.from.id,
      });
    } catch (err) {
      sessions.delete(ctx.from.id);
      await ctx.editMessageText(`⚠️ Failed to create the code: ${err.message}`);
      return;
    }

    sessions.delete(ctx.from.id);
    await ctx.editMessageText([`✅ Code ${bold(created)} created!`, '', formatRewardLines(session.data)].join('\n'), HTML);
  });

  // ---- Text handler for every force-reply step ----
  bot.on('text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !pendingPrompts.has(replyTo.message_id)) return next ? next() : undefined;

    const pending = pendingPrompts.get(replyTo.message_id);
    if (ctx.from.id !== pending.adminId || !isAdmin(ctx.from.id)) return next ? next() : undefined;
    pendingPrompts.delete(replyTo.message_id);

    const session = sessions.get(pending.adminId);
    if (!session) {
      await ctx.reply('This code-creation session expired — run /generatecode again.');
      return;
    }

    const text = ctx.message.text.trim();

    if (pending.field === 'code') {
      const valid = /^[A-Za-z0-9_-]+$/.test(text);
      if (!valid) {
        await promptText(ctx, pending.adminId, 'code', '⚠️ Codes can only contain letters, numbers, "_" and "-". Reply with a unique code.');
        return;
      }
      if (promoCodesDb.getCode(text)) {
        await promptText(ctx, pending.adminId, 'code', `⚠️ Code "${text.toUpperCase()}" already exists. Reply with a different code.`);
        return;
      }
      session.data.code = text.toUpperCase();
      await ctx.reply(bold('🎯 Select Reward Type'), { ...HTML, ...rewardTypeKeyboard() });
      return;
    }

    if (pending.field === 'coins') {
      const amount = Number(text);
      if (!Number.isInteger(amount) || amount < 0) {
        await promptText(ctx, pending.adminId, 'coins', '⚠️ Please reply with a whole number of coins (0 or more).');
        return;
      }
      session.data.coins = amount;
      if (session.rewardMode === 'coins') {
        await goToUsageLimitStep(ctx, pending.adminId);
      } else {
        session.multiStage = 'item';
        await ctx.reply(bold('🎒 Pick an item (or skip):'), { ...HTML, ...itemPickerKeyboard(0, true) });
      }
      return;
    }

    if (pending.field === 'item_qty') {
      const qty = Number(text);
      if (!Number.isInteger(qty) || qty <= 0) {
        await promptText(ctx, pending.adminId, 'item_qty', '⚠️ Please reply with a positive whole number for the quantity.');
        return;
      }
      session.data.itemQty = qty;
      if (session.rewardMode === 'item') {
        await goToUsageLimitStep(ctx, pending.adminId);
      } else {
        session.multiStage = 'pokemon';
        await ctx.reply(bold('🐾 Pick a rarity tier (or skip):'), { ...HTML, ...pokeTierKeyboard(true) });
      }
      return;
    }

    if (pending.field === 'limit_custom') {
      const limit = Number(text);
      if (!Number.isInteger(limit) || limit <= 0) {
        await promptText(ctx, pending.adminId, 'limit_custom', '⚠️ Please reply with a positive whole number.');
        return;
      }
      session.data.maxUses = limit;
      await goToExpiryStep(ctx);
      return;
    }

    if (pending.field === 'expiry_custom') {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        await promptText(
          ctx,
          pending.adminId,
          'expiry_custom',
          '⚠️ Could not parse that date, or it\'s already in the past. Reply with a future date/time, e.g. "2026-08-01 18:00".'
        );
        return;
      }
      session.data.expiresAt = parsed.toISOString();
      await goToConfirmStep(ctx, session);
      return;
    }
  });
}

module.exports = { register };
