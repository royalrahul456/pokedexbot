// Each entry: [name, types[], nationalDexNumber]. Legendaries/mythicals are genderless,
// matching how they actually work in the games. The dex number is used to fetch real
// artwork from PokeAPI's public sprite repo.
const POKEDEX_COMMON = [
  ['Pidgey', ['Normal', 'Flying'], 16],
  ['Rattata', ['Normal'], 19],
  ['Caterpie', ['Bug'], 10],
  ['Weedle', ['Bug', 'Poison'], 13],
  ['Zubat', ['Poison', 'Flying'], 41],
  ['Magikarp', ['Water'], 129],
  ['Eevee', ['Normal'], 133],
  ['Bulbasaur', ['Grass', 'Poison'], 1],
  ['Charmander', ['Fire'], 4],
  ['Squirtle', ['Water'], 7],
  ['Pikachu', ['Electric'], 25],
  ['Growlithe', ['Fire'], 58],
  ['Machop', ['Fighting'], 66],
  ['Abra', ['Psychic'], 63],
  ['Gastly', ['Ghost', 'Poison'], 92],
  ['Bellsprout', ['Grass', 'Poison'], 69],
  ['Ponyta', ['Fire'], 77],
  ['Meowth', ['Normal'], 52],
  ['Psyduck', ['Water'], 54],
  ['Poliwag', ['Water'], 60],
  ['Oddish', ['Grass', 'Poison'], 43],
  ['Paras', ['Bug', 'Grass'], 46],
  ['Diglett', ['Ground'], 50],
  ['Voltorb', ['Electric'], 100],
  ['Drowzee', ['Psychic'], 96],
  ['Krabby', ['Water'], 98],
  ['Horsea', ['Water'], 116],
  ['Goldeen', ['Water'], 118],
  ['Slowpoke', ['Water', 'Psychic'], 79],
  ['Cubone', ['Ground'], 104],
  ['Sentret', ['Normal'], 161],
  ['Hoothoot', ['Normal', 'Flying'], 163],
  ['Wurmple', ['Bug'], 265],
  ['Zigzagoon', ['Normal'], 263],
  ['Poochyena', ['Dark'], 261],
  ['Taillow', ['Normal', 'Flying'], 276],
  ['Bidoof', ['Normal'], 399],
  ['Starly', ['Normal', 'Flying'], 396],
  ['Lillipup', ['Normal'], 506],
  ['Wooloo', ['Normal'], 831],
  // Big roster expansion 2026-07-23 — every dex number below was verified against the real
  // PokeAPI official-artwork sprite repo (HEAD 200) before being added, same standard used
  // everywhere else in this file. Added mainly to grow "Who's That Pokémon?" variety, but
  // this list is shared bot-wide (spawns, catching, quizzes, breeding all draw from it too).
  ['Clefairy', ['Fairy'], 35],
  ['Vulpix', ['Fire'], 37],
  ['Jigglypuff', ['Normal', 'Fairy'], 39],
  ['Venonat', ['Bug', 'Poison'], 48],
  ['Mankey', ['Fighting'], 56],
  ['Shellder', ['Water'], 90],
  ['Onix', ['Rock', 'Ground'], 95],
  ['Exeggcute', ['Grass', 'Psychic'], 102],
  ['Koffing', ['Poison'], 109],
  ['Rhyhorn', ['Ground', 'Rock'], 111],
  ['Chansey', ['Normal'], 113],
  ['Tangela', ['Grass'], 114],
  ['Kangaskhan', ['Normal'], 115],
  ['Staryu', ['Water'], 120],
  ['Pinsir', ['Bug'], 127],
  ['Ditto', ['Normal'], 132],
  ['Chikorita', ['Grass'], 152],
  ['Cyndaquil', ['Fire'], 155],
  ['Totodile', ['Water'], 158],
  ['Chinchou', ['Water', 'Electric'], 170],
  ['Marill', ['Water', 'Fairy'], 183],
  ['Skarmory', ['Steel', 'Flying'], 227],
  ['Houndour', ['Dark', 'Fire'], 228],
  ['Teddiursa', ['Normal'], 216],
  ['Slugma', ['Fire'], 218],
  ['Swinub', ['Ice', 'Ground'], 220],
  ['Snorunt', ['Ice'], 361],
  ['Spheal', ['Ice', 'Water'], 363],
  ['Torchic', ['Fire'], 255],
  ['Mudkip', ['Water'], 258],
  ['Treecko', ['Grass'], 252],
  ['Ralts', ['Psychic', 'Fairy'], 280],
  ['Shroomish', ['Grass'], 285],
  ['Whismur', ['Normal'], 293],
  ['Trapinch', ['Ground'], 328],
  ['Feebas', ['Water'], 349],
  ['Snover', ['Grass', 'Ice'], 459],
  ['Buneary', ['Normal'], 427],
  ['Piplup', ['Water'], 393],
  ['Chimchar', ['Fire'], 390],
  ['Turtwig', ['Grass'], 387],
  ['Shinx', ['Electric'], 403],
  ['Buizel', ['Water'], 418],
  ['Snivy', ['Grass'], 495],
  ['Tepig', ['Fire'], 498],
  ['Oshawott', ['Water'], 501],
  ['Purrloin', ['Dark'], 509],
  ['Pidove', ['Normal', 'Flying'], 519],
  ['Scraggy', ['Dark', 'Fighting'], 559],
  ['Rowlet', ['Grass', 'Flying'], 722],
  ['Litten', ['Fire'], 725],
  ['Popplio', ['Water'], 728],
  ['Grookey', ['Grass'], 810],
  ['Scorbunny', ['Fire'], 813],
  ['Sobble', ['Water'], 816],
];

