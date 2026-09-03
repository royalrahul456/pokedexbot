// Shared between the Mini App backend (src/webapp/server.js) and the tunnel wrapper
// (scripts/tunnel.js), which run as separate pm2 processes but must agree on the port.
module.exports = { WEBAPP_PORT: Number(process.env.PORT || process.env.WEBAPP_PORT) || 3001 };
