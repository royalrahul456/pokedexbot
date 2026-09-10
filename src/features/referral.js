const referrals = require('../db/referrals');
const { grantRewards } = require('../utils/rewards');
const { escapeHtml, bold, HTML } = require('../utils/text');
const XP = require('../utils/xpValues');

const REFERRAL_COINS = 200;

let cachedBotUsername = null;
async function getBotUsername(telegram) {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await telegram.getMe();
  cachedBotUsername = me.username;
  return cachedBotUsername;
}

function buildReferralLink(botUsername, chatId, userId) {
  return `https://t.me/${botUsername}?start=ref_${chatId}_${userId}`;
}

function handleReferralStart(ctx) {
  const payload = ctx.startPayload;
  if (!payload || !payload.startsWith('ref_')) return;

  const [, chatIdStr, referrerIdStr] = payload.split('_');
  const chatId = Number(chatIdStr);
  const referrerId = Number(referrerIdStr);
  if (!Number.isFinite(chatId) || !Number.isFinite(referrerId)) return;
  if (referrerId === ctx.from.id) return; // can't refer yourself

  const recorded = referrals.recordReferral(ctx.from.id, referrerId, chatId);
  if (recorded) {
    ctx.reply(
      "👋 Welcome! Head into the group you were invited to and say hello — your friend earns a reward once you do."
    );
  }
}

async function checkReferralReward(ctx) {
  const chatId = ctx.chat.id;
  const referral = referrals.getPendingReferral(ctx.from.id);
  if (!referral || referral.chat_id !== chatId) return;

  if (!referrals.tryMarkRewarded(ctx.from.id)) return; // race guard, e.g. duplicate updates

  grantRewards(chatId, referral.referrer_user_id, { xp: XP.INVITE_FRIEND, coins: REFERRAL_COINS });
  const newUsername = ctx.from.username || ctx.from.first_name;
  try {
    await ctx.reply(
      `🎉 ${bold(escapeHtml(newUsername))} joined thanks to an invite! The referrer earned +${bold(
        XP.INVITE_FRIEND
      )} XP, +${bold(REFERRAL_COINS)} Coins. 🤝`,
      HTML
    );
  } catch (err) {
    console.error('Failed to post referral reward message:', err.message);
  }
}

async function showInviteLink(ctx) {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return ctx.reply('<blockquote>Use /invite inside a group to get your personal invite link for that group.</blockquote>', HTML);
  }
  const username = await getBotUsername(ctx.telegram);
  const link = buildReferralLink(username, ctx.chat.id, ctx.from.id);
  return ctx.reply(
    [
      '<blockquote>',
      bold('🤝 Invite Friends!'),
      '',
      `Share your personal link — when a friend joins and says hello in this group, you earn +${bold(
        XP.INVITE_FRIEND
      )} XP and +${bold(REFERRAL_COINS)} Coins:`,
      '',
      link,
      '</blockquote>',
    ].join('\n'),
    HTML
  );
}

function register(bot) {
  bot.command('invite', showInviteLink);
}

module.exports = {
  register,
  handleReferralStart,
  checkReferralReward,
  getBotUsername,
  buildReferralLink,
  showInviteLink,
};
