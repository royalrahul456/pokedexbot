// A deliberately simplified type chart — only "super effective" (1.5x) relationships,
// no resistances/immunities. Keeps battles strategic without needing full 18x18 chart data.
const TYPE_CHART = {
  Normal: [],
  Fire: ['Grass', 'Ice', 'Bug', 'Steel'],
  Water: ['Fire', 'Ground', 'Rock'],
  Electric: ['Water', 'Flying'],
  Grass: ['Water', 'Ground', 'Rock'],
  Ice: ['Grass', 'Ground', 'Flying', 'Dragon'],
  Fighting: ['Normal', 'Ice', 'Rock', 'Dark', 'Steel'],
  Poison: ['Grass', 'Fairy'],
  Ground: ['Fire', 'Electric', 'Poison', 'Rock', 'Steel'],
  Flying: ['Grass', 'Fighting', 'Bug'],
  Psychic: ['Fighting', 'Poison'],
  Bug: ['Grass', 'Psychic', 'Dark'],
  Rock: ['Fire', 'Ice', 'Flying', 'Bug'],
  Ghost: ['Psychic', 'Ghost'],
  Dragon: ['Dragon'],
  Dark: ['Psychic', 'Ghost'],
  Steel: ['Ice', 'Rock', 'Fairy'],
  Fairy: ['Fighting', 'Dragon', 'Dark'],
};

const SUPER_EFFECTIVE_MULTIPLIER = 1.5;

// A themed emoji per move type, used to flavor battle animation text (e.g. a Fire move's
// suspense/attack line gets 🔥 instead of a generic random icon) — small touch, no extra
// message edits needed, just makes the one edit per move feel more alive.
const TYPE_EMOJI = {
  Normal: '⭐',
  Fire: '🔥',
  Water: '💧',
  Electric: '⚡',
  Grass: '🌿',
  Ice: '❄️',
  Fighting: '🥊',
  Poison: '☠️',
  Ground: '🌍',
  Flying: '💨',
  Psychic: '🔮',
  Bug: '🐛',
  Rock: '🪨',
  Ghost: '👻',
  Dragon: '🐉',
  Dark: '🌑',
  Steel: '⚙️',
  Fairy: '✨',
};

// A generic move name per type — every mon gets one move per its own type(s), plus Tackle
// as a guaranteed fallback (so mono-type mons still have 2 choices).
const TYPE_MOVES = {
  Normal: 'Tackle',
  Fire: 'Ember',
  Water: 'Water Gun',
  Electric: 'Thunder Shock',
  Grass: 'Vine Whip',
  Ice: 'Ice Shard',
  Fighting: 'Karate Chop',
  Poison: 'Sludge',
  Ground: 'Mud Slap',
  Flying: 'Gust',
  Psychic: 'Confusion',
  Bug: 'Bug Bite',
  Rock: 'Rock Throw',
  Ghost: 'Lick',
  Dragon: 'Dragon Breath',
  Dark: 'Bite',
  Steel: 'Metal Claw',
  Fairy: 'Fairy Wind',
};

// Base stats derived from a species' natural rarity tier — same simplification used
// elsewhere in the bot (no full per-species stat authoring). Shiny mons hit a bit harder.
const BASE_STATS = {
  common: { hp: 90, atk: 16 },
  rare: { hp: 110, atk: 20 },
  legendary: { hp: 150, atk: 28 },
  mythical: { hp: 160, atk: 30 },
};
const SHINY_STAT_MULTIPLIER = 1.15;
const { getPowerMultiplier } = require('./speciesPower');

// `speciesName` is optional (3rd param, added 2026-07-23) — when given, layers a per-species
// power multiplier from speciesPower.js on top of the rarity-tier base, so e.g. Rayquaza hits
// harder than Regirock despite both being "legendary" tier (this is what makes Gold Store price
// differences within one category mechanically justified, not just cosmetic). Omitting it (or
// passing a species not in speciesPower.js) keeps the exact prior behavior — 1.0x, no change.
function computeStats(baseRarity, shiny, speciesName) {
  const base = BASE_STATS[baseRarity] || BASE_STATS.common;
  const shinyMult = shiny ? SHINY_STAT_MULTIPLIER : 1;
  const powerMult = speciesName ? getPowerMultiplier(speciesName) : 1;
  return {
    maxHp: Math.round(base.hp * shinyMult * powerMult),
    atk: Math.round(base.atk * shinyMult * powerMult),
  };
}

// One move per distinct type the mon has, plus a guaranteed Tackle (Normal) if it isn't
// already Normal-type — so every mon has 2-3 move buttons.
function movesFor(types) {
  const moves = [...new Set(types)].map((t) => ({ type: t, name: TYPE_MOVES[t] || 'Tackle' }));
  if (!types.includes('Normal')) moves.push({ type: 'Normal', name: 'Tackle' });
  return moves;
}

function isSuperEffective(moveType, defenderTypes) {
  const strongAgainst = TYPE_CHART[moveType] || [];
  return defenderTypes.some((t) => strongAgainst.includes(t));
}

// Returns { damage, superEffective }.
function calcDamage(attackerAtk, moveType, defenderTypes) {
  const superEffective = isSuperEffective(moveType, defenderTypes);
  const variance = 0.85 + Math.random() * 0.3; // 0.85 - 1.15
  const mult = superEffective ? SUPER_EFFECTIVE_MULTIPLIER : 1;
  const damage = Math.max(1, Math.round(attackerAtk * mult * variance));
  return { damage, superEffective };
}

function hpBar(hp, maxHp) {
  const clamped = Math.max(0, hp);
  const pct = maxHp > 0 ? clamped / maxHp : 0;
  const filled = Math.max(0, Math.min(10, Math.round(pct * 10)));
  return `${'🟩'.repeat(filled)}${'⬜'.repeat(10 - filled)} ${clamped}/${maxHp}`;
}

module.exports = { TYPE_CHART, TYPE_MOVES, TYPE_EMOJI, BASE_STATS, computeStats, movesFor, calcDamage, hpBar };
