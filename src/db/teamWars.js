const db = require('./index');

const getMembershipStmt = db.prepare('SELECT team FROM team_membership WHERE chat_id = ? AND user_id = ?');
const setMembershipStmt = db.prepare(`
  INSERT INTO team_membership (chat_id, user_id, team) VALUES (?, ?, ?)
  ON CONFLICT(chat_id, user_id) DO UPDATE SET team = excluded.team
`);
const listMembersStmt = db.prepare('SELECT user_id, team FROM team_membership WHERE chat_id = ?');

const getActiveWarStmt = db.prepare('SELECT * FROM team_wars WHERE chat_id = ? AND active = 1');
const insertWarStmt = db.prepare(`
  INSERT INTO team_wars (chat_id, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?)
`);
const deactivateWarStmt = db.prepare('UPDATE team_wars SET active = 0 WHERE id = ?');
const listDueWarsStmt = db.prepare('SELECT * FROM team_wars WHERE active = 1 AND ends_at <= ?');

const addParticipantStmt = db.prepare(`
  INSERT INTO team_war_participants (war_id, user_id, team, xp_at_join) VALUES (?, ?, ?, ?)
  ON CONFLICT(war_id, user_id) DO NOTHING
`);
const getParticipantStmt = db.prepare('SELECT * FROM team_war_participants WHERE war_id = ? AND user_id = ?');
const listParticipantsStmt = db.prepare('SELECT * FROM team_war_participants WHERE war_id = ?');

function getTeam(chatId, userId) {
  return getMembershipStmt.get(chatId, userId)?.team ?? null;
}

function setTeam(chatId, userId, team) {
  setMembershipStmt.run(chatId, userId, team);
}

function listMembers(chatId) {
  return listMembersStmt.all(chatId);
}

function getActiveWar(chatId) {
  return getActiveWarStmt.get(chatId);
}

function startWar(chatId, endsAt, createdBy) {
  const startsAt = new Date().toISOString();
  const result = insertWarStmt.run(chatId, startsAt, endsAt, createdBy ?? null);
  return result.lastInsertRowid;
}

function endWar(warId) {
  deactivateWarStmt.run(warId);
}

function listDueWars(nowIso) {
  return listDueWarsStmt.all(nowIso);
}

// Called at war start (for everyone already on a team) and whenever someone joins a team
// while a war is active — idempotent, won't overwrite an existing baseline.
function ensureParticipant(warId, userId, team, currentXp) {
  addParticipantStmt.run(warId, userId, team, currentXp);
}

function getParticipant(warId, userId) {
  return getParticipantStmt.get(warId, userId);
}

function listParticipants(warId) {
  return listParticipantsStmt.all(warId);
}

module.exports = {
  getTeam,
  setTeam,
  listMembers,
  getActiveWar,
  startWar,
  endWar,
  listDueWars,
  ensureParticipant,
  getParticipant,
  listParticipants,
};
