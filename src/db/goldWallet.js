const db = require('./index');

const getStmt = db.prepare('SELECT gold FROM gold_wallet WHERE user_id = ?');
const upsertZeroStmt = db.prepare(`
  INSERT INTO gold_wallet (user_id, gold, updated_at) VALUES (?, 0, datetime('now'))
  ON CONFLICT(user_id) DO NOTHING
`);
const addStmt = db.prepare(`
  INSERT INTO gold_wallet (user_id, gold, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET gold = gold + excluded.gold, updated_at = datetime('now')
`);
const insertTxnStmt = db.prepare(`
  INSERT INTO gold_transactions (user_id, amount, reason, admin_id, note, listing_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function getBalance(userId) {
  const row = getStmt.get(userId);
  return row ? row.gold : 0;
}

// Credits Gold (positive amount) and logs the transaction. `reason` is a short machine tag
// (admin_grant | store_purchase | refund), `adminId` is who granted it for manual credits.
function credit(userId, amount, reason, adminId = null, note = null) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('credit amount must be a positive integer');
  upsertZeroStmt.run(userId);
  addStmt.run(userId, amount);
  insertTxnStmt.run(userId, amount, reason, adminId, note, null);
  return getBalance(userId);
}

// Atomic debit — checks balance first and returns false (no state change) rather than going
// negative. Never throws for insufficient funds; that's a normal, expected outcome for a
// purchase flow, not an error condition. `listingId` (set for store_purchase debits) lets the
// earnings dashboard attribute revenue back to a specific listing/species.
function debit(userId, amount, reason, note = null, listingId = null) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('debit amount must be a positive integer');
  upsertZeroStmt.run(userId);
  const current = getBalance(userId);
  if (current < amount) return false;
  addStmt.run(userId, -amount);
  insertTxnStmt.run(userId, -amount, reason, null, note, listingId);
  return true;
}

// ── Earnings dashboard (kept separate from gameplay Bot Stats — this is money, not XP) ──

// Total Gold ever manually granted by an admin — the real proxy for "Gold sold" since Gold is
// only ever credited after an off-platform payment, never earned through gameplay.
const totalGrantedStmt = db.prepare(
  "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM gold_transactions WHERE reason = 'admin_grant'"
);
function getGrantTotals() {
  const row = totalGrantedStmt.get();
  return { total: row.total, count: row.cnt };
}

// Total Gold spent by trainers in the store (debits are stored negative — flip sign for display).
const totalSpentStmt = db.prepare(
  "SELECT COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS cnt FROM gold_transactions WHERE reason = 'store_purchase'"
);
function getSpendTotals() {
  const row = totalSpentStmt.get();
  return { total: row.total, count: row.cnt };
}

const totalRefundedStmt = db.prepare(
  "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM gold_transactions WHERE reason = 'refund'"
);
function getRefundTotals() {
  const row = totalRefundedStmt.get();
  return { total: row.total, count: row.cnt };
}

// Gold currently sitting unspent in wallets — total granted minus total spent/refunded out.
const circulatingStmt = db.prepare('SELECT COALESCE(SUM(gold), 0) AS total FROM gold_wallet');
function getCirculatingTotal() {
  return circulatingStmt.get().total;
}

// Top-selling listings by revenue — joins store_listings so a since-deleted listing still
// shows its species/category (LEFT JOIN, COALESCE fallback) rather than dropping the row.
const topSellersStmt = db.prepare(`
  SELECT
    t.listing_id AS listingId,
    COALESCE(sl.species_name, 'Deleted listing #' || t.listing_id) AS speciesName,
    COALESCE(sl.shiny, 0) AS shiny,
    COALESCE(sl.category, 'unknown') AS category,
    COUNT(*) AS unitsSold,
    SUM(-t.amount) AS revenue
  FROM gold_transactions t
  LEFT JOIN store_listings sl ON sl.id = t.listing_id
  WHERE t.reason = 'store_purchase' AND t.listing_id IS NOT NULL
  GROUP BY t.listing_id
  ORDER BY revenue DESC
  LIMIT ?
`);
function getTopSellers(limit = 10) {
  return topSellersStmt.all(limit);
}

// Per-admin breakdown of who granted how much — useful for reconciling manual payments.
const grantsByAdminStmt = db.prepare(`
  SELECT admin_id AS adminId, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
  FROM gold_transactions
  WHERE reason = 'admin_grant'
  GROUP BY admin_id
  ORDER BY total DESC
`);
function getGrantsByAdmin() {
  return grantsByAdminStmt.all();
}

module.exports = {
  getBalance,
  credit,
  debit,
  getGrantTotals,
  getSpendTotals,
  getRefundTotals,
  getCirculatingTotal,
  getTopSellers,
  getGrantsByAdmin,
};
