const users = require('../db/users');
const streaks = require('../db/streaks');
const { grantRewards } = require('../utils/rewards');
const { bold, HTML } = require('../utils/text');
const { react } = require('../utils/reactions');

const MILESTONE_REWARDS = {
  7: { xp: 100, coins: 200 },
  15: { xp: 250, coins: 500 },
  30: { xp: 500, coins: 1000 },
  100: { xp: 2000, coins: 5000 },
};

const BASE_CHECKIN_REWARD = { xp: 15, coins: 25 };

function register(bot) {
  bot.command(['checkin', 'daily'], async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    users.getOrCreateUser(chatId, userId, ctx.from.username || ctx.from.first_name);

    const result = streaks.checkIn(chatId, userId);
    if (result.alreadyCheckedInToday) {
      ctx.reply(`<blockquote>You already checked in today! Current streak: ${bold(`Day ${result.streak}`)} 🔥</blockquote>`, HTML);
      return;
    }

    grantRewards(chatId, userId, BASE_CHECKIN_REWARD);

    const lines = [
      `✅ Checked in! ${bold(`Day ${result.streak}`)} 🔥`,
      `+${bold(BASE_CHECKIN_REWARD.xp)} XP, +${bold(BASE_CHECKIN_REWARD.coins)} Coins`,
    ];

    const isMilestone = result.milestone && MILESTONE_REWARDS[result.milestone];
    if (isMilestone) {
      const reward = MILESTONE_REWARDS[result.milestone];
      grantRewards(chatId, userId, reward);
      lines.push(
        '',
        `🏅 ${bold(`Milestone reached: Day ${result.milestone}!`)}`,
        `Bonus: +${bold(reward.xp)} XP, +${bold(reward.coins)} Coins`
      );
    }

    const sent = await ctx.reply(`<blockquote>\n${lines.join('\n')}\n</blockquote>`, HTML);
    if (isMilestone) {
      await react(ctx.telegram, chatId, sent.message_id, '🔥');
    }
  });
}

module.exports = { register };