const POKEDEX_RARE = [
  ['Snorlax', ['Normal'], 143],
  ['Dragonite', ['Dragon', 'Flying'], 149],
  ['Gyarados', ['Water', 'Flying'], 130],
  ['Lapras', ['Water', 'Ice'], 131],
  ['Scyther', ['Bug', 'Flying'], 123],
  ['Tauros', ['Normal'], 128],
  ['Aerodactyl', ['Rock', 'Flying'], 142],
  ['Larvitar', ['Rock', 'Ground'], 246],
  ['Riolu', ['Fighting'], 447],
  ['Absol', ['Dark'], 359],
  ['Gible', ['Dragon', 'Ground'], 443],
  ['Dratini', ['Dragon'], 147],
  ['Alakazam', ['Psychic'], 65],
  ['Gengar', ['Ghost', 'Poison'], 94],
  ['Machamp', ['Fighting'], 68],
  ['Steelix', ['Steel', 'Ground'], 208],
  ['Scizor', ['Bug', 'Steel'], 212],
  ['Tyranitar', ['Rock', 'Dark'], 248],
  ['Metagross', ['Steel', 'Psychic'], 376],
  ['Salamence', ['Dragon', 'Flying'], 373],
  ['Garchomp', ['Dragon', 'Ground'], 445],
  ['Milotic', ['Water'], 350],
  ['Togekiss', ['Fairy', 'Flying'], 468],
  ['Sylveon', ['Fairy'], 700],
  ['Umbreon', ['Dark'], 197],
  ['Espeon', ['Psychic'], 196],
  ['Hydreigon', ['Dark', 'Dragon'], 635],
  // Big roster expansion 2026-07-23 — mostly evolved forms of species already in COMMON, same
  // "base form common, evolved form rare" pattern already used for Dratini/Umbreon/Espeon etc.
  ['Venusaur', ['Grass', 'Poison'], 3],
  ['Charizard', ['Fire', 'Flying'], 6],
  ['Blastoise', ['Water'], 9],
  ['Butterfree', ['Bug', 'Flying'], 12],
  ['Beedrill', ['Bug', 'Poison'], 15],
  ['Pidgeot', ['Normal', 'Flying'], 18],
  ['Raichu', ['Electric'], 26],
  ['Nidoqueen', ['Poison', 'Ground'], 31],
  ['Nidoking', ['Poison', 'Ground'], 34],
  ['Vaporeon', ['Water'], 134],
  ['Jolteon', ['Electric'], 135],
  ['Flareon', ['Fire'], 136],
  ['Ampharos', ['Electric'], 181],
  ['Typhlosion', ['Fire'], 157],
  ['Feraligatr', ['Water'], 160],
  ['Meganium', ['Grass'], 154],
  ['Sceptile', ['Grass'], 254],
  ['Blaziken', ['Fire', 'Fighting'], 257],
  ['Swampert', ['Water', 'Ground'], 260],
  ['Gardevoir', ['Psychic', 'Fairy'], 282],
  ['Torterra', ['Grass', 'Ground'], 389],
  ['Infernape', ['Fire', 'Fighting'], 392],
  ['Empoleon', ['Water', 'Steel'], 395],
  ['Lucario', ['Fighting', 'Steel'], 448],
  ['Darmanitan', ['Fire'], 555],
  ['Chandelure', ['Ghost', 'Fire'], 609],
  ['Volcarona', ['Bug', 'Fire'], 637],
  ['Braviary', ['Normal', 'Flying'], 628],
  // Added 2026-07-23 for Gold Store catalog stock — every dex number verified with a real
  // HEAD request against PokeAPI's official-artwork sprite repo (all returned 200) before adding.
  ['Greninja', ['Water', 'Dark'], 658],
  ['Zoroark', ['Dark'], 571],
  ['Aegislash', ['Steel', 'Ghost'], 681],
  ['Goodra', ['Dragon'], 706],
  ['Kommo-o', ['Dragon', 'Fighting'], 784],
  ['Dragapult', ['Dragon', 'Ghost'], 887],
  ['Haxorus', ['Dragon'], 612],
  ['Gallade', ['Psychic', 'Fighting'], 475],
  ['Kingdra', ['Water', 'Dragon'], 230],
  ['Electivire', ['Electric'], 466],
  ['Magmortar', ['Fire'], 467],
];

