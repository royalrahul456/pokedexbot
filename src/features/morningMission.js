const cron = require('node-cron');
const { listActiveGroups } = require('../db/groups');
const { getOrCreateTodayMission } = require('../db/missions');
const { escapeHtml, bold, HTML, brandTag } = require('../utils/text');
const spawnFeature = require('./spawn');
const { deactivateIfGroupGone } = require('../utils/groupHealth');
const seasonalEvents = require('../db/seasonalEvents');

const MISSION_REWARD_TEXT = '50 XP\n100 Coins\n1 Mystery Box 🎁';

// Guaranteed mission spawn lands 3–6 minutes after the announcement — long enough to
// feel like an event, short enough that people don't lose interest waiting.
const GUARANTEED_SPAWN_MIN_MS = 3 * 60 * 1000;
const GUARANTEED_SPAWN_MAX_MS = 6 * 60 * 1000;

function buildMissionMessage(pokemonName) {
  const event = seasonalEvents.getActiveEvent();
  return [
    brandTag(),
    bold('🌞 Good Morning Trainers!'),
    ...(event ? ['', bold(`🎉 ${escapeHtml(event.name)} Event is live — themed Pokémon are spawning more often!`)] : []),
    '',
    bold("📋 Today's Goals:"),
    '✅ /checkin — keep your streak alive',
    `🎯 Catch today's mystery Pokémon: ${bold(escapeHtml(pokemonName))}`,
    '🎡 /spin — free daily spin',
    '📦 /chest — free daily mystery chest',
    '❓ /quiz — play for bonus XP',
    '',
    bold('🔥 Daily Mission Reward:'),
    MISSION_REWARD_TEXT,
    '',
    `⏳ Time Left: ${bold('23h 59m')}`,
    '',
    '👀 Get ready — the mission Pokémon will appear in this chat in the next few minutes!',
  ].join('\n');
}

async function postMorningMission(bot, chatId) {
  const mission = getOrCreateTodayMission(chatId);
  await bot.telegram.sendMessage(chatId, buildMissionMessage(mission.pokemon_name), HTML);

  // Guarantee the mission's target Pokemon actually shows up — otherwise it's left to
  // the independent random spawn timer, which might not roll that exact name for hours.
  const delayMs = GUARANTEED_SPAWN_MIN_MS + Math.random() * (GUARANTEED_SPAWN_MAX_MS - GUARANTEED_SPAWN_MIN_MS);
  setTimeout(async () => {
    try {
      await spawnFeature.postTeaser(bot.telegram, chatId);
      await new Promise((resolve) => setTimeout(resolve, 30 * 1000));
      await spawnFeature.forceSpawnNamed(
        bot.telegram,
        chatId,
        mission.pokemon_name,
        '🎯 The mission Pokémon is here!'
      );
    } catch (err) {
      console.error(`Failed to post guaranteed mission spawn for chat ${chatId}:`, err.message);
      deactivateIfGroupGone(chatId, err, 'guaranteed mission spawn');
    }
  }, delayMs);
}

function register(bot) {
  // Runs every day at 9:00 AM server time.
  cron.schedule('0 9 * * *', async () => {
    for (const group of listActiveGroups()) {
      try {
        await postMorningMission(bot, group.chat_id);
      } catch (err) {
        console.error(`Failed to post morning mission for chat ${group.chat_id}:`, err.message);
        deactivateIfGroupGone(group.chat_id, err, 'morning mission');
      }
    }
  });

  // Manual trigger for anyone to preview today's mission — this is a pure info lookup,
  // it does NOT spawn anything, so it can't be abused to farm extra spawns.
  bot.command('mission', async (ctx) => {
    const mission = getOrCreateTodayMission(ctx.chat.id);
    await ctx.reply(buildMissionMessage(mission.pokemon_name), HTML);
  });
}

module.exports = { register, postMorningMission, buildMissionMessage };
