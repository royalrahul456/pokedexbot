const cron = require('node-cron');
const { Markup } = require('telegraf');
const { listActiveGroups } = require('../db/groups');
const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { deactivateIfGroupGone } = require('../utils/groupHealth');
const { ADMIN_IDS } = require('../config');
const spawnFeature = require('./spawn');

// Checked every 15 minutes per active group; each check independently rolls this chance,
// so no group can predict or schedule around it — that's the whole point vs. Seasonal Events,
// which are deliberately admin-announced ahead of time.
const TRIGGER_CHANCE = 0.04;
const CLAIM_RACE_WINNERS = 3;
const CLAIM_RACE_COINS = 75;
const CLAIM_RACE_TTL_MS = 5 * 60 * 1000;

const claimRaces = new Map(); // raceId -> { chatId, claimedUserIds: [], messageId, timeoutHandle }
let nextRaceId = 1;

function raceKeyboard(raceId) {
  return Markup.inlineKeyboard([Markup.button.callback('🎁 Claim!', `hidden:claim:${raceId}`)]);
}

// `closeReason` is undefined while still open, 'full' once all slots are claimed, or
// 'expired' once the 5-minute window runs out with slots still unclaimed — these need
// different text, otherwise a timeout with e.g. only 1/3 claimed misleadingly says
// "All spots claimed" (a real bug a user caught: race timed out with 1 claim, button
// vanished, and the message still claimed the race was full).
function raceText(race, closeReason) {
  const names = race.claimedUserIds.map((c) => bold(escapeHtml(c.name))).join(', ') || 'nobody yet';
  const lines = [
    bold('💰 Surprise Bonus!'),
    '',
    `First ${bold(CLAIM_RACE_WINNERS)} trainers to tap Claim win ${bold(CLAIM_RACE_COINS)} coins each!`,
    '',
    `Claimed so far: ${names}`,
  ];
  if (closeReason === 'full') lines.push('', '🏁 All spots claimed — see you next surprise!');
  if (closeReason === 'expired') lines.push('', '⌛ Time\'s up — this surprise has closed. See you next time!');
  return lines.join('\n');
}

async function startClaimRace(bot, chatId) {
  const raceId = nextRaceId++;
  const race = { chatId, claimedUserIds: [], messageId: null, timeoutHandle: null };
  claimRaces.set(raceId, race);

  const sent = await bot.telegram.sendMessage(chatId, raceText(race), { ...HTML, ...raceKeyboard(raceId) });
  race.messageId = sent.message_id;

  race.timeoutHandle = setTimeout(async () => {
    if (!claimRaces.has(raceId)) return;
    claimRaces.delete(raceId);
    try {
      await bot.telegram.editMessageText(chatId, sent.message_id, undefined, raceText(race, 'expired'), HTML);
    } catch (err) {
      console.error('Failed to close expired claim race:', err.message);
    }
  }, CLAIM_RACE_TTL_MS);
}

async function startSurpriseSpawn(bot, chatId) {
  await spawnFeature.doSpawn(bot.telegram, chatId, '✨ Surprise! An extra wild Pokémon just appeared out of nowhere!');
}

async function triggerHiddenEvent(bot, chatId) {
  const type = Math.random() < 0.5 ? 'claim_race' : 'surprise_spawn';
  if (type === 'claim_race') {
    await startClaimRace(bot, chatId);
  } else {
    await startSurpriseSpawn(bot, chatId);
  }
}

function register(bot) {
  cron.schedule('*/15 * * * *', async () => {
    for (const group of listActiveGroups()) {
      if (Math.random() >= TRIGGER_CHANCE) continue;
      try {
        await triggerHiddenEvent(bot, group.chat_id);
      } catch (err) {
        console.error(`Failed to trigger hidden event for chat ${group.chat_id}:`, err.message);
        deactivateIfGroupGone(group.chat_id, err, 'hidden event');
      }
    }
  });

  bot.action(/^hidden:claim:(\d+)$/, async (ctx) => {
    const raceId = Number(ctx.match[1]);
    const race = claimRaces.get(raceId);
    if (!race) {
      await ctx.answerCbQuery('This bonus is no longer available.', { show_alert: true });
      return;
    }
    if (race.claimedUserIds.some((c) => c.userId === ctx.from.id)) {
      await ctx.answerCbQuery("You already claimed this one!");
      return;
    }
    if (race.claimedUserIds.length >= CLAIM_RACE_WINNERS) {
      await ctx.answerCbQuery('Too slow — all spots are taken!');
      return;
    }

    const username = ctx.from.username || ctx.from.first_name;
    users.getOrCreateUser(race.chatId, ctx.from.id, username);
    grantRewards(race.chatId, ctx.from.id, { coins: CLAIM_RACE_COINS });
    race.claimedUserIds.push({ userId: ctx.from.id, name: username });

    const finished = race.claimedUserIds.length >= CLAIM_RACE_WINNERS;
    await ctx.answerCbQuery(`+${CLAIM_RACE_COINS} coins!`);
    if (finished) {
      clearTimeout(race.timeoutHandle);
      claimRaces.delete(raceId);
      await ctx.editMessageText(raceText(race, 'full'), HTML);
    } else {
      await ctx.editMessageText(raceText(race), { ...HTML, ...raceKeyboard(raceId) });
    }
  });

  // Admin-only: force a surprise event in the current group right now, for testing.
  bot.command('testhiddenevent', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    await triggerHiddenEvent(bot, ctx.chat.id);
  });
}

module.exports = { register, triggerHiddenEvent };
