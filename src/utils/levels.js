const MAX_LEVEL = 50;

// Cumulative XP needed to REACH a given level. Grows ~quadratically so higher
// levels take meaningfully longer, matching the Lv1->Lv50 rank spread.
function xpForLevel(level) {
  return 100 * level * (level - 1) / 2;
}

function levelFromXp(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) {
    level++;
  }
  return level;
}

const RANKS = [
  [1, 'Rookie'],
  [5, 'Trainer'],
  [10, 'Ace Trainer'],
  [20, 'Veteran'],
  [30, 'Elite'],
  [40, 'Champion'],
  [50, 'Pokémon Master'],
];

function rankForLevel(level) {
  let rank = RANKS[0][1];
  for (const [minLevel, title] of RANKS) {
    if (level >= minLevel) rank = title;
  }
  return rank;
}

module.exports = { MAX_LEVEL, xpForLevel, levelFromXp, rankForLevel };
