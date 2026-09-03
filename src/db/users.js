const db = require('./index');
const { levelFromXp } = require('../utils/levels');

const getStmt = db.prepare('SELECT * FROM users WHERE chat_id = ? AND user_id = ?');
const insertStmt = db.prepare(
  'INSERT INTO users (chat_id, user_id, username) VALUES (?, ?, ?)'
);
const touchUsernameStmt = db.prepare(
  'UPDATE users SET username = ? WHERE chat_id = ? AND user_id = ?'
);
const addXpStmt = db.prepare(
  'UPDATE users SET xp = xp + ?, level = ? WHERE chat_id = ? AND user_id = ?'
);
const addCoinsStmt = db.prepare(
  'UPDATE users SET coins = coins + ? WHERE chat_id = ? AND user_id = ?'
);
const deductCoinsStmt = db.prepare(
  'UPDATE users SET coins = coins - ? WHERE chat_id = ? AND user_id = ? AND coins >= ?'
);
const incrementStmt = (column) =>
  db.prepare(`UPDATE users SET ${column} = ${column} + ? WHERE chat_id = ? AND user_id = ?`);
const leaderboardStmt = db.prepare(
  'SELECT * FROM users WHERE chat_id = ? ORDER BY xp DESC LIMIT ?'
);

const ALLOWED_COUNTERS = new Set([
  'catches',
  'quiz_wins',
  'shiny_count',
  'legendary_count',
  'ttt_wins',
  'rps_wins',
  'scramble_wins',
  'whosthat_wins',
  'connect4_wins',
  'hangman_wins',
  'battle_wins',
]);

function getOrCreateUser(chatId, userId, username) {
  let user = getStmt.get(chatId, userId);
  if (!user) {
    insertStmt.run(chatId, userId, username || null);
    user = getStmt.get(chatId, userId);
  } else if (username && user.username !== username) {
    touchUsernameStmt.run(username, chatId, userId);
    user.username = username;
  }
  return user;
}

// Returns { newLevel, leveledUp } so callers can announce level-ups.
function addXp(chatId, userId, amount) {
  const user = getStmt.get(chatId, userId);
  const newXp = user.xp + amount;
  const newLevel = levelFromXp(newXp);
  const leveledUp = newLevel > user.level;
  addXpStmt.run(amount, newLevel, chatId, userId);
  return { newXp, newLevel, leveledUp };
}

function addCoins(chatId, userId, amount) {
  addCoinsStmt.run(amount, chatId, userId);
}

// Atomic guarded deduct — returns false (and leaves balance untouched) if the user
// can't cover the amount, so callers never need to pre-check balance separately.
function deductCoins(chatId, userId, amount) {
  const result = deductCoinsStmt.run(amount, chatId, userId, amount);
  return result.changes > 0;
}

function incrementCounter(chatId, userId, column, amount = 1) {
  if (!ALLOWED_COUNTERS.has(column)) throw new Error(`Unknown counter column: ${column}`);
  incrementStmt(column).run(amount, chatId, userId);
}

function getProfile(chatId, userId) {
  return getStmt.get(chatId, userId);
}

function getLeaderboard(chatId, limit = 10) {
  return leaderboardStmt.all(chatId, limit);
}

function getRank(chatId, userId) {
  const rows = db
    .prepare('SELECT user_id FROM users WHERE chat_id = ? ORDER BY xp DESC')
    .all(chatId);
  const idx = rows.findIndex((r) => r.user_id === userId);
  return idx === -1 ? null : idx + 1;
}

const groupStatsStmt = db.prepare(`
  SELECT
    COUNT(*) AS total_trainers,
    COALESCE(SUM(catches), 0) AS total_catches,
    COALESCE(SUM(shiny_count), 0) AS total_shinies,
    COALESCE(SUM(legendary_count), 0) AS total_legendaries,
    COALESCE(SUM(coins), 0) AS total_coins
  FROM users WHERE chat_id = ?
`);

function getGroupStats(chatId) {
  const totals = groupStatsStmt.get(chatId);
  const topUser = leaderboardStmt.all(chatId, 1)[0] ?? null;
  return { ...totals, topUser };
}

const globalStatsStmt = db.prepare(`
  SELECT
    COUNT(DISTINCT user_id) AS distinct_trainers,
    COUNT(*) AS total_memberships,
    COALESCE(SUM(catches), 0) AS total_catches,
    COALESCE(SUM(shiny_count), 0) AS total_shinies,
    COALESCE(SUM(legendary_count), 0) AS total_legendaries,
    COALESCE(SUM(coins), 0) AS total_coins,
    COALESCE(SUM(quiz_wins + ttt_wins + rps_wins + connect4_wins + scramble_wins + whosthat_wins + hangman_wins), 0) AS total_game_wins
  FROM users
`);

// Bot-wide stats across every group — used by the admin panel's 📊 Bot Stats button.
function getGlobalStats() {
  return globalStatsStmt.get();
}

const totalCatchesStmt = db.prepare('SELECT COALESCE(SUM(catches), 0) AS total FROM users WHERE user_id = ?');

// Sum of the old per-group `catches` counter across every group for this user. Used only
// to show an honest "you also have N untracked catches from before /collection existed"
// note — those catches were never recorded at species-level, so they can't be listed.
function getTotalCatchesAcrossGroups(userId) {
  return totalCatchesStmt.get(userId).total;
}

module.exports = {
  getOrCreateUser,
  addXp,
  addCoins,
  deductCoins,
  incrementCounter,
  getProfile,
  getLeaderboard,
  getRank,
  getGroupStats,
  getGlobalStats,
  getTotalCatchesAcrossGroups,
};
