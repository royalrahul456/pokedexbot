const db = require('./index');

const CATEGORIES = ['rare', 'legendary', 'mythical', 'shiny', 'shiny_legendary', 'shiny_mythical', 'gigantamax', 'dynamax'];

const insertStmt = db.prepare(`
  INSERT INTO store_listings (species_name, shiny, category, price_gold, event_label, available_from, available_until, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const getStmt = db.prepare('SELECT * FROM store_listings WHERE id = ?');
const listAllStmt = db.prepare('SELECT * FROM store_listings ORDER BY category, species_name');
const listByCategoryStmt = db.prepare(
  'SELECT * FROM store_listings WHERE category = ? ORDER BY featured DESC, species_name'
);
// "Available now" = enabled AND (no window, or now falls within available_from/available_until).
const listAvailableByCategoryStmt = db.prepare(`
  SELECT * FROM store_listings
  WHERE category = ? AND enabled = 1
    AND (available_from IS NULL OR available_from <= datetime('now'))
    AND (available_until IS NULL OR available_until >= datetime('now'))
  ORDER BY featured DESC, species_name
`);
const setEnabledStmt = db.prepare('UPDATE store_listings SET enabled = ? WHERE id = ?');
const setFeaturedStmt = db.prepare('UPDATE store_listings SET featured = ? WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM store_listings WHERE id = ?');

function addListing(species_name, shiny, category, price_gold, opts = {}) {
  const { eventLabel = null, availableFrom = null, availableUntil = null, createdBy = null } = opts;
  const result = insertStmt.run(species_name, shiny ? 1 : 0, category, price_gold, eventLabel, availableFrom, availableUntil, createdBy);
  return getStmt.get(Number(result.lastInsertRowid));
}

function getListing(id) {
  return getStmt.get(id);
}

function listAll() {
  return listAllStmt.all();
}

function listByCategory(category) {
  return listByCategoryStmt.all(category);
}

// Only what a player should actually see in /store: enabled and inside its availability window.
function listAvailableByCategory(category) {
  return listAvailableByCategoryStmt.all(category);
}

function updateListing(id, fields) {
  const current = getListing(id);
  if (!current) return null;
  const priceGold = fields.priceGold ?? current.price_gold;
  db.prepare('UPDATE store_listings SET price_gold = ? WHERE id = ?').run(priceGold, id);
  return getListing(id);
}

function setEnabled(id, enabled) {
  setEnabledStmt.run(enabled ? 1 : 0, id);
  return getListing(id);
}

function setFeatured(id, featured) {
  setFeaturedStmt.run(featured ? 1 : 0, id);
  return getListing(id);
}

function deleteListing(id) {
  deleteStmt.run(id);
}

module.exports = {
  CATEGORIES,
  addListing,
  getListing,
  listAll,
  listByCategory,
  listAvailableByCategory,
  updateListing,
  setEnabled,
  setFeatured,
  deleteListing,
};
