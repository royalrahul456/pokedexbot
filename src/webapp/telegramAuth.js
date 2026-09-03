// Validates Telegram Mini App `initData` per Telegram's official algorithm:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const crypto = require('crypto');
const { BOT_TOKEN } = require('../config');

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
const HEX_64 = /^[0-9a-f]{64}$/i;

// Returns { userId, username, firstName } if genuine and fresh, or null otherwise. Never
// throws — always safe to call directly on untrusted client input.
function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch (err) {
    return null;
  }

  const hash = params.get('hash');
  if (!hash || !HEX_64.test(hash)) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const isValid = crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(hash, 'hex'));
  if (!isValid) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson);
    if (!user || typeof user.id !== 'number') return null;
    return { userId: user.id, username: user.username || null, firstName: user.first_name || null };
  } catch (err) {
    return null;
  }
}

module.exports = { validateInitData };
