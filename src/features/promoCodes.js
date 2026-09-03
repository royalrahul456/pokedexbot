const users = require('../db/users');
const promoCodesDb = require('../db/promoCodes');
const inventoryDb = require('../db/inventory');
const pokemonCollectionDb = require('../db/pokemonCollection');
const { getItemInfo } = require('../data/items');
const { getBaseRarity } = require('../data/pokemon');
const { grantRewards } = require('../utils/rewards');
const { escapeHtml, bold, HTML } = require('../utils/text');

const REASON_MESSAGES = {
  not_found: '❌ That code doesn\'t exist or is no longer active.',
  expired: '⌛ This code has expired.',
  already_redeemed: '⚠️ You\'ve already redeemed this code.',
  limit_reached: '⌛ This code has reached its usage limit.',
};

function register(bot) {
  bot.command('redeem', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    users.getOrCreateUser(chatId, userId, username);

    const code = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!code) {
      await ctx.reply('Usage: /redeem CODE');
      return;
    }

    const result = promoCodesDb.redeemCode(userId, chatId, code);
    if (!result.ok) {
      await ctx.reply(REASON_MESSAGES[result.reason] || '❌ Could not redeem that code.');
      return;
    }

    const levelUpMsg = grantRewards(chatId, userId, { xp: result.xp, coins: result.coins });

    if (result.itemKey) {
      inventoryDb.addItem(userId, result.itemKey, result.itemQty);
    }
    if (result.pokemonName) {
      pokemonCollectionDb.recordCatch(userId, result.pokemonName, getBaseRarity(result.pokemonName), result.pokemonShiny);
    }

    const lines = [bold('🎟️ Code redeemed!')];
    const rewardParts = [];
    if (result.xp > 0) rewardParts.push(`+${result.xp} XP`);
    if (result.coins > 0) rewardParts.push(`+${result.coins} coins`);
    if (result.itemKey) {
      const item = getItemInfo(result.itemKey);
      rewardParts.push(`${item.emoji} ${escapeHtml(item.label)} x${result.itemQty}`);
    }
    if (result.pokemonName) {
      rewardParts.push(`🐾 ${result.pokemonShiny ? '✨ Shiny ' : ''}${escapeHtml(result.pokemonName)}`);
    }
    if (rewardParts.length) lines.push(rewardParts.join(', '));
    if (levelUpMsg) lines.push(levelUpMsg);

    await ctx.reply(lines.join('\n'), HTML);
  });
}

module.exports = { register };
