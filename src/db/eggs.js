const db = require('./index');

const getStmt = db.prepare('SELECT * FROM egg_incubation WHERE user_id = ?');
const insertStmt = db.prepare(`
  INSERT INTO egg_incubation (user_id, egg_key, started_at, ready_at, chat_id, notified) VALUES (?, ?, ?, ?, ?, 0)
`);
const deleteStmt = db.prepare('DELETE FROM egg_incubation WHERE user_id = ?');
// Ready, not yet pinged, and we know where to ping them — used by the reminder sweep.
const listReadyUnnotifiedStmt = db.prepare(`
  SELECT * FROM egg_incubation WHERE notified = 0 AND ready_at <= ? AND chat_id IS NOT NULL
`);
const markNotifiedStmt = db.prepare('UPDATE egg_incubation SET notified = 1 WHERE user_id = ?');

function getIncubation(userId) {
  return getStmt.get(userId);
}

// Only call after confirming getIncubation(userId) is null — one egg at a time. `chatId` is
// the group to notify in once it's ready (wherever /egg was run to start it).
function startIncubation(userId, eggKey, durationMs, chatId) {
  const now = new Date();
  const readyAt = new Date(now.getTime() + durationMs);
  insertStmt.run(userId, eggKey, now.toISOString(), readyAt.toISOString(), chatId ?? null);
}

function clearIncubation(userId) {
  deleteStmt.run(userId);
}

function isReady(incubation) {
  return Boolean(incubation) && Date.parse(incubation.ready_at) <= Date.now();
}

function listReadyUnnotified() {
  return listReadyUnnotifiedStmt.all(new Date().toISOString());
}

function markNotified(userId) {
  markNotifiedStmt.run(userId);
}

module.exports = { getIncubation, startIncubation, clearIncubation, isReady, listReadyUnnotified, markNotified };
