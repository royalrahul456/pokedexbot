const db = require('./index');

const upsertTitleStmt = db.prepare(`
  INSERT INTO equipped_cosmetics (user_id, title_key) VALUES (?, ?)
  ON CONFLICT(user_id) DO UPDATE SET title_key = excluded.title_key
`);
const upsertBadgeStmt = db.prepare(`
  INSERT INTO equipped_cosmetics (user_id, badge_key) VALUES (?, ?)
  ON CONFLICT(user_id) DO UPDATE SET badge_key = excluded.badge_key
`);
const getStmt = db.prepare('SELECT * FROM equipped_cosmetics WHERE user_id = ?');

function getEquipped(userId) {
  return getStmt.get(userId) || { user_id: userId, title_key: null, badge_key: null };
}

function setEquippedTitle(userId, titleKey) {
  upsertTitleStmt.run(userId, titleKey);
}

function setEquippedBadge(userId, badgeKey) {
  upsertBadgeStmt.run(userId, badgeKey);
}

module.exports = { getEquipped, setEquippedTitle, setEquippedBadge };
