const { Telegraf } = require('telegraf');
const { BOT_TOKEN } = require('./config');
const groups = require('./db/groups');
const users = require('./db/users');
const { grantRewards } = require('./utils/rewards');
const XP = require('./utils/xpValues');

const profileFeature = require('./features/profile');
const checkinFeature = require('./features/checkin');
const morningMissionFeature = require('./features/morningMission');
const spawnFeature = require('./features/spawn');
const spinChestFeature = require('./features/spinChest');
const quizFeature = require('./features/quiz');
const inventoryFeature = require('./features/inventory');
const streakReminderFeature = require('./features/streakReminder');
const adminPanelFeature = require('./features/adminPanel');
const referralFeature = require('./features/referral');
const autopromoFeature = require('./features/autopromo');
const announcementFeature = require('./features/announcement');
const collectionFeature = require('./features/collection');
const tictactoeFeature = require('./features/tictactoe');
const rpsFeature = require('./features/rps');
const scrambleFeature = require('./features/scramble');
const whosthatFeature = require('./features/whosthat');
const gamesFeature = require('./features/games');
const connect4Feature = require('./features/connect4');
const hangmanFeature = require('./features/hangman');
const shopFeature = require('./features/shop');
const promoCodesFeature = require('./features/promoCodes');
const generateCodeFeature = require('./features/generateCode');
const friendsFeature = require('./features/friends');
const seasonalEventsFeature = require('./features/seasonalEvents');
const battleFeature = require('./features/battle');
const luckyDrawFeature = require('./features/luckyDraw');
const hiddenEventsFeature = require('./features/hiddenEvents');
const breedingFeature = require('./features/breeding');
const bossRaidFeature = require('./features/bossRaid');
const teamWarsFeature = require('./features/teamWars');
const breedFeature = require('./features/breed');
const pokeStoreFeature = require('./features/pokeStore');
const tradingFeature = require('./features/trading');
const { startWebAppServer } = require('./webapp/server');
const { ADMIN_IDS } = require('./config');
const { bold, HTML, brandTag } = require('./utils/text');
const { Markup } = require('telegraf');

const bot = new Telegraf(BOT_TOKEN);

// Installed before any feature registers — every ctx.reply/replyWithPhoto/etc. and every
// bot.telegram.sendXxx call from here on out (across every feature file) automatically
// gets its group messages cleaned up after a couple minutes. See src/utils/autoDelete.js.
require('./utils/autoDelete').installAutoDelete(bot);

