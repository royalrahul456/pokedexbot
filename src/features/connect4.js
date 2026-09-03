const { Markup } = require('telegraf');
const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatRules } = require('../data/gameRules');

const BET_COINS = 40;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MOVE_TTL_MS = 10 * 60 * 1000;
const BOT_ID = 'BOT';

const COLS = 7;
const ROWS = 6;

const pendingChallenges = new Map(); // challengeId -> {...}
const activeGames = new Map(); // gameId -> {...}
let nextId = 1;

function idx(row, col) {
  return row * COLS + col;
}

// Drops a piece into the lowest empty row of `col`. Returns the row used, or -1 if full.
function dropPiece(board, col, symbol) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (!board[idx(row, col)]) {
      board[idx(row, col)] = symbol;
      return row;
    }
  }
  return -1;
}

function columnFull(board, col) {
  return Boolean(board[idx(0, col)]);
}

const DIRECTIONS = [
  [0, 1], // →
  [1, 0], // ↓
  [1, 1], // ↘
  [1, -1], // ↙
];

// Full-board scan for 4-in-a-row in any of the 4 directions — cheap at 42 cells, no need
// for Tic-Tac-Toe's fixed-line-list trick since this grid is bigger.
function checkWinner(board) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const symbol = board[idx(row, col)];
      if (!symbol) continue;
      for (const [dr, dc] of DIRECTIONS) {
        let count = 1;
        let r = row + dr;
        let c = col + dc;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[idx(r, c)] === symbol) {
          count++;
          r += dr;
          c += dc;
        }
        if (count >= 4) return symbol;
      }
    }
  }
  if (board.every((cell) => cell)) return 'draw';
  return null;
}

function displayName(user) {
  return escapeHtml(user.username || user.first_name || 'Trainer');
}

function renderBoard(board) {
  const rows = [];
  for (let row = 0; row < ROWS; row++) {
    let line = '';
    for (let col = 0; col < COLS; col++) {
      const cell = board[idx(row, col)];
      line += cell === 'X' ? '🔴' : cell === 'O' ? '🟡' : '⚪';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

const COLUMN_LABELS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

function columnKeyboard(gameId, board) {
  const row = [];
  for (let col = 0; col < COLS; col++) {
    row.push(Markup.button.callback(COLUMN_LABELS[col], `c4:${gameId}:mv:${col}`));
  }
  return Markup.inlineKeyboard([row]);
}

function challengeKeyboard(challengeId, isTargeted) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(isTargeted ? '⚔️ Accept' : '⚔️ Accept Challenge', `c4:${challengeId}:accept`)],
    [Markup.button.callback('🤖 Play vs Bot', `c4:${challengeId}:bot`)],
    [
      Markup.button.callback('📖 Rules', `c4:${challengeId}:rules`),
      Markup.button.callback('❌ Cancel', `c4:${challengeId}:cancel`),
    ],
  ]);
}

