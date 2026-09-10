const users = require('../db/users');
const streaks = require('../db/streaks');
const cooldowns = require('../db/cooldowns');
const inventory = require('../db/inventory');
const { grantRewards } = require('../utils/rewards');
const { formatDuration } = require('../utils/format');
const { escapeHtml, bold, italic, HTML } = require('../utils/text');
const { SPIN_TABLE, CHEST_TABLE, weightedPick } = require('../data/rewards');

const DAY_MS = 24 * 60 * 60 * 1000;
const SPIN_ICONS = ['🎰', '💰', '⭐', '🍬', '🥚', '🎫'];
const CHEST_ICONS = ['📦', '✨', '🎁', '🔑'];

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

async function handleSpin(ctx) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  users.getOrCreateUser(chatId, userId, username);

  const status = cooldowns.checkCooldown(chatId, userId, 'spin', DAY_MS);
  if (!status.ready) {
    return ctx.reply(
      `<blockquote>\n${bold('🎡 DAILY SPIN')}\n───────────────────────────\n📦 Spin Status: Claimed\n⏳ Next spin available in ${bold(formatDuration(status.msRemaining))}\n</blockquote>`,
      HTML
    );
  }

  const reward = weightedPick(SPIN_TABLE);
  const message = await playSuspense(ctx, SPIN_ICONS, '🎡 Spinning the wheel...');
  applyReward(chatId, userId, reward.key);

  if (reward.key === 'extra_spin') {
    return await ctx.telegram.editMessageText(
      chatId,
      message.message_id,
      undefined,
      [
        '<blockquote>',
        bold('🎡 DAILY SPIN'),
        '───────────────────────────',
        `🎯 ${italic('You landed on...')}`,
        `🎉 ${bold(escapeHtml(reward.label))}`,
        `✅ ${italic('Extra Spin Granted! Spin again with /spin!')}`,
        '</blockquote>',
      ].join('\n'),
      HTML
    );
  }

  cooldowns.useCooldown(chatId, userId, 'spin');

  const profile = users.getProfile(chatId, userId);
  const streak = streaks.getStreak(chatId, userId);
  const divider = '───────────────────────────';

  const lines = [
    bold('🎡 DAILY SPIN'),
    divider,
    `🎯 ${italic('You landed on...')}`,
    `✨ ${bold(escapeHtml(reward.label))}`,
    `✅ ${italic('Reward successfully added!')}`,
    `📊 Current XP: ${bold(profile.xp.toLocaleString())}`,
    `🔥 Streak: ${bold(streak.current_streak + ' Days')}`,
    divider,
    `⏳ ${italic('Next spin available in 24h')}`,
  ];

  return await ctx.telegram.editMessageText(
    chatId,
    message.message_id,
    undefined,
    `<blockquote>\n${lines.join('\n')}\n</blockquote>`,
    HTML
  );
}

async function handleChest(ctx) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  users.getOrCreateUser(chatId, userId, username);

  const status = cooldowns.checkCooldown(chatId, userId, 'chest', DAY_MS);
  if (!status.ready) {
    return ctx.reply(
      `<blockquote>\n${bold('🎁 MYSTERY CHEST')}\n───────────────────────────\n📦 Chest Status: Claimed\n⏳ Next chest: ${bold(formatDuration(status.msRemaining))}\n</blockquote>`,
      HTML
    );
  }

  const reward = weightedPick(CHEST_TABLE);
  const message = await playSuspense(ctx, CHEST_ICONS, '📦 Opening the Mystery Chest...');
  applyReward(chatId, userId, reward.key);
  cooldowns.useCooldown(chatId, userId, 'chest');

  const prefix = reward.key === 'mythical' ? '🎊🎊🎊 JACKPOT! 🎊🎊🎊' : '🎁 MYSTERY CHEST OPENED!';
  const divider = '───────────────────────────';

  const lines = [
    bold(prefix),
    divider,
    `✨ ${italic('You discovered:')}`,
    `✨ ${bold(escapeHtml(reward.label))}`,
    '',
    `🎉 ${italic('Nice find, Trainer!')}`,
    divider,
    `📦 ${italic('Chest Status: Claimed')}`,
    `⏳ ${italic('Next chest: 24h')}`,
  ];

  return await ctx.telegram.editMessageText(
    chatId,
    message.message_id,
    undefined,
    `<blockquote>\n${lines.join('\n')}\n</blockquote>`,
    HTML
  );
}

function register(bot) {
  bot.command('spin', handleSpin);
  bot.command('chest', handleChest);
}

module.exports = { register, handleSpin, handleChest, applyReward, SPIN_ICONS, CHEST_ICONS, ITEM_REWARD_KEYS };