// Populates Telegram's native "/" menu button next to the message box.
const BOT_COMMANDS = [
  { command: 'profile', description: '👤 View your trainer profile' },
  { command: 'leaderboard', description: '🏆 Top trainers in this group' },
  { command: 'checkin', description: '🔥 Daily streak check-in' },
  { command: 'mission', description: "🌞 View today's mystery mission" },
  { command: 'spin', description: '🎡 Free daily spin wheel' },
  { command: 'chest', description: '📦 Free daily mystery chest' },
  { command: 'quiz', description: '❓ Start a Poké Quiz' },
  { command: 'games', description: '🎮 Mini-games menu & rules' },
  { command: 'tictactoe', description: '❌⭕ Challenge someone to Tic-Tac-Toe' },
  { command: 'rps', description: '🔥💧🌿 Challenge someone to Rock-Paper-Scissors' },
  { command: 'scramble', description: '🔤 Unscramble a Pokémon name' },
  { command: 'whosthat', description: "❓ Who's that Pokémon? Guess the silhouette" },
  { command: 'whosthatstart', description: "🔁 Auto-post a new Who's That round after each one ends" },
  { command: 'stopwhoisthat', description: "🛑 Stop auto Who's That" },
  { command: 'connect4', description: '🔴🟡 Challenge someone to Connect 4' },
  { command: 'hangman', description: '🪢 Guess the Pokémon name, letter by letter' },
  { command: 'battle', description: '⚔️ Challenge someone to a 3v3 Pokémon team battle' },
  { command: 'inventory', description: '🎒 View your items' },
  { command: 'collection', description: '📂 Browse your Pokémon & items' },
  { command: 'shop', description: '🛍️ Spend coins on titles & badges' },
  { command: 'store', description: '🛒 Spend Gold on exclusive Pokémon (DM only)' },
  { command: 'trade', description: '🔄 Reply to a trainer to trade Pokémon/items/Coins' },
  { command: 'canceltrade', description: '❌ Cancel your pending trade' },
  { command: 'redeem', description: '🎟️ Redeem a promo code' },
  { command: 'use', description: '✨ Use an item, e.g. /use shiny_ticket' },
  { command: 'egg', description: '🥚 Incubate or hatch an egg' },
  { command: 'breed', description: '🥚 Breed two Pokémon (yours, or with a friend) for an egg' },
  { command: 'jointeam', description: '⚔️ Join Team Red or Team Blue' },
  { command: 'warstatus', description: '📊 Check the current Team War standings' },
  { command: 'raidstats', description: '🏆 Check your Boss Raid stats in this group' },
  { command: 'myteam', description: '🐾 Build your 3-Pokémon team for Raids & Battles' },
  { command: 'guide', description: '📖 Full step-by-step guide' },
  { command: 'invite', description: '🤝 Get your invite link for rewards' },
  { command: 'friend', description: '🤝 Reply to someone to send a friend request' },
  { command: 'friends', description: '📇 View your friends list' },
  { command: 'gift', description: '🎁 Send a friend today\'s free gift' },
  { command: 'unfriend', description: '💔 Remove someone from your friends list' },
  { command: 'promo', description: '📣 Show a shareable hype message' },
  { command: 'myid', description: '🆔 Show your Telegram user ID' },
  { command: 'help', description: 'ℹ️ Show all commands' },
];

const HELP_TEXT = [
  brandTag(),
  '',
  '<blockquote>',
  bold('🎮 Commands'),
  '',
  '👤 /profile — View your trainer profile',
  '🏆 /leaderboard — Top trainers in this group',
  '🔥 /checkin — Daily streak check-in',
  '🌞 /mission — View today\'s mystery mission',
  '🎡 /spin — Free daily spin wheel',
  '📦 /chest — Free daily mystery chest',
  '❓ /quiz — Start a Poké Quiz (first correct answer wins)',
  '🎒 /inventory — View items you\'ve earned and what they do',
  '📂 /collection — Browse your Pokémon, items, and more by category',
  '🛍️ /shop — Spend coins on titles & badges shown on your profile',
  '🛒 /store — Spend Gold (a separate premium currency, DM only) on exclusive Pokémon',
  '🔄 /trade — Reply to another trainer\'s message to trade Pokémon, items, and/or Coins',
  '🎟️ /redeem CODE — Redeem a promo code for XP/coins',
  '✨ /use &lt;item&gt; — Use a consumable item, e.g. /use shiny_ticket',
  '🥚 /egg — Incubate an egg from /spin, /chest, or /breed, then hatch it into a new Pokémon',
  '🥚 /breed — Breed two of your own Pokémon, or reply to a friend to breed with theirs',
  '⚔️ /jointeam red (or blue) — Join a team; /warstatus checks Team War standings',
  '🏆 /raidstats — Check your Boss Raid stats in this group',
  '🐾 /myteam — Pick your 3-Pokémon team for Boss Raids & PvP Battles',
  '📖 /guide — Full step-by-step guide for new trainers',
  '🤝 /invite — Get your personal invite link and earn rewards',
  '📣 /promo — Show a fun, shareable hype message about this group',
  '',
  bold('🤝 Friends'),
  '',
  '🤝 /friend — Reply to someone\'s message to send a friend request',
  '📇 /friends — View your friends list',
  '🎁 /gift — Send today\'s free gift to a friend',
  '💔 /unfriend — Remove a friend',
  '',
  bold('🎮 Mini-Games'),
  '',
  '📖 /games — Mini-games menu with rules for each one',
  '❌⭕ /tictactoe — Challenge someone to Tic-Tac-Toe',
  '🔥💧🌿 /rps — Rock-Paper-Scissors',
  '🔴🟡 /connect4 — Challenge someone to Connect 4',
  '🔤 /scramble — Unscramble a Pokémon name',
  '❓ /whosthat — Guess the Pokémon from its silhouette',
  '🪢 /hangman — Guess the Pokémon letter by letter',
  '⚔️ /battle — 3v3 team battles with real Pokémon from your /collection',
  '</blockquote>',
].join('\n');

