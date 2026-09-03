const { Jimp } = require('jimp');
const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { COMMON, RARE, LEGENDARY, MYTHICAL, getPokedexEntry, getArtworkUrl } = require('../data/pokemon');
const { isCloseMatch } = require('../utils/fuzzyMatch');

const GUESS_TIMEOUT_MS = 30 * 1000;
const activeRounds = new Map(); // chatId -> { answer, timer, imageUrl }

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
  img.scan(0, 0, img.width, img.height, function silhouette(x, y, idx) {
    if (this.bitmap.data[idx + 3] > 0) {
      this.bitmap.data[idx] = 12;
      this.bitmap.data[idx + 1] = 12;
      this.bitmap.data[idx + 2] = 12;
    }
  });
  return img.getBuffer('image/png');
}

function register(bot) {
  bot.command('whosthat', async (ctx) => {
    const chatId = ctx.chat.id;
    if (activeRounds.has(chatId)) {
      ctx.reply('A "Who\'s That Pokémon?" round is already in progress in this group!');
      return;
    }

    const name = pickRandom(NAME_POOL);
    const entry = getPokedexEntry(name);
    const imageUrl = getArtworkUrl(entry.dexNumber);
    if (!imageUrl) {
      ctx.reply("Couldn't find artwork for that Pokémon — try again.");
      return;
    }

    let silhouetteBuffer;
    try {
      silhouetteBuffer = await buildSilhouette(imageUrl);
    } catch (err) {
      console.error('Failed to build silhouette:', err.message);
      ctx.reply("Couldn't prepare the silhouette this time — try again in a moment.");
      return;
    }

    const timer = setTimeout(async () => {
      if (activeRounds.get(chatId)?.answer !== name) return;
      activeRounds.delete(chatId);
      try {
        await ctx.replyWithPhoto(imageUrl, {
          caption: `⏰ Time's up! It was ${bold(escapeHtml(name))}!`,
          parse_mode: 'HTML',
        });
      } catch (err) {
        console.error('Failed to reveal whosthat answer:', err.message);
      }
    }, GUESS_TIMEOUT_MS);

    activeRounds.set(chatId, { answer: name, timer, imageUrl });

    await ctx.replyWithPhoto(
      { source: silhouetteBuffer },
      {
        caption: [bold("❓ Who's that Pokémon?"), '', 'First correct reply in the chat wins XP!', '📖 Rules: /games'].join('\n'),
        parse_mode: 'HTML',
      }
    );
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
      const caption = [`${reaction} It's ${bold(escapeHtml(active.answer))}! +${bold(XP.WHOSTHAT_WIN)} XP`];
      if (levelUpMsg) caption.push(levelUpMsg);

      ctx
        .replyWithPhoto(active.imageUrl, { caption: caption.join('\n'), parse_mode: 'HTML' })
        .catch((err) => console.error('Failed to reveal whosthat winner photo:', err.message));
      return;
    }
    return next ? next() : undefined;
  });
}

module.exports = { register };
