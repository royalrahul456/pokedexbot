// Every item a player can hold. `consumable: true` means /use removes one and
// triggers `effectText`; cosmetic items are just kept for flex/collection value.
const ITEMS = {
  rare_candy: {
    label: 'Rare Candy',
    emoji: '🍬',
    description: 'Use it for an instant burst of XP.',
    consumable: true,
  },
  lucky_egg: {
    label: 'Lucky Egg',
    emoji: '🥚',
    description: 'Use it for a bonus Coin payout.',
    consumable: true,
  },
  shiny_ticket: {
    label: 'Shiny Ticket',
    emoji: '🎫',
    description: 'Use it to summon a Shiny Pokémon into the group right now.',
    consumable: true,
  },
  rare_pokemon_encounter: {
    label: 'Rare Pokémon Encounter',
    emoji: '🔎',
    description: 'Use it to summon a Rare-tier Pokémon into the group right now.',
    consumable: true,
  },
  lucky_ticket: {
    label: 'Lucky Ticket',
    emoji: '🎟️',
    description: 'Entry ticket for the nightly Lucky Draw (coming in a future update).',
    consumable: false,
  },
  event_key: {
    label: 'Event Key',
    emoji: '🗝️',
    description: 'Unlocks seasonal events (coming in a future update).',
    consumable: false,
  },
  avatar_frame: {
    label: 'Avatar Frame',
    emoji: '🖼️',
    description: 'A cosmetic profile decoration (shop to equip it is coming soon).',
    consumable: false,
  },
  avatar_badge: {
    label: 'Avatar Badge',
    emoji: '🏅',
    description: 'A cosmetic profile badge (shop to equip it is coming soon).',
    consumable: false,
  },
  mystery_box: {
    label: 'Mystery Box',
    emoji: '🎁',
    description: 'Use it to crack it open for a random reward, no cooldown needed.',
    consumable: true,
  },
  egg_common: {
    label: 'Common Egg',
    emoji: '🥚',
    description: 'Incubate it with /egg — hatches into a new Pokémon (mostly common/rare) in 2 hours.',
    consumable: false,
  },
  egg_rare: {
    label: 'Rare Egg',
    emoji: '🥚✨',
    description: 'Incubate it with /egg — hatches into a new Pokémon (mostly rare, a shot at legendary) in 6 hours.',
    consumable: false,
  },
  mythical_reward: {
    label: 'Mythical Reward',
    emoji: '🌟',
    description: 'An ultra-rare jackpot trophy. Pure bragging rights.',
    consumable: false,
  },

  // Cosmetic Shop catalog (/shop) — purchased with coins, equipped one-at-a-time via
  // src/db/cosmetics.js. `displayText` is what shows on /profile when a title is equipped;
  // badges reuse their `emoji` for that purpose instead.
  title_rookie: {
    label: 'Rookie Title',
    emoji: '🌱',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'title',
    displayText: '🌱 Rookie',
    price: 50,
  },
  title_hunter: {
    label: 'Pokémon Hunter Title',
    emoji: '🎯',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'title',
    displayText: '🎯 Pokémon Hunter',
    price: 150,
  },
  title_champion: {
    label: 'Champion Title',
    emoji: '🏆',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'title',
    displayText: '🏆 Champion',
    price: 300,
  },
  title_shadow: {
    label: 'Shadow Trainer Title',
    emoji: '🌑',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'title',
    displayText: '🌑 Shadow Trainer',
    price: 400,
  },
  title_legend: {
    label: 'Legend Title',
    emoji: '⚡',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'title',
    displayText: '⚡ Legend',
    price: 500,
  },
  badge_star: {
    label: 'Star Badge',
    emoji: '⭐',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'badge',
    price: 100,
  },
  badge_fire: {
    label: 'Fire Badge',
    emoji: '🔥',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'badge',
    price: 200,
  },
  badge_crown: {
    label: 'Crown Badge',
    emoji: '👑',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'badge',
    price: 350,
  },
  badge_diamond: {
    label: 'Diamond Badge',
    emoji: '💎',
    description: 'Equip via /shop.',
    consumable: false,
    cosmeticType: 'badge',
    price: 450,
  },
};

function getItemInfo(itemKey) {
  return ITEMS[itemKey] || { label: itemKey, emoji: '📦', description: '', consumable: false };
}

function getCosmeticsByType(type) {
  return Object.entries(ITEMS)
    .filter(([, item]) => item.cosmeticType === type)
    .map(([key, item]) => ({ key, ...item }));
}

module.exports = { ITEMS, getItemInfo, getCosmeticsByType };
