const { Markup } = require('telegraf');
const {
  rollSpawn,
  rollSpawnWithRarity,
  rollSpawnForName,
  RARITY_XP,
  RARITY_COINS,
  getPokedexEntry,
  formatTypeLine,
  getBaseRarity,
} = require('../data/pokemon');
const spawns = require('../db/spawns');
const users = require('../db/users');
const missions = require('../db/missions');
const inventory = require('../db/inventory');
const pokemonCollection = require('../db/pokemonCollection');
const seasonalEvents = require('../db/seasonalEvents');
const { react } = require('../utils/reactions');
const { grantRewards } = require('../utils/rewards');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatDuration } = require('../utils/format');
const { ADMIN_IDS } = require('../config');
const { deactivateIfGroupGone } = require('../utils/groupHealth');

const MIN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;

// Rarer Pokemon get a shorter catch window, so "Catch Chance" feels meaningful.
const RARITY_EXPIRY_MS = {
  common: 10 * 60 * 1000,
  rare: 8 * 60 * 1000,
  shiny: 6 * 60 * 1000,
  legendary: 4 * 60 * 1000,
  mythical: 3 * 60 * 1000,
  shiny_legendary: 2.5 * 60 * 1000,
  shiny_mythical: 2 * 60 * 1000,
};

const RARITY_HEADLINE = {
  common: (name) => `A Wild ${name} appeared!`,
  rare: (name) => `A Wild ${name} appeared!`,
  shiny: (name) => `✨ A Wild Shiny ${name} appeared!`,
  legendary: (name) => `🐉 Wild ${name} appeared!`,
  mythical: (name) => `🌟 A Mythical ${name} has appeared!!`,
  shiny_legendary: (name) => `✨🐉 A Wild SHINY ${name} appeared!!`,
  shiny_mythical: (name) => `✨🌟 A Wild SHINY ${name} has appeared!!!`,
};

// Hooky urgency lines shown under the catch window — rarer spawns get more hype/pressure.
const RARITY_URGENCY = {
  common: '⏱ Plenty of time... but don\'t get comfortable.',
  rare: '⏱ Don\'t sleep on this one!',
  shiny: '⚡ RARE FIND — tap before someone else does!',
  legendary: '🚨 LEGENDARY! Everyone in the group can see this. GO GO GO!',
  mythical: '🚨🚨 MYTHICAL SPAWN! Blink and it\'s gone forever!',
  shiny_legendary: '🚨✨ SHINY LEGENDARY! This might never happen again. GO NOW!',
  shiny_mythical: '🚨✨ SHINY MYTHICAL!! The rarest thing in the game. DO NOT MISS THIS!',
};

// Only rare+ catches get an animated reaction — reacting on every common spawn would get
// noisy fast across many active groups. `null` means no reaction for that rarity.
const RARITY_REACTION = {
  common: null,
  rare: null,
  shiny: '🔥',
  legendary: '🏆',
  mythical: '🏆',
  shiny_legendary: '🎉',
  shiny_mythical: '🎉',
};

// Random variety for the "nobody caught it" message, so repeat misses don't feel copy-pasted.
const GONE_FLAVOR = [
  'It got away! Nobody caught it in time.',
  'So close! It slipped away before anyone tapped.',
  'It fled the scene — faster fingers next time!',
  'Gone! You snooze, you lose. 😅',
];

// A short "get ready" heads-up posted shortly before every spawn, so people aren't
// caught off guard — and it builds a little anticipation instead of just appearing cold.
const TEASER_MESSAGES = [
  "👀 Something's rustling in the bushes... a wild Pokémon is about to appear! Get ready!",
  "📡 Radar's picking up movement nearby... a wild spawn is incoming any second now!",
  "🌾 The grass is shaking... something's about to jump out! Stay alert, trainers!",
  "🔔 Heads up! A wild Pokémon will appear in this chat very soon. Don't blink!",
];

const TEASER_LEAD_MIN_MS = 20 * 1000;
const TEASER_LEAD_MAX_MS = 60 * 1000;

const timers = new Map(); // chatId -> Timeout, so we don't double-schedule a group

