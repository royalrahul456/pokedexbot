const db = require('./index');

const getStmt = db.prepare('SELECT * FROM active_spawns WHERE chat_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO active_spawns (chat_id, pokemon_name, rarity, message_id, created_at, caught_by, expired, gender)
  VALUES (?, ?, ?, ?, datetime('now'), NULL, 0, ?)
  ON CONFLICT(chat_id) DO UPDATE SET
    pokemon_name = excluded.pokemon_name,
    rarity = excluded.rarity,
    message_id = excluded.message_id,
    created_at = excluded.created_at,
    caught_by = NULL,
    expired = 0,
    gender = excluded.gender
`);
const setMessageIdStmt = db.prepare('UPDATE active_spawns SET message_id = ? WHERE chat_id = ?');
// Atomic claim: only succeeds if nobody has caught it yet and it hasn't expired.
const claimStmt = db.prepare(
  'UPDATE active_spawns SET caught_by = ? WHERE chat_id = ? AND caught_by IS NULL AND expired = 0'
);
// Atomic expiry: only succeeds if this exact spawn message is still uncaught, so a
// stale expiry timer can never wipe out a newer spawn that already replaced it.
const expireStmt = db.prepare(
  'UPDATE active_spawns SET expired = 1 WHERE chat_id = ? AND message_id = ? AND caught_by IS NULL AND expired = 0'
);

function createSpawn(chatId, pokemonName, rarity, gender) {
  upsertStmt.run(chatId, pokemonName, rarity, null, gender ?? null);
}

function setSpawnMessageId(chatId, messageId) {
  setMessageIdStmt.run(messageId, chatId);
}

function getActiveSpawn(chatId) {
  return getStmt.get(chatId);
}

// Returns true if this user won the claim race, false if someone beat them to it (or it expired).
function tryClaimSpawn(chatId, userId) {
  const result = claimStmt.run(userId, chatId);
  return result.changes > 0;
}

// Returns true if this call is the one that actually expired it (so the caller should
// edit the Telegram message); false if it was already caught or already expired.
function tryExpireSpawn(chatId, messageId) {
  const result = expireStmt.run(chatId, messageId);
  return result.changes > 0;
}

module.exports = { createSpawn, setSpawnMessageId, getActiveSpawn, tryClaimSpawn, tryExpireSpawn };
