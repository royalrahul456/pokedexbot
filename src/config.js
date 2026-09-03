require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is missing. Copy .env.example to .env and fill it in.');
}

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

module.exports = {
  BOT_TOKEN,
  ADMIN_IDS,
  DATABASE_URL: process.env.DATABASE_URL || null,
  BACKEND_URL: process.env.BACKEND_URL || null,
  DB_PATH: require('path').join(__dirname, '..', 'data', 'trainer.sqlite'),
};
