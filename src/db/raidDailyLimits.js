const db = require('./index');

const DAILY_LIMIT = 5;

const getStmt = db.prepare('SELECT count FROM raid_daily_limits WHERE chat_id = ? AND date = ?');
const upsertStmt = db.prepare(`
  INSERT INTO raid_daily_limits (chat_id, date, count) VALUES (?, ?, 1)
  ON CONFLICT(chat_id, date) DO UPDATE SET count = count + 1
`);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getCountToday(chatId) {
  return getStmt.get(chatId, todayKey())?.count || 0;
}

function increment(chatId) {
  upsertStmt.run(chatId, todayKey());
}

module.exports = { getCountToday, increment, DAILY_LIMIT };
