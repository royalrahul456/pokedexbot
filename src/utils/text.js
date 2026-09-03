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

function code(str) {
  return `<code>${str}</code>`;
}

function pre(str) {
  return `<pre>${str}</pre>`;
}

function spoiler(str) {
  return `<tg-spoiler>${str}</tg-spoiler>`;
}

function quote(str) {
  return `<blockquote>${str}</blockquote>`;
}

function expandableQuote(str) {
  return `<blockquote expandable>${str}</blockquote>`;
}

const HTML = { parse_mode: 'HTML' };

// Consistent brand identity — a small tag line prefixed to major broadcast messages
const BRAND_NAME = 'PokéDex Bot';
const BRAND_EMOJI = '📟';

function brandTag() {
  return bold(`${BRAND_EMOJI} ${BRAND_NAME}`);
}

module.exports = {
  escapeHtml,
  bold,
  italic,
  code,
  pre,
  spoiler,
  quote,
  expandableQuote,
  HTML,
  BRAND_NAME,
  BRAND_EMOJI,
  brandTag,
};
