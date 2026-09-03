const users = require('../db/users');
const inventoryDb = require('../db/inventory');
const { getItemInfo } = require('../data/items');
const { grantRewards } = require('../utils/rewards');
const { weightedPick, CHEST_TABLE } = require('../data/rewards');
const { escapeHtml, bold, HTML } = require('../utils/text');
const spinChest = require('./spinChest');
const spawnFeature = require('./spawn');

function register(bot) {
  bot.command('inventory', (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    users.getOrCreateUser(chatId, userId, ctx.from.username || ctx.from.first_name);

    const items = inventoryDb.listInventory(userId);
    if (items.length === 0) {
      ctx.reply('🎒 Your inventory is empty. Try /spin, /chest, or catching Pokémon to earn items!');
      return;
    }

    const lines = [bold('🎒 Your Inventory'), ''];
    for (const { item_key, quantity } of items) {
      const info = getItemInfo(item_key);
      const usable = info.consumable ? ` — /use ${item_key}` : '';
      lines.push(`${info.emoji} ${bold(info.label)} x${bold(quantity)}${usable}`);
      lines.push(`   ${info.description}`);
    }
    ctx.reply(lines.join('\n'), HTML);
  });

  bot.command('use', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    users.getOrCreateUser(chatId, userId, username);

    const arg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!arg) {
      ctx.reply('Usage: /use ITEM_NAME — e.g. /use shiny_ticket. Check /inventory for your items.');
      return;
    }
    const itemKey = arg.toLowerCase().replace(/\s+/g, '_');
    const info = getItemInfo(itemKey);

    if (!info.consumable) {
      ctx.reply(`${info.emoji} ${bold(info.label)} can't be used directly — it's a cosmetic/collection item.`, HTML);
      return;
    }

    const owned = inventoryDb.getItemQuantity(userId, itemKey);
    if (owned <= 0) {
      ctx.reply(`You don't have any ${bold(info.label)}. Check /inventory to see what you own.`, HTML);
      return;
    }

    inventoryDb.consumeItem(userId, itemKey);

    switch (itemKey) {
      case 'rare_candy': {
        grantRewards(chatId, userId, { xp: 80 });
        ctx.reply(`🍬 Used ${bold('Rare Candy')}! +${bold(80)} XP`, HTML);
        break;
      }
      case 'lucky_egg': {
        grantRewards(chatId, userId, { coins: 150 });
        ctx.reply(`🥚 Used ${bold('Lucky Egg')}! +${bold(150)} Coins`, HTML);
        break;
      }
      case 'shiny_ticket': {
        await spawnFeature.forceSpawn(
          ctx.telegram,
          chatId,
          'shiny',
          `🎫 ${bold(escapeHtml(username))} redeemed a Shiny Ticket!`
        );
        break;
      }
      case 'rare_pokemon_encounter': {
        await spawnFeature.forceSpawn(
          ctx.telegram,
          chatId,
          'rare',
          `🔎 ${bold(escapeHtml(username))} redeemed a Rare Pokémon Encounter!`
        );
        break;
      }
      case 'mystery_box': {
        const reward = weightedPick(CHEST_TABLE);
        spinChest.applyReward(chatId, userId, reward.key);
        ctx.reply(`🎁 Opened ${bold('Mystery Box')}!\n\nYou got: ${bold(escapeHtml(reward.label))}!`, HTML);
        break;
      }
      default:
        ctx.reply(`Used ${bold(info.label)}.`, HTML);
    }
  });
}

module.exports = { register };
