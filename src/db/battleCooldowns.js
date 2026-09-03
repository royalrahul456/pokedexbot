const db = require('./index');

const insertStmt = db.prepare(`
  INSERT INTO battle_cooldown_instances (user_id, species_name, shiny, cooldown_until)
  VALUES (?, ?, ?, ?)
`);
const countRestingStmt = db.prepare(`
  SELECT COUNT(*) AS c FROM battle_cooldown_instances
  WHERE user_id = ? AND species_name = ? AND shiny = ? AND cooldown_until > ?
`);
const nextCooldownUntilStmt = db.prepare(`
  SELECT MIN(cooldown_until) AS until FROM battle_cooldown_instances
  WHERE user_id = ? AND species_name = ? AND shiny = ? AND cooldown_until > ?
`);
// Opportunistic cleanup of long-expired rows so the table doesn't grow forever — safe to run
// on every insert since it only ever removes rows that are well past being relevant.
const cleanupStmt = db.prepare('DELETE FROM battle_cooldown_instances WHERE cooldown_until <= ?');

const FAINT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — default, used by /battle

// How many copies of this species+shiny are CURRENTLY resting (one row per resting copy).
function restingCount(userId, speciesName, shiny) {
  return countRestingStmt.get(userId, speciesName, shiny ? 1 : 0, new Date().toISOString()).c;
}

// Quantity-aware: a species is only "resting" (fully unusable) once EVERY owned copy is on
// cooldown — a trainer with 2 Ho-Oh and 1 resting copy can still use the other one.
// `ownedQuantity` should be the trainer's real pokemon_collection.quantity for this species;
// defaults to 1 for any caller that genuinely only ever deals with a single copy.
function isResting(userId, speciesName, shiny, ownedQuantity = 1) {
  return restingCount(userId, speciesName, shiny) >= ownedQuantity;
}

// Earliest moment any currently-resting copy of this species becomes free — used for display
// ("ready again in..."), not for eligibility checks (use isResting/restingCount for those).
function getCooldownUntil(userId, speciesName, shiny) {
  const row = nextCooldownUntilStmt.get(userId, speciesName, shiny ? 1 : 0, new Date().toISOString());
  return row.until || null;
}

// `durationMs` defaults to the 1v1 battle faint cooldown — raid faints pass their own, shorter
// duration. Inserts a NEW row per faint (rather than upserting) so multiple owned copies of the
// same species can rest independently and concurrently.
function applyFaintCooldown(userId, speciesName, shiny, durationMs = FAINT_COOLDOWN_MS) {
  const until = new Date(Date.now() + durationMs).toISOString();
  insertStmt.run(userId, speciesName, shiny ? 1 : 0, until);
  cleanupStmt.run(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
}

module.exports = { isResting, restingCount, getCooldownUntil, applyFaintCooldown, FAINT_COOLDOWN_MS };
