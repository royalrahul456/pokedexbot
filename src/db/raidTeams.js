const db = require('./index');

const getStmt = db.prepare('SELECT * FROM raid_saved_teams WHERE user_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO raid_saved_teams (user_id, m1_species, m1_shiny, m2_species, m2_shiny, m3_species, m3_shiny, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    m1_species = excluded.m1_species, m1_shiny = excluded.m1_shiny,
    m2_species = excluded.m2_species, m2_shiny = excluded.m2_shiny,
    m3_species = excluded.m3_species, m3_shiny = excluded.m3_shiny,
    updated_at = datetime('now')
`);

// Returns [{ speciesName, shiny }, ...] (always length 3) or null if never saved.
function getTeam(userId) {
  const row = getStmt.get(userId);
  if (!row) return null;
  return [
    { speciesName: row.m1_species, shiny: Boolean(row.m1_shiny) },
    { speciesName: row.m2_species, shiny: Boolean(row.m2_shiny) },
    { speciesName: row.m3_species, shiny: Boolean(row.m3_shiny) },
  ];
}

// `picks` must be exactly 3 { speciesName, shiny } entries — caller validates ownership
// and uniqueness before calling this.
function saveTeam(userId, picks) {
  upsertStmt.run(
    userId,
    picks[0].speciesName, picks[0].shiny ? 1 : 0,
    picks[1].speciesName, picks[1].shiny ? 1 : 0,
    picks[2].speciesName, picks[2].shiny ? 1 : 0
  );
}

module.exports = { getTeam, saveTeam };
