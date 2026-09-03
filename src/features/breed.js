const { Markup } = require('telegraf');
const users = require('../db/users');
const pokemonCollectionDb = require('../db/pokemonCollection');
const friendshipsDb = require('../db/friendships');
const cooldowns = require('../db/cooldowns');
const inventory = require('../db/inventory');
const { getItemInfo } = require('../data/items');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatDuration } = require('../utils/format');

const PAGE_SIZE = 6;
const BREED_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const BREED_COOLDOWN_KEY = 'breed';
// Breeding cooldowns are global (not tied to which group you breed in), same trick /gift
// uses for its own daily cooldown.
const GLOBAL_COOLDOWN_CHAT = 0;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const RARITY_RANK = { common: 0, rare: 1, legendary: 2, mythical: 3 };
const RARITY_TAG = { common: '', rare: '⭐', legendary: '🐉', mythical: '🌟' };

// A solo trainer's two-step "pick parent 1, then parent 2" session.
const soloSessions = new Map(); // userId -> { choices, parent1Idx: null }
// A cross-trainer breed request, from the moment the initiator picks their own parent
// through the friend accepting/declining.
const crossRequests = new Map(); // requestId -> {...}
let nextRequestId = 1;

function displayName(user) {
  return escapeHtml(user.username || user.first_name || 'Trainer');
}

function eligibleCollection(userId) {
  return pokemonCollectionDb.listCollection(userId).filter((row) => row.quantity > 0);
}

function pickLabel(row) {
  const tag = RARITY_TAG[row.base_rarity] || '';
  const shiny = row.shiny ? '✨' : '';
  return `${tag}${shiny}${row.species_name}`;
}

function eggTierFor(rarityA, rarityB) {
  const maxRank = Math.max(RARITY_RANK[rarityA] ?? 0, RARITY_RANK[rarityB] ?? 0);
  return maxRank >= 1 ? 'egg_rare' : 'egg_common';
}

function paginate(arr, page) {
  const start = page * PAGE_SIZE;
  return { slice: arr.slice(start, start + PAGE_SIZE), hasPrev: page > 0, hasNext: start + PAGE_SIZE < arr.length };
}