const GUIDE_TEXT = [
  brandTag(),
  '',
  '<blockquote>',
  bold('📖 Trainer Guide — How This Group Works'),
  '',
  bold('1. Check in every day'),
  'Send /checkin once a day to build your streak 🔥. Longer streaks unlock bonus rewards at day 7, 15, 30, and 100.',
  '',
  bold('2. Watch for wild Pokémon'),
  'Every 30–60 minutes a wild Pokémon appears in the group with a 🎯 Catch! button. First tap wins it — rarer ones give more XP and Coins.',
  '',
  bold('3. Complete the daily mission'),
  "Send /mission to see today's target Pokémon.",
  '',
  bold('4. Spin & open your free daily rewards'),
  '/spin and /chest are both free once a day.',
  '',
  bold('5. Use your items'),
  'Check /inventory to see what you\'ve collected, then /use &lt;item&gt; to redeem it.',
  '',
  bold('6. Play mini-games & battles'),
  'Send /games for mini-games or /battle for 3v3 Pokémon team combat!',
  '</blockquote>',
].join('\n');

const settings = require('./db/settings');

const START_TEXT = [
  brandTag(),
  '',
  '<blockquote>',
  bold('🎮 Welcome to PokéDex Bot!'),
  '',
  bold('Catch Pokémon, complete missions, collect rare finds, battle trainers & climb the leaderboard! 🐾🏆'),
  '',
  '✨ ' + bold('Ready to begin your journey?'),
  '',
  '👉 Tap /start to create your Trainer Profile and begin catching!',
  '</blockquote>',
].join('\n');

function guideKeyboard() {
  return Markup.inlineKeyboard([Markup.button.callback('📖 Full Guide', 'show_guide')]);
}

function startKeyboard(botUsername) {
  const buttons = [];
  if (botUsername) {
    buttons.push([Markup.button.url('➕ Add to Group', `https://t.me/${botUsername}?startgroup=true`)]);
  }
  buttons.push([Markup.button.callback('📖 Full Guide', 'show_guide')]);
  return Markup.inlineKeyboard(buttons);
}

async function sendStartMessage(ctx) {
  referralFeature.handleReferralStart(ctx);
  const botUsername = ctx.botInfo?.username;
  const keyboard = startKeyboard(botUsername);

  const startVideo = settings.getSetting('start_video_url', null);
  const startPic = settings.getSetting('start_pic_url', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');

  if (startVideo) {
    try {
      return await ctx.replyWithVideo(startVideo, { caption: START_TEXT, ...HTML, ...keyboard });
    } catch (err) {
      try {
        return await ctx.replyWithAnimation(startVideo, { caption: START_TEXT, ...HTML, ...keyboard });
      } catch (err2) {
        console.error('Failed to send start video, attempting photo fallback:', err2.message);
      }
    }
  }

  if (startPic) {
    try {
      return await ctx.replyWithPhoto(startPic, { caption: START_TEXT, ...HTML, ...keyboard });
    } catch (err) {
      console.error('Failed to send start cover photo, falling back to text:', err.message);
    }
  }

  return ctx.reply(START_TEXT, { ...HTML, ...keyboard });
}

bot.start((ctx) => {
  console.log(`/start received from ${ctx.from.username || ctx.from.id} in chat ${ctx.chat.id}`);
  return sendStartMessage(ctx);
});

bot.help((ctx) => ctx.reply(HELP_TEXT, { ...HTML, ...guideKeyboard() }));
bot.command('guide', (ctx) => ctx.reply(GUIDE_TEXT, HTML));

bot.action('show_guide', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(GUIDE_TEXT, HTML);
});

