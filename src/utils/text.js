// Telegram HTML parse_mode helpers. Escape any user-controlled text (usernames)
// before interpolating into HTML-formatted messages to avoid broken markup.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bold(str) {
  return `<b>${str}</b>`;
}

function italic(str) {
  return `<i>${str}</i>`;
}

const HTML = { parse_mode: 'HTML' };

// Consistent brand identity — a small tag line prefixed to major broadcast messages
// (mission, guide, announcements, etc.) so every feature feels like one product.
const BRAND_NAME = 'PokéDex Bot';
const BRAND_EMOJI = '📟';

function brandTag() {
  return italic(`${BRAND_EMOJI} ${BRAND_NAME}`);
}

module.exports = { escapeHtml, bold, italic, HTML, BRAND_NAME, BRAND_EMOJI, brandTag };
