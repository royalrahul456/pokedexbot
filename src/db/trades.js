const db = require('./index');
const pokemonInstances = require('./pokemonInstances');
const inventoryDb = require('./inventory');
const users = require('./users');

const SIDES = ['initiator', 'target'];

function otherSide(side) {
  return side === 'initiator' ? 'target' : 'initiator';
}

const activeForUserStmt = db.prepare(`
  SELECT * FROM trades
  WHERE status = 'pending' AND (initiator_id = ? OR target_id = ?)
  LIMIT 1
`);
function getActiveTradeForUser(userId) {
  return activeForUserStmt.get(userId, userId);
}

const insertTradeStmt = db.prepare(`
  INSERT INTO trades (chat_id, initiator_id, target_id) VALUES (?, ?, ?)
`);
function createTrade(chatId, initiatorId, targetId) {
  const result = insertTradeStmt.run(chatId, initiatorId, targetId);
  return getTrade(Number(result.lastInsertRowid));
}

const getTradeStmt = db.prepare('SELECT * FROM trades WHERE id = ?');
function getTrade(tradeId) {
  return getTradeStmt.get(tradeId);
}

const setMessageIdStmt = db.prepare('UPDATE trades SET message_id = ? WHERE id = ?');
function setMessageId(tradeId, messageId) {
  setMessageIdStmt.run(messageId, tradeId);
}

const touchStmt = db.prepare("UPDATE trades SET updated_at = datetime('now') WHERE id = ?");
const unreadyBothStmt = db.prepare(
  "UPDATE trades SET initiator_ready = 0, target_ready = 0, updated_at = datetime('now') WHERE id = ?"
);

// Resolves which side (`initiator`|`target`) a given userId is on for this trade, or null if
// they're not a participant.
function sideFor(trade, userId) {
  if (trade.initiator_id === userId) return 'initiator';
  if (trade.target_id === userId) return 'target';
  return null;
}

function userIdForSide(trade, side) {
  return side === 'initiator' ? trade.initiator_id : trade.target_id;
}

// ── Offer building ─────────────────────────────────────────────────────────

const insertOfferPokemonStmt = db.prepare(
  'INSERT OR IGNORE INTO trade_offer_pokemon (trade_id, side, instance_id) VALUES (?, ?, ?)'
);
const removeOfferPokemonStmt = db.prepare(
  'DELETE FROM trade_offer_pokemon WHERE trade_id = ? AND instance_id = ?'
);

// Adds a specific owned instance to `side`'s offer. Re-verifies live ownership (never trusts the
// client) — returns { ok: false, reason } if the instance isn't actually owned by that side's
// user, or is already in this same offer.
function addPokemonToOffer(tradeId, side, userId, instanceId) {
  const owned = db.prepare('SELECT user_id FROM pokemon_instances WHERE instance_id = ?').get(instanceId);
  if (!owned || owned.user_id !== userId) return { ok: false, reason: 'not_owned' };
  const already = db
    .prepare('SELECT 1 FROM trade_offer_pokemon WHERE trade_id = ? AND instance_id = ?')
    .get(tradeId, instanceId);
  if (already) return { ok: false, reason: 'already_offered' };
  insertOfferPokemonStmt.run(tradeId, side, instanceId);
  unreadyBothStmt.run(tradeId);
  return { ok: true };
}

function removePokemonFromOffer(tradeId, instanceId) {
  removeOfferPokemonStmt.run(tradeId, instanceId);
  unreadyBothStmt.run(tradeId);
}

const setItemQtyStmt = db.prepare(`
  INSERT INTO trade_offer_items (trade_id, side, item_key, quantity) VALUES (?, ?, ?, ?)
  ON CONFLICT(trade_id, side, item_key) DO UPDATE SET quantity = excluded.quantity
`);
const removeItemStmt = db.prepare('DELETE FROM trade_offer_items WHERE trade_id = ? AND side = ? AND item_key = ?');

// Sets (not adds) how many of an item `side` is offering. quantity <= 0 removes it from the
// offer entirely. Re-verifies the offering user actually owns at least that many right now.
function setItemInOffer(tradeId, side, userId, itemKey, quantity) {
  if (quantity <= 0) {
    removeItemStmt.run(tradeId, side, itemKey);
    unreadyBothStmt.run(tradeId);
    return { ok: true };
  }
  const owned = inventoryDb.getItemQuantity(userId, itemKey);
  if (owned < quantity) return { ok: false, reason: 'not_enough' };
  setItemQtyStmt.run(tradeId, side, itemKey, quantity);
  unreadyBothStmt.run(tradeId);
  return { ok: true };
}

