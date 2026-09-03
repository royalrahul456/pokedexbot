const db = require('./index');

const insertStmt = db.prepare(`
  INSERT INTO referrals (referred_user_id, referrer_user_id, chat_id, rewarded)
  VALUES (?, ?, ?, 0)
`);
const getByReferredStmt = db.prepare('SELECT * FROM referrals WHERE referred_user_id = ?');
const markRewardedStmt = db.prepare(
  'UPDATE referrals SET rewarded = 1 WHERE referred_user_id = ? AND rewarded = 0'
);

// Records a pending referral. Returns false if this user was already referred before
// (globally unique — prevents the same "friend" being used to farm the reward twice).
function recordReferral(referredUserId, referrerUserId, chatId) {
  if (getByReferredStmt.get(referredUserId)) return false;
  insertStmt.run(referredUserId, referrerUserId, chatId);
  return true;
}

function getPendingReferral(referredUserId) {
  const row = getByReferredStmt.get(referredUserId);
  if (!row || row.rewarded) return null;
  return row;
}

// Atomic: returns true only for the one call that actually marks it rewarded.
function tryMarkRewarded(referredUserId) {
  const result = markRewardedStmt.run(referredUserId);
  return result.changes > 0;
}

module.exports = { recordReferral, getPendingReferral, tryMarkRewarded };
