const fs = require('fs');
const path = require('path');

const URL_FILE = path.join(__dirname, '..', '..', 'data', 'tunnel_url.txt');

// Re-reads the file every call (never cached) — the tunnel process is independent (its own
// pm2 entry) and can restart with a brand new *.trycloudflare.com address at any time.
function getTunnelUrl() {
  try {
    const url = fs.readFileSync(URL_FILE, 'utf8').trim();
    return url || null;
  } catch (err) {
    return null;
  }
}

module.exports = { getTunnelUrl };
