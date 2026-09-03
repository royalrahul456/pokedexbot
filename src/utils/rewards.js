const users = require('../db/users');
const { rankForLevel } = require('./levels');
const { escapeHtml, bold } = require('./text');

// Awards XP/coins and returns an HTML-formatted level-up announcement, or null if no level-up.
function grantRewards(chatId, userId, { xp = 0, coins = 0 } = {}) {
  let leveledUpMessage = null;
  if (xp > 0) {
    const { newLevel, leveledUp } = users.addXp(chatId, userId, xp);
    if (leveledUp) {
      const user = users.getProfile(chatId, userId);
      const name = escapeHtml(user.username || 'A trainer');
      leveledUpMessage = `🎉 ${bold(name)} leveled up to ${bold(`Lv${newLevel}`)} — ${bold(rankForLevel(newLevel))}!`;
    }
  }
  if (coins > 0) {
    users.addCoins(chatId, userId, coins);
  }
  return leveledUpMessage;
}

module.exports = { grantRewards };