function boardCaption(names, board, turnSymbol, bet, extra) {
  const lines = [
    bold('🔴🟡 Connect 4'),
    '',
    `${bold('🔴')} ${names.X}  vs  ${bold('🟡')} ${names.O}`,
    bet ? `💰 Bet: ${bold(bet)} coins` : '🎮 Friendly match',
    '',
    renderBoard(board),
    '',
    `Turn: ${turnSymbol === 'X' ? names.X : names.O} (${turnSymbol === 'X' ? '🔴' : '🟡'})`,
  ];
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

function boardCaptionFinal(game) {
  return [
    bold('🔴🟡 Connect 4'),
    '',
    `${bold('🔴')} ${game.names.X}  vs  ${bold('🟡')} ${game.names.O}`,
    '',
    renderBoard(game.board),
  ].join('\n');
}

async function settleBet(chatId, winnerId, bet) {
  if (!bet) return;
  if (winnerId !== BOT_ID) users.addCoins(chatId, winnerId, bet * 2);
}

async function refundBet(chatId, game) {
  if (!game.bet) return;
  if (game.players.X !== BOT_ID) users.addCoins(chatId, game.players.X, game.bet);
  if (game.players.O !== BOT_ID) users.addCoins(chatId, game.players.O, game.bet);
}

// Same heuristic tier as Tic-Tac-Toe's bot: win-if-possible, else block, else prefer
// center, else random valid column.
function botMove(board) {
  const validCols = [];
  for (let col = 0; col < COLS; col++) {
    if (!columnFull(board, col)) validCols.push(col);
  }

  const tryFind = (symbol) => {
    for (const col of validCols) {
      const copy = [...board];
      dropPiece(copy, col, symbol);
      if (checkWinner(copy) === symbol) return col;
    }
    return null;
  };

  let move = tryFind('O');
  if (move === null) move = tryFind('X');
  if (move === null) {
    const center = 3;
    if (validCols.includes(center)) move = center;
  }
  if (move === null) move = validCols[Math.floor(Math.random() * validCols.length)];
  return move;
}

async function finishGame(ctx, gameId, game, winnerSymbol) {
  clearTimeout(game.timeoutHandle);
  activeGames.delete(gameId);

  let resultLine;
  if (winnerSymbol === 'draw') {
    resultLine = "🤝 It's a draw!";
    await refundBet(game.chatId, game);
  } else {
    const winnerId = game.players[winnerSymbol];
    const winnerName = game.names[winnerSymbol];
    resultLine = `🏆 ${bold(winnerName)} wins!`;

    if (winnerId !== BOT_ID) {
      users.incrementCounter(game.chatId, winnerId, 'connect4_wins');
      const levelUpMsg = grantRewards(game.chatId, winnerId, { xp: XP.CONNECT4_WIN });
      resultLine += ` +${XP.CONNECT4_WIN} XP`;
      if (game.bet) {
        await settleBet(game.chatId, winnerId, game.bet);
        resultLine += ` +${game.bet * 2} coins`;
      }
      if (levelUpMsg) resultLine += `\n${levelUpMsg}`;
    } else {
      resultLine += ' 🤖 (better luck next time!)';
    }
  }

  const text = [boardCaptionFinal(game), '', resultLine].join('\n');
  try {
    await ctx.telegram.editMessageText(game.chatId, game.messageId, undefined, text, HTML);
  } catch (err) {
    console.error('Failed to edit finished connect4 board:', err.message);
  }
}

async function startGame(ctx, challenge, opponentId, opponentName, vsBot) {
  const gameId = nextId++;
  const board = Array(COLS * ROWS).fill(null);
  const players = { X: challenge.challengerId, O: vsBot ? BOT_ID : opponentId };
  const names = { X: challenge.challengerName, O: vsBot ? '🤖 Bot' : opponentName };

  if (challenge.bet && !vsBot) {
    const challengerOk = users.deductCoins(challenge.chatId, challenge.challengerId, challenge.bet);
    if (!challengerOk) {
      await ctx.answerCbQuery("You don't have enough coins for this bet anymore.", { show_alert: true });
      return false;
    }
    const opponentOk = users.deductCoins(challenge.chatId, opponentId, challenge.bet);
    if (!opponentOk) {
      users.addCoins(challenge.chatId, challenge.challengerId, challenge.bet);
      await ctx.answerCbQuery("You don't have enough coins to accept this bet.", { show_alert: true });
      return false;
    }
  }

  const game = {
    chatId: challenge.chatId,
    messageId: challenge.messageId,
    board,
    players,
    names,
    turn: 'X',
    bet: vsBot ? 0 : challenge.bet,
    timeoutHandle: null,
  };
  activeGames.set(gameId, game);
  scheduleIdleTimeout(ctx, gameId);

  const text = boardCaption(names, board, 'X', game.bet);
  await ctx.editMessageText(text, { ...HTML, ...columnKeyboard(gameId, board) });
  return true;
}

function scheduleIdleTimeout(ctx, gameId) {
  const game = activeGames.get(gameId);
  if (!game) return;
  game.timeoutHandle = setTimeout(async () => {
    const g = activeGames.get(gameId);
    if (!g) return;
    activeGames.delete(gameId);
    await refundBet(g.chatId, g);
    try {
      await ctx.telegram.editMessageText(
        g.chatId,
        g.messageId,
        undefined,
        [boardCaptionFinal(g), '', '⌛ Game expired from inactivity.' + (g.bet ? ' Bet refunded.' : '')].join('\n'),
        HTML
      );
    } catch (err) {
      console.error('Failed to edit expired connect4 game:', err.message);
    }
  }, MOVE_TTL_MS);
}

function register(bot) {
  const startHandler = async (ctx) => {
    const chatId = ctx.chat.id;
    const challenger = ctx.from;
    users.getOrCreateUser(chatId, challenger.id, challenger.username || challenger.first_name);

    const args = ctx.message.text.split(' ').slice(1);
    const bet = args.some((a) => a.toLowerCase() === 'bet') ? BET_COINS : 0;

    const repliedUser = ctx.message.reply_to_message?.from;
    const targetId = repliedUser && !repliedUser.is_bot ? repliedUser.id : null;
    const targetName = repliedUser ? escapeHtml(repliedUser.username || repliedUser.first_name) : null;

    if (targetId === challenger.id) {
      await ctx.reply("You can't challenge yourself — use the 🤖 Play vs Bot option instead.");
      return;
    }

    if (bet) {
      const profile = users.getProfile(chatId, challenger.id);
      if (!profile || profile.coins < bet) {
        await ctx.reply(`🪙 You need at least ${bet} coins to start a bet match.`);
        return;
      }
    }

    const challengeId = nextId++;
    const challengerName = escapeHtml(challenger.username || challenger.first_name);

    const challenge = {
      chatId,
      challengerId: challenger.id,
      challengerName,
      targetId,
      targetName,
      bet,
      messageId: null,
      timeoutHandle: null,
    };
    pendingChallenges.set(challengeId, challenge);

    const lines = [
      bold('🔴🟡 Connect 4 Challenge!'),
      '',
      targetId
        ? `${bold(challengerName)} is challenging ${bold(targetName)}!`
        : `${bold(challengerName)} wants to play — who's in?`,
      bet ? `💰 Bet: ${bold(bet)} coins` : '🎮 Friendly match (no bet)',
    ];

    const sent = await ctx.reply(lines.join('\n'), {
      ...HTML,
      ...challengeKeyboard(challengeId, Boolean(targetId)),
    });
    challenge.messageId = sent.message_id;

    challenge.timeoutHandle = setTimeout(async () => {
      if (!pendingChallenges.has(challengeId)) return;
      pendingChallenges.delete(challengeId);
      try {
        await ctx.telegram.editMessageText(chatId, sent.message_id, undefined, '⌛ Challenge expired — nobody accepted in time.', HTML);
      } catch (err) {
        console.error('Failed to edit expired connect4 challenge:', err.message);
      }
    }, CHALLENGE_TTL_MS);
  };

  bot.command('connect4', startHandler);
  bot.command('c4', startHandler);

  bot.action(/^c4:(\d+):accept$/, async (ctx) => {
    const challengeId = Number(ctx.match[1]);
    const challenge = pendingChallenges.get(challengeId);
    if (!challenge) {
      await ctx.answerCbQuery('This challenge is no longer available.', { show_alert: true });
      return;
    }
    if (challenge.targetId && ctx.from.id !== challenge.targetId) {
      await ctx.answerCbQuery("This challenge isn't for you.", { show_alert: true });
      return;
    }
    if (ctx.from.id === challenge.challengerId) {
      await ctx.answerCbQuery("You can't accept your own challenge.", { show_alert: true });
      return;
    }
    users.getOrCreateUser(challenge.chatId, ctx.from.id, ctx.from.username || ctx.from.first_name);
    await ctx.answerCbQuery('Match starting!');
    const opponentName = escapeHtml(ctx.from.username || ctx.from.first_name);
    const started = await startGame(ctx, challenge, ctx.from.id, opponentName, false);
    if (started) {
      clearTimeout(challenge.timeoutHandle);
      pendingChallenges.delete(challengeId);
    }
  });

  bot.action(/^c4:(\d+):bot$/, async (ctx) => {
    const challengeId = Number(ctx.match[1]);
    const challenge = pendingChallenges.get(challengeId);
    if (!challenge) {
      await ctx.answerCbQuery('This challenge is no longer available.', { show_alert: true });
      return;
    }
    if (ctx.from.id !== challenge.challengerId) {
      await ctx.answerCbQuery('Only the challenger can start the bot match.', { show_alert: true });
      return;
    }
    clearTimeout(challenge.timeoutHandle);
    pendingChallenges.delete(challengeId);
    await ctx.answerCbQuery('Match starting!');
    await startGame(ctx, challenge, BOT_ID, '🤖 Bot', true);
  });

  bot.action(/^c4:(\d+):rules$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(formatRules('connect4'), HTML);
  });

  bot.action(/^c4:(\d+):cancel$/, async (ctx) => {
    const challengeId = Number(ctx.match[1]);
    const challenge = pendingChallenges.get(challengeId);
    if (!challenge) {
      await ctx.answerCbQuery('Already gone.');
      return;
    }
    if (ctx.from.id !== challenge.challengerId) {
      await ctx.answerCbQuery('Only the challenger can cancel this.', { show_alert: true });
      return;
    }
    clearTimeout(challenge.timeoutHandle);
    pendingChallenges.delete(challengeId);
    await ctx.answerCbQuery('Challenge cancelled.');
    await ctx.editMessageText('❌ Challenge cancelled.');
  });

  bot.action(/^c4:(\d+):mv:(\d)$/, async (ctx) => {
    const gameId = Number(ctx.match[1]);
    const col = Number(ctx.match[2]);
    const game = activeGames.get(gameId);
    if (!game) {
      await ctx.answerCbQuery('This game has ended.', { show_alert: true });
      return;
    }
    const turnUserId = game.players[game.turn];
    if (ctx.from.id !== turnUserId) {
      await ctx.answerCbQuery("It's not your turn.", { show_alert: true });
      return;
    }
    if (columnFull(game.board, col)) {
      await ctx.answerCbQuery('That column is full — pick another.');
      return;
    }

    dropPiece(game.board, col, game.turn);
    await ctx.answerCbQuery();

    const winner = checkWinner(game.board);
    if (winner) {
      await finishGame(ctx, gameId, game, winner);
      return;
    }

    game.turn = game.turn === 'X' ? 'O' : 'X';
    clearTimeout(game.timeoutHandle);
    scheduleIdleTimeout(ctx, gameId);

    const isBotTurn = game.players[game.turn] === BOT_ID;
    if (isBotTurn) {
      const botCol = botMove(game.board);
      dropPiece(game.board, botCol, game.turn);
      const botWinner = checkWinner(game.board);
      if (botWinner) {
        await finishGame(ctx, gameId, game, botWinner);
        return;
      }
      game.turn = game.turn === 'X' ? 'O' : 'X';
      clearTimeout(game.timeoutHandle);
      scheduleIdleTimeout(ctx, gameId);
    }

    const text = boardCaption(game.names, game.board, game.turn, game.bet);
    try {
      await ctx.editMessageText(text, { ...HTML, ...columnKeyboard(gameId, game.board) });
    } catch (err) {
      console.error('Failed to edit connect4 board:', err.message);
    }
  });
}

module.exports = { register };
