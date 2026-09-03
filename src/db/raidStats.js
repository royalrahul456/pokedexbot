const db = require('./index');

function bumpStmt(column) {
  return db.prepare(`UPDATE users SET ${column} = ${column} + ? WHERE chat_id = ? AND user_id = ?`);
}

const raidsParticipatedStmt = bumpStmt('raids_participated');
const raidsCompletedStmt = bumpStmt('raids_completed');
const raidDamageTotalStmt = bumpStmt('raid_damage_total');
const raidMvpAwardsStmt = bumpStmt('raid_mvp_awards');
const legendaryRaidsWonStmt = bumpStmt('legendary_raids_won');
const mythicalRaidsWonStmt = bumpStmt('mythical_raids_won');
const ultraRareRaidsWonStmt = bumpStmt('ultra_rare_raids_won');
const raidPointsStmt = bumpStmt('raid_points');
const maxHighestDamageStmt = db.prepare(
  'UPDATE users SET highest_raid_damage = ? WHERE chat_id = ? AND user_id = ? AND highest_raid_damage < ?'
);

function recordParticipation(chatId, userId) {
  raidsParticipatedStmt.run(1, chatId, userId);
}

function recordVictory(chatId, userId, tier) {
  raidsCompletedStmt.run(1, chatId, userId);
  const stmt = tier === 'ultra_rare' ? ultraRareRaidsWonStmt : tier === 'mythical' ? mythicalRaidsWonStmt : legendaryRaidsWonStmt;
  stmt.run(1, chatId, userId);
}

function addDamage(chatId, userId, damage) {
  raidDamageTotalStmt.run(damage, chatId, userId);
  maxHighestDamageStmt.run(damage, chatId, userId, damage);
}

function addMvp(chatId, userId) {
  raidMvpAwardsStmt.run(1, chatId, userId);
}

function addPoints(chatId, userId, points) {
  raidPointsStmt.run(points, chatId, userId);
}

module.exports = { recordParticipation, recordVictory, addDamage, addMvp, addPoints };
