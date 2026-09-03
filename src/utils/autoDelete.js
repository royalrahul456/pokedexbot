/**
 * Automatically deletes bot messages in groups after a short delay to keep group chats clean.
 */

const DEFAULT_AUTO_DELETE_MS = 2 * 60 * 1000; // 2 minutes

function scheduleAutoDelete(bot, chatId, messageId, delayMs = DEFAULT_AUTO_DELETE_MS) {
  if (!chatId || !messageId) return;

  setTimeout(async () => {
    try {
      await bot.telegram.deleteMessage(chatId, messageId);
    } catch (err) {
      // Ignore deletion errors gracefully (e.g. message already deleted or missing delete permissions)
    }
  }, delayMs);
}

function installAutoDelete(bot, delayMs = DEFAULT_AUTO_DELETE_MS) {
  bot.use(async (ctx, next) => {
    const originalReply = ctx.reply;
    const originalReplyWithPhoto = ctx.replyWithPhoto;

    if (originalReply) {
      ctx.reply = async (...args) => {
        const sent = await originalReply.apply(ctx, args);
        if (sent && ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
          scheduleAutoDelete(bot, ctx.chat.id, sent.message_id, delayMs);
        }
        return sent;
      };
    }

    if (originalReplyWithPhoto) {
      ctx.replyWithPhoto = async (...args) => {
        const sent = await originalReplyWithPhoto.apply(ctx, args);
        if (sent && ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
          scheduleAutoDelete(bot, ctx.chat.id, sent.message_id, delayMs);
        }
        return sent;
      };
    }

    return next();
  });
}

module.exports = {
  installAutoDelete,
  scheduleAutoDelete,
};
