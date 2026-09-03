// Telegram's native animated message reactions — no image/sticker hosting needed, the
// client renders the little animation itself. Telegram only accepts a fixed whitelist of
// reaction emoji (undocumented here in code, but stable ones like these are safe); any
// rejection is swallowed so a decorative reaction can never break a real feature.
async function react(telegram, chatId, messageId, emoji) {
  if (!messageId) return;
  try {
    await telegram.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji }], false);
  } catch (err) {
    console.error(`Failed to set reaction "${emoji}" on message ${messageId} in chat ${chatId}:`, err.message);
  }
}

module.exports = { react };
