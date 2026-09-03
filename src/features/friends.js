const { Markup } = require('telegraf');
const friendships = require('../db/friendships');
const users = require('../db/users');
const cooldowns = require('../db/cooldowns');
const { GIFT_TABLE, weightedPick } = require('../data/rewards');
const { applyReward, ITEM_REWARD_KEYS } = require('./spinChest');
const { grantRewards } = require('../utils/rewards');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatDuration } = require('../utils/format');

const DAY_MS = 24 * 60 * 60 * 1000;
// Friend gifting is global (once a day, pick any one friend), not per-group — so cooldowns
// (which are keyed by chat_id) use this sentinel chat, the same trick the friendships table
// avoids needing entirely by just not being chat-scoped at all.
const GLOBAL_COOLDOWN_CHAT = 0;

function targetFromReply(ctx) {
  const repliedUser = ctx.message.reply_to_message?.from;
  if (!repliedUser || repliedUser.is_bot) return null;
  return repliedUser;
}

function displayName(user) {
  return escapeHtml(user.username || user.first_name || 'Trainer');
}

function acceptKeyboard(userA, userB) {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Accept', `friend:accept:${userA}:${userB}`),
  ]);
}

function unfriendConfirmKeyboard(userA, userB) {
  return Markup.inlineKeyboard([
    Markup.button.callback('💔 Confirm Unfriend', `friend:unfriend:${userA}:${userB}`),
    Markup.button.callback('❌ Cancel', 'friend:cancel'),
  ]);
}

function register(bot) {
  bot.command('friend', async (ctx) => {
    const chatId = ctx.chat.id;
    const requester = ctx.from;
    users.getOrCreateUser(chatId, requester.id, requester.username || requester.first_name);

    const target = targetFromReply(ctx);
    if (!target) {
      await ctx.reply('🤝 Reply to a group member\'s message with /friend to send them a friend request.');
      return;
    }
    if (target.id === requester.id) {
      await ctx.reply("You can't friend yourself, trainer.");
      return;
    }

    const existing = friendships.getFriendship(requester.id, target.id);
    if (existing?.status === 'accepted') {
      await ctx.reply(`You're already friends with ${bold(displayName(target))}!`, HTML);
      return;
    }
    if (existing?.status === 'pending' && existing.requested_by === requester.id) {
      await ctx.reply(`⏳ Already sent — waiting on ${bold(displayName(target))} to accept.`, HTML);
      return;
    }
    if (existing?.status === 'pending' && existing.requested_by === target.id) {
      // They already asked us first — treat this as an implicit accept instead of making
      // both people separately hunt down each other's original request message.
      const accepted = friendships.acceptRequest(requester.id, target.id);
      if (accepted) {
        await ctx.reply(
          `🤝 ${bold(displayName(requester))} and ${bold(displayName(target))} are now friends!`,
          HTML
        );
      }
      return;
    }

    friendships.sendRequest(
      requester.id,
      requester.username || requester.first_name,
      target.id,
      target.username || target.first_name
    );
    await ctx.reply(
      [
        bold('🤝 Friend Request'),
        '',
        `${bold(displayName(requester))} wants to be friends with ${bold(displayName(target))}!`,
      ].join('\n'),
      { ...HTML, ...acceptKeyboard(requester.id, target.id) }
    );
  });

  bot.action(/^friend:accept:(\d+):(\d+)$/, async (ctx) => {
    const requesterId = Number(ctx.match[1]);
    const targetId = Number(ctx.match[2]);
    if (ctx.from.id !== targetId) {
      await ctx.answerCbQuery('This request is not for you.', { show_alert: true });
      return;
    }
    users.getOrCreateUser(ctx.chat.id, ctx.from.id, ctx.from.username || ctx.from.first_name);
    const accepted = friendships.acceptRequest(targetId, requesterId);
    if (!accepted) {
      await ctx.answerCbQuery('This request is no longer available.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery('You are now friends!');
    await ctx.editMessageText(`🤝 ${bold('Friends!')} Say hello and try /gift once a day.`, HTML);
  });

  bot.command('friends', async (ctx) => {
    const list = friendships.listFriends(ctx.from.id);
    if (list.length === 0) {
      await ctx.reply('You have no friends yet — reply to someone\'s message with /friend to send a request.');
      return;
    }
    const lines = [bold(`🤝 Your Friends (${list.length})`), ''];
    for (const friend of list) {
      lines.push(`• ${escapeHtml(friend.username || `Trainer ${friend.userId}`)}`);
    }
    await ctx.reply(lines.join('\n'), HTML);
  });

  bot.command('unfriend', async (ctx) => {
    const target = targetFromReply(ctx);
    if (!target) {
      await ctx.reply("💔 Reply to a friend's message with /unfriend to remove them.");
      return;
    }
    if (!friendships.areFriends(ctx.from.id, target.id)) {
      await ctx.reply(`You're not friends with ${bold(displayName(target))}.`, HTML);
      return;
    }
    await ctx.reply(
      `Remove ${bold(displayName(target))} from your friends list?`,
      { ...HTML, ...unfriendConfirmKeyboard(ctx.from.id, target.id) }
    );
  });

  bot.action(/^friend:unfriend:(\d+):(\d+)$/, async (ctx) => {
    const userA = Number(ctx.match[1]);
    const userB = Number(ctx.match[2]);
    if (ctx.from.id !== userA && ctx.from.id !== userB) {
      await ctx.answerCbQuery('This is not your request.', { show_alert: true });
      return;
    }
    friendships.removeFriendship(userA, userB);
    await ctx.answerCbQuery('Removed.');
    await ctx.editMessageText('💔 Friendship removed.');
  });

  bot.action('friend:cancel', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Cancelled — still friends.');
  });

  bot.command('gift', async (ctx) => {
    const chatId = ctx.chat.id;
    const sender = ctx.from;
    users.getOrCreateUser(chatId, sender.id, sender.username || sender.first_name);

    const target = targetFromReply(ctx);
    if (!target) {
      await ctx.reply("🎁 Reply to a friend's message with /gift to send them today's free gift.");
      return;
    }
    if (!friendships.areFriends(sender.id, target.id)) {
      await ctx.reply(`You can only gift friends — reply to their message with /friend first.`);
      return;
    }

    const status = cooldowns.checkCooldown(GLOBAL_COOLDOWN_CHAT, sender.id, 'friend_gift', DAY_MS);
    if (!status.ready) {
      await ctx.reply(
        `🎁 You already sent a gift today. Next gift in ${bold(formatDuration(status.msRemaining))}.`,
        HTML
      );
      return;
    }

    users.getOrCreateUser(chatId, target.id, target.username || target.first_name);
    const reward = weightedPick(GIFT_TABLE);
    applyReward(chatId, target.id, reward.key);
    cooldowns.useCooldown(GLOBAL_COOLDOWN_CHAT, sender.id, 'friend_gift');

    const itemNote = ITEM_REWARD_KEYS.has(reward.key)
      ? ` Check /inventory (in this group) to see it.`
      : '';
    await ctx.reply(
      `🎁 ${bold(displayName(sender))} sent ${bold(displayName(target))} a gift: ${bold(escapeHtml(reward.label))}!${itemNote}`,
      HTML
    );
  });
}

module.exports = { register };
