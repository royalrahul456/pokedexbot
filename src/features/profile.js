const users = require('../db/users');
const streaks = require('../db/streaks');
const cosmeticsDb = require('../db/cosmetics');
const { formatProfile } = require('../utils/format');
const { escapeHtml, bold, HTML } = require('../utils/text');

function showProfile(ctx) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  users.getOrCreateUser(chatId, userId, username);

  const profile = users.getProfile(chatId, userId);
  const streak = streaks.getStreak(chatId, userId);
  const rank = users.getRank(chatId, userId);
  const equipped = cosmeticsDb.getEquipped(userId);

  return ctx.reply(formatProfile(profile, streak, rank, equipped), HTML);
}

function showLeaderboard(ctx) {
  const rows = users.getLeaderboard(ctx.chat.id, 10);
  if (rows.length === 0) {
    return ctx.reply('<blockquote>No trainers ranked yet — be the first to earn XP!</blockquote>', HTML);
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((u, i) => {
    const rankIcon = medals[i] || `${i + 1}.`;
    return `${rankIcon} ${bold(escapeHtml(u.username || 'Trainer'))} — Lv${u.level} (${u.xp} XP)`;
  });
  return ctx.reply(`<blockquote>\n${bold('🏆 Trainer Leaderboard')}\n\n${lines.join('\n')}\n</blockquote>`, HTML);
}

function register(bot) {
  bot.command(['profile', 'me'], showProfile);
  bot.command(['leaderboard', 'top'], showLeaderboard);
}

module.exports = { register, showProfile, showLeaderboard };
