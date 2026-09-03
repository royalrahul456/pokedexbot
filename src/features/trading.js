const { Markup } = require('telegraf');
const tradesDb = require('../db/trades');
const users = require('../db/users');
const { getItemInfo } = require('../data/items');
const { escapeHtml, bold, HTML, brandTag } = require('../utils/text');
const { getTunnelUrl } = require('../webapp/tunnelUrl');

// Pub-sub so the Mini App backend (src/webapp/server.js) can push live updates to both sides'
// browsers the instant either one changes their offer — same shape as bossRaid.js/battle.js's
// onRaidChange/onBattleChange, kept independent per feature rather than a shared bus.
const tradeChangeListeners = [];
function onTradeChange(fn) {
  tradeChangeListeners.push(fn);
}
function emitTradeChange(tradeId) {
  const trade = tradesDb.getTrade(tradeId);
  if (!trade) return;
  for (const fn of tradeChangeListeners) {
    try {
      fn(trade);
    } catch (err) {
      console.error('Trade change listener threw (ignored):', err.message);
    }
  }
}

function targetFromReply(ctx) {
  const repliedUser = ctx.message.reply_to_message?.from;
  if (!repliedUser || repliedUser.is_bot) return null;
  return repliedUser;
}

function displayName(user) {
  return escapeHtml(user.username || user.first_name || 'Trainer');
}

function tradeStatusLine(trade, initiatorName, targetName) {
  const iReady = trade.initiator_ready ? '✅ Ready' : '⏳ Building offer';
  const tReady = trade.target_ready ? '✅ Ready' : '⏳ Building offer';
  return `${initiatorName}: ${iReady}  |  ${targetName}: ${tReady}`;
}

function groupTradeText(trade, initiatorName, targetName) {
  return [
    brandTag(),
    bold('🔄 Trade Started'),
    '',
    `${bold(initiatorName)} ↔ ${bold(targetName)}`,
    '',
    'Both trainers: tap 📦 Build My Offer below (opens a private DM) to add Pokémon, items, and/or Coins to your side. This works for a straight swap (both sides give 0 Coins) or a paid deal (one side offers Coins for the other\'s Pokémon/items) — whatever you two agree on.',
    '',
    tradeStatusLine(trade, initiatorName, targetName),
    '',
    'The trade completes automatically the instant both sides tap Ready.',
  ].join('\n');
}

function groupTradeKeyboard(tradeId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📦 Build My Offer', `trade:${tradeId}:offer`)],
    [Markup.button.callback('❌ Cancel Trade', `trade:${tradeId}:cancel`)],
  ]);
}

async function sendOfferLinkDM(telegram, userId, tradeId) {
  const tunnelUrl = getTunnelUrl();
  if (!tunnelUrl) {
    try {
      await telegram.sendMessage(
        userId,
        '⚠️ The Trade window is temporarily unavailable (the app server is offline right now) — ask whoever runs the bot to check it, then try tapping 📦 Build My Offer again.'
      );
    } catch (err) {
      // Can't even DM the "unavailable" notice — nothing more to do.
    }
    return false;
  }
  try {
    await telegram.sendMessage(userId, bold('🔄 Tap below to build your side of the trade:'), {
      ...HTML,
      ...Markup.inlineKeyboard([[Markup.button.webApp('📦 Open Trade Window', `${tunnelUrl}/trade.html?tradeId=${tradeId}`)]]),
    });
    return true;
  } catch (err) {
    console.error(`Failed to DM Trade Window link to user ${userId} (harmless — they can tap the group button again):`, err.message);
    return false;
  }
}

function formatOfferLine(offer) {
  const parts = [];
  if (offer.pokemon.length) {
    parts.push(offer.pokemon.map((p) => `${p.species_name}${p.shiny ? ' ✨' : ''}`).join(', '));
  }
  for (const item of offer.items) {
    const info = getItemInfo(item.item_key);
    parts.push(`${info.emoji} ${info.label} x${item.quantity}`);
  }
  return parts.length ? parts.join(', ') : null;
}

