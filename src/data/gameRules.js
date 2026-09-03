const { bold } = require('../utils/text');

// Central rulebook text for every mini-game — shown via /games and the "📖 Rules" buttons
// on challenge messages, so players never have to guess how a game works.
const GAME_RULES = {
  ttt: {
    emoji: '❌⭕',
    title: 'Tic-Tac-Toe',
    command: '/tictactoe (or /ttt)',
    rules: [
      'Classic 3x3 grid — get 3 in a row (any direction: row, column, or diagonal) to win.',
      `${bold('/tictactoe')} opens a challenge anyone in the group can Accept.`,
      "Reply to someone's message with /tictactoe to challenge that exact person instead.",
      `Add ${bold('bet')} (e.g. "/tictactoe bet") to play for 50 coins a side — the winner takes both stakes, a draw refunds everyone.`,
      'Tap 🤖 Play vs Bot for instant solo play — no bet available against the bot.',
      'An unaccepted challenge expires after 5 minutes; an idle match expires after 10 minutes (any bet is refunded).',
      'Reward: +25 XP for a win.',
    ],
  },
  rps: {
    emoji: '🔥💧🌿',
    title: 'Rock-Paper-Scissors',
    command: '/rps',
    rules: [
      'Pokémon-typed picks: Fire beats Grass, Grass beats Water, Water beats Fire. Same pick = draw.',
      `${bold('/rps')} opens a challenge anyone in the group can Accept.`,
      "Reply to someone's message with /rps to challenge that exact person instead.",
      `Add ${bold('bet')} (e.g. "/rps bet") to play for 30 coins a side — the winner takes both stakes, a draw refunds everyone.`,
      'Tap 🤖 Play vs Bot for instant solo play — no bet available against the bot.',
      'Your pick stays hidden until both players have chosen — no peeking at each other\'s move.',
      'Reward: +15 XP for a win.',
    ],
  },
  scramble: {
    emoji: '🔤',
    title: 'Scramble',
    command: '/scramble',
    rules: [
      "The bot shuffles a Pokémon's name and gives you a type hint.",
      'First correct reply in the chat — just type the name — wins.',
      '30 seconds to answer before the round expires and reveals the answer.',
      'Reward: +20 XP for the winner.',
    ],
  },
  whosthat: {
    emoji: '❓',
    title: "Who's That Pokémon?",
    command: '/whosthat',
    rules: [
      "The bot posts a real silhouette generated from a Pokémon's official artwork.",
      'First correct reply in the chat — just type the name — wins. Small typos are forgiven, as long as it\'s not accidentally the exact name of a different real Pokémon.',
      '30 seconds to answer before the round expires and reveals the Pokémon.',
      'Reward: +25 XP for the winner.',
      `${bold('/whosthatstart')} turns on auto mode — a new round posts by itself once each one ends, no need to keep re-running /whosthat. ${bold('/stopwhoisthat')} turns it back off.`,
    ],
  },
  connect4: {
    emoji: '🔴🟡',
    title: 'Connect 4',
    command: '/connect4 (or /c4)',
    rules: [
      'Classic 7x6 grid — get 4 in a row (any direction) to win. Tap a column number to drop your piece there.',
      `${bold('/connect4')} opens a challenge anyone in the group can Accept.`,
      "Reply to someone's message with /connect4 to challenge that exact person instead.",
      `Add ${bold('bet')} (e.g. "/connect4 bet") to play for 40 coins a side — the winner takes both stakes, a draw refunds everyone.`,
      'Tap 🤖 Play vs Bot for instant solo play — no bet available against the bot.',
      'An unaccepted challenge expires after 5 minutes; an idle match expires after 10 minutes (any bet is refunded).',
      'Reward: +30 XP for a win.',
    ],
  },
  hangman: {
    emoji: '🪢',
    title: 'Hangman',
    command: '/hangman',
    rules: [
      "The bot picks a Pokémon name and shows it as blanks.",
      'Type a single letter to guess it — correct letters reveal every spot they appear, wrong letters cost you a strike (6 strikes and the round is lost).',
      'Guessing a wrong full name also costs a strike — only the exact answer wins, so guess carefully!',
      'Anyone can guess a letter or the full name; whoever completes the word wins.',
      '60 seconds of no activity ends the round and reveals the answer.',
      'Reward: +20 XP for the winner.',
    ],
  },
  battle: {
    emoji: '⚔️',
    title: 'Pokémon Battle',
    command: '/battle',
    rules: [
      "Real 3v3 team combat using Pokémon from your actual /collection, Pokémon GO PvP-style — not just trainer stats.",
      `${bold('/battle')} opens a challenge anyone in the group can Accept.`,
      "Reply to someone's message with /battle to challenge that exact person instead.",
      `Add ${bold('bet')} (e.g. "/battle bet") to play for 60 coins a side — the winner takes both stakes.`,
      'Tap 🤖 Play vs Bot for instant solo play — no bet available against the bot.',
      `Battles use your pre-built team — set it once with ${bold('/myteam')} (the same 3-Pokémon team you use for raids). No in-chat picking, so the fight starts the instant a challenge is accepted. Stats come from rarity tier (and shinies hit a bit harder) — type still matters a lot.`,
      'Each turn, pick a move by type — moves that are super effective against the opponent\'s type(s) deal 1.5x damage. When your active Pokémon faints, your next one automatically swaps in — the match only ends once a whole team (all 3) has fainted.',
      "Real players get DM'd a link to an animated Battle Arena (Telegram Mini App) — the fight happens there, fully animated with sprites, HP bars, a live team bench, and move buttons. The group only sees a short \"battle started\" notice and the final result, not the turn-by-turn. If a DM can't reach someone, the group message reveals the full battle with Telegram buttons instead, so nobody gets stuck.",
      "A fainted Pokémon rests for 1 hour before it can battle again — swap your team with /myteam if you want to fight sooner.",
      'An unaccepted challenge expires after 5 minutes; an idle battle expires after 10 minutes (any bet is refunded).',
      'Reward: +40 XP for a win.',
    ],
  },
};

function formatRules(key) {
  const game = GAME_RULES[key];
  if (!game) return null;
  const lines = [
    bold(`${game.emoji} ${game.title} — Rules`),
    '',
    ...game.rules.map((line) => `• ${line}`),
    '',
    `▶️ Start with: ${bold(game.command)}`,
  ];
  return lines.join('\n');
}

module.exports = { GAME_RULES, formatRules };