function randomInterval() {
  return MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

function randomTeaserLead() {
  return TEASER_LEAD_MIN_MS + Math.random() * (TEASER_LEAD_MAX_MS - TEASER_LEAD_MIN_MS);
}

function pickGoneFlavor() {
  return GONE_FLAVOR[Math.floor(Math.random() * GONE_FLAVOR.length)];
}

function pickTeaser() {
  return TEASER_MESSAGES[Math.floor(Math.random() * TEASER_MESSAGES.length)];
}

async function postTeaser(telegram, chatId) {
  try {
    await telegram.sendMessage(chatId, pickTeaser());
  } catch (err) {
    console.error(`Failed to post spawn teaser for chat ${chatId}:`, err.message);
  }
}

const { formatDexId } = require('../data/pokemon');

function headlineWithGender(rarity, name, gender, dexStr) {
  const dexPrefix = dexStr ? `${dexStr} ` : '';
  const namePart = gender ? `${dexPrefix}${escapeHtml(name)} ${gender}` : `${dexPrefix}${escapeHtml(name)}`;
  return bold(RARITY_HEADLINE[rarity](namePart));
}

function buildSpawnMessage(spawn, precedingText, expiryMs) {
  const dexStr = spawn.dexStr || formatDexId(spawn.dexNumber);
  const headline = headlineWithGender(spawn.rarity, spawn.name, spawn.gender, dexStr);
  const urgency = RARITY_URGENCY[spawn.rarity] ?? RARITY_URGENCY.common;
  const lines = [];
  if (precedingText) lines.push(precedingText, '');
  lines.push(
    headline,
    '',
    bold(formatTypeLine(spawn.types)),
    '',
    bold('Catch Chance:'),
    spawn.stars,
    '',
    `⏳ Disappears in ${bold(formatDuration(expiryMs))}!`,
    urgency
  );
  return `<blockquote>\n${lines.join('\n')}\n</blockquote>`;
}

// `telegram` is a Telegraf Telegram client — either `bot.telegram` or `ctx.telegram`.
async function postSpawn(telegram, chatId, spawn, precedingText) {
  spawns.createSpawn(chatId, spawn.name, spawn.rarity, spawn.gender);
  const expiryMs = RARITY_EXPIRY_MS[spawn.rarity] ?? RARITY_EXPIRY_MS.common;
  const caption = buildSpawnMessage(spawn, precedingText, expiryMs);
  const keyboard = Markup.inlineKeyboard([Markup.button.callback('🎯 Catch!', 'catch')]).reply_markup;

  const message = spawn.imageUrl
    ? await telegram.sendPhoto(chatId, spawn.imageUrl, { caption, parse_mode: 'HTML', reply_markup: keyboard })
    : await telegram.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: keyboard });
  spawns.setSpawnMessageId(chatId, message.message_id);

  setTimeout(async () => {
    const didExpire = spawns.tryExpireSpawn(chatId, message.message_id);
    if (!didExpire) return; // already caught, or a newer spawn replaced it
    const dexStr = spawn.dexStr || formatDexId(spawn.dexNumber);
    const headline = headlineWithGender(spawn.rarity, spawn.name, spawn.gender, dexStr);
    const goneText = `<blockquote>\n${headline}\n\n💨 ${pickGoneFlavor()}\n</blockquote>`;
    try {
      if (spawn.imageUrl) {
        await telegram.editMessageCaption(chatId, message.message_id, undefined, goneText, HTML);
      } else {
        await telegram.editMessageText(chatId, message.message_id, undefined, goneText, HTML);
      }
    } catch (err) {
      console.error(`Failed to edit expired spawn message for chat ${chatId}:`, err.message);
    }
  }, expiryMs);
}

// Active seasonal event (if any) biases which species shows up within its normal rarity
// tier, and gets a short banner line on the spawn message so people know why it's showing up.
function activeEventThemeSet() {
  const event = seasonalEvents.getActiveEvent();
  if (!event) return { themeSet: null, banner: undefined };
  return {
    themeSet: new Set(event.theme_species.split(',')),
    banner: bold(`🎉 ${escapeHtml(event.name)} Event!`),
  };
}

async function doSpawn(telegram, chatId, extraBanner) {
  const { themeSet, banner } = activeEventThemeSet();
  const combinedBanner = [extraBanner, banner].filter(Boolean).join('\n') || undefined;
  await postSpawn(telegram, chatId, rollSpawn(themeSet), combinedBanner);
}

// Summons an immediate spawn of a specific rarity, e.g. from a redeemed ticket item.
async function forceSpawn(telegram, chatId, rarity, precedingText) {
  await postSpawn(telegram, chatId, rollSpawnWithRarity(rarity), precedingText);
}

// Guarantees one exact, known Pokemon spawns — used to make sure the daily mission's
// target actually appears in the group instead of leaving it to random chance.
async function forceSpawnNamed(telegram, chatId, name, precedingText) {
  await postSpawn(telegram, chatId, rollSpawnForName(name), precedingText);
}

function scheduleNextSpawn(bot, chatId) {
  if (timers.has(chatId)) return; // already running for this group
  const runOnce = async () => {
    try {
      await postTeaser(bot.telegram, chatId);
      await new Promise((resolve) => setTimeout(resolve, randomTeaserLead()));
      await doSpawn(bot.telegram, chatId);
    } catch (err) {
      console.error(`Spawn failed for chat ${chatId}:`, err.message);
      if (deactivateIfGroupGone(chatId, err, 'spawn loop')) {
        timers.delete(chatId);
        return; // group is gone — stop rescheduling instead of retrying forever
      }
    }
    timers.set(chatId, setTimeout(runOnce, randomInterval()));
  };
  timers.set(chatId, setTimeout(runOnce, randomInterval()));
}

