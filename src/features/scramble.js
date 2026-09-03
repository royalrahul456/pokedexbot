const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { COMMON, RARE, LEGENDARY, MYTHICAL, getPokedexEntry, formatTypeLine } = require('../data/pokemon');

const SCRAMBLE_TIMEOUT_MS = 30 * 1000;
const activeScrambles = new Map(); // chatId -> { answer, timer }

const NAME_POOL = [...COMMON, ...RARE, ...LEGENDARY, ...MYTHICAL];

const INTRO_LINES = [
  '🔤 Scramble Time!',
  '🧩 Can you unscramble this Pokémon?',
  '🌀 Someone shuffled the letters — put them back!',
  '📝 Trainer word puzzle incoming!',
];

const CTA_LINES = [
  '⚡ First correct answer wins XP!',
  '🏃 Fastest fingers win this one!',
  '💨 Quick, before someone else beats you to it!',
];

const CORRECT_REACTIONS = [
  (name) => `✅ Correct, ${name}! Nice unscrambling.`,
  (name) => `🎉 Nailed it, ${name}!`,
  (name) => `🔥 ${name} solved it in record time.`,
];

const TIMEOUT_LINES = [
  "⏰ Time's up! Nobody unscrambled it.",
  '⌛ And it\'s gone. The answer was:',
  '🚨 Nobody buzzed in! Here\'s the answer:',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function scrambleWord(word) {
  // Strip spaces AND hyphens before scrambling (e.g. "Tapu Koko", "Wo-Chien") — otherwise
  // the hyphen ends up jumbled to a random position among the letters, which is just noisy
  // rather than a real puzzle element.
  const letters = word.replace(/[\s-]+/g, '').split('');
  let attempt = letters.join('');
  let guard = 0;
  while ((attempt === letters.join('') || attempt.toLowerCase() === word.toLowerCase()) && guard < 20) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    attempt = letters.join('');
    guard++;
  }
  return attempt.toUpperCase().split('').join(' ');
}

function register(bot) {
  bot.command('scramble', (ctx) => {
    const chatId = ctx.chat.id;
    if (activeScrambles.has(chatId)) {
      ctx.reply('A scramble is already in progress in this group!');
      return;
    }

    const name = pickRandom(NAME_POOL);
    const entry = getPokedexEntry(name);
    const scrambled = scrambleWord(name);

    const timer = setTimeout(() => {
      if (activeScrambles.get(chatId)?.answer === name) {
        activeScrambles.delete(chatId);
        ctx.reply(`${pickRandom(TIMEOUT_LINES)}\n${bold(escapeHtml(name))}`, HTML);
      }
    }, SCRAMBLE_TIMEOUT_MS);

    activeScrambles.set(chatId, { answer: name, timer });

    const caption = [
      bold(pickRandom(INTRO_LINES)),
      '',
      `🔤 ${bold(scrambled)}`,
      `Hint: ${formatTypeLine(entry.types)}`,
      '',
      pickRandom(CTA_LINES),
      '📖 Rules: /games',
    ].join('\n');

    ctx.reply(caption, HTML);
  });

  bot.on('text', (ctx, next) => {
    const chatId = ctx.chat.id;
    const active = activeScrambles.get(chatId);
    if (!active) return next ? next() : undefined;

    if (ctx.message.text.trim().toLowerCase() === active.answer.toLowerCase()) {
      clearTimeout(active.timer);
      activeScrambles.delete(chatId);

      const userId = ctx.from.id;
      const username = ctx.from.username || ctx.from.first_name;
      users.getOrCreateUser(chatId, userId, username);
      users.incrementCounter(chatId, userId, 'scramble_wins');
      const levelUpMsg = grantRewards(chatId, userId, { xp: XP.SCRAMBLE_WIN });

      const reaction = pickRandom(CORRECT_REACTIONS)(bold(escapeHtml(username)));
      const lines = [`${reaction} +${bold(XP.SCRAMBLE_WIN)} XP`];
      if (levelUpMsg) lines.push(levelUpMsg);
      ctx.reply(lines.join('\n'), HTML);
      return;
    }
    return next ? next() : undefined;
  });
}

module.exports = { register };