const POKEDEX_LEGENDARY = [
  ['Rayquaza', ['Dragon', 'Flying'], 384],
  ['Mewtwo', ['Psychic'], 150],
  ['Lugia', ['Psychic', 'Flying'], 249],
  ['Ho-Oh', ['Fire', 'Flying'], 250],
  ['Groudon', ['Ground'], 383],
  ['Kyogre', ['Water'], 382],
  ['Dialga', ['Steel', 'Dragon'], 483],
  ['Palkia', ['Water', 'Dragon'], 484],
  ['Giratina', ['Ghost', 'Dragon'], 487],
  ['Zacian', ['Fairy'], 888],
  ['Articuno', ['Ice', 'Flying'], 144],
  ['Zapdos', ['Electric', 'Flying'], 145],
  ['Moltres', ['Fire', 'Flying'], 146],
  ['Raikou', ['Electric'], 243],
  ['Entei', ['Fire'], 244],
  ['Suicune', ['Water'], 245],
  ['Latios', ['Dragon', 'Psychic'], 381],
  ['Latias', ['Dragon', 'Psychic'], 380],
  ['Heatran', ['Fire', 'Steel'], 485],
  ['Cresselia', ['Psychic'], 488],
  ['Reshiram', ['Dragon', 'Fire'], 643],
  ['Zekrom', ['Dragon', 'Electric'], 644],
  ['Xerneas', ['Fairy'], 716],
  ['Yveltal', ['Dark', 'Flying'], 717],
  ['Zamazenta', ['Fighting'], 889],
  // Big roster expansion 2026-07-23 — every real canonical Legendary not already covered,
  // spanning Gen3 through Gen9 (Regis, lake trio, forces of nature, Kyurem, Zygarde, Tapus,
  // Ultra Beasts'-generation legends, Crown Tundra legends, Paldean ruin beasts, box legends).
  ['Regirock', ['Rock'], 377],
  ['Regice', ['Ice'], 378],
  ['Registeel', ['Steel'], 379],
  ['Uxie', ['Psychic'], 480],
  ['Mesprit', ['Psychic'], 481],
  ['Azelf', ['Psychic'], 482],
  ['Regigigas', ['Normal'], 486],
  ['Cobalion', ['Steel', 'Fighting'], 638],
  ['Terrakion', ['Rock', 'Fighting'], 639],
  ['Virizion', ['Grass', 'Fighting'], 640],
  ['Tornadus', ['Flying'], 641],
  ['Thundurus', ['Electric', 'Flying'], 642],
  ['Landorus', ['Ground', 'Flying'], 645],
  ['Kyurem', ['Dragon', 'Ice'], 646],
  ['Zygarde', ['Dragon', 'Ground'], 718],
  ['Tapu Koko', ['Electric', 'Fairy'], 785],
  ['Tapu Lele', ['Psychic', 'Fairy'], 786],
  ['Tapu Bulu', ['Grass', 'Fairy'], 787],
  ['Tapu Fini', ['Water', 'Fairy'], 788],
  ['Solgaleo', ['Psychic', 'Steel'], 791],
  ['Lunala', ['Psychic', 'Ghost'], 792],
  ['Necrozma', ['Psychic'], 800],
  ['Eternatus', ['Poison', 'Dragon'], 890],
  ['Regieleki', ['Electric'], 894],
  ['Regidrago', ['Dragon'], 895],
  ['Glastrier', ['Ice'], 896],
  ['Spectrier', ['Ghost'], 897],
  ['Calyrex', ['Psychic', 'Grass'], 898],
  ['Wo-Chien', ['Dark', 'Grass'], 1001],
  ['Chien-Pao', ['Dark', 'Ice'], 1002],
  ['Ting-Lu', ['Dark', 'Ground'], 1003],
  ['Chi-Yu', ['Dark', 'Fire'], 1004],
  ['Koraidon', ['Fighting', 'Dragon'], 1007],
  ['Miraidon', ['Electric', 'Dragon'], 1008],
];