// Sets (not adds) how much Coin `side` is offering, in the trade's own group economy.
function setCoinsInOffer(tradeId, side, userId, chatId, amount) {
  if (!Number.isInteger(amount) || amount < 0) return { ok: false, reason: 'invalid_amount' };
  const profile = users.getProfile(chatId, userId);
  const balance = profile ? profile.coins : 0;
  if (amount > balance) return { ok: false, reason: 'not_enough' };
  const column = side === 'initiator' ? 'initiator_coins' : 'target_coins';
  db.prepare(`UPDATE trades SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(amount, tradeId);
  unreadyBothStmt.run(tradeId);
  return { ok: true };
}

const listOfferPokemonStmt = db.prepare(`
  SELECT pi.instance_id, pi.species_name, pi.shiny, pi.base_rarity
  FROM trade_offer_pokemon top
  JOIN pokemon_instances pi ON pi.instance_id = top.instance_id
  WHERE top.trade_id = ? AND top.side = ?
`);
const listOfferItemsStmt = db.prepare(
  'SELECT item_key, quantity FROM trade_offer_items WHERE trade_id = ? AND side = ?'
);

// Full snapshot of one side's current offer — used both for the API response and for the final
// execute-time re-validation.
function getOffer(tradeId, side) {
  return {
    pokemon: listOfferPokemonStmt.all(tradeId, side),
    items: listOfferItemsStmt.all(tradeId, side),
  };
}

const setReadyStmt = (side) =>
  db.prepare(`UPDATE trades SET ${side}_ready = ?, updated_at = datetime('now') WHERE id = ?`);
const initiatorReadyStmt = setReadyStmt('initiator');
const targetReadyStmt = setReadyStmt('target');

function setReady(tradeId, side, ready) {
  (side === 'initiator' ? initiatorReadyStmt : targetReadyStmt).run(ready ? 1 : 0, tradeId);
}

function setStatus(tradeId, status) {
  db.prepare("UPDATE trades SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, tradeId);
}

// ── Execution ────────────────────────────────────────────────────────────

// Re-validates everything live (ownership can drift between "offer built" and "both readied up"
// — e.g. an item got used elsewhere) and, only if every single line item on both sides still
// checks out, executes the whole trade atomically: Pokémon instances change owner, items move
// inventories, Coins move within the trade's group economy. Returns { ok: true } or
// { ok: false, reason, side } — the caller un-readies both sides and tells the offending side
// what broke, rather than silently completing a partial trade.
function executeTrade(tradeId) {
  const trade = getTrade(tradeId);
  if (!trade || trade.status !== 'pending') return { ok: false, reason: 'not_pending' };

  const offers = {
    initiator: getOffer(tradeId, 'initiator'),
    target: getOffer(tradeId, 'target'),
  };

  // Live re-validation pass (read-only, before touching anything).
  for (const side of SIDES) {
    const userId = userIdForSide(trade, side);
    for (const p of offers[side].pokemon) {
      const row = db.prepare('SELECT user_id FROM pokemon_instances WHERE instance_id = ?').get(p.instance_id);
      if (!row || row.user_id !== userId) return { ok: false, reason: 'pokemon_no_longer_owned', side };
    }
    for (const item of offers[side].items) {
      if (inventoryDb.getItemQuantity(userId, item.item_key) < item.quantity) {
        return { ok: false, reason: 'item_no_longer_available', side };
      }
    }
    const coinAmount = side === 'initiator' ? trade.initiator_coins : trade.target_coins;
    if (coinAmount > 0) {
      const profile = users.getProfile(trade.chat_id, userId);
      const balance = profile ? profile.coins : 0;
      if (balance < coinAmount) return { ok: false, reason: 'coins_no_longer_available', side };
    }
  }

  // Reject a genuinely empty trade (nothing offered on either side) — not a real trade.
  const totalItems =
    offers.initiator.pokemon.length +
    offers.initiator.items.length +
    offers.target.pokemon.length +
    offers.target.items.length +
    (trade.initiator_coins > 0 ? 1 : 0) +
    (trade.target_coins > 0 ? 1 : 0);
  if (totalItems === 0) return { ok: false, reason: 'empty_trade' };

  db.exec('BEGIN');
  try {
    for (const side of SIDES) {
      const fromUserId = userIdForSide(trade, side);
      const toUserId = userIdForSide(trade, otherSide(side));

      for (const p of offers[side].pokemon) {
        db.prepare('UPDATE pokemon_instances SET user_id = ? WHERE instance_id = ?').run(toUserId, p.instance_id);
      }
      for (const item of offers[side].items) {
        const removed = inventoryDb.removeQuantity(fromUserId, item.item_key, item.quantity);
        if (!removed) throw new Error(`item_transfer_failed:${item.item_key}`);
        inventoryDb.addItem(toUserId, item.item_key, item.quantity);
      }
      const coinAmount = side === 'initiator' ? trade.initiator_coins : trade.target_coins;
      if (coinAmount > 0) {
        const deducted = users.deductCoins(trade.chat_id, fromUserId, coinAmount);
        if (!deducted) throw new Error('coin_transfer_failed');
        users.addCoins(trade.chat_id, toUserId, coinAmount);
      }
    }
    setStatus(tradeId, 'completed');
    db.exec('COMMIT');
    return { ok: true, trade: getTrade(tradeId), offers };
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(`Trade #${tradeId} execution failed mid-transaction (rolled back):`, err.message);
    return { ok: false, reason: 'execution_error' };
  }
}

function cancelTrade(tradeId, status = 'cancelled') {
  setStatus(tradeId, status);
}

// Idle-timeout sweep target — trades untouched for 30+ minutes auto-cancel so an abandoned
// session doesn't sit "pending" forever (same dynamic-expiry-at-read-time style used elsewhere,
// but trades also need an active sweep since nothing else re-reads them passively).
const staleStmt = db.prepare(`
  SELECT * FROM trades WHERE status = 'pending' AND updated_at < datetime('now', '-30 minutes')
`);
function listStaleTrades() {
  return staleStmt.all();
}

module.exports = {
  getActiveTradeForUser,
  createTrade,
  getTrade,
  setMessageId,
  sideFor,
  userIdForSide,
  addPokemonToOffer,
  removePokemonFromOffer,
  setItemInOffer,
  setCoinsInOffer,
  getOffer,
  setReady,
  setStatus,
  executeTrade,
  cancelTrade,
  listStaleTrades,
};
