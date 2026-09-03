const db = require('./index');

const upsertStmt = db.prepare(`
  INSERT INTO groups (chat_id, title, active) VALUES (?, ?, 1)
  ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title, active = 1
`);
const listActiveStmt = db.prepare('SELECT * FROM groups WHERE active = 1');
const countAllStmt = db.prepare('SELECT COUNT(*) AS c FROM groups');
const countActiveStmt = db.prepare('SELECT COUNT(*) AS c FROM groups WHERE active = 1');
const setActiveStmt = db.prepare('UPDATE groups SET active = ? WHERE chat_id = ?');
const getGroupStmt = db.prepare('SELECT * FROM groups WHERE chat_id = ?');
const setAutopromoStmt = db.prepare('UPDATE groups SET autopromo_enabled = ? WHERE chat_id = ?');
const setPromoTextStmt = db.prepare('UPDATE groups SET promo_text = ? WHERE chat_id = ?');

function registerGroup(chatId, title) {
  upsertStmt.run(chatId, title || null);
}

function listActiveGroups() {
  return listActiveStmt.all();
}

function countAllGroups() {
  return countAllStmt.get().c;
}

function countActiveGroups() {
  return countActiveStmt.get().c;
}

function setGroupActive(chatId, active) {
  setActiveStmt.run(active ? 1 : 0, chatId);
}

function getGroup(chatId) {
  return getGroupStmt.get(chatId);
}

// Returns the new enabled state after toggling.
function toggleAutopromo(chatId) {
  const group = getGroupStmt.get(chatId);
  const newState = group?.autopromo_enabled ? 0 : 1;
  setAutopromoStmt.run(newState, chatId);
  return newState === 1;
}

function setPromoText(chatId, text) {
  setPromoTextStmt.run(text, chatId);
}

module.exports = {
  registerGroup,
  listActiveGroups,
  countAllGroups,
  countActiveGroups,
  setGroupActive,
  getGroup,
  toggleAutopromo,
  setPromoText,
};
