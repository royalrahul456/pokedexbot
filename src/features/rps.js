const { Markup } = require('telegraf');
const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatRules } = require('../data/gameRules');

const BET_COINS = 30;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PICK_TTL_MS = 2 * 60 * 1000;
const BOT_ID = 'BOT';

const pendingChallenges = new Map();
const activeGames = new Map();
let nextId = 1;

const CHOICES = {
  fire: { emoji: '🔥', label: 'Fire', beats: 'grass' },
  water: { emoji: '💧', label: 'Water', beats: 'fire' },
  grass: { emoji: '🌿', label: 'Grass', beats: 'water' },
};

function challengeKeyboard(challengeId, isTargeted) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(isTargeted ? '⚔️ Accept' : '⚔️ Accept Challenge', `rps:${challengeId}:accept`)],
    [Markup.button.callback('🤖 Play vs Bot', `rps:${challengeId}:bot`)],
    [
      Markup.button.callback('📖 Rules', `rps:${challengeId}:rules`),
      Markup.button.callback('❌ Cancel', `rps:${challengeId}:cancel`),
    ],
  ]);
}

function pickKeyboard(gameId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔥 Fire', `rps:${gameId}:pick:fire`),
      Markup.button.callback('💧 Water', `rps:${gameId}:pick:water`),
      Markup.button.callback('🌿 Grass', `rps:${gameId}:pick:grass`),
    ],
  ]);
}

function pickCaption(names, bet) {
  return [
    bold('🔥💧🌿 Rock-Paper-Scissors'),
    '',
    `${bold(names.p1)} vs ${bold(names.p2)}`,
    bet ? `💰 Bet: ${bold(bet)} coins` : '🎮 Friendly match',
    '',
    'Both players: pick your type below (your pick stays hidden until both are in).',
  ].join('\n');
}

function resolveWinner(p1Choice, p2Choice) {
  if (p1Choice === p2Choice) return 'draw';
  return CHOICES[p1Choice].beats === p2Choice ? 'p1' : 'p2';
}

async function refundBet(chatId, game) {
  if (!game.bet) return;
  if (game.p1Id !== BOT_ID) users.addCoins(chatId, game.p1Id, game.bet);
  if (game.p2Id !== BOT_ID) users.addCoins(chatId, game.p2Id, game.bet);
}

async function finishGame(ctx, gameId, game) {
  clearTimeout(game.timeoutHandle);
  activeGames.delete(gameId);

  const outcome = resolveWinner(game.p1Choice, game.p2Choice);
  const p1 = CHOICES[game.p1Choice];
  const p2 = CHOICES[game.p2Choice];

  const lines = [
    bold('🔥💧🌿 Rock-Paper-Scissors — Result'),
    '',
    `${bold(game.names.p1)}: ${p1.emoji} ${p1.label}`,
    `${bold(game.names.p2)}: ${p2.emoji} ${p2.label}`,
    '',
  ];

  if (outcome === 'draw') {
    lines.push("🤝 It's a draw!");
    await refundBet(game.chatId, game);
  } else {
    const winnerId = outcome === 'p1' ? game.p1Id : game.p2Id;
    const winnerName = outcome === 'p1' ? game.names.p1 : game.names.p2;
    let result = `🏆 ${bold(winnerName)} wins!`;
    if (winnerId !== BOT_ID) {
      users.incrementCounter(game.chatId, winnerId, 'rps_wins');
      const levelUpMsg = grantRewards(game.chatId, winnerId, { xp: XP.RPS_WIN });
      result += ` +${XP.RPS_WIN} XP`;
      if (game.bet) {
        users.addCoins(game.chatId, winnerId, game.bet * 2);
        result += ` +${game.bet * 2} coins`;
      }
      if (levelUpMsg) result += `\n${levelUpMsg}`;
    } else {
      result += ' 🤖 (better luck next time!)';
    }
    lines.push(result);
  }

  try {
    await ctx.telegram.editMessageText(game.chatId, game.messageId, undefined, lines.join('\n'), HTML);
  } catch (err) {
    console.error('Failed to edit finished rps board:', err.message);
  }
}

