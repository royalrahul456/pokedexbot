const users = require('../db/users');
const streaks = require('../db/streaks');
const cosmeticsDb = require('../db/cosmetics');
const { formatProfile } = require('../utils/format');
const { escapeHtml, bold, HTML } = require('../utils/text');

function register(bot) {
  bot.command(['profile', 'me'], (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    users.getOrCreateUser(chatId, userId, username);

    const profile = users.getProfile(chatId, userId);
    const streak = streaks.getStreak(chatId, userId);
    const rank = users.getRank(chatId, userId);
    const equipped = cosmeticsDb.getEquipped(userId);

    ctx.reply(formatProfile(profile, streak, rank, equipped), HTML);
  });

  bot.command(['leaderboard', 'top'], (ctx) => {
    const rows = users.getLeaderboard(ctx.chat.id, 10);
    if (rows.length === 0) {
      ctx.reply('No trainers ranked yet — be the first to earn XP!');
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((u, i) => {
      const rankIcon = medals[i] || `${i + 1}.`;
      return `${rankIcon} ${bold(escapeHtml(u.username || 'Trainer'))} — Lv${u.level} (${u.xp} XP)`;
    });
    ctx.reply([bold('🏆 Trainer Leaderboard'), '', ...lines].join('\n'), HTML);
  });
}

module.exports = { register };