function stopSpawns(chatId) {
  const timer = timers.get(chatId);
  if (timer) clearTimeout(timer);
  timers.delete(chatId);
}

function register(bot) {
  // Admin-only: trigger an immediate spawn for testing, instead of waiting up to 60 minutes.
  bot.command('forcespawn', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply("🛠 Admin-only command. Add your Telegram user ID to ADMIN_IDS in .env to use this.");
      return;
    }
    const rarityArg = ctx.message.text.split(' ')[1]?.toLowerCase();
    const validRarities = ['common', 'rare', 'shiny', 'legendary', 'mythical', 'shiny_legendary', 'shiny_mythical'];
    if (rarityArg && !validRarities.includes(rarityArg)) {
      await ctx.reply(`Usage: /forcespawn [${validRarities.join('|')}] — omit for a random rarity.`);
      return;
    }
    if (rarityArg) {
      await forceSpawn(ctx.telegram, ctx.chat.id, rarityArg, '🛠 Admin forced spawn.');
    } else {
      await doSpawn(ctx.telegram, ctx.chat.id);
    }
  });

  bot.action('catch', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const spawn = spawns.getActiveSpawn(chatId);

    if (!spawn || spawn.caught_by) {
      await ctx.answerCbQuery('Too slow! Already caught.');
      return;
    }
    if (spawn.expired) {
      await ctx.answerCbQuery('💨 Too late — it got away!');
      return;
    }

    const won = spawns.tryClaimSpawn(chatId, userId);
    if (!won) {
      await ctx.answerCbQuery('Too slow! Someone beat you to it.');
      return;
    }

    const username = ctx.from.username || ctx.from.first_name;
    users.getOrCreateUser(chatId, userId, username);
    users.incrementCounter(chatId, userId, 'catches');
    const isShinyCatch = spawn.rarity === 'shiny' || spawn.rarity === 'shiny_legendary' || spawn.rarity === 'shiny_mythical';
    if (isShinyCatch) users.incrementCounter(chatId, userId, 'shiny_count');
    if (['legendary', 'mythical', 'shiny_legendary', 'shiny_mythical'].includes(spawn.rarity)) {
      users.incrementCounter(chatId, userId, 'legendary_count');
    }
    // Global collection — same across every group, unlike the per-group counters above.
    pokemonCollection.recordCatch(
      userId,
      spawn.pokemon_name,
      getBaseRarity(spawn.pokemon_name),
      isShinyCatch
    );

    const xpReward = RARITY_XP[spawn.rarity];
    const coinsReward = RARITY_COINS[spawn.rarity];
    const levelUpMsg = grantRewards(chatId, userId, { xp: xpReward, coins: coinsReward });
    const missionCompleted = missions.tryCompleteMission(chatId, userId, spawn.pokemon_name);

    await ctx.answerCbQuery(`You caught ${spawn.pokemon_name}!`);
    const lines = [
      `🎉 ${bold(escapeHtml(username))} caught ${bold(escapeHtml(spawn.pokemon_name))}!`,
      `+${bold(xpReward)} XP, +${bold(coinsReward)} Coins`,
    ];
    if (missionCompleted) {
      grantRewards(chatId, userId, { xp: 50, coins: 100 });
      inventory.addItem(userId, 'mystery_box', 1);
      lines.push('', `✅ ${bold('Daily Mission complete!')} +50 XP, +100 Coins, 1 Mystery Box 🎁`);
    }
    if (levelUpMsg) lines.push('', levelUpMsg);

    const headline = headlineWithGender(spawn.rarity, spawn.pokemon_name, spawn.gender);
    const typeLine = bold(formatTypeLine(getPokedexEntry(spawn.pokemon_name).types));
    const finalText = [headline, '', typeLine, '', lines.join('\n')].join('\n');
    // Spawns with artwork are photo messages — Telegram requires editMessageCaption for
    // those, since editMessageText only works on plain text messages.
    if (ctx.callbackQuery.message?.photo) {
      await ctx.editMessageCaption(finalText, HTML);
    } else {
      await ctx.editMessageText(finalText, HTML);
    }

    const reactionEmoji = RARITY_REACTION[spawn.rarity];
    if (reactionEmoji) {
      await react(ctx.telegram, chatId, ctx.callbackQuery.message.message_id, reactionEmoji);
    }
  });
}

module.exports = {
  register,
  scheduleNextSpawn,
  stopSpawns,
  forceSpawn,
  forceSpawnNamed,
  doSpawn,
  postTeaser,
};
