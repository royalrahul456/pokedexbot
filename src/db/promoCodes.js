const db = require('./index');

const insertStmt = db.prepare(`
  INSERT INTO promo_codes
    (code, xp, coins, item_key, item_qty, pokemon_name, pokemon_shiny, max_uses, expires_at, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getStmt = db.prepare('SELECT * FROM promo_codes WHERE code = ?');
const listStmt = db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC');
const deactivateStmt = db.prepare('UPDATE promo_codes SET active = 0 WHERE code = ?');
const reactivateStmt = db.prepare('UPDATE promo_codes SET active = 1 WHERE code = ?');
const deleteStmt = db.prepare('DELETE FROM promo_codes WHERE code = ?');
const editStmt = db.prepare('UPDATE promo_codes SET max_uses = ?, expires_at = ? WHERE code = ?');
const hasRedeemedStmt = db.prepare('SELECT 1 FROM promo_code_redemptions WHERE user_id = ? AND code = ?');
const claimSlotStmt = db.prepare(
  'UPDATE promo_codes SET uses_count = uses_count + 1 WHERE code = ? AND active = 1 AND (max_uses IS NULL OR uses_count < max_uses)'
);
const insertRedemptionStmt = db.prepare(
  'INSERT INTO promo_code_redemptions (user_id, code, chat_id) VALUES (?, ?, ?)'
);
const countRedemptionsStmt = db.prepare('SELECT COUNT(*) AS c FROM promo_code_redemptions');

function normalize(code) {
  return code.trim().toUpperCase();
}

function isExpired(entry) {
  return Boolean(entry.expires_at) && new Date(entry.expires_at).getTime() <= Date.now();
}

function createCode(
  code,
  {
    xp = 0,
    coins = 0,
    itemKey = null,
    itemQty = null,
    pokemonName = null,
    pokemonShiny = false,
    maxUses = null,
    expiresAt = null,
    createdBy,
  } = {}
) {
  const normalized = normalize(code);
  insertStmt.run(
    normalized,
    xp,
    coins,
    itemKey,
    itemQty,
    pokemonName,
    pokemonShiny ? 1 : 0,
    maxUses,
    expiresAt,
    createdBy ?? null
  );
  return normalized;
}

function getCode(code) {
  return getStmt.get(normalize(code));
}

function listCodes() {
  return listStmt.all();
}

function deactivateCode(code) {
  const result = deactivateStmt.run(normalize(code));
  return result.changes > 0;
}

function reactivateCode(code) {
  const result = reactivateStmt.run(normalize(code));
  return result.changes > 0;
}

// Hard delete — deliberately does NOT touch promo_code_redemptions, so the same code text
// can never be redeemed twice by the same trainer even if it's recreated later.
function deleteCode(code) {
  const result = deleteStmt.run(normalize(code));
  return result.changes > 0;
}

function editCode(code, { maxUses, expiresAt }) {
  const normalized = normalize(code);
  const entry = getStmt.get(normalized);
  if (!entry) return false;
  const result = editStmt.run(
    maxUses !== undefined ? maxUses : entry.max_uses,
    expiresAt !== undefined ? expiresAt : entry.expires_at,
    normalized
  );
  return result.changes > 0;
}

function hasRedeemed(userId, code) {
  return Boolean(hasRedeemedStmt.get(userId, normalize(code)));
}

function countRedemptions() {
  return countRedemptionsStmt.get().c;
}

// Redeems a code for a user in a specific chat, atomically. Returns:
//   { ok: true, xp, coins, itemKey, itemQty, pokemonName, pokemonShiny } on success
//   { ok: false, reason: 'not_found' | 'expired' | 'already_redeemed' | 'limit_reached' }
function redeemCode(userId, chatId, code) {
  const normalized = normalize(code);
  const entry = getStmt.get(normalized);
  if (!entry || !entry.active) {
    return { ok: false, reason: 'not_found' };
  }
  if (isExpired(entry)) {
    return { ok: false, reason: 'expired' };
  }
  if (hasRedeemed(userId, normalized)) {
    return { ok: false, reason: 'already_redeemed' };
  }

  db.exec('BEGIN');
  try {
    const claimed = claimSlotStmt.run(normalized);
    if (claimed.changes === 0) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'limit_reached' };
    }
    try {
      insertRedemptionStmt.run(userId, normalized, chatId);
    } catch (err) {
      // (user_id, code) PK conflict — someone else's concurrent request for the same
      // user already recorded a redemption first; give back the slot we just claimed.
      db.exec('ROLLBACK');
      return { ok: false, reason: 'already_redeemed' };
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    ok: true,
    xp: entry.xp,
    coins: entry.coins,
    itemKey: entry.item_key,
    itemQty: entry.item_qty,
    pokemonName: entry.pokemon_name,
    pokemonShiny: Boolean(entry.pokemon_shiny),
  };
}

module.exports = {
  createCode,
  getCode,
  listCodes,
  deactivateCode,
  reactivateCode,
  deleteCode,
  editCode,
  hasRedeemed,
  countRedemptions,
  redeemCode,
  isExpired,
};
