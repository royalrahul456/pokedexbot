const db = require('./index');

const insertStmt = db.prepare(`
  INSERT INTO seasonal_events (name, theme_species, starts_at, ends_at, created_by)
  VALUES (?, ?, ?, ?, ?)
`);
const listAllStmt = db.prepare('SELECT * FROM seasonal_events ORDER BY starts_at DESC');
const getByIdStmt = db.prepare('SELECT * FROM seasonal_events WHERE id = ?');
const deactivateStmt = db.prepare('UPDATE seasonal_events SET active = 0 WHERE id = ?');
const reactivateStmt = db.prepare('UPDATE seasonal_events SET active = 1 WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM seasonal_events WHERE id = ?');
// `active = 1` is only the admin kill-switch — start/end are still checked live here, the
// same "no cron sweep needed" style as promo_codes.expires_at.
const activeStmt = db.prepare(`
  SELECT * FROM seasonal_events
  WHERE active = 1 AND starts_at <= ? AND ends_at > ?
  ORDER BY created_at DESC
  LIMIT 1
`);

function createEvent(name, themeSpecies, startsAt, endsAt, createdBy) {
  const result = insertStmt.run(name, themeSpecies.join(','), startsAt, endsAt, createdBy ?? null);
  return getByIdStmt.get(result.lastInsertRowid);
}

function listEvents() {
  return listAllStmt.all();
}

function getEvent(id) {
  return getByIdStmt.get(id);
}

// The one event live right now, if any — used by the spawn loop / morning mission for
// species bias and the event banner. Returns null if nothing is currently running.
function getActiveEvent() {
  const now = new Date().toISOString();
  return activeStmt.get(now, now) ?? null;
}

function computeStatus(event) {
  if (!event.active) return 'disabled';
  const now = Date.now();
  if (Date.parse(event.starts_at) > now) return 'upcoming';
  if (Date.parse(event.ends_at) <= now) return 'ended';
  return 'active';
}

function setActive(id, active) {
  (active ? reactivateStmt : deactivateStmt).run(id);
}

function deleteEvent(id) {
  deleteStmt.run(id);
}

module.exports = { createEvent, listEvents, getEvent, getActiveEvent, computeStatus, setActive, deleteEvent };
