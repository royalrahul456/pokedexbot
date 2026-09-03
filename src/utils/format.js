const { xpForLevel, rankForLevel, MAX_LEVEL } = require('./levels');
const { escapeHtml, bold } = require('./text');
const { getItemInfo } = require('../data/items');

function displayName(ctx) {
  const from = ctx.from;
  return from.username ? `@${from.username}` : from.first_name || 'Trainer';
}

function formatProfile(user, streak, rank, equipped) {
  const rank2 = rankForLevel(user.level);
  const nextLevelXp = user.level < MAX_LEVEL ? xpForLevel(user.level + 1) : null;
  const xpLine = nextLevelXp
    ? `XP: ${bold(user.xp)} / ${nextLevelXp}`
    : `XP: ${bold(user.xp)} (MAX LEVEL)`;

  const titleText = equipped?.title_key ? getItemInfo(equipped.title_key).displayText : null;
  const badgeEmoji = equipped?.badge_key ? getItemInfo(equipped.badge_key).emoji : null;
  const cosmeticLine = [badgeEmoji, titleText].filter(Boolean).join(' ');

  return [
    `👤 ${bold(escapeHtml(user.username || 'Trainer'))}`,
    cosmeticLine,
    ``,
    `🏆 Level ${bold(user.level)} — ${bold(rank2)}`,
    xpLine,
    ``,
    `✨ Shiny Collection: ${bold(user.shiny_count)}`,
    `🐉 Legendary: ${bold(user.legendary_count)}`,
    `🪙 Coins: ${bold(user.coins)}`,
    ``,
    `🔥 Current Streak: ${bold(streak.current_streak)}`,
    `❓ Quiz Wins: ${bold(user.quiz_wins)}`,
    `🎯 Total Catches: ${bold(user.catches)}`,
    ``,
    rank ? `📊 Rank: ${bold(`#${rank}`)} in this group` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function formatDuration(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = { displayName, formatProfile, formatDuration };