function pickerKeyboard(prefix, choices, page) {
  const { slice, hasPrev, hasNext } = paginate(choices, page);
  const rows = slice.map((row, i) => {
    const idx = page * PAGE_SIZE + i;
    return [Markup.button.callback(pickLabel(row), `${prefix}:pick:${idx}`)];
  });
  const nav = [];
  if (hasPrev) nav.push(Markup.button.callback('⬅️ Prev', `${prefix}:page:${page - 1}`));
  if (hasNext) nav.push(Markup.button.callback('Next ➡️', `${prefix}:page:${page + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

function pickerWithDeclineKeyboard(prefix, choices, page, requestId) {
  const keyboard = pickerKeyboard(prefix, choices, page);
  keyboard.reply_markup.inline_keyboard.push([
    Markup.button.callback('❌ Decline', `breed:cross:${requestId}:decline`),
  ]);
  return keyboard;
}

function grantEgg(userId, eggKey, label) {
  inventory.addItem(userId, eggKey, 1);
  return `${getItemInfo(eggKey).emoji} ${bold(label)} got a ${bold(getItemInfo(eggKey).label)}! Incubate it with /egg.`;
}

function register(bot) {
  bot.command('breed', async (ctx) => {
    const chatId = ctx.chat.id;
    const initiator = ctx.from;
    users.getOrCreateUser(chatId, initiator.id, initiator.username || initiator.first_name);

    const status = cooldowns.checkCooldown(GLOBAL_COOLDOWN_CHAT, initiator.id, BREED_COOLDOWN_KEY, BREED_COOLDOWN_MS);
    if (!status.ready) {
      await ctx.reply(`🥚 You already bred recently. Try again in ${bold(formatDuration(status.msRemaining))}.`, HTML);
      return;
    }

    const repliedUser = ctx.message.reply_to_message?.from;
    const targetId = repliedUser && !repliedUser.is_bot ? repliedUser.id : null;

    if (targetId) {
      if (targetId === initiator.id) {
        await ctx.reply("You can't breed with yourself that way — just send /breed with no reply to use two of your own Pokémon.");
        return;
      }
      if (!friendshipsDb.areFriends(initiator.id, targetId)) {
        await ctx.reply('🥚 You can only breed with a friend\'s Pokémon — send them a /friend request first.');
        return;
      }
      const myChoices = eligibleCollection(initiator.id);
      if (myChoices.length === 0) {
        await ctx.reply("🥚 You don't have any Pokémon to breed — catch some first!");
        return;
      }

      users.getOrCreateUser(chatId, targetId, repliedUser.username || repliedUser.first_name);
      const requestId = nextRequestId++;
      crossRequests.set(requestId, {
        chatId,
        initiatorId: initiator.id,
        initiatorName: displayName(initiator),
        targetId,
        targetName: displayName(repliedUser),
        myChoices,
        myPick: null,
        theirChoices: null,
        theirPick: null,
        requestMsgId: null,
        timeoutHandle: null,
      });

      await ctx.reply(
        [bold('🥚 Pick which of YOUR Pokémon to offer for breeding:')].join('\n'),
        { ...HTML, ...pickerKeyboard(`breed:cross:${requestId}:mine`, myChoices, 0) }
      );
      return;
    }

    // Solo mode — breed two of your own Pokémon.
    const choices = eligibleCollection(initiator.id);
    if (choices.length < 2) {
      await ctx.reply('🥚 You need at least 2 different Pokémon in your collection to breed.');
      return;
    }
    soloSessions.set(initiator.id, { choices, parent1Idx: null });
    await ctx.reply(
      bold('🥚 Pick the first parent:'),
      { ...HTML, ...pickerKeyboard('breed:solo', choices, 0) }
    );
  });

  // ---- Solo breeding ----
  bot.action(/^breed:solo:page:(\d+)$/, async (ctx) => {
    const session = soloSessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active breeding session — run /breed again.', { show_alert: true });
    await ctx.answerCbQuery();
    const prefix = session.parent1Idx === null ? 'breed:solo' : 'breed:solo2';
    await ctx.editMessageReplyMarkup(pickerKeyboard(prefix, session.choices, Number(ctx.match[1])).reply_markup);
  });

  bot.action(/^breed:solo2:page:(\d+)$/, async (ctx) => {
    const session = soloSessions.get(ctx.from.id);
    if (!session || session.parent1Idx === null) return ctx.answerCbQuery('No active breeding session.', { show_alert: true });
    await ctx.answerCbQuery();
    const remaining = session.choices.filter((_, i) => i !== session.parent1Idx);
    await ctx.editMessageReplyMarkup(pickerKeyboard('breed:solo2', remaining, Number(ctx.match[1])).reply_markup);
  });

  bot.action(/^breed:solo:pick:(\d+)$/, async (ctx) => {
    const session = soloSessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active breeding session — run /breed again.', { show_alert: true });
    const idx = Number(ctx.match[1]);
    const parent1 = session.choices[idx];
    if (!parent1) return ctx.answerCbQuery('Invalid pick.', { show_alert: true });

    session.parent1Idx = idx;
    await ctx.answerCbQuery(`Parent 1: ${parent1.species_name}`);
    const remaining = session.choices.filter((_, i) => i !== idx);
    await ctx.editMessageText(
      `Parent 1: ${bold(pickLabel(parent1))}\n\n${bold('Now pick the second parent:')}`,
      { ...HTML, ...pickerKeyboard('breed:solo2', remaining, 0) }
    );
  });

  bot.action(/^breed:solo2:pick:(\d+)$/, async (ctx) => {
    const session = soloSessions.get(ctx.from.id);
    if (!session || session.parent1Idx === null) return ctx.answerCbQuery('No active breeding session.', { show_alert: true });
    const remaining = session.choices.filter((_, i) => i !== session.parent1Idx);
    const idx = Number(ctx.match[1]);
    const parent2 = remaining[idx];
    const parent1 = session.choices[session.parent1Idx];
    if (!parent2) return ctx.answerCbQuery('Invalid pick.', { show_alert: true });

    soloSessions.delete(ctx.from.id);
    cooldowns.useCooldown(GLOBAL_COOLDOWN_CHAT, ctx.from.id, BREED_COOLDOWN_KEY);

    const eggKey = eggTierFor(parent1.base_rarity, parent2.base_rarity);
    inventory.addItem(ctx.from.id, eggKey, 1);
    await ctx.answerCbQuery('Bred!');
    await ctx.editMessageText(
      [
        `🥚 ${bold(pickLabel(parent1))} + ${bold(pickLabel(parent2))} bred successfully!`,
        '',
        `You got a ${bold(getItemInfo(eggKey).label)} ${getItemInfo(eggKey).emoji} — incubate it with /egg.`,
      ].join('\n'),
      HTML
    );
  });

  // ---- Cross-trainer breeding ----
  bot.action(/^breed:cross:(\d+):mine:page:(\d+)$/, async (ctx) => {
    const req = crossRequests.get(Number(ctx.match[1]));
    if (!req) return ctx.answerCbQuery('This request is no longer available.', { show_alert: true });
    if (ctx.from.id !== req.initiatorId) return ctx.answerCbQuery("This isn't your picker.", { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      pickerKeyboard(`breed:cross:${ctx.match[1]}:mine`, req.myChoices, Number(ctx.match[2])).reply_markup
    );
  });

  bot.action(/^breed:cross:(\d+):mine:pick:(\d+)$/, async (ctx) => {
    const requestId = Number(ctx.match[1]);
    const req = crossRequests.get(requestId);
    if (!req) return ctx.answerCbQuery('This request is no longer available.', { show_alert: true });
    if (ctx.from.id !== req.initiatorId) return ctx.answerCbQuery("This isn't your picker.", { show_alert: true });

    const idx = Number(ctx.match[2]);
    const parent = req.myChoices[idx];
    if (!parent) return ctx.answerCbQuery('Invalid pick.', { show_alert: true });

    req.myPick = parent;
    await ctx.answerCbQuery(`Offering: ${parent.species_name}`);
    await ctx.editMessageText(
      `🥚 ${bold(req.initiatorName)} is offering ${bold(pickLabel(parent))} to breed! Waiting on ${bold(req.targetName)}...`,
      HTML
    );

    req.theirChoices = eligibleCollection(req.targetId);
    if (req.theirChoices.length === 0) {
      crossRequests.delete(requestId);
      await ctx.telegram.sendMessage(
        req.chatId,
        `⚠️ ${bold(req.targetName)} has no Pokémon to breed with. Request cancelled.`,
        HTML
      );
      return;
    }

    const requestMsg = await ctx.telegram.sendMessage(
      req.chatId,
      [
        bold(`🥚 ${req.initiatorName} wants to breed with your Pokémon, ${req.targetName}!`),
        '',
        `They're offering ${bold(pickLabel(parent))}. Pick one of yours to breed with it:`,
      ].join('\n'),
      { ...HTML, ...pickerWithDeclineKeyboard(`breed:cross:${requestId}:theirs`, req.theirChoices, 0, requestId) }
    );
    req.requestMsgId = requestMsg.message_id;

    req.timeoutHandle = setTimeout(async () => {
      if (!crossRequests.has(requestId)) return;
      crossRequests.delete(requestId);
      try {
        await ctx.telegram.editMessageText(
          req.chatId,
          requestMsg.message_id,
          undefined,
          '⌛ Breeding request expired — nobody responded in time.',
          HTML
        );
      } catch (err) {
        console.error('Failed to edit expired breed request:', err.message);
      }
    }, REQUEST_TTL_MS);
  });

  bot.action(/^breed:cross:(\d+):theirs:page:(\d+)$/, async (ctx) => {
    const req = crossRequests.get(Number(ctx.match[1]));
    if (!req) return ctx.answerCbQuery('This request is no longer available.', { show_alert: true });
    if (ctx.from.id !== req.targetId) return ctx.answerCbQuery("This isn't your picker.", { show_alert: true });
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      pickerWithDeclineKeyboard(`breed:cross:${ctx.match[1]}:theirs`, req.theirChoices, Number(ctx.match[2]), Number(ctx.match[1]))
        .reply_markup
    );
  });

  bot.action(/^breed:cross:(\d+):theirs:pick:(\d+)$/, async (ctx) => {
    const requestId = Number(ctx.match[1]);
    const req = crossRequests.get(requestId);
    if (!req) return ctx.answerCbQuery('This request is no longer available.', { show_alert: true });
    if (ctx.from.id !== req.targetId) return ctx.answerCbQuery("This isn't your picker.", { show_alert: true });

    const idx = Number(ctx.match[2]);
    const theirParent = req.theirChoices[idx];
    if (!theirParent) return ctx.answerCbQuery('Invalid pick.', { show_alert: true });

    clearTimeout(req.timeoutHandle);
    crossRequests.delete(requestId);
    cooldowns.useCooldown(GLOBAL_COOLDOWN_CHAT, req.initiatorId, BREED_COOLDOWN_KEY);

    const eggKey = eggTierFor(req.myPick.base_rarity, theirParent.base_rarity);
    await ctx.answerCbQuery('Bred!');

    const initiatorLine = grantEgg(req.initiatorId, eggKey, req.initiatorName);
    const targetLine = grantEgg(req.targetId, eggKey, req.targetName);

    await ctx.editMessageText(
      [
        `🥚 ${bold(pickLabel(req.myPick))} + ${bold(pickLabel(theirParent))} bred successfully!`,
        '',
        `Both trainers got a ${bold(getItemInfo(eggKey).label)} ${getItemInfo(eggKey).emoji}!`,
        initiatorLine,
        targetLine,
      ].join('\n'),
      HTML
    );
  });

  bot.action(/^breed:cross:(\d+):decline$/, async (ctx) => {
    const requestId = Number(ctx.match[1]);
    const req = crossRequests.get(requestId);
    if (!req) return ctx.answerCbQuery('Already gone.');
    if (ctx.from.id !== req.targetId) return ctx.answerCbQuery("This isn't your request.", { show_alert: true });
    clearTimeout(req.timeoutHandle);
    crossRequests.delete(requestId);
    await ctx.answerCbQuery('Declined.');
    await ctx.editMessageText(`❌ ${bold(req.targetName)} declined the breeding request.`, HTML);
  });
}

module.exports = { register };
