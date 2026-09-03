// Thin compatibility wrapper over pokemonInstances.js (the real per-instance source of truth
// since 2026-07-23). Kept as its own module — rather than updating every call site — so
// battle.js/bossRaid.js/breed.js/collection.js/friends.js/spawn.js/breeding.js/promoCodes.js
// need zero changes: they all only ever consumed the aggregate {species_name, shiny, quantity}
// shape, never a specific instance, so that shape is preserved exactly here.
const pokemonInstances = require('./pokemonInstances');

// Records one catch. `shiny` should reflect the actual visual variant caught (true when
// the spawn's rarity roll was 'shiny'), separate from the species' natural base_rarity.
function recordCatch(userId, speciesName, baseRarity, shiny) {
  pokemonInstances.createInstance(userId, speciesName, baseRarity, shiny, 'catch');
}

function listCollection(userId) {
  return pokemonInstances.listCollectionAggregate(userId);
}

function getCollectionStats(userId) {
  return pokemonInstances.getStats(userId);
}

module.exports = { recordCatch, listCollection, getCollectionStats };
