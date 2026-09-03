const { Markup } = require('telegraf');
const users = require('../db/users');
const inventoryDb = require('../db/inventory');
const cosmeticsDb = require('../db/cosmetics');
const { getCosmeticsByType, getItemInfo } = require('../data/items');
const { bold, HTML, brandTag } = require('../utils/text');

const IDLE_EXPIRY_MS = 15 * 60 * 1000; // matches collection.js's sliding-expiry window

function now() {
  return Math.floor(Date.now() / 1000);
}

// Same pattern as collection.js: `shop:<ownerId>:<ts>:...` — owner check plus a sliding
// 15-min idle expiry, re-stamped on every render.
function tag(ownerId) {
  return `${ownerId}:${now()}`;
}

async function requireOwnerAndFresh(ctx, ownerId, ts) {
  if (ctx.from.id !== ownerId) {
    await ctx.answerCbQuery("🔒 This isn't your shop — run /shop yourself!", { show_alert: true });
    return false;
  }
  if (now() - ts > IDLE_EXPIRY_MS / 1000) {
    await ctx.answerCbQuery('⌛ This menu has been idle too long — run /shop again for a fresh one.', {
      show_alert: true,
    });
    return false;
  }
  return true;
}

function mainMenuText() {
  return [brandTag(), bold('🛍️ Cosmetic Shop'), '', 'Spend coins on titles and badges shown on your /profile.'].join('\n');
}

function mainMenuKeyboard(ownerId) {
  const t = tag(ownerId);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎭 Titles', `shop:${t}:titles`),
      Markup.button.callback('🏅 Badges', `shop:${t}:badges`),
    ],
  ]);
}

function catalogText(type, ownerId) {
  const equipped = cosmeticsDb.getEquipped(ownerId);
  const equippedKey = type === 'title' ? equipped.title_key : equipped.badge_key;
  const catalog = getCosmeticsByType(type);
  const lines = [bold(type === 'title' ? '🎭 Titles' : '🏅 Badges'), ''];
  for (const item of catalog) {
    const owned = inventoryDb.getItemQuantity(ownerId, item.key) > 0;
    const equippedTag = item.key === equippedKey ? ' ✅ Equipped' : '';
    const label = type === 'title' ? item.displayText : `${item.emoji} ${item.label}`;
    lines.push(`${label} — ${bold(item.price)} coins${owned ? ' (owned)' : ''}${equippedTag}`);
  }
  return lines.join('\n');
}

function catalogKeyboard(type, ownerId) {
  const t = tag(ownerId);
  const equipped = cosmeticsDb.getEquipped(ownerId);
  const equippedKey = type === 'title' ? equipped.title_key : equipped.badge_key;
  const catalog = getCosmeticsByType(type);
  const rows = [];

  for (const item of catalog) {
    const owned = inventoryDb.getItemQuantity(ownerId, item.key) > 0;
    const shortLabel = type === 'title' ? item.label.replace(' Title', '') : item.label.replace(' Badge', '');
    if (!owned) {
      rows.push([Markup.button.callback(`💰 Buy ${shortLabel} (${item.price})`, `shop:${t}:buy:${item.key}`)]);
    } else if (item.key === equippedKey) {
      rows.push([Markup.button.callback(`🚫 Unequip ${shortLabel}`, `shop:${t}:unequip:${type}`)]);
    } else {
      rows.push([Markup.button.callback(`✅ Equip ${shortLabel}`, `shop:${t}:equip:${item.key}`)]);
    }
  }
  rows.push([Markup.button.callback('⬅️ Back to Shop', `shop:${t}:menu`)]);
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  bot.command('shop', async (ctx) => {
    const userId = ctx.from.id;
    users.getOrCreateUser(ctx.chat.id, userId, ctx.from.username || ctx.from.first_name);
    await ctx.reply(mainMenuText(), { ...HTML, ...mainMenuKeyboard(userId) });
  });

  bot.action(/^shop:(\d+):(\d+):menu$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    await ctx.answerCbQuery();
    await ctx.editMessageText(mainMenuText(), { ...HTML, ...mainMenuKeyboard(ownerId) });
  });

  bot.action(/^shop:(\d+):(\d+):(titles|badges)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    const type = ctx.match[3] === 'titles' ? 'title' : 'badge';
    await ctx.answerCbQuery();
    await ctx.editMessageText(catalogText(type, ownerId), { ...HTML, ...catalogKeyboard(type, ownerId) });
  });

  bot.action(/^shop:(\d+):(\d+):buy:(\w+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    const key = ctx.match[3];
    const item = getItemInfo(key);
    if (!item.cosmeticType) {
      await ctx.answerCbQuery('Unknown item.', { show_alert: true });
      return;
    }
    if (inventoryDb.getItemQuantity(ownerId, key) > 0) {
      await ctx.answerCbQuery('You already own this.');
    } else {
      const chatId = ctx.chat.id;
      const ok = users.deductCoins(chatId, ownerId, item.price);
      if (!ok) {
        await ctx.answerCbQuery(`🪙 Not enough coins — you need ${item.price}.`, { show_alert: true });
        return;
      }
      inventoryDb.addItem(ownerId, key, 1);
      await ctx.answerCbQuery(`✅ Bought! (-${item.price} coins)`);
    }
    await ctx.editMessageText(catalogText(item.cosmeticType, ownerId), {
      ...HTML,
      ...catalogKeyboard(item.cosmeticType, ownerId),
    });
  });

  bot.action(/^shop:(\d+):(\d+):equip:(\w+)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    const key = ctx.match[3];
    const item = getItemInfo(key);
    if (!item.cosmeticType || inventoryDb.getItemQuantity(ownerId, key) === 0) {
      await ctx.answerCbQuery("You don't own this.", { show_alert: true });
      return;
    }
    if (item.cosmeticType === 'title') cosmeticsDb.setEquippedTitle(ownerId, key);
    else cosmeticsDb.setEquippedBadge(ownerId, key);
    await ctx.answerCbQuery('✅ Equipped!');
    await ctx.editMessageText(catalogText(item.cosmeticType, ownerId), {
      ...HTML,
      ...catalogKeyboard(item.cosmeticType, ownerId),
    });
  });

  bot.action(/^shop:(\d+):(\d+):unequip:(title|badge)$/, async (ctx) => {
    const ownerId = Number(ctx.match[1]);
    if (!(await requireOwnerAndFresh(ctx, ownerId, Number(ctx.match[2])))) return;
    const type = ctx.match[3];
    if (type === 'title') cosmeticsDb.setEquippedTitle(ownerId, null);
    else cosmeticsDb.setEquippedBadge(ownerId, null);
    await ctx.answerCbQuery('Unequipped.');
    await ctx.editMessageText(catalogText(type, ownerId), { ...HTML, ...catalogKeyboard(type, ownerId) });
  });
}

module.exports = { register };
