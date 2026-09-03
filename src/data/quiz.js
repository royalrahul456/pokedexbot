const { COMMON, RARE, LEGENDARY, MYTHICAL } = require('./pokemon');

// Auto-generated "Which Pokémon is this?" image questions built straight from our own
// Pokédex data — every entry gets one, so this grows automatically as the roster grows.
// `guessName` tells the quiz feature which artwork to attach to the question.
function buildImageQuestions(names, difficulty) {
  return names.map((name) => ({
    difficulty,
    question: '🖼️ Which Pokémon is this?',
    answers: [name.toLowerCase()],
    guessName: name,
  }));
}

const IMAGE_QUESTIONS = [
  ...buildImageQuestions(COMMON, 1),
  ...buildImageQuestions(RARE, 2),
  ...buildImageQuestions(LEGENDARY, 3),
  ...buildImageQuestions(MYTHICAL, 3),
];

// difficulty: 1 (easy) - 3 (hard). Answers matched case-insensitively, trimmed.
const QUESTIONS = [
  // ── Easy: types & starters ─────────────────────────────────────────────
  { difficulty: 1, question: 'Which type is Pikachu?', answers: ['electric'] },
  { difficulty: 1, question: 'What type is Charmander?', answers: ['fire'] },
  { difficulty: 1, question: 'What type is Squirtle?', answers: ['water'] },
  { difficulty: 1, question: 'What type is Bulbasaur (its primary type)?', answers: ['grass'] },
  { difficulty: 1, question: 'Water is super effective against which type?', answers: ['fire'] },
  { difficulty: 1, question: 'Fire is super effective against which type?', answers: ['grass'] },
  { difficulty: 1, question: 'Grass is super effective against which type?', answers: ['water'] },
  { difficulty: 1, question: 'Electric-type moves have no effect on which type?', answers: ['ground'] },
  { difficulty: 1, question: 'What type of Pokémon is immune to Poison-type moves?', answers: ['steel'] },
  { difficulty: 1, question: 'Ghost-type moves have no effect on which type?', answers: ['normal'] },
  { difficulty: 1, question: 'What does a Water Stone evolve Eevee into?', answers: ['vaporeon'] },
  { difficulty: 1, question: 'What does a Thunder Stone evolve Eevee into?', answers: ['jolteon'] },
  { difficulty: 1, question: 'What does a Fire Stone evolve Eevee into?', answers: ['flareon'] },
  { difficulty: 1, question: "What's the very first Pokémon in the National Pokédex (#001)?", answers: ['bulbasaur'] },
  { difficulty: 1, question: 'Which Pokémon is famous for saying its own name and living in a yellow round shape?', answers: ['pikachu'] },
  { difficulty: 1, question: "Ash Ketchum's signature partner Pokémon is which one?", answers: ['pikachu'] },
  { difficulty: 1, question: 'What type is a Geodude?', answers: ['rock'] },
  { difficulty: 1, question: 'What type is Magikarp?', answers: ['water'] },
  { difficulty: 1, question: 'Which Pokémon is known as the "Psi Pokémon" and teleports away using Psychic power?', answers: ['abra'] },
  { difficulty: 1, question: 'What color is a Shiny Gyarados usually depicted as (instead of blue)?', answers: ['red'] },

  // ── Easy/Medium: evolutions ────────────────────────────────────────────
  { difficulty: 1, question: 'Which Pokémon evolves into Gallade?', answers: ['kirlia'] },
  { difficulty: 1, question: 'What does Eevee evolve into with high friendship during the day?', answers: ['espeon'] },
  { difficulty: 1, question: 'What does Eevee evolve into with high friendship at night?', answers: ['umbreon'] },
  { difficulty: 2, question: 'Magikarp evolves into which fearsome Pokémon?', answers: ['gyarados'] },
  { difficulty: 2, question: 'What is the final evolution of Charmander?', answers: ['charizard'] },
  { difficulty: 2, question: 'What is the final evolution of Squirtle?', answers: ['blastoise'] },
  { difficulty: 2, question: 'What is the final evolution of Bulbasaur?', answers: ['venusaur'] },
  { difficulty: 2, question: 'Which Pokémon evolves into Alakazam?', answers: ['kadabra'] },
  { difficulty: 2, question: 'Which baby Pokémon evolves into Chansey?', answers: ['happiny'] },
  { difficulty: 2, question: 'Riolu evolves into which Fighting/Steel-type?', answers: ['lucario'] },
  { difficulty: 2, question: 'Feebas evolves into which elegant Water/Dragon-type?', answers: ['milotic'] },
  { difficulty: 2, question: 'What does Scyther evolve into when traded holding a Metal Coat?', answers: ['scizor'] },
  { difficulty: 2, question: 'What does Onix evolve into when traded holding a Metal Coat?', answers: ['steelix'] },
  { difficulty: 2, question: 'Clamperl evolves into Huntail or which other Pokémon, depending on the item used?', answers: ['gorebyss'] },

  // ── Medium: legendaries, mythicals, pseudo-legendaries ─────────────────
  { difficulty: 2, question: 'Which Pokémon is known as the Mythical psychic-type that resembles a small pink cat?', answers: ['mew'] },
  { difficulty: 2, question: "Which legendary bird represents ice, and is one of Kanto's original three legendary birds?", answers: ['articuno'] },
  { difficulty: 2, question: "Which legendary bird represents electricity, one of Kanto's original three?", answers: ['zapdos'] },
  { difficulty: 2, question: "Which legendary bird represents fire, one of Kanto's original three?", answers: ['moltres'] },
  { difficulty: 2, question: 'Which Legendary is famously found asleep on top of the Sprout Tower / in a warehouse, known as the Sleeping Pokémon?', answers: ['snorlax'] },
  { difficulty: 2, question: 'Which Pokémon has 600 base stat total and is a pseudo-legendary Dragon starter-line from Kalos?', answers: ['dragonite', 'tyranitar', 'garchomp', 'salamence', 'metagross', 'goodra', 'hydreigon', 'dragapult', 'kommo-o'] },
  { difficulty: 2, question: 'What is the Japanese-mythology-inspired Legendary that represents the sun and can transform into its Origin Forme?', answers: ['ho-oh', 'hooh'] },
  { difficulty: 2, question: 'Which Legendary represents the moon in the Ho-Oh/Lugia duo from Gen 2?', answers: ['lugia'] },
  { difficulty: 2, question: 'Which Legendary trio member represents the land and can transform into Primal form in Omega Ruby?', answers: ['groudon'] },
  { difficulty: 2, question: 'Which Legendary trio member represents the sea and can transform into Primal form in Alpha Sapphire?', answers: ['kyogre'] },
  { difficulty: 2, question: 'Which Legendary represents both land and sea, and is the third member of the Hoenn weather trio?', answers: ['rayquaza'] },

  // ── Hard: legendaries deep cuts, Ultra Beasts, obscure facts ───────────
  { difficulty: 3, question: 'Which legendary Pokémon is known as the "Sky High Pokémon" and can Mega Evolve into a Dragon/Flying type?', answers: ['rayquaza'] },
  { difficulty: 3, question: "Which Ultra Beast's code name is UB-01?", answers: ['nihilego'] },
  { difficulty: 3, question: 'Which Ultra Beast is known as UB-02 Absorption?', answers: ['pheromosa'] },
  { difficulty: 3, question: 'What is the signature Fighting-type move of Lucario used as a Z-Move ingredient?', answers: ['aura sphere'] },
  { difficulty: 3, question: 'Which Legendary Pokémon is said to control time?', answers: ['dialga'] },
  { difficulty: 3, question: 'Which Legendary Pokémon is said to control space?', answers: ['palkia'] },
  { difficulty: 3, question: 'Which Legendary Pokémon is said to control antimatter/distortion and resides in the Distortion World?', answers: ['giratina'] },
  { difficulty: 3, question: 'Which Mythical Pokémon is said to have created the universe with 1,000 arms?', answers: ['arceus'] },
  { difficulty: 3, question: 'What is the name of the Mythical Pokémon associated with nightmares and Dream Mist?', answers: ['darkrai'] },
  { difficulty: 3, question: 'Which Sword/Shield Legendary wields a mighty sword and is the box art cover of Pokémon Sword?', answers: ['zacian'] },
  { difficulty: 3, question: 'What is the signature Ground-type move used by Groudon as its most powerful attack?', answers: ['precipice blades'] },
  { difficulty: 3, question: "Which move is Kyogre's iconic Water-type signature attack?", answers: ['origin pulse'] },

  // ── Pokémon GO specific ─────────────────────────────────────────────────
  { difficulty: 1, question: 'In Pokémon GO, what do you call the egg-hatching companion feature where a Pokémon walks with you?', answers: ['buddy', 'buddy pokemon'] },
  { difficulty: 1, question: 'What color glow appears around a Raid Gym when a raid is about to start?', answers: ['blue', 'orange', 'red', 'purple'] },
  { difficulty: 1, question: 'What is the item called that lets you evolve certain Pokémon without candy, like Sylveon or Black Augurite users?', answers: ['special item', 'evolution item'] },
  { difficulty: 2, question: 'In Pokémon GO, what is the name of the monthly event that boosts a specific featured Pokémon\'s shiny rate and spawns?', answers: ['community day'] },
  { difficulty: 2, question: 'What currency do you spend to re-battle the same Raid Gym instantly in Pokémon GO?', answers: ['premium raid pass', 'raid pass'] },
  { difficulty: 2, question: 'What is the maximum CP-boosting weather condition called for Electric, Rock and Steel types combined in Pokémon GO weather boosts?', answers: ['rain'] },
  { difficulty: 2, question: 'What do trainers call the extremely rare, high-IV, sometimes-shiny catch celebrated with a special animation?', answers: ['lucky pokemon', 'lucky'] },
  { difficulty: 3, question: 'What is the name of the resource used to power up and evolve Pokémon that is Pokémon-species-specific?', answers: ['candy'] },
  { difficulty: 3, question: "What's the technical term for a Pokémon's individual values that determine its stat potential in GO (out of 15/15/15)?", answers: ['iv', 'ivs', 'individual values'] },

  // ── Moves & abilities ───────────────────────────────────────────────────
  { difficulty: 1, question: "What is Pikachu's signature Electric-type move?", answers: ['thunderbolt'] },
  { difficulty: 2, question: 'What move does Charizard learn as its strongest Fire-type Elite Charged Attack in GO, tied to Mega Charizard Y?', answers: ['blast burn'] },
  { difficulty: 2, question: 'Which move is known for always causing the user to flinch-target and is a signature Normal-type move of Snorlax and Kangaskhan?', answers: ['body slam'] },
  { difficulty: 2, question: 'What is the name of the move that never misses and always causes the target to fall asleep, made famous by Jigglypuff\'s song?', answers: ['sing'] },
  { difficulty: 3, question: 'Which Ability, common on Ghost types like Gengar, prevents the Pokémon from being hit by Normal or Fighting-type moves?', answers: ['levitate'] },
  { difficulty: 3, question: 'What is the name of Metagross and Bronzong\'s shared ability that boosts their Speed stat in Trick Room?', answers: ['clear body', 'levitate'] },

  // ── Fun / quirky facts ──────────────────────────────────────────────────
  { difficulty: 1, question: 'Which Pokémon is literally a pile of sludge/garbage and is a Poison-type?', answers: ['grimer', 'muk', 'trubbish', 'garbodor'] },
  { difficulty: 1, question: 'Which Pokémon is based on a ghost bedsheet and is a Ghost/Poison-type?', answers: ['gastly', 'haunter', 'gengar'] },
  { difficulty: 1, question: 'Which Fire/Fighting-type starter has an iconic flaming rear end?', answers: ['infernape', 'chimchar', 'monferno'] },
  { difficulty: 1, question: 'Which Pokémon is known for constantly sleeping and having a Dream Eater-style gimmick, evolving from Munna?', answers: ['musharna'] },
  { difficulty: 1, question: 'Which tiny Rock/Ground Pokémon looks exactly like a pile of boulders stacked up?', answers: ['geodude', 'graveler', 'golem'] },
  { difficulty: 2, question: 'Which Pokémon species is famously the subject of jokes for being "useless" due to Splash being its only starting move?', answers: ['magikarp'] },
  { difficulty: 2, question: 'What is the nickname trainers often give to Ditto for its role in breeding, since it can pair with almost anything?', answers: ['transform pokemon', 'transform'] },
  { difficulty: 2, question: "Which Pokémon's Pokédex entries claim it can rewrite its own memories and erase people's memories with Lavender Town lore?", answers: ['mr. mime', 'mr mime', 'cubone', 'marowak'] },
  { difficulty: 1, question: 'Which adorable Fairy/Normal-type spins cotton and is famous for being confused with real sheep in real life?', answers: ['mareep', 'flaaffy', 'ampharos', 'wooloo'] },

  // ── More types/generations trivia ───────────────────────────────────────
  { difficulty: 1, question: 'How many core types currently exist in the Pokémon type chart (as of Gen 6 onward, including Fairy)?', answers: ['18'] },
  { difficulty: 2, question: 'Which type was introduced in Generation 6 (X and Y) to balance out Dragon-types?', answers: ['fairy'] },
  { difficulty: 2, question: 'Which type combination is famously the only one immune to both Poison and Ground moves?', answers: ['flying/steel', 'steel/flying'] },
  { difficulty: 1, question: 'What is the region called where the very first Pokémon games (Red/Blue/Yellow) take place?', answers: ['kanto'] },
  { difficulty: 1, question: 'What is the region called in Pokémon Gold, Silver and Crystal?', answers: ['johto'] },
  { difficulty: 2, question: 'What is the region called in Pokémon Ruby, Sapphire and Emerald?', answers: ['hoenn'] },
  { difficulty: 2, question: 'What is the region called in Pokémon Sword and Shield?', answers: ['galar'] },
  { difficulty: 2, question: 'What is the region called in Pokémon Scarlet and Violet?', answers: ['paldea'] },

  ...IMAGE_QUESTIONS,
];

function pickQuestion(maxDifficulty = 3) {
  const pool = QUESTIONS.filter((q) => q.difficulty <= maxDifficulty);
  return pool[Math.floor(Math.random() * pool.length)];
}

function isCorrect(question, text) {
  const normalized = text.trim().toLowerCase();
  return question.answers.some((a) => a.toLowerCase() === normalized);
}

module.exports = { QUESTIONS, pickQuestion, isCorrect };
