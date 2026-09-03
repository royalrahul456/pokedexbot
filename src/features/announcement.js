const { Markup } = require('telegraf');
const { ADMIN_IDS } = require('../config');
const { listActiveGroups } = require('../db/groups');
const { escapeHtml, bold, HTML, brandTag } = require('../utils/text');
const { deactivateIfGroupGone } = require('../utils/groupHealth');

const PENDING_TTL_MS = 5 * 60 * 1000;
const pending = new Map(); // adminUserId -> { text, createdAt }

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Confirm Send', 'announce:confirm'),
    Markup.button.callback('❌ Cancel', 'announce:cancel'),
  ]);
}

function register(bot) {
  bot.command('announcement', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!text) {
      await ctx.reply(
        'Usage: /announcement <message> — it will be broadcast to every active group after you confirm.'
      );
      return;
    }

    const groupCount = listActiveGroups().length;
    pending.set(ctx.from.id, { text, createdAt: Date.now() });
    await ctx.reply(
      [
        bold('📢 Announcement Preview'),
        '',
        escapeHtml(text),
        '',
        `Send this to all ${bold(groupCount)} active group(s)?`,
      ].join('\n'),
      { ...HTML, ...confirmKeyboard() }
    );
  });

  bot.action('announce:confirm', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const entry = pending.get(ctx.from.id);
    if (!entry || Date.now() - entry.createdAt > PENDING_TTL_MS) {
      await ctx.answerCbQuery('This preview expired — run /announcement again.');
      return;
    }
    pending.delete(ctx.from.id);
    await ctx.answerCbQuery('Sending...');

    const groups = listActiveGroups();
    const messageText = `${brandTag()}\n${bold('📢 Announcement')}\n\n${escapeHtml(entry.text)}`;
    let sent = 0;
    let failed = 0;
    let removed = 0;
    for (const group of groups) {
      try {
        await ctx.telegram.sendMessage(group.chat_id, messageText, HTML);
        sent++;
      } catch (err) {
        failed++;
        console.error(`Failed to send announcement to chat ${group.chat_id}:`, err.message);
        if (deactivateIfGroupGone(group.chat_id, err, 'announcement')) removed++;
      }
    }

    const resultLines = [bold('📢 Announcement sent!'), '', `✅ Delivered to ${bold(sent)} group(s)`];
    if (failed > 0) {
      resultLines.push(`⚠️ Failed for ${bold(failed)} group(s) (bot may have been removed from them)`);
    }
    if (removed > 0) {
      resultLines.push(`🚫 Auto-removed ${bold(removed)} group(s) that are no longer reachable`);
    }
    await ctx.editMessageText(resultLines.join('\n'), HTML);
  });

  bot.action('announce:cancel', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    pending.delete(ctx.from.id);
    await ctx.answerCbQuery('Cancelled.');
    await ctx.editMessageText('❌ Announcement cancelled.');
  });
}

module.exports = { register };
