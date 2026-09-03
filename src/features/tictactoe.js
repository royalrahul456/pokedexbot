const { Markup } = require('telegraf');
const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatRules } = require('../data/gameRules');

const BET_COINS = 50;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MOVE_TTL_MS = 10 * 60 * 1000;
const BOT_ID = 'BOT';

const pendingChallenges = new Map(); // challengeId -> {...}
const activeGames = new Map(); // gameId -> {...}
let nextId = 1;

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function displayName(user) {
  return escapeHtml(user.username || user.first_name || 'Trainer');
}

function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every((cell) => cell)) return 'draw';
  return null;
}

function boardKeyboard(gameId, board) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const label = board[i] === 'X' ? '❌' : board[i] === 'O' ? '⭕' : '⬜';
      row.push(Markup.button.callback(label, `ttt:${gameId}:mv:${i}`));
    }
    rows.push(row);
  }
  return Markup.inlineKeyboard(rows);
}

function challengeKeyboard(challengeId, isTargeted) {
  const rows = [
    [Markup.button.callback(isTargeted ? '⚔️ Accept' : '⚔️ Accept Challenge', `ttt:${challengeId}:accept`)],
    [Markup.button.callback('🤖 Play vs Bot', `ttt:${challengeId}:bot`)],
    [
      Markup.button.callback('📖 Rules', `ttt:${challengeId}:rules`),
      Markup.button.callback('❌ Cancel', `ttt:${challengeId}:cancel`),
    ],
  ];
  return Markup.inlineKeyboard(rows);
}

function boardCaption(names, turnSymbol, bet, extra) {
  const lines = [
    bold('❌⭕ Tic-Tac-Toe'),
    '',
    `${bold('❌')} ${names.X}  vs  ${bold('⭕')} ${names.O}`,
    bet ? `💰 Bet: ${bold(bet)} coins` : '🎮 Friendly match',
    '',
    `Turn: ${turnSymbol === 'X' ? names.X : names.O} (${turnSymbol === 'X' ? '❌' : '⭕'})`,
  ];
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

async function settleBet(chatId, winnerId, loserId, bet) {
  if (!bet) return;
  if (winnerId !== BOT_ID) users.addCoins(chatId, winnerId, bet * 2);
}

async function refundBet(chatId, game) {
  if (!game.bet) return;
  if (game.players.X !== BOT_ID) users.addCoins(chatId, game.players.X, game.bet);
  if (game.players.O !== BOT_ID) users.addCoins(chatId, game.players.O, game.bet);
}

function botMove(board) {
  const empty = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
  const tryFind = (symbol) => {
    for (const i of empty) {
      const copy = [...board];
      copy[i] = symbol;
      if (checkWinner(copy) === symbol) return i;
    }
    return null;
  };
  let move = tryFind('O');
  if (move === null) move = tryFind('X');
  if (move === null && board[4] === null) move = 4;
  if (move === null) {
    const corners = [0, 2, 6, 8].filter((i) => empty.includes(i));
    if (corners.length) move = corners[Math.floor(Math.random() * corners.length)];
  }
  if (move === null) move = empty[Math.floor(Math.random() * empty.length)];
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
    const loserSymbol = winnerSymbol === 'X' ? 'O' : 'X';
    const loserId = game.players[loserSymbol];
    const winnerName = game.names[winnerSymbol];
    resultLine = `🏆 ${bold(winnerName)} wins!`;

    if (winnerId !== BOT_ID) {
      users.incrementCounter(game.chatId, winnerId, 'ttt_wins');
      const levelUpMsg = grantRewards(game.chatId, winnerId, { xp: XP.TTT_WIN });
      resultLine += ` +${XP.TTT_WIN} XP`;
      if (game.bet) {
        await settleBet(game.chatId, winnerId, loserId, game.bet);
        resultLine += ` +${game.bet * 2} coins`;
      }
      if (levelUpMsg) resultLine += `\n${levelUpMsg}`;
    } else {
      resultLine += ' 🤖 (better luck next time!)';
    }
  }

  const text = [boardCaptionFinal(game, winnerSymbol), '', resultLine].join('\n');
  try {
    await ctx.telegram.editMessageText(game.chatId, game.messageId, undefined, text, HTML);
  } catch (err) {
    console.error('Failed to edit finished ttt board:', err.message);
  }
}

function boardCaptionFinal(game, winnerSymbol) {
  const lines = [bold('❌⭕ Tic-Tac-Toe'), '', `${bold('❌')} ${game.names.X}  vs  ${bold('⭕')} ${game.names.O}`];
  const rows = [];
  for (let r = 0; r < 3; r++) {
    rows.push(
      [0, 1, 2]
        .map((c) => {
          const cell = game.board[r * 3 + c];
          return cell === 'X' ? '❌' : cell === 'O' ? '⭕' : '⬜';
        })
        .join('')
    );
  }
  lines.push('', rows.join('\n'));
  return lines.join('\n');
}

async function startGame(ctx, challenge, opponentId, opponentName, vsBot) {
  const gameId = nextId++;
  const board = Array(9).fill(null);
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

  const text = boardCaption(names, 'X', game.bet);
  await ctx.editMessageText(text, { ...HTML, ...boardKeyboard(gameId, board) });
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
        [boardCaptionFinal(g, null), '', '⌛ Game expired from inactivity.' + (g.bet ? ' Bet refunded.' : '')].join('\n'),
        HTML
      );
    } catch (err) {
      console.error('Failed to edit expired ttt game:', err.message);
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
      bold('❌⭕ Tic-Tac-Toe Challenge!'),
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
        console.error('Failed to edit expired ttt challenge:', err.message);
      }
    }, CHALLENGE_TTL_MS);
  };

  bot.command('tictactoe', startHandler);
  bot.command('ttt', startHandler);

  bot.action(/^ttt:(\d+):accept$/, async (ctx) => {
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

  bot.action(/^ttt:(\d+):bot$/, async (ctx) => {
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

  bot.action(/^ttt:(\d+):rules$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(formatRules('ttt'), HTML);
  });

  bot.action(/^ttt:(\d+):cancel$/, async (ctx) => {
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

  bot.action(/^ttt:(\d+):mv:(\d)$/, async (ctx) => {
    const gameId = Number(ctx.match[1]);
    const cell = Number(ctx.match[2]);
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
    if (game.board[cell]) {
      await ctx.answerCbQuery('That cell is already taken.');
      return;
    }

    game.board[cell] = game.turn;
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
      const move = botMove(game.board);
      game.board[move] = game.turn;
      const botWinner = checkWinner(game.board);
      if (botWinner) {
        await finishGame(ctx, gameId, game, botWinner);
        return;
      }
      game.turn = game.turn === 'X' ? 'O' : 'X';
      clearTimeout(game.timeoutHandle);
      scheduleIdleTimeout(ctx, gameId);
    }

    const text = boardCaption(game.names, game.turn, game.bet);
    try {
      await ctx.editMessageText(text, { ...HTML, ...boardKeyboard(gameId, game.board) });
    } catch (err) {
      console.error('Failed to edit ttt board:', err.message);
    }
  });
}

module.exports = { register };