bot.action('show_help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(HELP_TEXT, { ...HTML, ...guideKeyboard() });
});

// Command Callback Handlers
bot.action('cmd:profile', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return profileFeature.showProfile(ctx); });
bot.action('cmd:leaderboard', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return profileFeature.showLeaderboard(ctx); });
bot.action('cmd:checkin', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return checkinFeature.handleCheckin(ctx); });
bot.action('cmd:spin', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return spinChestFeature.handleSpin(ctx); });
bot.action('cmd:chest', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return spinChestFeature.handleChest(ctx); });
bot.action('cmd:quiz', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return quizFeature.startQuiz(ctx); });
bot.action('cmd:battle', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return ctx.reply('⚔️ Send /battle in a group or reply to a trainer to challenge them!'); });
bot.action('cmd:games', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return gamesFeature.showGamesMenu(ctx); });
bot.action('cmd:inventory', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return inventoryFeature.showInventory(ctx); });
bot.action('cmd:collection', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return collectionFeature.showCollection(ctx); });
bot.action('cmd:shop', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return shopFeature.showShop(ctx); });
bot.action('cmd:breed', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return breedFeature.handleBreedCommand(ctx); });
bot.action('cmd:friends', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return friendsFeature.showFriends(ctx); });
bot.action('cmd:invite', async (ctx) => { try { await ctx.answerCbQuery(); } catch (e) {} return referralFeature.showInviteLink(ctx); });

// Admin commands to update/reset start media (Video / Photo)
bot.command(['setstartvideo', 'setstartanim'], async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ Admin command only.');
  }

  let videoUrlOrId = null;
  const textArg = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (textArg && (textArg.startsWith('http://') || textArg.startsWith('https://'))) {
    videoUrlOrId = textArg;
  }

  if (!videoUrlOrId && (ctx.message.video || ctx.message.animation)) {
    const media = ctx.message.video || ctx.message.animation;
    videoUrlOrId = media.file_id;
  }

  if (!videoUrlOrId && ctx.message.reply_to_message && (ctx.message.reply_to_message.video || ctx.message.reply_to_message.animation)) {
    const media = ctx.message.reply_to_message.video || ctx.message.reply_to_message.animation;
    videoUrlOrId = media.file_id;
  }

  if (!videoUrlOrId) {
    return ctx.reply('⚠️ Please send a video URL (e.g. `/setstartvideo https://...`) or reply to a video/GIF with `/setstartvideo`.', HTML);
  }

  settings.setSetting('start_video_url', videoUrlOrId);
  return ctx.reply('✅ Start video cover updated successfully! /start will now play this video/animation.', HTML);
});

bot.command(['setstartpic', 'setstartcover'], async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ Admin command only.');
  }

  let photoUrlOrId = null;
  const textArg = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (textArg && (textArg.startsWith('http://') || textArg.startsWith('https://'))) {
    photoUrlOrId = textArg;
  }

  if (!photoUrlOrId && ctx.message.photo && ctx.message.photo.length > 0) {
    photoUrlOrId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  }

  if (!photoUrlOrId && ctx.message.reply_to_message && ctx.message.reply_to_message.photo && ctx.message.reply_to_message.photo.length > 0) {
    photoUrlOrId = ctx.message.reply_to_message.photo[ctx.message.reply_to_message.photo.length - 1].file_id;
  }

  if (!photoUrlOrId) {
    return ctx.reply('⚠️ Please send a photo URL (e.g. `/setstartpic https://...`) or reply to an image with `/setstartpic`.', HTML);
  }

  settings.setSetting('start_pic_url', photoUrlOrId);
  return ctx.reply('✅ Start cover photo updated successfully!', HTML);
});

bot.command('resetstartmedia', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ Admin command only.');
  }

  settings.setSetting('start_video_url', '');
  settings.setSetting('start_pic_url', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');
  return ctx.reply('✅ Start media reset to default!', HTML);
});

// Register the group and kick off its spawn loop whenever the bot is added,
// and whenever anyone interacts with it (covers groups added before this deploy).
function ensureGroupActive(ctx) {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
  groups.registerGroup(ctx.chat.id, ctx.chat.title);
  spawnFeature.scheduleNextSpawn(bot, ctx.chat.id);
}