// Attempts to execute the trade (both sides marked ready). On success, edits the group message
// and DMs both sides a receipt. On failure (something changed since offers were built — an item
// got used elsewhere, a Pokémon got traded away some other way), un-readies both sides and tells
// them plainly what broke rather than silently completing a partial/wrong trade.
async function tryExecute(telegram, tradeId) {
  const trade = tradesDb.getTrade(tradeId);
  if (!trade || trade.status !== 'pending') return;
  if (!trade.initiator_ready || !trade.target_ready) return;

  const result = tradesDb.executeTrade(tradeId);
  if (!result.ok) {
    tradesDb.setReady(tradeId, 'initiator', false);
    tradesDb.setReady(tradeId, 'target', false);
    const reasonText = {
      pokemon_no_longer_owned: "a Pokémon in the offer isn't owned by that side anymore",
      item_no_longer_available: "an item in the offer isn't available anymore",
      coins_no_longer_available: "one side no longer has enough Coins",
      empty_trade: 'the offer is empty — add something before marking Ready',
      execution_error: 'something went wrong completing the trade',
    }[result.reason] || 'something changed since the offer was built';
    for (const uid of [trade.initiator_id, trade.target_id]) {
      try {
        await telegram.sendMessage(uid, `⚠️ Trade #${tradeId} couldn't complete — ${reasonText}. Please review your offer and mark Ready again.`);
      } catch (err) {
        // best-effort
      }
    }
    emitTradeChange(tradeId);
    return;
  }

  const initiatorProfile = users.getProfile(trade.chat_id, trade.initiator_id);
  const targetProfile = users.getProfile(trade.chat_id, trade.target_id);
  const initiatorName = escapeHtml(initiatorProfile?.username || `Trainer ${trade.initiator_id}`);
  const targetName = escapeHtml(targetProfile?.username || `Trainer ${trade.target_id}`);
  const initiatorLine = formatOfferLine(result.offers.initiator) || 'nothing';
  const targetLine = formatOfferLine(result.offers.target) || 'nothing';
  const initiatorCoinsLine = trade.initiator_coins > 0 ? ` + 🪙${trade.initiator_coins}` : '';
  const targetCoinsLine = trade.target_coins > 0 ? ` + 🪙${trade.target_coins}` : '';

  const summary = [
    bold('✅ Trade Complete!'),
    '',
    `${bold(initiatorName)} gave: ${escapeHtml(initiatorLine)}${initiatorCoinsLine}`,
    `${bold(targetName)} gave: ${escapeHtml(targetLine)}${targetCoinsLine}`,
  ].join('\n');

  if (trade.message_id) {
    try {
      await telegram.editMessageText(trade.chat_id, trade.message_id, undefined, summary, HTML);
    } catch (err) {
      try {
        await telegram.sendMessage(trade.chat_id, summary, HTML);
      } catch (err2) {
        // best-effort
      }
    }
  }
  for (const uid of [trade.initiator_id, trade.target_id]) {
    try {
      await telegram.sendMessage(uid, summary, HTML);
    } catch (err) {
      // best-effort — group message already shows the result
    }
  }
  emitTradeChange(tradeId);
}

// Idle-timeout sweep — trades untouched for 30+ minutes auto-cancel (see trades.js). Runs every
// 5 minutes, same cadence style as Team Wars' resolution sweep.
function startStaleTradeSweep(bot) {
  setInterval(async () => {
    const stale = tradesDb.listStaleTrades();
    for (const trade of stale) {
      tradesDb.cancelTrade(trade.id, 'expired');
      if (trade.message_id) {
        try {
          await bot.telegram.editMessageText(
            trade.chat_id,
            trade.message_id,
            undefined,
            '⌛ This trade expired from inactivity (30+ minutes with no changes). Run /trade again to start a new one.',
            HTML
          );
        } catch (err) {
          // best-effort
        }
      }
      emitTradeChange(trade.id);
    }
  }, 5 * 60 * 1000).unref();
}

