const db = require('./index');

const getStmt = db.prepare('SELECT * FROM streaks WHERE chat_id = ? AND user_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO streaks (chat_id, user_id, current_streak, longest_streak, last_checkin)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(chat_id, user_id) DO UPDATE SET
    current_streak = excluded.current_streak,
    longest_streak = excluded.longest_streak,
    last_checkin = excluded.last_checkin
`);

const MILESTONES = [7, 15, 30, 100];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(b) - Date.parse(a)) / msPerDay);
}

// Returns { streak, longest, milestone, alreadyCheckedInToday }
function checkIn(chatId, userId) {
  const today = todayStr();
  const row = getStmt.get(chatId, userId) || {
    current_streak: 0,
    longest_streak: 0,
    last_checkin: null,
  };

  if (row.last_checkin === today) {
    return { streak: row.current_streak, longest: row.longest_streak, milestone: null, alreadyCheckedInToday: true };
  }

  let newStreak = 1;
  if (row.last_checkin) {
    const gap = daysBetween(row.last_checkin, today);
    newStreak = gap === 1 ? row.current_streak + 1 : 1;
  }
  const newLongest = Math.max(newStreak, row.longest_streak);
  upsertStmt.run(chatId, userId, newStreak, newLongest, today);

  const milestone = MILESTONES.includes(newStreak) ? newStreak : null;
  return { streak: newStreak, longest: newLongest, milestone, alreadyCheckedInToday: false };
}

function getStreak(chatId, userId) {
  return getStmt.get(chatId, userId) || { current_streak: 0, longest_streak: 0, last_checkin: null };
}

const atRiskStmt = db.prepare(`
  SELECT s.user_id, u.username, s.current_streak
  FROM streaks s
  JOIN users u ON u.chat_id = s.chat_id AND u.user_id = s.user_id
  WHERE s.chat_id = ? AND s.current_streak > 0 AND s.last_checkin != ?
`);

// Users who built up a streak but haven't checked in today — they lose it if the day ends without one.
function getUsersAtRiskOfLosingStreak(chatId) {
  return atRiskStmt.all(chatId, todayStr());
}

module.exports = { checkIn, getStreak, getUsersAtRiskOfLosingStreak, MILESTONES };