const POKEDEX_MYTHICAL = [
  ['Mew', ['Psychic'], 151],
  ['Celebi', ['Psychic', 'Grass'], 251],
  ['Jirachi', ['Steel', 'Psychic'], 385],
  ['Arceus', ['Normal'], 493],
  ['Darkrai', ['Dark'], 491],
  ['Deoxys', ['Psychic'], 386],
  ['Shaymin', ['Grass'], 492],
  ['Victini', ['Psychic', 'Fire'], 494],
  ['Genesect', ['Bug', 'Steel'], 649],
  ['Hoopa', ['Psychic', 'Ghost'], 720],
  ['Volcanion', ['Fire', 'Water'], 721],
  ['Magearna', ['Steel', 'Fairy'], 801],
  ['Zeraora', ['Electric'], 807],
  ['Zarude', ['Dark', 'Grass'], 893],
  ['Meloetta', ['Normal', 'Psychic'], 648],
  // Big roster expansion 2026-07-23 — every real canonical Mythical not already covered.
  ['Manaphy', ['Water'], 490],
  ['Keldeo', ['Water', 'Fighting'], 647],
  ['Diancie', ['Rock', 'Fairy'], 719],
  ['Marshadow', ['Fighting', 'Ghost'], 802],
  ['Meltan', ['Steel'], 808],
  ['Melmetal', ['Steel'], 809],
  ['Pecharunt', ['Poison', 'Ghost'], 1025],
  // Added 2026-07-23 for Gold Store catalog stock — dex number verified with a real HEAD
  // request against PokeAPI's official-artwork sprite repo (returned 200) before adding.
  ['Phione', ['Water'], 489],
];

