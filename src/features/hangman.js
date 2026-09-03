const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { COMMON, RARE, LEGENDARY, MYTHICAL } = require('../data/pokemon');

const HANGMAN_TIMEOUT_MS = 60 * 1000;
const MAX_WRONG = 6;

const NAME_POOL = [...COMMON, ...RARE, ...LEGENDARY, ...MYTHICAL];

// chatId -> { answer, revealed: Set<letter>, wrong: Set<letter>, chatId, messageId, timer }
const activeGames = new Map();

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Non-letter characters (spaces in "Tapu Koko", hyphens in "Wo-Chien") are never guessable
// as a "letter" (the guess regex only accepts a-z), so they're always shown as themselves
// from the start instead of a permanently-unsolvable blank — matches how paper Hangman
// already handles multi-word answers.
function renderBlanks(answer, revealed) {
  return answer
    .toUpperCase()
    .split('')
    .map((ch) => (/[A-Z]/.test(ch) ? (revealed.has(ch) ? ch : '_') : ch))
    .join(' ');
}

function strikeCount(game) {
  return game.wrongLetters.size + game.wrongWords.size;
}

function renderHearts(wrongCount) {
  return '❤️'.repeat(MAX_WRONG - wrongCount) + '🖤'.repeat(wrongCount);
}

function renderBoard(game, extra) {
  const lines = [
    bold('🪢 Hangman'),
    '',
    renderBlanks(game.answer, game.revealed),
    renderHearts(strikeCount(game)),
  ];
  const wrongGuesses = [...game.wrongLetters, ...game.wrongWords];
  if (wrongGuesses.length > 0) {
    lines.push(`Wrong guesses: ${wrongGuesses.join(', ')}`);
  }
  lines.push('', 'Type a single letter to guess, or the full name to win instantly.', '📖 Rules: /games');
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

function isWordComplete(answer, revealed) {
  return answer
    .toUpperCase()
    .split('')
    .every((ch) => !/[A-Z]/.test(ch) || revealed.has(ch));
}

async function finishRound(ctx, game, resultLine) {
  clearTimeout(game.timer);
  activeGames.delete(game.chatId);
  const text = [
    bold('🪢 Hangman'),
    '',
    game.answer.toUpperCase().split('').join(' '),
    '',
    resultLine,
  ].join('\n');
  try {
    await ctx.telegram.editMessageText(game.chatId, game.messageId, undefined, text, HTML);
  } catch (err) {
    console.error('Failed to edit finished hangman board:', err.message);
  }
}

function scheduleTimeout(ctx, chatId) {
  const game = activeGames.get(chatId);
  if (!game) return;
  game.timer = setTimeout(() => {
    const g = activeGames.get(chatId);
    if (!g) return;
    finishRound(ctx, g, "⏰ Time's up! Nobody finished the word.");
  }, HANGMAN_TIMEOUT_MS);
}

function register(bot) {
  bot.command('hangman', async (ctx) => {
    const chatId = ctx.chat.id;
    if (activeGames.has(chatId)) {
      await ctx.reply('A Hangman round is already in progress in this group!');
      return;
    }

    const name = pickRandom(NAME_POOL);
    const game = {
      answer: name,
      revealed: new Set(),
      wrongLetters: new Set(),
      wrongWords: new Set(),
      chatId,
      messageId: null,
      timer: null,
    };
    activeGames.set(chatId, game);

    const sent = await ctx.reply(renderBoard(game), HTML);
    game.messageId = sent.message_id;
    scheduleTimeout(ctx, chatId);
  });

  bot.on('text', async (ctx, next) => {
    const chatId = ctx.chat.id;
    const game = activeGames.get(chatId);
    if (!game) return next ? next() : undefined;

    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    const isLetterGuess = /^[a-zA-Z]$/.test(text);
    const isFullWordGuess = text.toLowerCase() === game.answer.toLowerCase();
    // A single "word-like" token (no spaces) that isn't a letter and isn't the answer —
    // the natural way someone tries to guess the whole name. Deliberately excludes
    // anything with a space so ordinary group chat never gets treated as a wrong guess.
    const isWrongWordGuess = !isLetterGuess && !isFullWordGuess && /^[A-Za-z][A-Za-z'.-]{1,19}$/.test(text);

    if (!isLetterGuess && !isFullWordGuess && !isWrongWordGuess) {
      return next ? next() : undefined;
    }

    if (isFullWordGuess) {
      users.getOrCreateUser(chatId, userId, username);
      users.incrementCounter(chatId, userId, 'hangman_wins');
      const levelUpMsg = grantRewards(chatId, userId, { xp: XP.HANGMAN_WIN });
      const lines = [`🎉 ${bold(escapeHtml(username))} guessed the full word! +${bold(XP.HANGMAN_WIN)} XP`];
      if (levelUpMsg) lines.push(levelUpMsg);
      await finishRound(ctx, game, lines.join('\n'));
      return;
    }

    if (isWrongWordGuess) {
      const wordUpper = text.toUpperCase();
      if (game.wrongWords.has(wordUpper)) {
        return; // already tried this exact wrong guess, ignore quietly
      }
      game.wrongWords.add(wordUpper);
      if (strikeCount(game) >= MAX_WRONG) {
        await finishRound(ctx, game, `💀 Out of guesses! Nobody solved it.`);
        return;
      }
      clearTimeout(game.timer);
      scheduleTimeout(ctx, chatId);
      try {
        await ctx.telegram.editMessageText(chatId, game.messageId, undefined, renderBoard(game), HTML);
      } catch (err) {
        console.error('Failed to edit hangman board:', err.message);
      }
      return;
    }

    const letter = text.toUpperCase();
    if (game.revealed.has(letter) || game.wrongLetters.has(letter)) {
      return; // already guessed, ignore quietly — consumed, not passed through
    }

    if (game.answer.toUpperCase().includes(letter)) {
      game.revealed.add(letter);
      if (isWordComplete(game.answer, game.revealed)) {
        users.getOrCreateUser(chatId, userId, username);
        users.incrementCounter(chatId, userId, 'hangman_wins');
        const levelUpMsg = grantRewards(chatId, userId, { xp: XP.HANGMAN_WIN });
        const lines = [`🎉 ${bold(escapeHtml(username))} completed the word! +${bold(XP.HANGMAN_WIN)} XP`];
        if (levelUpMsg) lines.push(levelUpMsg);
        await finishRound(ctx, game, lines.join('\n'));
        return;
      }
      clearTimeout(game.timer);
      scheduleTimeout(ctx, chatId);
      try {
        await ctx.telegram.editMessageText(chatId, game.messageId, undefined, renderBoard(game), HTML);
      } catch (err) {
        console.error('Failed to edit hangman board:', err.message);
      }
      return;
    }

    game.wrongLetters.add(letter);
    if (strikeCount(game) >= MAX_WRONG) {
      await finishRound(ctx, game, `💀 Out of guesses! Nobody solved it.`);
      return;
    }
    clearTimeout(game.timer);
    scheduleTimeout(ctx, chatId);
    try {
      await ctx.telegram.editMessageText(chatId, game.messageId, undefined, renderBoard(game), HTML);
    } catch (err) {
      console.error('Failed to edit hangman board:', err.message);
    }
  });
}

module.exports = { register };
