const cron = require('node-cron');
const { listActiveGroups, getGroup, toggleAutopromo, setPromoText } = require('../db/groups');
const { ADMIN_IDS } = require('../config');
const { bold, HTML } = require('../utils/text');
const { deactivateIfGroupGone } = require('../utils/groupHealth');

// A rotating pool instead of one static line — keeps it feeling alive instead of nagging.
const DEFAULT_PROMO_MESSAGES = [
  [
    bold("🚨 Trainer Alert!"),
    '',
    "This group is popping off — Legendary spawns, daily missions, a leaderboard that won't fill itself. Got a friend who still isn't playing? /invite them before someone else claims the bragging rights. 🏆",
  ].join('\n'),
  [
    bold('🎮 PSA from your local Professor:'),
    '',
    "Every trainer started as a Rookie. Bring a friend in with /invite and you BOTH win — they get to play, you get +100 XP and +200 Coins. That's it. That's the whole scam. 🤝",
  ].join('\n'),
  [
    bold("🔥 There's a hole in this leaderboard..."),
    '',
    "...and it has your friend's name on it. Fix that. Send /invite and let them embarrass themselves at Lv1 while you flex your streak. 😏",
  ].join('\n'),
  [
    bold("🐉 Rare spawns don't wait around."),
    '',
    "Neither should your invite. Tap /invite, stack free rewards, and watch your friends slowly realize they're behind. ✨",
  ].join('\n'),
  [
    bold('🎁 Free Coins, zero effort:'),
    '',
    "Every friend you bring in with /invite = instant rewards for you. It's basically a Mystery Box you control. Go on, open it. 📦",
  ].join('\n'),
  [
    bold('👀 Someone in this group is one invite away from being unstoppable.'),
    '',
    "Could be you. Send /invite and find out. 🚀",
  ].join('\n'),
  [
    bold('🎮⚡ WAKE UP, TRAINER! ⚡🎮'),
    '',
    '🌅 A fresh mission drops every morning',
    "🐾 Wild Pokémon spawn all day — ⏳ but they don't wait around",
    '🎡 Free daily spin + 📦 Mystery Chest, just for showing up',
    '🏆 A leaderboard that remembers who actually plays',
    '',
    '🔥 Miss a day, lose your streak. Show up, level up.',
    '',
    '🤝 Got a friend who needs this energy? Send /invite — you BOTH cash in the moment they join. 💰✨',
    '',
    'This group only gets better with more trainers in it. Go bring one. 🚀',
  ].join('\n'),
  [
    bold('🚨 TRAINERS, LISTEN UP 🚨'),
    '',
    '🎯 Catch. 🔥 Streak. 🎡 Spin. 🏆 Climb.',
    'Every day = new rewards, new spawns, new bragging rights.',
    '',
    '👀 Someone you know is missing out — fix that with /invite and you BOTH earn XP + Coins instantly. 🤝💰',
    '',
    "Let's grow this squad. 🚀",
  ].join('\n'),
];

function pickPromoMessage() {
  return DEFAULT_PROMO_MESSAGES[Math.floor(Math.random() * DEFAULT_PROMO_MESSAGES.length)];
}

// A group's custom text (set via /setpromo) always wins over the rotating pool.
function resolvePromoText(group) {
  return group?.promo_text || pickPromoMessage();
}

function register(bot) {
  // Runs every 6 hours; only posts in groups where an admin has turned it on.
  cron.schedule('0 */6 * * *', async () => {
    for (const group of listActiveGroups()) {
      if (!group.autopromo_enabled) continue;
      try {
        await bot.telegram.sendMessage(group.chat_id, resolvePromoText(group), HTML);
      } catch (err) {
        console.error(`Failed to post auto-promo for chat ${group.chat_id}:`, err.message);
        deactivateIfGroupGone(group.chat_id, err, 'auto-promo');
      }
    }
  });

  // Anyone can preview/trigger the promo message on demand — handy for sharing manually
  // or for an admin who doesn't want to wait for the 6-hour cron.
  bot.command('promo', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    await ctx.reply(resolvePromoText(group), HTML);
  });

  // Admin-only: set this group's custom promo text, or reset to the rotating pool with no args.
  bot.command('setpromo', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
    setPromoText(ctx.chat.id, text || null);
    await ctx.reply(
      text
        ? '✅ Custom auto-promo message set for this group.'
        : '✅ Auto-promo reset — back to the rotating default messages.'
    );
  });
}

module.exports = { register, toggleAutopromo, getGroup, DEFAULT_PROMO_MESSAGES, pickPromoMessage };