function scheduleTimeout(ctx, gameId) {
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
        '⌛ Round expired — not everyone picked in time.' + (g.bet ? ' Bet refunded.' : ''),
        HTML
      );
    } catch (err) {
      console.error('Failed to edit expired rps game:', err.message);
    }
  }, PICK_TTL_MS);
}

async function startGame(ctx, challenge, opponentId, opponentName, vsBot) {
  if (challenge.bet && !vsBot) {
    const p1Ok = users.deductCoins(challenge.chatId, challenge.challengerId, challenge.bet);
    if (!p1Ok) {
      await ctx.answerCbQuery("You don't have enough coins for this bet anymore.", { show_alert: true });
      return false;
    }
    const p2Ok = users.deductCoins(challenge.chatId, opponentId, challenge.bet);
    if (!p2Ok) {
      users.addCoins(challenge.chatId, challenge.challengerId, challenge.bet);
      await ctx.answerCbQuery("You don't have enough coins to accept this bet.", { show_alert: true });
      return false;
    }
  }

  const gameId = nextId++;
  const game = {
    chatId: challenge.chatId,
    messageId: challenge.messageId,
    p1Id: challenge.challengerId,
    p2Id: vsBot ? BOT_ID : opponentId,
    p1Choice: null,
    p2Choice: null,
    names: { p1: challenge.challengerName, p2: vsBot ? '🤖 Bot' : opponentName },
    bet: vsBot ? 0 : challenge.bet,
    timeoutHandle: null,
  };

  if (vsBot) {
    game.p2Choice = Object.keys(CHOICES)[Math.floor(Math.random() * 3)];
  }

  activeGames.set(gameId, game);
  scheduleTimeout(ctx, gameId);

  await ctx.editMessageText(pickCaption(game.names, game.bet), { ...HTML, ...pickKeyboard(gameId) });
  return true;
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
      bold('🔥💧🌿 Rock-Paper-Scissors Challenge!'),
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
        console.error('Failed to edit expired rps challenge:', err.message);
      }
    }, CHALLENGE_TTL_MS);
  };

  bot.command('rps', startHandler);

  bot.action(/^rps:(\d+):accept$/, async (ctx) => {
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

  bot.action(/^rps:(\d+):bot$/, async (ctx) => {
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

  bot.action(/^rps:(\d+):rules$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(formatRules('rps'), HTML);
  });

  bot.action(/^rps:(\d+):cancel$/, async (ctx) => {
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

  bot.action(/^rps:(\d+):pick:(fire|water|grass)$/, async (ctx) => {
    const gameId = Number(ctx.match[1]);
    const choice = ctx.match[2];
    const game = activeGames.get(gameId);
    if (!game) {
      await ctx.answerCbQuery('This round has ended.', { show_alert: true });
      return;
    }

    if (ctx.from.id === game.p1Id) {
      if (game.p1Choice) {
        await ctx.answerCbQuery(`You already picked ${CHOICES[game.p1Choice].label}. Waiting for opponent...`);
        return;
      }
      game.p1Choice = choice;
      await ctx.answerCbQuery(`You picked ${CHOICES[choice].label}! Waiting for opponent...`);
    } else if (ctx.from.id === game.p2Id) {
      if (game.p2Choice) {
        await ctx.answerCbQuery(`You already picked ${CHOICES[game.p2Choice].label}. Waiting for opponent...`);
        return;
      }
      game.p2Choice = choice;
      await ctx.answerCbQuery(`You picked ${CHOICES[choice].label}! Waiting for opponent...`);
    } else {
      await ctx.answerCbQuery("This isn't your match.", { show_alert: true });
      return;
    }

    if (game.p1Choice && game.p2Choice) {
      await finishGame(ctx, gameId, game);
    }
  });
}

module.exports = { register };
