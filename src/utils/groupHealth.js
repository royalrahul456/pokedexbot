const groups = require('../db/groups');

// Telegram error messages that mean the bot can never reach this chat again, as opposed to a
// transient failure (network blip, rate limit) that's worth just retrying next cycle.
const GONE_PATTERNS = [
  /bot was kicked/i,
  /bot is not a member/i,
  /chat not found/i,
  /not enough rights to send/i,
  /user is deactivated/i,
];

function isGroupGoneError(err) {
  const msg = err?.message || err?.description || '';
  return GONE_PATTERNS.some((re) => re.test(msg));
}

// Call from any catch block right after a failed telegram send/edit for a specific group. If the
// error means the bot can no longer reach that chat at all, deactivate it so future spawns and
// broadcasts stop retrying a chat that will only ever fail — returns true if it deactivated.
function deactivateIfGroupGone(chatId, err, context) {
  if (!isGroupGoneError(err)) return false;
  groups.setGroupActive(chatId, false);
  console.log(`🚫 Auto-removed group ${chatId} from active groups (${context}): ${err.message}`);
  return true;
}

module.exports = { isGroupGoneError, deactivateIfGroupGone };
