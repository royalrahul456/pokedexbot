const cron = require('node-cron');
const { listActiveGroups } = require('../db/groups');
const inventory = require('../db/inventory');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML, brandTag } = require('../utils/text');
const { deactivateIfGroupGone } = require('../utils/groupHealth');
const { ADMIN_IDS } = require('../config');

const DRAW_COINS = 300;
const DRAW_ITEM = 'mystery_box';

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Runs the nightly draw for one group. Every entrant's ticket is consumed regardless of
// outcome (real-raffle mechanics, not a refundable entry) — same "consume-only-on-success"
// pattern isn't needed here since there's no failure mode, just a random winner pick.
async function postLuckyDraw(bot, chatId) {
  const entrants = inventory.listHoldersInGroup(chatId, 'lucky_ticket');
  if (entrants.length === 0) return;

  for (const entrant of entrants) {
    inventory.consumeItem(entrant.user_id, 'lucky_ticket');
  }

  const winner = pick(entrants);
  grantRewards(chatId, winner.user_id, { xp: XP.LUCKY_DRAW_WIN, coins: DRAW_COINS });
  inventory.addItem(winner.user_id, DRAW_ITEM, 1);

  const text = [
    brandTag(),
    bold('🎟️ Lucky Draw!'),
    '',
    `${bold(entrants.length)} ticket(s) were entered tonight...`,
    '',
    `🏆 The winner is ${bold(escapeHtml(winner.username || 'a lucky trainer'))}!`,
    `+${bold(DRAW_COINS)} Coins, +${bold(XP.LUCKY_DRAW_WIN)} XP, 1 Mystery Box 🎁`,
    '',
    "Everyone else's ticket was entered too — better luck next time! Get more Lucky Tickets from /chest.",
  ].join('\n');

  await bot.telegram.sendMessage(chatId, text, HTML);
}

function register(bot) {
  // Runs every night at 10 PM server time — after the 9 PM streak reminder, distinct slot.
  cron.schedule('0 22 * * *', async () => {
    for (const group of listActiveGroups()) {
      try {
        await postLuckyDraw(bot, group.chat_id);
      } catch (err) {
        console.error(`Failed to run Lucky Draw for chat ${group.chat_id}:`, err.message);
        deactivateIfGroupGone(group.chat_id, err, 'lucky draw');
      }
    }
  });

  // Admin-only: preview tonight's draw immediately without waiting for 10 PM.
  bot.command('testluckydraw', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    await postLuckyDraw(bot, ctx.chat.id);
    await ctx.reply('(If nothing appeared above, nobody in this group currently holds a Lucky Ticket.)');
  });
}

module.exports = { register, postLuckyDraw };
