const { Markup } = require('telegraf');
const { ADMIN_IDS } = require('../config');
const seasonalEventsDb = require('../db/seasonalEvents');
const { resolveSpeciesName } = require('../data/pokemon');
const { bold, escapeHtml, HTML } = require('../utils/text');

// adminId -> { name, themeSpecies: string[], startsAt: string|null }
const sessions = new Map();
// force-reply prompt message_id -> { adminId, field }
const pendingPrompts = new Map();

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

async function promptText(ctx, adminId, field, text) {
  const prompt = await ctx.reply(text, { ...HTML, ...Markup.forceReply() });
  pendingPrompts.set(prompt.message_id, { adminId, field });
}

function startKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚀 Start Now', 'se:start:now')],
    [Markup.button.callback('📅 Custom Start Date', 'se:start:custom')],
  ]);
}

function durationKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('1 Day', 'se:dur:1d'),
      Markup.button.callback('3 Days', 'se:dur:3d'),
    ],
    [
      Markup.button.callback('7 Days', 'se:dur:7d'),
      Markup.button.callback('14 Days', 'se:dur:14d'),
    ],
    [Markup.button.callback('✏️ Custom End Date', 'se:dur:custom')],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirm', 'se:confirm'), Markup.button.callback('❌ Cancel', 'se:cancel')],
  ]);
}

function formatSummary(session) {
  return [
    bold('🎉 Confirm New Seasonal Event'),
    '',
    `Name: ${bold(escapeHtml(session.name))}`,
    `Themed Pokémon: ${bold(session.themeSpecies.join(', '))}`,
    `Starts: ${bold(new Date(session.startsAt).toLocaleString())}`,
    `Ends: ${bold(new Date(session.endsAt).toLocaleString())}`,
    '',
    'While this event is live, these Pokémon show up much more often in their normal rarity tier, and a banner appears on spawns and the morning mission.',
  ].join('\n');
}

async function goToStartStep(ctx, adminId) {
  await ctx.reply(bold('🚀 When should this event start?'), { ...HTML, ...startKeyboard() });
}

async function goToDurationStep(ctx) {
  await ctx.reply(bold('⏳ How long should it run?'), { ...HTML, ...durationKeyboard() });
}

function register(bot) {
  const cancelWizard = async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    if (sessions.has(ctx.from.id)) {
      sessions.delete(ctx.from.id);
      await ctx.reply('❌ Seasonal event creation cancelled.');
    }
  };

  bot.command('seasonalevent', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('🛠 You must be an admin to do this.');
      return;
    }
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    sessions.set(ctx.from.id, { name: null, themeSpecies: null, startsAt: null, endsAt: null });
    await promptText(ctx, ctx.from.id, 'name', [
      bold('🎉 Create a Seasonal Event'),
      '',
      'Reply with a name for this event (e.g. "Halloween Spooktacular", "Legendary Weekend").',
    ].join('\n'));
  });

  bot.command('cancel', cancelWizard);

  bot.action('se:cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled.');
    sessions.delete(ctx.from.id);
    await ctx.editMessageText('❌ Seasonal event creation cancelled.');
  });

  bot.action('se:start:now', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard — run /seasonalevent again.', { show_alert: true });
    session.startsAt = new Date().toISOString();
    await ctx.answerCbQuery();
    await goToDurationStep(ctx);
  });

  bot.action('se:start:custom', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await promptText(ctx, ctx.from.id, 'start_custom', '📅 Reply with a start date/time, e.g. "2026-10-25 09:00".');
  });

  bot.action(/^se:dur:(1d|3d|7d|14d)$/, async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    const durations = { '1d': 86400e3, '3d': 3 * 86400e3, '7d': 7 * 86400e3, '14d': 14 * 86400e3 };
    session.endsAt = new Date(Date.parse(session.startsAt) + durations[ctx.match[1]]).toISOString();
    await ctx.answerCbQuery();
    await ctx.reply(formatSummary(session), { ...HTML, ...confirmKeyboard() });
  });

  bot.action('se:dur:custom', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    await promptText(ctx, ctx.from.id, 'end_custom', '✏️ Reply with an end date/time, e.g. "2026-11-01 09:00".');
  });

  bot.action('se:confirm', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery('No active wizard.', { show_alert: true });
    await ctx.answerCbQuery();
    const created = seasonalEventsDb.createEvent(
      session.name,
      session.themeSpecies,
      session.startsAt,
      session.endsAt,
      ctx.from.id
    );
    sessions.delete(ctx.from.id);
    await ctx.editMessageText(`✅ Seasonal event ${bold(escapeHtml(created.name))} created!`, HTML);
  });

  bot.on('text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !pendingPrompts.has(replyTo.message_id)) return next ? next() : undefined;

    const pending = pendingPrompts.get(replyTo.message_id);
    if (ctx.from.id !== pending.adminId || !isAdmin(ctx.from.id)) return next ? next() : undefined;
    pendingPrompts.delete(replyTo.message_id);

    const session = sessions.get(pending.adminId);
    if (!session) {
      await ctx.reply('This event-creation session expired — run /seasonalevent again.');
      return;
    }

    const text = ctx.message.text.trim();

    if (pending.field === 'name') {
      if (!text) {
        await promptText(ctx, pending.adminId, 'name', '⚠️ Reply with a non-empty name for this event.');
        return;
      }
      session.name = text;
      await promptText(
        ctx,
        pending.adminId,
        'species',
        'Reply with the themed Pokémon for this event, comma-separated (e.g. Gastly, Zubat, Cubone). Any rarity works — each keeps its normal tier.'
      );
      return;
    }

    if (pending.field === 'species') {
      const rawNames = text.split(',').map((s) => s.trim()).filter(Boolean);
      const resolved = [];
      const unknown = [];
      for (const raw of rawNames) {
        const canonical = resolveSpeciesName(raw);
        if (canonical) resolved.push(canonical);
        else unknown.push(raw);
      }
      if (unknown.length > 0) {
        await promptText(
          ctx,
          pending.adminId,
          'species',
          `⚠️ Not on the roster: ${unknown.join(', ')}. Reply again with valid Pokémon names, comma-separated.`
        );
        return;
      }
      if (resolved.length === 0) {
        await promptText(ctx, pending.adminId, 'species', '⚠️ Reply with at least one Pokémon name.');
        return;
      }
      session.themeSpecies = [...new Set(resolved)];
      await goToStartStep(ctx, pending.adminId);
      return;
    }

    if (pending.field === 'start_custom') {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) {
        await promptText(ctx, pending.adminId, 'start_custom', '⚠️ Could not parse that date. Reply with a date/time, e.g. "2026-10-25 09:00".');
        return;
      }
      session.startsAt = parsed.toISOString();
      await goToDurationStep(ctx);
      return;
    }

    if (pending.field === 'end_custom') {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.parse(session.startsAt)) {
        await promptText(
          ctx,
          pending.adminId,
          'end_custom',
          '⚠️ Could not parse that date, or it\'s not after the start date. Reply with a later date/time, e.g. "2026-11-01 09:00".'
        );
        return;
      }
      session.endsAt = parsed.toISOString();
      await ctx.reply(formatSummary(session), { ...HTML, ...confirmKeyboard() });
      return;
    }
  });
}

module.exports = { register };
