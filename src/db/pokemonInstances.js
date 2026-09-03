const crypto = require('crypto');
const db = require('./index');

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const existsStmt = db.prepare('SELECT 1 FROM pokemon_instances WHERE instance_id = ?');

// 8-char base36-ish ID via crypto.randomBytes, retried on the rare collision against the
// instance_id PK (birthday-bound collision odds are astronomically low at this ID space,
// but a retry loop is cheap insurance).
function generateInstanceId() {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    let id = '';
    for (let i = 0; i < 8; i++) id += ID_CHARS[bytes[i] % ID_CHARS.length];
    if (!existsStmt.get(id)) return id;
  }
}

const insertStmt = db.prepare(`
  INSERT INTO pokemon_instances (instance_id, user_id, species_name, base_rarity, shiny, source, acquired_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`);

// Records one individually-owned Pokémon. `shiny` should reflect the actual visual variant
// (true when the spawn's rarity roll was 'shiny'), separate from the species' natural
// base_rarity. `source` defaults to 'catch' — pass 'egg' | 'promo' | 'purchase' | 'breed' as
// appropriate so store purchases and future trading have an honest provenance trail.
function createInstance(userId, speciesName, baseRarity, shiny, source = 'catch') {
  const instanceId = generateInstanceId();
  insertStmt.run(instanceId, userId, speciesName, baseRarity, shiny ? 1 : 0, source);
  return instanceId;
}

const listInstancesStmt = db.prepare(
  'SELECT * FROM pokemon_instances WHERE user_id = ? ORDER BY acquired_at DESC'
);

// Raw individual rows — used by the store's "your purchases" view and any future per-copy
// picker. Not consumed by existing aggregate-only pickers (battle/raid/breed/collection).
function listInstances(userId) {
  return listInstancesStmt.all(userId);
}

const aggregateStmt = db.prepare(`
  SELECT species_name, shiny, base_rarity, COUNT(*) AS quantity,
         MIN(acquired_at) AS first_caught_at, MAX(acquired_at) AS last_caught_at
  FROM pokemon_instances
  WHERE user_id = ?
  GROUP BY species_name, shiny
`);

// Same shape the old pokemon_collection table returned — this is what makes the per-instance
// rewrite additive rather than a breaking change for every existing consumer.
function listCollectionAggregate(userId) {
  return aggregateStmt.all(userId);
}

const countDistinctStmt = db.prepare(
  'SELECT COUNT(DISTINCT species_name || \'|\' || shiny) AS cnt FROM pokemon_instances WHERE user_id = ?'
);
const countTotalStmt = db.prepare('SELECT COUNT(*) AS cnt FROM pokemon_instances WHERE user_id = ?');

function getStats(userId) {
  return {
    distinctSpecies: countDistinctStmt.get(userId).cnt,
    totalCaught: countTotalStmt.get(userId).cnt,
  };
}

module.exports = {
  generateInstanceId,
  createInstance,
  listInstances,
  listCollectionAggregate,
  getStats,
};
