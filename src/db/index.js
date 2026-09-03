const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('../config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// CREATE TABLE IF NOT EXISTS won't add new columns to a table created by an older
// version of this schema, so patch existing databases forward one column at a time.
for (const migration of [
  'ALTER TABLE active_spawns ADD COLUMN expired INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE active_spawns ADD COLUMN gender TEXT',
  'ALTER TABLE groups ADD COLUMN autopromo_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE groups ADD COLUMN promo_text TEXT',
  'ALTER TABLE users ADD COLUMN ttt_wins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN rps_wins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN scramble_wins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN whosthat_wins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN connect4_wins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN hangman_wins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE promo_codes ADD COLUMN item_key TEXT',
  'ALTER TABLE promo_codes ADD COLUMN item_qty INTEGER',
  'ALTER TABLE promo_codes ADD COLUMN pokemon_name TEXT',
  'ALTER TABLE promo_codes ADD COLUMN pokemon_shiny INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE promo_codes ADD COLUMN expires_at TEXT',
  'ALTER TABLE users ADD COLUMN battle_wins INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE egg_incubation ADD COLUMN chat_id INTEGER',
  'ALTER TABLE egg_incubation ADD COLUMN notified INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN raids_participated INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN raids_completed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN raid_damage_total INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN raid_mvp_awards INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN legendary_raids_won INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN mythical_raids_won INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN highest_raid_damage INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN raid_points INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN ultra_rare_raids_won INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE gold_transactions ADD COLUMN listing_id INTEGER',
]) {
  try {
    db.exec(migration);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

// One-time structural migration: older installs had `inventory` scoped per (chat_id, user_id).
// Items are now global per user, so collapse those rows by summing quantities per (user_id, item_key).
// CREATE TABLE IF NOT EXISTS above is a no-op on an existing table, so this has to happen explicitly.
const inventoryColumns = db.prepare("PRAGMA table_info(inventory)").all();
const inventoryHasChatId = inventoryColumns.some((c) => c.name === 'chat_id');
if (inventoryHasChatId) {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE inventory_global (
        user_id   INTEGER NOT NULL,
        item_key  TEXT NOT NULL,
        quantity  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, item_key)
      )
    `);
    db.exec(`
      INSERT INTO inventory_global (user_id, item_key, quantity)
      SELECT user_id, item_key, SUM(quantity) FROM inventory GROUP BY user_id, item_key
    `);
    db.exec('DROP TABLE inventory');
    db.exec('ALTER TABLE inventory_global RENAME TO inventory');
    db.exec('COMMIT');
    console.log('[migration] inventory table converted from per-group to global.');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// One-time structural migration: individual Pokémon ownership. `pokemon_collection` only ever
// stored a per-(user, species, shiny) quantity counter; `pokemon_instances` gives every single
// Pokémon its own permanent row/ID (needed so a store purchase is a real specific individual,
// not just +1 to a stack). Only runs once — once pokemon_instances has rows, this is skipped
// on every future startup even if pokemon_collection still exists.
const instancesEmpty = db.prepare('SELECT COUNT(*) AS cnt FROM pokemon_instances').get().cnt === 0;
const pokemonCollectionExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pokemon_collection'")
  .get();
if (instancesEmpty && pokemonCollectionExists) {
  const oldRows = db.prepare('SELECT * FROM pokemon_collection').all();
  const oldTotal = oldRows.reduce((sum, r) => sum + r.quantity, 0);
  if (oldTotal > 0) {
    db.exec('BEGIN');
    try {
      const insertInstance = db.prepare(`
        INSERT INTO pokemon_instances (instance_id, user_id, species_name, base_rarity, shiny, source, acquired_at)
        VALUES (?, ?, ?, ?, ?, 'catch', ?)
      `);
      const usedIds = new Set();
      const genId = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id;
        do {
          id = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        } while (usedIds.has(id));
        usedIds.add(id);
        return id;
      };
      for (const row of oldRows) {
        for (let i = 0; i < row.quantity; i++) {
          insertInstance.run(genId(), row.user_id, row.species_name, row.base_rarity, row.shiny, row.last_caught_at);
        }
      }
      const newTotal = db.prepare('SELECT COUNT(*) AS cnt FROM pokemon_instances').get().cnt;
      if (newTotal !== oldTotal) {
        throw new Error(`pokemon_instances migration count mismatch: old=${oldTotal} new=${newTotal}`);
      }
      db.exec('DROP TABLE pokemon_collection');
      db.exec('COMMIT');
      console.log(`[migration] pokemon_collection (${oldTotal} total) converted to pokemon_instances (per-instance tracking).`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } else {
    // No catches yet — nothing to migrate, just drop the now-superseded table.
    db.exec('DROP TABLE pokemon_collection');
  }
}

module.exports = db;
