const users = require('../db/users');
const { pickQuestion, isCorrect } = require('../data/quiz');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { getPokedexEntry, getArtworkUrl } = require('../data/pokemon');

const QUIZ_TIMEOUT_MS = 30 * 1000;
const activeQuizzes = new Map(); // chatId -> { question, timer }

const INTRO_LINES = [
  '❓ Poké Quiz Time!',
  '🧠 Trainer IQ Test incoming!',
  '🎓 Professor Oak wants to know something...',
  '🔬 Pop quiz, trainers!',
  '🧩 Brain gym is open. Get in here.',
  '📖 Dust off your Pokédex knowledge!',
];

const CTA_LINES = [
  '⚡ First correct answer wins XP!',
  '🏃 Fastest fingers win this one!',
  '🎯 Type the answer — first one right takes the prize!',
  '💨 Quick, before someone else beats you to it!',
];

const CORRECT_REACTIONS = [
  (name) => `✅ Correct, ${name}! Big brain energy. 🧠`,
  (name) => `🎉 Nailed it, ${name}!`,
  (name) => `🔥 ${name} knew that instantly. Show-off.`,
  (name) => `🏆 Correct! ${name} flexes their Pokédex knowledge.`,
  (name) => `✨ ${name} said it with their whole chest — and got it right!`,
  (name) => `🧠 Correct, ${name}! Professor Oak is proud.`,
];

const TIMEOUT_LINES = [
  "⏰ Time's up! Crickets... 🦗 Nobody knew it.",
  '⌛ And it\'s gone. Silence in the chat. The answer was:',
  "😴 Everyone's asleep on this one apparently. The answer was:",
  '🚨 Nobody buzzed in! Here\'s the answer:',
  '💀 Tumbleweeds. The correct answer was:',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function difficultyForLevel(level) {
  if (level >= 20) return 3;
  if (level >= 8) return 2;
  return 1;
}

function register(bot) {
  bot.command('quiz', (ctx) => {
    const chatId = ctx.chat.id;
    if (activeQuizzes.has(chatId)) {
      ctx.reply('A quiz is already in progress in this group!');
      return;
    }

    const asker = users.getOrCreateUser(chatId, ctx.from.id, ctx.from.username || ctx.from.first_name);
    const question = pickQuestion(difficultyForLevel(asker.level));

    const timer = setTimeout(() => {
      if (activeQuizzes.get(chatId)?.question === question) {
        activeQuizzes.delete(chatId);
        ctx.reply(`${pickRandom(TIMEOUT_LINES)}\n${bold(escapeHtml(question.answers[0]))}`, HTML);
      }
    }, QUIZ_TIMEOUT_MS);

    activeQuizzes.set(chatId, { question, timer });
    const caption = [bold(pickRandom(INTRO_LINES)), '', question.question, '', pickRandom(CTA_LINES)].join('\n');

    if (question.guessName) {
      const imageUrl = getArtworkUrl(getPokedexEntry(question.guessName).dexNumber);
      if (imageUrl) {
        ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'HTML' });
        return;
      }
    }
    ctx.reply(caption, HTML);
  });

  bot.on('text', (ctx, next) => {
    const chatId = ctx.chat.id;
    const active = activeQuizzes.get(chatId);
    if (!active) return next ? next() : undefined;

    if (isCorrect(active.question, ctx.message.text)) {
      clearTimeout(active.timer);
      activeQuizzes.delete(chatId);

      const userId = ctx.from.id;
      const username = ctx.from.username || ctx.from.first_name;
      users.getOrCreateUser(chatId, userId, username);
      users.incrementCounter(chatId, userId, 'quiz_wins');
      const levelUpMsg = grantRewards(chatId, userId, { xp: XP.QUIZ_WIN });

      const reaction = pickRandom(CORRECT_REACTIONS)(bold(escapeHtml(username)));
      const lines = [`${reaction} +${bold(XP.QUIZ_WIN)} XP`];
      if (levelUpMsg) lines.push(levelUpMsg);
      ctx.reply(lines.join('\n'), HTML);
      return;
    }
    return next ? next() : undefined;
  });
}

module.exports = { register };
