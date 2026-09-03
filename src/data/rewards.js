// Weighted reward tables. Each entry: { key, label, weight, apply(chatId, userId) -> resultText }

const SPIN_TABLE = [
  { key: 'coins_small', label: '50 Coins', weight: 30 },
  { key: 'coins_big', label: '150 Coins', weight: 15 },
  { key: 'xp_small', label: '30 XP', weight: 25 },
  { key: 'xp_big', label: '80 XP', weight: 12 },
  { key: 'rare_candy', label: 'Rare Candy', weight: 8 },
  { key: 'lucky_egg', label: 'Lucky Egg', weight: 6 },
  { key: 'avatar_frame', label: 'Avatar Frame', weight: 2 },
  { key: 'egg_common', label: '🥚 Common Egg', weight: 1.5 },
  { key: 'shiny_ticket', label: 'Shiny Ticket', weight: 1.5 },
  { key: 'extra_spin', label: 'Extra Spin!', weight: 0.5 },
];

const CHEST_TABLE = [
  { key: 'coins', label: '200 Coins', weight: 40 },
  { key: 'shiny_ticket', label: 'Shiny Ticket', weight: 20 },
  { key: 'lucky_ticket', label: 'Lucky Ticket', weight: 20 },
  { key: 'avatar_badge', label: 'Avatar Badge', weight: 10 },
  { key: 'rare_pokemon', label: 'Rare Pokémon Encounter', weight: 8 },
  { key: 'egg_common', label: '🥚 Common Egg', weight: 5 },
  { key: 'event_key', label: 'Event Key', weight: 1.9 },
  { key: 'egg_rare', label: '🥚✨ Rare Egg', weight: 0.9 },
  { key: 'mythical', label: '🌟 MYTHICAL REWARD 🌟', weight: 0.1 },
];

// Smaller/gentler than SPIN_TABLE — a daily gift between friends, not a jackpot roll.
const GIFT_TABLE = [
  { key: 'coins_small', label: '50 Coins', weight: 45 },
  { key: 'xp_small', label: '30 XP', weight: 30 },
  { key: 'rare_candy', label: 'Rare Candy', weight: 15 },
  { key: 'lucky_egg', label: 'Lucky Egg', weight: 10 },
];

function weightedPick(table) {
  const total = table.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  for (const reward of table) {
    if (roll < reward.weight) return reward;
    roll -= reward.weight;
  }
  return table[0];
}

module.exports = { SPIN_TABLE, CHEST_TABLE, GIFT_TABLE, weightedPick };
