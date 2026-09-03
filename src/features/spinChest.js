const users = require('../db/users');
const cooldowns = require('../db/cooldowns');
const inventory = require('../db/inventory');
const { grantRewards } = require('../utils/rewards');
const { formatDuration } = require('../utils/format');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { SPIN_TABLE, CHEST_TABLE, weightedPick } = require('../data/rewards');

const DAY_MS = 24 * 60 * 60 * 1000;
const SPIN_ICONS = ['🎰', '💰', '⭐', '🍬', '🥚', '🎫'];
const CHEST_ICONS = ['📦', '✨', '🎁', '🔑'];

// Reward keys that land in /inventory (as opposed to instant Coins/XP) — used to only
// show the "check your inventory" note when it's actually relevant.
const ITEM_REWARD_KEYS = new Set([
  'rare_candy',
  'lucky_egg',
  'avatar_frame',
  'shiny_ticket',
  'lucky_ticket',
  'avatar_badge',
  'rare_pokemon',
  'event_key',
  'mythical',
  'egg_common',
  'egg_rare',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Applies a reward's effect (XP/coins/items). Label/announcement is handled by the caller.
function applyReward(chatId, userId, rewardKey) {
  switch (rewardKey) {
    case 'coins_small':
      grantRewards(chatId, userId, { coins: 50 });
      break;
    case 'coins_big':
    case 'coins':
      grantRewards(chatId, userId, { coins: rewardKey === 'coins' ? 200 : 150 });
      break;
    case 'xp_small':
      grantRewards(chatId, userId, { xp: 30 });
      break;
    case 'xp_big':
      grantRewards(chatId, userId, { xp: 80 });
      break;
    case 'rare_candy':
      inventory.addItem(userId, 'rare_candy', 1);
      break;
    case 'lucky_egg':
      inventory.addItem(userId, 'lucky_egg', 1);
      break;
    case 'avatar_frame':
      inventory.addItem(userId, 'avatar_frame', 1);
      break;
    case 'shiny_ticket':
      inventory.addItem(userId, 'shiny_ticket', 1);
      break;
    case 'lucky_ticket':
      inventory.addItem(userId, 'lucky_ticket', 1);
      break;
    case 'avatar_badge':
      inventory.addItem(userId, 'avatar_badge', 1);
      break;
    case 'rare_pokemon':
      inventory.addItem(userId, 'rare_pokemon_encounter', 1);
      break;
    case 'event_key':
      inventory.addItem(userId, 'event_key', 1);
      break;
    case 'egg_common':
      inventory.addItem(userId, 'egg_common', 1);
      break;
    case 'egg_rare':
      inventory.addItem(userId, 'egg_rare', 1);
      break;
    case 'mythical':
      grantRewards(chatId, userId, { xp: 500, coins: 1000 });
      inventory.addItem(userId, 'mythical_reward', 1);
      break;
    case 'extra_spin':
      // handled by caller (resets cooldown instead of granting an item)
      break;
    default:
      break;
  }
}

function randomLine(icons) {
  const shuffled = [...icons].sort(() => Math.random() - 0.5);
  return shuffled.join(' ');
}

async function playSuspense(ctx, icons, title) {
  const message = await ctx.reply(`${bold(title)}\n\n${randomLine(icons)}`, HTML);
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    await ctx.telegram
      .editMessageText(ctx.chat.id, message.message_id, undefined, `${bold(title)}\n\n${randomLine(icons)}`, HTML)
      .catch(() => {});
  }
  return message;
}

function register(bot) {
  bot.command('spin', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    users.getOrCreateUser(chatId, userId, ctx.from.username || ctx.from.first_name);

    const status = cooldowns.checkCooldown(chatId, userId, 'spin', DAY_MS);
    if (!status.ready) {
      ctx.reply(`🎡 You already spun today. Next spin in ${bold(formatDuration(status.msRemaining))}.`, HTML);
      return;
    }

    const reward = weightedPick(SPIN_TABLE);
    const message = await playSuspense(ctx, SPIN_ICONS, '🎡 Spinning the wheel...');
    applyReward(chatId, userId, reward.key);

    if (reward.key === 'extra_spin') {
      await ctx.telegram.editMessageText(
        chatId,
        message.message_id,
        undefined,
        `${bold('🎡 Spin Wheel')}\n\n🎉 ${bold(escapeHtml(reward.label))}\nSpin again right away with /spin!`,
        HTML
      );
      return; // don't set cooldown, so they can spin again immediately
    }

    cooldowns.useCooldown(chatId, userId, 'spin');
    const spinItemNote = ITEM_REWARD_KEYS.has(reward.key)
      ? '\n\n📦 Saved to /inventory — check it here in this group.'
      : '';
    await ctx.telegram.editMessageText(
      chatId,
      message.message_id,
      undefined,
      `${bold('🎡 Spin Wheel')}\n\nYou landed on: ${bold(escapeHtml(reward.label))}!${spinItemNote}`,
      HTML
    );
  });

  bot.command('chest', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    users.getOrCreateUser(chatId, userId, ctx.from.username || ctx.from.first_name);

    const status = cooldowns.checkCooldown(chatId, userId, 'chest', DAY_MS);
    if (!status.ready) {
      ctx.reply(
        `📦 Mystery Chest already opened today. Next chest in ${bold(formatDuration(status.msRemaining))}.`,
        HTML
      );
      return;
    }

    const reward = weightedPick(CHEST_TABLE);
    const message = await playSuspense(ctx, CHEST_ICONS, '📦 Opening the Mystery Chest...');
    applyReward(chatId, userId, reward.key);
    cooldowns.useCooldown(chatId, userId, 'chest');

    const prefix = reward.key === 'mythical' ? '🎊🎊🎊 JACKPOT! 🎊🎊🎊' : '📦 Mystery Chest';
    const chestItemNote = ITEM_REWARD_KEYS.has(reward.key)
      ? '\n\nCheck /inventory (in this group) to see what it does.'
      : '';
    await ctx.telegram.editMessageText(
      chatId,
      message.message_id,
      undefined,
      `${bold(prefix)}\n\nYou got: ${bold(escapeHtml(reward.label))}!${chestItemNote}`,
      HTML
    );
  });
}

module.exports = { register, applyReward, SPIN_ICONS, CHEST_ICONS, ITEM_REWARD_KEYS };