const TYPE_EMOJI = {
  Normal: '⚪',
  Fire: '🔥',
  Water: '💧',
  Electric: '⚡',
  Grass: '🌿',
  Ice: '❄️',
  Fighting: '🥊',
  Poison: '☠️',
  Ground: '🌍',
  Flying: '🕊️',
  Psychic: '🔮',
  Bug: '🐛',
  Rock: '🪨',
  Ghost: '👻',
  Dragon: '🐉',
  Dark: '🌑',
  Steel: '⚙️',
  Fairy: '✨',
};

// Build name -> { types, genderless, dexNumber } lookup, and rarity -> plain name list, in one pass.
const POKEDEX = new Map();
function registerTier(entries, genderless) {
  const names = [];
  for (const [name, types, dexNumber] of entries) {
    POKEDEX.set(name, { types, genderless, dexNumber });
    names.push(name);
  }
  return names;
}

const COMMON = registerTier(POKEDEX_COMMON, false);
const RARE = registerTier(POKEDEX_RARE, false);
const LEGENDARY = registerTier(POKEDEX_LEGENDARY, true);
const MYTHICAL = registerTier(POKEDEX_MYTHICAL, true);

// name pool for the "shiny" flavor — any common/rare pokemon can appear shiny
const SHINY_CANDIDATES = [...COMMON, ...RARE];

// A species' natural tier, independent of "shiny" (which is a paint job, not a tier).
// Used for the Pokemon Collection so a Shiny Charmander still files under "common".
function getBaseRarity(name) {
  if (COMMON.includes(name)) return 'common';
  if (RARE.includes(name)) return 'rare';
  if (LEGENDARY.includes(name)) return 'legendary';
  if (MYTHICAL.includes(name)) return 'mythical';
  return 'common';
}

// Weighted spawn table: [rarity, weight]
const RARITY_WEIGHTS = [
  ['common', 65],
  ['rare', 22],
  ['shiny', 9],
  ['legendary', 3.5],
  ['mythical', 0.5],
  ['shiny_legendary', 0.08],
  ['shiny_mythical', 0.02],
];

const RARITY_STARS = {
  common: '⭐',
  rare: '⭐⭐⭐',
  shiny: '⭐⭐⭐⭐',
  legendary: '⭐⭐⭐⭐⭐',
  mythical: '⭐⭐⭐⭐⭐',
  shiny_legendary: '🌟⭐⭐⭐⭐⭐',
  shiny_mythical: '🌟⭐⭐⭐⭐⭐',
};

const RARITY_XP = {
  common: 10,
  rare: 20,
  shiny: 40,
  legendary: 80,
  mythical: 150,
  shiny_legendary: 250,
  shiny_mythical: 400,
};

const RARITY_COINS = {
  common: 15,
  rare: 30,
  shiny: 75,
  legendary: 150,
  mythical: 300,
  shiny_legendary: 500,
  shiny_mythical: 800,
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Case-insensitive lookup of a species' canonical POKEDEX name, e.g. "pikachu" -> "Pikachu".
// Returns null if it's not a real roster entry (used to validate seasonal event input).
function resolveSpeciesName(input) {
  const target = String(input).trim().toLowerCase();
  for (const name of POKEDEX.keys()) {
    if (name.toLowerCase() === target) return name;
  }
  return null;
}

// Picks from `pool`, but if a themed subset (a seasonal event's featured species) overlaps
// this pool, mostly picks from that overlap instead — the tier/rarity odds are untouched,
// only which name within the tier comes up more often.
const THEME_BIAS_CHANCE = 0.65;
function pickBiased(pool, themeSet) {
  if (themeSet && themeSet.size) {
    const themed = pool.filter((name) => themeSet.has(name));
    if (themed.length && Math.random() < THEME_BIAS_CHANCE) return pick(themed);
  }
  return pick(pool);
}

function pickRarity() {
  const total = RARITY_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [rarity, weight] of RARITY_WEIGHTS) {
    if (roll < weight) return rarity;
    roll -= weight;
  }
  return 'common';
}

function getPokedexEntry(name) {
  return POKEDEX.get(name) ?? { types: ['Normal'], genderless: false, dexNumber: null };
}

