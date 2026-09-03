const db = require('./index');

const getStmt = db.prepare(
  'SELECT last_used FROM cooldowns WHERE chat_id = ? AND user_id = ? AND action_key = ?'
);
const upsertStmt = db.prepare(`
  INSERT INTO cooldowns (chat_id, user_id, action_key, last_used)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(chat_id, user_id, action_key) DO UPDATE SET last_used = excluded.last_used
`);

// Returns { ready: true } or { ready: false, msRemaining }
function checkCooldown(chatId, userId, actionKey, cooldownMs) {
  const row = getStmt.get(chatId, userId, actionKey);
  if (!row) return { ready: true };
  const elapsed = Date.now() - Date.parse(row.last_used);
  if (elapsed >= cooldownMs) return { ready: true };
  return { ready: false, msRemaining: cooldownMs - elapsed };
}

function useCooldown(chatId, userId, actionKey) {
  upsertStmt.run(chatId, userId, actionKey, new Date().toISOString());
}

module.exports = { checkCooldown, useCooldown };
