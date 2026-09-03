const db = require('./index');

function canon(userA, usernameA, userB, usernameB) {
  return userA < userB
    ? { a: userA, usernameA, b: userB, usernameB }
    : { a: userB, usernameA: usernameB, b: userA, usernameB: usernameA };
}

const getStmt = db.prepare('SELECT * FROM friendships WHERE user_id_a = ? AND user_id_b = ?');
const insertStmt = db.prepare(`
  INSERT INTO friendships (user_id_a, user_id_b, username_a, username_b, status, requested_by)
  VALUES (?, ?, ?, ?, 'pending', ?)
`);
const acceptStmt = db.prepare(`
  UPDATE friendships SET status = 'accepted' WHERE user_id_a = ? AND user_id_b = ? AND status = 'pending'
`);
const deleteStmt = db.prepare('DELETE FROM friendships WHERE user_id_a = ? AND user_id_b = ?');
const listStmt = db.prepare(`
  SELECT * FROM friendships WHERE (user_id_a = ? OR user_id_b = ?) AND status = 'accepted'
`);

function getFriendship(userA, userB) {
  const { a, b } = canon(userA, null, userB, null);
  return getStmt.get(a, b);
}

function areFriends(userA, userB) {
  const row = getFriendship(userA, userB);
  return Boolean(row && row.status === 'accepted');
}

// Creates a pending request if none exists yet. Returns the resulting row either way
// (existing pending/accepted row is left untouched — caller decides what that means).
function sendRequest(fromId, fromUsername, toId, toUsername) {
  const { a, usernameA, b, usernameB } = canon(fromId, fromUsername, toId, toUsername);
  const existing = getStmt.get(a, b);
  if (existing) return existing;
  insertStmt.run(a, b, usernameA, usernameB, fromId);
  return getStmt.get(a, b);
}

// Only the side that DIDN'T send the request can accept. Returns true only if this call
// actually flipped it (atomic — a double-tap race can't accept twice).
function acceptRequest(accepterId, requesterId) {
  const { a, b } = canon(accepterId, null, requesterId, null);
  const row = getStmt.get(a, b);
  if (!row || row.status !== 'pending' || row.requested_by === accepterId) return false;
  const result = acceptStmt.run(a, b);
  return result.changes > 0;
}

function removeFriendship(userA, userB) {
  const { a, b } = canon(userA, null, userB, null);
  deleteStmt.run(a, b);
}

// Returns [{ userId, username }] for this user's accepted friends.
function listFriends(userId) {
  const rows = listStmt.all(userId, userId);
  return rows.map((row) =>
    row.user_id_a === userId
      ? { userId: row.user_id_b, username: row.username_b }
      : { userId: row.user_id_a, username: row.username_a }
  );
}

module.exports = { getFriendship, areFriends, sendRequest, acceptRequest, removeFriendship, listFriends };
