const db = require('./index');

// Global per-user — items are the same for a trainer in every group (see schema.sql).
const upsertStmt = db.prepare(`
  INSERT INTO inventory (user_id, item_key, quantity) VALUES (?, ?, ?)
  ON CONFLICT(user_id, item_key) DO UPDATE SET quantity = quantity + excluded.quantity
`);
const listStmt = db.prepare('SELECT item_key, quantity FROM inventory WHERE user_id = ? AND quantity > 0');
const getQtyStmt = db.prepare('SELECT quantity FROM inventory WHERE user_id = ? AND item_key = ?');
const decrementStmt = db.prepare(
  'UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_key = ? AND quantity > 0'
);
const decrementByStmt = db.prepare(
  'UPDATE inventory SET quantity = quantity - ? WHERE user_id = ? AND item_key = ? AND quantity >= ?'
);
// Users active in a specific group (has a `users` row there) who currently hold at least
// one of the given global item — used by Lucky Draw to find entrants for a specific group.
const holdersInGroupStmt = db.prepare(`
  SELECT u.user_id, u.username
  FROM users u
  JOIN inventory i ON i.user_id = u.user_id
  WHERE u.chat_id = ? AND i.item_key = ? AND i.quantity > 0
`);

function addItem(userId, itemKey, quantity = 1) {
  upsertStmt.run(userId, itemKey, quantity);
}

function listInventory(userId) {
  return listStmt.all(userId);
}

function getItemQuantity(userId, itemKey) {
  return getQtyStmt.get(userId, itemKey)?.quantity || 0;
}

// Atomically removes one of the item; returns true if one was actually consumed.
function consumeItem(userId, itemKey) {
  const result = decrementStmt.run(userId, itemKey);
  return result.changes > 0;
}

function listHoldersInGroup(chatId, itemKey) {
  return holdersInGroupStmt.all(chatId, itemKey);
}

// Atomically removes `quantity` of the item; returns true only if the full amount was actually
// available and consumed (no partial removal on failure).
function removeQuantity(userId, itemKey, quantity) {
  const result = decrementByStmt.run(quantity, userId, itemKey, quantity);
  return result.changes > 0;
}

module.exports = { addItem, listInventory, getItemQuantity, consumeItem, listHoldersInGroup, removeQuantity };
