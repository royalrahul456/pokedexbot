const cron = require('node-cron');
const { listActiveGroups } = require('../db/groups');
const { getUsersAtRiskOfLosingStreak } = require('../db/streaks');
const { escapeHtml, bold, HTML, brandTag } = require('../utils/text');
const { deactivateIfGroupGone } = require('../utils/groupHealth');

const MAX_MENTIONS = 15;

function buildReminderMessage(atRiskUsers) {
  const mentions = atRiskUsers
    .slice(0, MAX_MENTIONS)
    .map((u) => `${bold(escapeHtml(u.username || `Trainer${u.user_id}`))} (${u.current_streak}🔥)`)
    .join(', ');
  const extra = atRiskUsers.length > MAX_MENTIONS ? ` and ${atRiskUsers.length - MAX_MENTIONS} more` : '';

  return [
    brandTag(),
    bold('⏰ Streak Alert!'),
    '',
    `${mentions}${extra} — your streak is about to reset to zero!`,
    '',
    `Just send ${bold('/checkin')} before the day ends to keep it alive. Don't throw it all away now! 😤`,
  ].join('\n');
}

async function postStreakReminder(bot, chatId) {
  const atRiskUsers = getUsersAtRiskOfLosingStreak(chatId);
  if (atRiskUsers.length === 0) return;
  await bot.telegram.sendMessage(chatId, buildReminderMessage(atRiskUsers), HTML);
}

function register(bot) {
  // Runs every day at 9:00 PM server time — late enough to create urgency, early enough to act on it.
  cron.schedule('0 21 * * *', async () => {
    for (const group of listActiveGroups()) {
      try {
        await postStreakReminder(bot, group.chat_id);
      } catch (err) {
        console.error(`Failed to post streak reminder for chat ${group.chat_id}:`, err.message);
        deactivateIfGroupGone(group.chat_id, err, 'streak reminder');
      }
    }
  });
}

module.exports = { register, postStreakReminder, buildReminderMessage };