// Free, public artwork from PokeAPI's sprite repo — no API key needed.
function getArtworkUrl(dexNumber, shiny = false) {
  if (!dexNumber) return null;
  const shinyPath = shiny ? 'shiny/' : '';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${shinyPath}${dexNumber}.png`;
}

// Real animated sprites from Pokémon Showdown's public CDN — verified 100% coverage for
// every species in LEGENDARY/MYTHICAL (39/39, image/gif, served over Cloudflare). Used for
// Boss Raid intros so the animation always genuinely matches whichever boss actually rolled,
// instead of one hardcoded clip for every species (tried once, reverted — visibly mismatched
// whenever RNG picked a different boss).
function getAnimatedSpriteUrl(speciesName) {
  const normalized = speciesName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `https://play.pokemonshowdown.com/sprites/ani/${normalized}.gif`;
}

function formatTypeLine(types) {
  return types.map((t) => `${t} ${TYPE_EMOJI[t] ?? ''}`).join(' / ') + (types.length > 1 ? ' Types' : ' Type');
}

// Genderless species (legendaries/mythicals) return null; others are 50/50.
function rollGender(genderless) {
  if (genderless) return null;
  return Math.random() < 0.5 ? '♂️' : '♀️';
}

// `themeSet` is an optional Set of species names from an active seasonal event — when given,
// the name is far more likely to come from that set (see pickBiased), but rarity odds and
// XP/coins/expiry are completely unaffected.
function rollSpawnWithRarity(rarity, themeSet = null) {
  let name;
  switch (rarity) {
    case 'shiny':
      name = pickBiased(SHINY_CANDIDATES, themeSet);
      break;
    case 'legendary':
    case 'shiny_legendary':
      name = pickBiased(LEGENDARY, themeSet);
      break;
    case 'mythical':
    case 'shiny_mythical':
      name = pickBiased(MYTHICAL, themeSet);
      break;
    case 'rare':
      name = pickBiased(RARE, themeSet);
      break;
    default:
      name = pickBiased(COMMON, themeSet);
  }
  const entry = getPokedexEntry(name);
  const isShiny = rarity === 'shiny' || rarity === 'shiny_legendary' || rarity === 'shiny_mythical';
  return {
    name,
    rarity,
    types: entry.types,
    gender: rollGender(entry.genderless),
    stars: RARITY_STARS[rarity],
    xp: RARITY_XP[rarity],
    coins: RARITY_COINS[rarity],
    imageUrl: getArtworkUrl(entry.dexNumber, isShiny),
  };
}

function rollSpawn(themeSet = null) {
  return rollSpawnWithRarity(pickRarity(), themeSet);
}

function pickMysteryPokemon() {
  return pick([...COMMON, ...RARE]);
}

// Builds a spawn for one exact, known Pokemon (used to guarantee the daily mission's
// target actually appears, rather than leaving it to chance on the random spawn roll).
function rollSpawnForName(name) {
  const rarity = COMMON.includes(name) ? 'common' : RARE.includes(name) ? 'rare' : 'common';
  const entry = getPokedexEntry(name);
  return {
    name,
    rarity,
    types: entry.types,
    gender: rollGender(entry.genderless),
    stars: RARITY_STARS[rarity],
    xp: RARITY_XP[rarity],
    coins: RARITY_COINS[rarity],
    imageUrl: getArtworkUrl(entry.dexNumber, rarity === 'shiny'),
  };
}

module.exports = {
  COMMON,
  RARE,
  LEGENDARY,
  MYTHICAL,
  RARITY_XP,
  RARITY_COINS,
  RARITY_STARS,
  TYPE_EMOJI,
  rollSpawn,
  rollSpawnWithRarity,
  rollSpawnForName,
  pickMysteryPokemon,
  getPokedexEntry,
  formatTypeLine,
  getArtworkUrl,
  getAnimatedSpriteUrl,
  getBaseRarity,
  resolveSpeciesName,
};