function register(bot) {
  bot.command('trade', async (ctx) => {
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
      await ctx.reply('🔄 Run /trade inside a group, replying to the trainer you want to trade with.');
      return;
    }
    const initiator = ctx.from;
    users.getOrCreateUser(ctx.chat.id, initiator.id, initiator.username || initiator.first_name);

    const target = targetFromReply(ctx);
    if (!target) {
      await ctx.reply("🔄 Reply to another trainer's message with /trade to start a trade with them.");
      return;
    }
    if (target.id === initiator.id) {
      await ctx.reply("You can't trade with yourself.");
      return;
    }
    users.getOrCreateUser(ctx.chat.id, target.id, target.username || target.first_name);

    const existingInitiator = tradesDb.getActiveTradeForUser(initiator.id);
    if (existingInitiator) {
      await ctx.reply('🔄 You already have a pending trade — finish or /canceltrade it before starting another.');
      return;
    }
    const existingTarget = tradesDb.getActiveTradeForUser(target.id);
    if (existingTarget) {
      await ctx.reply(`🔄 ${displayName(target)} already has a pending trade — try again once they're done.`, HTML);
      return;
    }

    const trade = tradesDb.createTrade(ctx.chat.id, initiator.id, target.id);
    const text = groupTradeText(trade, displayName(initiator), displayName(target));
    const sent = await ctx.reply(text, { ...HTML, ...groupTradeKeyboard(trade.id) });
    tradesDb.setMessageId(trade.id, sent.message_id);
  });

  bot.command('canceltrade', async (ctx) => {
    const active = tradesDb.getActiveTradeForUser(ctx.from.id);
    if (!active) {
      await ctx.reply("You don't have a pending trade right now.");
      return;
    }
    tradesDb.cancelTrade(active.id, 'cancelled');
    if (active.message_id) {
      try {
        await ctx.telegram.editMessageText(
          active.chat_id,
          active.message_id,
          undefined,
          `❌ Trade #${active.id} was cancelled by ${displayName(ctx.from)}.`,
          HTML
        );
      } catch (err) {
        // best-effort
      }
    }
    emitTradeChange(active.id);
    await ctx.reply('❌ Trade cancelled.');
  });

  bot.action(/^trade:(\d+):offer$/, async (ctx) => {
    const tradeId = Number(ctx.match[1]);
    const trade = tradesDb.getTrade(tradeId);
    if (!trade || trade.status !== 'pending') {
      await ctx.answerCbQuery('This trade is no longer active.', { show_alert: true });
      return;
    }
    const side = tradesDb.sideFor(trade, ctx.from.id);
    if (!side) {
      await ctx.answerCbQuery("This isn't your trade.", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const sent = await sendOfferLinkDM(ctx.telegram, ctx.from.id, tradeId);
    if (!sent && getTunnelUrl()) {
      // Tunnel is up but the DM itself failed (bot can't message them first) — tell them in-group.
      await ctx.reply(
        `📩 ${bold(displayName(ctx.from))}: I couldn't DM you the Trade Window link — tap my name, hit Start, then tap 📦 Build My Offer again.`,
        HTML
      );
    }
  });

  bot.action(/^trade:(\d+):cancel$/, async (ctx) => {
    const tradeId = Number(ctx.match[1]);
    const trade = tradesDb.getTrade(tradeId);
    if (!trade || trade.status !== 'pending') {
      await ctx.answerCbQuery('This trade is no longer active.', { show_alert: true });
      return;
    }
    const side = tradesDb.sideFor(trade, ctx.from.id);
    if (!side) {
      await ctx.answerCbQuery("This isn't your trade.", { show_alert: true });
      return;
    }
    tradesDb.cancelTrade(tradeId, 'cancelled');
    await ctx.answerCbQuery('Trade cancelled.');
    try {
      await ctx.editMessageText(`❌ Trade #${tradeId} was cancelled by ${displayName(ctx.from)}.`, HTML);
    } catch (err) {
      // best-effort
    }
    emitTradeChange(tradeId);
  });

  // Keeps the group's status message in sync as either side's offer/ready state changes (fired
  // from the Mini App's REST handlers in webapp/server.js) — best-effort, a failed edit never
  // blocks the underlying trade logic.
  onTradeChange(async (trade) => {
    if (trade.status !== 'pending' || !trade.message_id) return;
    const initiatorProfile = users.getProfile(trade.chat_id, trade.initiator_id);
    const targetProfile = users.getProfile(trade.chat_id, trade.target_id);
    const initiatorName = displayName({ username: initiatorProfile?.username, first_name: null });
    const targetName = displayName({ username: targetProfile?.username, first_name: null });
    try {
      await bot.telegram.editMessageText(
        trade.chat_id,
        trade.message_id,
        undefined,
        groupTradeText(trade, initiatorName, targetName),
        { ...HTML, ...groupTradeKeyboard(trade.id) }
      );
    } catch (err) {
      // best-effort — message may be identical (Telegram 400s on no-op edits) or unreachable
    }
    if (trade.initiator_ready && trade.target_ready) {
      await tryExecute(bot.telegram, trade.id);
    }
  });

  startStaleTradeSweep(bot);
}

// Full state for the Mini App — both sides see each other's complete offer (unlike raid HP,
// there's no strategic reason to hide anything in a trade; both parties need full visibility to
// agree to a deal). `viewerUserId` only determines which side is labeled "you" vs "them".
function sanitizeTradeForWeb(trade, viewerUserId) {
  const viewerSide = tradesDb.sideFor(trade, viewerUserId);
  const initiatorProfile = users.getProfile(trade.chat_id, trade.initiator_id);
  const targetProfile = users.getProfile(trade.chat_id, trade.target_id);
  return {
    id: trade.id,
    status: trade.status,
    viewerSide,
    initiator: {
      userId: trade.initiator_id,
      name: initiatorProfile?.username || `Trainer ${trade.initiator_id}`,
      ready: !!trade.initiator_ready,
      coins: trade.initiator_coins,
      offer: tradesDb.getOffer(trade.id, 'initiator'),
      coinBalance: initiatorProfile?.coins ?? 0,
    },
    target: {
      userId: trade.target_id,
      name: targetProfile?.username || `Trainer ${trade.target_id}`,
      ready: !!trade.target_ready,
      coins: trade.target_coins,
      offer: tradesDb.getOffer(trade.id, 'target'),
      coinBalance: targetProfile?.coins ?? 0,
    },
  };
}

module.exports = { register, onTradeChange, emitTradeChange, tryExecute, sanitizeTradeForWeb };
