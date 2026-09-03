// Telegram 429 errors include a human-readable "retry after N" (seconds) — parsing it out
// lets a throttle back off for exactly as long as Telegram actually asked, instead of
// guessing a fixed interval and getting hit again. Shared by any feature that edits a message
// repeatedly (bossRaid.js, battle.js) since they all hit the same class of rate limit.
function parseRetryAfterMs(message) {
  const match = /retry after (\d+)/i.exec(message || '');
  return match ? Number(match[1]) * 1000 : null;
}

module.exports = { parseRetryAfterMs };
