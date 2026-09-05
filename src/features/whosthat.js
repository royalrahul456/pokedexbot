const { Jimp } = require('jimp');
const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { COMMON, RARE, LEGENDARY, MYTHICAL, getPokedexEntry, getArtworkUrl, formatDexId } = require('../data/pokemon');
const { isCloseMatch } = require('../utils/fuzzyMatch');

const GUESS_TIMEOUT_MS = 30 * 1000;
const activeRounds = new Map(); // chatId -> { answer, timer, imageUrl, dexStr }
const autoModes = new Set(); // chatId set for auto-loop mode (/whosthatstart)

const NAME_POOL = [...COMMON, ...RARE, ...LEGENDARY, ...MYTHICAL];

const CORRECT_REACTIONS = [
  (name) => `✅ Correct, ${name}! Great eye.`,
  (name) => `🎉 That's right, ${name}!`,
  (name) => `🔥 ${name} spotted it instantly.`,
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function buildSilhouette(imageUrl) {
  const img = await Jimp.read(imageUrl);
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  img.scan(0, 0, width, height, function silhouette(x, y, idx) {
    if (this.bitmap.data[idx + 3] > 0) {
      this.bitmap.data[idx] = 12;
      this.bitmap.data[idx + 1] = 12;
      this.bitmap.data[idx + 2] = 12;
    }
  });
  return await img.getBuffer('image/png');
}

async function startRound(bot, chatId) {
  if (activeRounds.has(chatId)) return false;

  const name = pickRandom(NAME_POOL);
  const entry = getPokedexEntry(name);
  const dexStr = formatDexId(entry.dexNumber);
  const imageUrl = getArtworkUrl(entry.dexNumber);
  if (!imageUrl) return false;

  let silhouetteBuffer;
  try {
    silhouetteBuffer = await buildSilhouette(imageUrl);
  } catch (err) {
    console.error('Failed to build silhouette:', err.message);
    return false;
  }

  const timer = setTimeout(async () => {
    if (activeRounds.get(chatId)?.answer !== name) return;
    activeRounds.delete(chatId);
    const dexNameStr = dexStr ? `${dexStr} ${name}` : name;
    try {
      await bot.telegram.sendPhoto(chatId, imageUrl, {
        caption: `<blockquote>\n⏰ Time's up! It was ${bold(escapeHtml(dexNameStr))}!\n</blockquote>`,
        parse_mode: 'HTML',
      });
    } catch (err) {
      console.error('Failed to reveal whosthat answer:', err.message);
    }
    if (autoModes.has(chatId)) {
      setTimeout(() => startRound(bot, chatId), 3000);
    }
  }, GUESS_TIMEOUT_MS);

  activeRounds.set(chatId, { answer: name, timer, imageUrl, dexStr });

  try {
    await bot.telegram.sendPhoto(
      chatId,
      { source: silhouetteBuffer },
      {
        caption: [
          '<blockquote>',
          bold("❓ Who's that Pokémon?"),
          '',
          'First correct reply in the chat wins XP!',
          '📖 Rules: /games',
          '</blockquote>',
        ].join('\n'),
        parse_mode: 'HTML',
      }
    );
    return true;
  } catch (err) {
    console.error('Failed to send whosthat silhouette photo:', err.message);
    clearTimeout(timer);
    activeRounds.delete(chatId);
    return false;
  }
}

function register(bot) {
  bot.command(['whosthat', 'wtp'], async (ctx) => {
    const chatId = ctx.chat.id;
    if (activeRounds.has(chatId)) {
      ctx.reply('<blockquote>A "Who\'s That Pokémon?" round is already in progress in this group!</blockquote>', HTML);
      return;
    }
    const started = await startRound(bot, chatId);
    if (!started) {
      ctx.reply("<blockquote>Couldn't prepare the silhouette this time — try again in a moment.</blockquote>", HTML);
    }
  });

  bot.command('whosthatstart', async (ctx) => {
    const chatId = ctx.chat.id;
    autoModes.add(chatId);
    ctx.reply('<blockquote>🤖 Auto-mode enabled! "Who\'s That Pokémon?" rounds will run continuously. Send /stopwhoisthat to end it.</blockquote>', HTML);
    if (!activeRounds.has(chatId)) {
      await startRound(bot, chatId);
    }
  });

  bot.command('stopwhoisthat', async (ctx) => {
    const chatId = ctx.chat.id;
    autoModes.delete(chatId);
    ctx.reply('<blockquote>🛑 Auto-mode stopped.</blockquote>', HTML);
  });

  bot.on('text', (ctx, next) => {
    const chatId = ctx.chat.id;
    const active = activeRounds.get(chatId);
    if (!active) return next ? next() : undefined;

    if (isCloseMatch(ctx.message.text, active.answer, NAME_POOL)) {
      clearTimeout(active.timer);
      activeRounds.delete(chatId);

      const userId = ctx.from.id;
      const username = ctx.from.username || ctx.from.first_name;
      users.getOrCreateUser(chatId, userId, username);
      users.incrementCounter(chatId, userId, 'whosthat_wins');
      const levelUpMsg = grantRewards(chatId, userId, { xp: XP.WHOSTHAT_WIN });

      const reaction = pickRandom(CORRECT_REACTIONS)(bold(escapeHtml(username)));
      const dexNameStr = active.dexStr ? `${active.dexStr} ${active.answer}` : active.answer;
      const captionLines = [`${reaction} It's ${bold(escapeHtml(dexNameStr))}! +${bold(XP.WHOSTHAT_WIN)} XP`];
      if (levelUpMsg) captionLines.push('', levelUpMsg);

      const caption = `<blockquote>\n${captionLines.join('\n')}\n</blockquote>`;

      ctx.telegram
        .sendPhoto(chatId, active.imageUrl, { caption, parse_mode: 'HTML' })
        .catch((err) => console.error('Failed to reveal whosthat winner photo:', err.message));

      if (autoModes.has(chatId)) {
        setTimeout(() => startRound(bot, chatId), 3000);
      }
      return;
    }
    return next ? next() : undefined;
  });
}

module.exports = { register };
