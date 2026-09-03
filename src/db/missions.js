const db = require('./index');
const { pickMysteryPokemon } = require('../data/pokemon');

const getStmt = db.prepare('SELECT * FROM daily_missions WHERE chat_id = ? AND mission_date = ?');
const insertStmt = db.prepare(
  'INSERT INTO daily_missions (chat_id, mission_date, pokemon_name, completed_by) VALUES (?, ?, ?, ?)'
);
const updateCompletedStmt = db.prepare(
  'UPDATE daily_missions SET completed_by = ? WHERE chat_id = ? AND mission_date = ?'
);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Creates today's mission if it doesn't exist yet, returns the mission row.
function getOrCreateTodayMission(chatId) {
  const date = todayStr();
  let mission = getStmt.get(chatId, date);
  if (!mission) {
    const pokemonName = pickMysteryPokemon();
    insertStmt.run(chatId, date, pokemonName, '');
    mission = getStmt.get(chatId, date);
  }
  return mission;
}

// Marks the mission complete for a user if they haven't already claimed it today.
// Returns true if this call newly completed it, false if already claimed or wrong Pokemon.
function tryCompleteMission(chatId, userId, caughtPokemonName) {
  const mission = getOrCreateTodayMission(chatId);
  if (mission.pokemon_name.toLowerCase() !== caughtPokemonName.toLowerCase()) return false;

  const completedIds = mission.completed_by ? mission.completed_by.split(',').filter(Boolean) : [];
  if (completedIds.includes(String(userId))) return false;

  completedIds.push(String(userId));
  updateCompletedStmt.run(completedIds.join(','), chatId, mission.mission_date);
  return true;
}

module.exports = { getOrCreateTodayMission, tryCompleteMission };
