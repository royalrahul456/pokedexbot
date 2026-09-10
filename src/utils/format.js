const { xpForLevel, rankForLevel, MAX_LEVEL } = require('./levels');
const { escapeHtml, bold } = require('./text');
const { getItemInfo } = require('../data/items');

function displayName(ctx) {
  const from = ctx.from;
  return from.username ? `@${from.username}` : from.first_name || 'Trainer';
}

function makeProgressBar(current, max, length = 10) {
  if (!max || max <= 0) return '██████████ 100%';
  const ratio = Math.min(1, Math.max(0, current / max));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  const percent = Math.floor(ratio * 100);
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${bar} ${percent}%`;
}

function formatProfile(user, streak, rank, equipped) {
  const rankTitle = rankForLevel(user.level);
  const nextLevelXp = user.level < MAX_LEVEL ? xpForLevel(user.level + 1) : null;
  const xpText = nextLevelXp ? `${user.xp} / ${nextLevelXp}` : `${user.xp} (MAX)`;
  const progressBar = nextLevelXp ? makeProgressBar(user.xp, nextLevelXp) : '██████████ 100%';

  const titleText = equipped?.title_key ? getItemInfo(equipped.title_key).displayText : null;
  const badgeEmoji = equipped?.badge_key ? getItemInfo(equipped.badge_key).emoji : null;
  const badgeTitleLine = [badgeEmoji, titleText].filter(Boolean).join(' ');

  const currentStreakDays = streak?.current_streak || 0;
  const streakText = `${currentStreakDays} Day${currentStreakDays === 1 ? '' : 's'}`;
  const groupRankText = rank ? `#${rank} in this group` : 'Unranked';

  const divider = '───────────────────────────';

  const lines = [
    bold('👤 TRAINER PROFILE'),
    divider,
    `🎖️ ${bold(escapeHtml(user.username || 'Trainer'))}`,
  ];
  if (badgeTitleLine) lines.push(badgeTitleLine);
  lines.push(
    `🏆 Level ${user.level} • ${rankTitle}`,
    `✨ XP: ${xpText}`,
    progressBar,
    divider,
    bold('📖 POKÉDEX'),
    `🐾 Pokémon Caught: ${user.catches || 0}`,
    `✨ Shiny Pokémon: ${user.shiny_count || 0}`,
    `🐉 Legendary Pokémon: ${user.legendary_count || 0}`,
    '',
    bold('💰 TRAINER STATS'),
    `🪙 Coins: ${(user.coins || 0).toLocaleString()}`,
    `🔥 Check-in Streak: ${streakText}`,
    `❓ Quiz Wins: ${user.quiz_wins || 0}`,
    '',
    bold('🥇 GROUP RANK'),
    `🎯 ${groupRankText}`,
    divider,
    '⭐ Keep catching. Keep progressing.'
  );

  return `<blockquote>\n${lines.join('\n')}\n</blockquote>`;
}

function formatDuration(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function generateTxnId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `PDX-${code}`;
}

function formatDate(date = new Date()) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year} • ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

function formatTransferReceipt(senderName, recipientName, amount, senderBalance, recipientBalance, txnId = generateTxnId(), dateStr = formatDate()) {
  const divider = '───────────────────────────';
  const lines = [
    bold('💸 COINS TRANSFERRED'),
    divider,
    '',
    `${bold(escapeHtml(senderName))} ➔ ${bold(escapeHtml(recipientName))}`,
    `🪙 ${bold(amount.toLocaleString() + ' Coins')}`,
    '',
    bold('📊 Balances'),
    `👤 Sender: ${bold(senderBalance.toLocaleString())} 🪙`,
    `👤 Recipient: ${bold(recipientBalance.toLocaleString())} 🪙`,
    '',
    `🧾 ${bold('TXN ID:')} <code>${txnId}</code>`,
    `✅ ${bold('Status:')} Completed`,
    `🕒 ${dateStr}`,
    divider,
  ];
  return `<blockquote>\n${lines.join('\n')}\n</blockquote>`;
}

module.exports = {
  displayName,
  formatProfile,
  formatDuration,
  makeProgressBar,
  generateTxnId,
  formatDate,
  formatTransferReceipt,
};