bot.on('my_chat_member', (ctx) => {
  const chatId = ctx.chat.id;
  const newStatus = ctx.myChatMember?.new_chat_member?.status;
  if (newStatus === 'kicked' || newStatus === 'left') {
    groups.setGroupActive(chatId, false);
    spawnFeature.stopSpawns(chatId);
    console.log(`Bot removed from chat ${chatId} (${newStatus}) — group deactivated.`);
    return;
  }
  ensureGroupActive(ctx);
});

bot.use((ctx, next) => {
  ensureGroupActive(ctx);
  return next();
});

// Passive chat XP: 1 XP per message, throttled to once per 60s per user to prevent spam-farming.
const lastChatXp = new Map(); // `${chatId}:${userId}` -> timestamp
bot.on('text', async (ctx, next) => {
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    const now = Date.now();
    if (!lastChatXp.has(key) || now - lastChatXp.get(key) >= 60_000) {
      lastChatXp.set(key, now);
      users.getOrCreateUser(ctx.chat.id, ctx.from.id, ctx.from.username || ctx.from.first_name);
      grantRewards(ctx.chat.id, ctx.from.id, { xp: XP.CHAT });
    }
    await referralFeature.checkReferralReward(ctx);
  }
  return next();
});

profileFeature.register(bot);
checkinFeature.register(bot);
morningMissionFeature.register(bot);
spawnFeature.register(bot);
spinChestFeature.register(bot);
quizFeature.register(bot);
inventoryFeature.register(bot);
collectionFeature.register(bot);
streakReminderFeature.register(bot);
adminPanelFeature.register(bot);
referralFeature.register(bot);
autopromoFeature.register(bot);
announcementFeature.register(bot);
gamesFeature.register(bot);
tictactoeFeature.register(bot);
rpsFeature.register(bot);
scrambleFeature.register(bot);
whosthatFeature.register(bot);
connect4Feature.register(bot);
hangmanFeature.register(bot);
shopFeature.register(bot);
promoCodesFeature.register(bot);
generateCodeFeature.register(bot);
friendsFeature.register(bot);
seasonalEventsFeature.register(bot);
battleFeature.register(bot);
luckyDrawFeature.register(bot);
hiddenEventsFeature.register(bot);
breedingFeature.register(bot);
bossRaidFeature.register(bot);
teamWarsFeature.register(bot);
breedFeature.register(bot);
pokeStoreFeature.register(bot);
tradingFeature.register(bot);

// Admin-only: preview tonight's streak reminder without waiting for 9 PM.
bot.command('teststreakreminder', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.reply('🛠 Admin-only command.');
    return;
  }
  await streakReminderFeature.postStreakReminder(bot, ctx.chat.id);
  await ctx.reply('(If nothing appeared above, nobody in this group is currently at risk of losing a streak.)');
});

// Anyone can check their own numeric Telegram ID — needed to add someone to ADMIN_IDS in .env.
bot.command('myid', (ctx) => {
  ctx.reply(`Your Telegram user ID: ${bold(ctx.from.id)}`, HTML);
});

bot.catch((err, ctx) => {
  console.error(`Error handling update ${ctx.updateType}:`, err);
});

async function main() {
  // Resume spawn loops for groups the bot was already active in before restart.
  for (const group of groups.listActiveGroups()) {
    spawnFeature.scheduleNextSpawn(bot, group.chat_id);
  }

  // In-process, not a separate pm2 app — the Mini App backend needs the exact same
  // `require('./features/bossRaid')` module instance the Telegram handlers above use, so an
  // attack from either surface mutates the one shared in-memory raid state.
  try {
    startWebAppServer(bot);
  } catch (err) {
    console.error('Failed to start the raid Mini App server (raids still work via Telegram buttons):', err.message);
  }

  await bot.telegram.setMyCommands(BOT_COMMANDS);
  await bot.launch();
  console.log('Daily Trainer Bot is running.');
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
