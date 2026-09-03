// Per-species power tiers — layered on TOP of the existing rarity-tier base stats
// (computeStats() in battleData.js), never replacing them. Added 2026-07-23 because the Gold
// Store sold every Pokémon within a category (e.g. every Legendary) at identical HP/Attack
// despite different prices — unfair, since a pricier "S-tier" pick should hit harder than a
// cheaper one in the same category.
//
// Deliberately scoped to only the ~120 species actually sold in the Gold Store (plus a couple
// of shared evolution-line names already in the roster) — anything NOT listed here defaults to
// tier 'B' (1.0x, i.e. unchanged from before this file existed), so the other 100+ roster
// species keep their exact existing battle/raid balance untouched.
const TIER_MULTIPLIER = { S: 1.3, A: 1.15, B: 1.0, C: 0.9 };

const POWER_TIER = {
  // ── Rare / Shiny tier species ──
  Garchomp: 'S',
  Metagross: 'S',
  Tyranitar: 'S',
  Dragapult: 'S',
  Salamence: 'S',
  Volcarona: 'S',
  Dragonite: 'A',
  Hydreigon: 'A',
  'Kommo-o': 'A',
  Goodra: 'A',
  Charizard: 'A',
  Greninja: 'A',
  Gardevoir: 'A',
  Gallade: 'A',
  Scizor: 'A',
  Lucario: 'B',
  Zoroark: 'B',
  Aegislash: 'B',
  Haxorus: 'B',
  Kingdra: 'B',
  Gengar: 'B',
  Sylveon: 'B',
  Umbreon: 'B',
  Electivire: 'C',
  Magmortar: 'C',

  // ── Legendary / Shiny Legendary tier species ──
  Rayquaza: 'S',
  Mewtwo: 'S',
  Kyogre: 'S',
  Groudon: 'S',
  Dialga: 'S',
  Palkia: 'S',
  Giratina: 'S',
  Zacian: 'S',
  Zamazenta: 'S',
  Eternatus: 'S',
  Necrozma: 'S',
  Lugia: 'S',
  'Ho-Oh': 'S',
  Zekrom: 'A',
  Reshiram: 'A',
  Kyurem: 'A',
  Xerneas: 'A',
  Yveltal: 'A',
  Solgaleo: 'A',
  Lunala: 'A',
  Regigigas: 'A',
  Latios: 'A',
  Latias: 'A',
  Heatran: 'A',
  Articuno: 'B',
  Zapdos: 'B',
  Moltres: 'B',
  Raikou: 'B',
  Entei: 'B',
  Suicune: 'B',
  Cresselia: 'B',
  Regirock: 'C',
  Regice: 'C',
  Registeel: 'C',

  // ── Mythical / Shiny Mythical tier species ──
  Arceus: 'S',
  Mew: 'S',
  Darkrai: 'S',
  Deoxys: 'S',
  Genesect: 'A',
  Marshadow: 'A',
  Zeraora: 'A',
  Magearna: 'A',
  Victini: 'A',
  Melmetal: 'A',
  Zarude: 'A',
  Celebi: 'B',
  Jirachi: 'B',
  Shaymin: 'B',
  Keldeo: 'B',
  Meloetta: 'B',
  Diancie: 'B',
  Volcanion: 'B',
  Hoopa: 'B',
  Manaphy: 'C',
  Phione: 'C',
  Meltan: 'C',
};

function getPowerTier(speciesName) {
  return POWER_TIER[speciesName] || 'B';
}

function getPowerMultiplier(speciesName) {
  return TIER_MULTIPLIER[getPowerTier(speciesName)];
}

module.exports = { POWER_TIER, TIER_MULTIPLIER, getPowerTier, getPowerMultiplier };
