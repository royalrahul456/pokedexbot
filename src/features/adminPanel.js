const { Markup } = require('telegraf');
const { ADMIN_IDS } = require('../config');
const users = require('../db/users');
const spawnFeature = require('./spawn');
const bossRaidFeature = require('./bossRaid');
const raidDailyLimits = require('../db/raidDailyLimits');
const morningMissionFeature = require('./morningMission');
const streakReminderFeature = require('./streakReminder');
const groupsDb = require('../db/groups');
const { escapeHtml, bold, HTML, brandTag } = require('../utils/text');
const { deactivateIfGroupGone } = require('../utils/groupHealth');
const promoCodesDb = require('../db/promoCodes');
const seasonalEventsDb = require('../db/seasonalEvents');
const { getItemInfo } = require('../data/items');
const goldWallet = require('../db/goldWallet');
const storeListings = require('../db/storeListings');
const { resolveSpeciesName } = require('../data/pokemon');

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// message_id of the force-reply prompt -> { adminId, chatId } — same pattern as
// collection.js's pendingSearches, so a "💰 Grant Coins" click can collect free-text input.
const pendingGrants = new Map();

// message_id of an edit-limit/edit-expiry force-reply prompt -> { adminId, code, field }
const pendingCodeEdits = new Map();

// message_id of a store add-listing / edit-price force-reply prompt -> { adminId, field, listingId? }
const pendingStoreInput = new Map();

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Groups', 'admin:groups')],
    [Markup.button.callback('🌍 Broadcast Force Spawn (All Groups)', 'admin:bc:menu')],
    [Markup.button.callback('🎟️ Promo Codes', 'admin:codes:menu')],
    [Markup.button.callback('🎉 Seasonal Events', 'admin:events:menu')],
    [Markup.button.callback('🛒 Store Management', 'admin:store:menu')],
    [Markup.button.callback('💰 Gold Earnings', 'admin:earnings:menu')],
    [Markup.button.callback('📊 Bot Stats', 'admin:globalstats')],
  ]);
}

function mainMenuText() {
  return [
    brandTag(),
    bold('🛠 Admin Panel'),
    '',
    '📋 Groups — pick one to force spawns, preview mission/streak alerts, view stats, grant coins, and more',
    '🌍 Broadcast Force Spawn — spawn a Pokémon in every active group at once',
    '🎟️ Promo Codes — manage existing codes (create new ones with /generatecode)',
    '🎉 Seasonal Events — manage events (create new ones with /seasonalevent)',
    '🛒 Store Management — manage the Gold Store catalog (grant Gold with /grantgold)',
    '💰 Gold Earnings — real-money Gold sold/spent, kept separate from gameplay Bot Stats',
    '📊 Bot Stats — total trainers, groups, and activity across the whole bot',
  ].join('\n');
}

// ── Gold Earnings (real-money tracking — deliberately separate from gameplay Bot Stats) ──
function earningsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🏆 Top Sellers', 'admin:earnings:topsellers')],
    [Markup.button.callback('👤 Grants By Admin', 'admin:earnings:byadmin')],
    [Markup.button.callback('⬅️ Main Menu', 'admin:menu')],
  ]);
}

function earningsSummaryText() {
  const granted = goldWallet.getGrantTotals();
  const spent = goldWallet.getSpendTotals();
  const refunded = goldWallet.getRefundTotals();
  const circulating = goldWallet.getCirculatingTotal();
  return [
    bold('💰 Gold Earnings'),
    '',
    'This tracks real money — Gold is only ever credited via /grantgold after an off-platform payment, so these numbers are your actual sales, separate from gameplay stats.',
    '',
    `💎 Total Gold Sold: ${bold(granted.total)} (${bold(granted.count)} grant${granted.count === 1 ? '' : 's'})`,
    `🛒 Total Gold Spent in Store: ${bold(spent.total)} (${bold(spent.count)} purchase${spent.count === 1 ? '' : 's'})`,
    `↩️ Total Refunded: ${bold(refunded.total)} (${bold(refunded.count)})`,
    `🏦 Gold Currently in Wallets: ${bold(circulating)}`,
  ].join('\n');
}

function categoryEmoji(category) {
  return {
    rare: '🔹',
    legendary: '🐉',
    mythical: '🌟',
    shiny: '✨',
    shiny_legendary: '✨🐉',
    shiny_mythical: '✨🌟',
    gigantamax: '🔴',
    dynamax: '🟣',
  }[category] || '❓';
}

function topSellersText() {
  const sellers = goldWallet.getTopSellers(10);
  if (sellers.length === 0) {
    return [bold('🏆 Top Sellers'), '', 'No store purchases yet.'].join('\n');
  }
  const lines = [bold('🏆 Top Sellers'), ''];
  sellers.forEach((s, i) => {
    const shinyLabel = s.shiny ? ' ✨' : '';
    lines.push(
      `${i + 1}. ${categoryEmoji(s.category)} ${escapeHtml(s.speciesName)}${shinyLabel} — ${bold(s.unitsSold)} sold, ${bold(`💎 ${s.revenue}`)} revenue`
    );
  });
  return lines.join('\n');
}

function grantsByAdminText() {
  const rows = goldWallet.getGrantsByAdmin();
  if (rows.length === 0) {
    return [bold('👤 Grants By Admin'), '', 'No Gold grants recorded yet.'].join('\n');
  }
  const lines = [bold('👤 Grants By Admin'), ''];
  for (const r of rows) {
    const label = r.adminId ? `Admin ${r.adminId}` : 'Unknown/system';
    lines.push(`${escapeHtml(label)} — ${bold(r.total)} Gold across ${bold(r.cnt)} grant${r.cnt === 1 ? '' : 's'}`);
  }
  return lines.join('\n');
}

// ── Store Management ────────────────────────────────────────────────────────
function storeMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Manage Listings', 'admin:store:list')],
    [Markup.button.callback('➕ Add Listing', 'admin:store:add')],
    [Markup.button.callback('⬅️ Main Menu', 'admin:menu')],
  ]);
}

function storeListingRowLabel(l) {
  const status = l.enabled ? '✅' : '🚫';
  const star = l.featured ? '⭐' : '';
  return `${status}${star} ${l.species_name}${l.shiny ? ' ✨' : ''} — 💎${l.price_gold} (${l.category})`;
}

function storeListKeyboard(listings) {
  const rows = listings.map((l) => [Markup.button.callback(storeListingRowLabel(l), `admin:store:detail:${l.id}`)]);
  rows.push([Markup.button.callback('⬅️ Back', 'admin:store:menu')]);
  return Markup.inlineKeyboard(rows);
}

function storeListText(listings) {
  if (listings.length === 0) return 'No store listings yet. Tap ➕ Add Listing to create one.';
  return 'Tap a listing to manage it:';
}

function storeDetailText(l) {
  const window =
    l.available_from || l.available_until
      ? `${l.available_from ? new Date(l.available_from).toLocaleString() : 'now'} → ${l.available_until ? new Date(l.available_until).toLocaleString() : 'forever'}`
      : 'Always available';
  return [
    bold(`🛒 ${escapeHtml(l.species_name)}${l.shiny ? ' ✨' : ''}`),
    '',
    `Category: ${bold(l.category)}`,
    `Price: ${bold(`💎 ${l.price_gold}`)}`,
    `Status: ${bold(l.enabled ? '✅ Enabled' : '🚫 Disabled')}`,
    `Featured: ${bold(l.featured ? '⭐ Yes' : 'No')}`,
    `Event label: ${l.event_label ? escapeHtml(l.event_label) : 'None (permanent stock)'}`,
    `Availability: ${window}`,
  ].join('\n');
}

function storeDetailKeyboard(l) {
  return Markup.inlineKeyboard([
    [
      l.enabled
        ? Markup.button.callback('🚫 Disable', `admin:store:toggle:${l.id}`)
        : Markup.button.callback('✅ Enable', `admin:store:toggle:${l.id}`),
      l.featured
        ? Markup.button.callback('⭐ Unfeature', `admin:store:togglefeat:${l.id}`)
        : Markup.button.callback('⭐ Feature', `admin:store:togglefeat:${l.id}`),
    ],
    [Markup.button.callback('✏️ Edit Price', `admin:store:editprice:${l.id}`)],
    [Markup.button.callback('🗑️ Delete', `admin:store:delconfirm:${l.id}`)],
    [Markup.button.callback('⬅️ Back to List', 'admin:store:list')],
  ]);
}

function storeDeleteConfirmKeyboard(id) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🗑️ Yes, delete permanently', `admin:store:delete:${id}`),
      Markup.button.callback('❌ Cancel', `admin:store:detail:${id}`),
    ],
  ]);
}

function buildGlobalStatsMessage() {
  const stats = users.getGlobalStats();
  const totalGroups = groupsDb.countAllGroups();
  const activeGroups = groupsDb.countActiveGroups();
  const redemptions = promoCodesDb.countRedemptions();
  return [
    bold('📊 Bot-Wide Stats'),
    '',
    `👥 Total Trainers: ${bold(stats.distinct_trainers)}`,
    `📋 Active Groups: ${bold(activeGroups)} (${bold(totalGroups)} ever registered)`,
    `🎯 Total Catches: ${bold(stats.total_catches)}`,
    `✨ Total Shinies: ${bold(stats.total_shinies)}`,
    `🐉 Total Legendaries: ${bold(stats.total_legendaries)}`,
    `🪙 Coins in Circulation: ${bold(stats.total_coins)}`,
    `🎮 Total Mini-Game Wins: ${bold(stats.total_game_wins)}`,
    `🎟️ Promo Codes Redeemed: ${bold(redemptions)}`,
  ].join('\n');
}

function codesMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Manage Codes', 'admin:codes:list')],
    [Markup.button.callback('⬅️ Main Menu', 'admin:menu')],
  ]);
}

function codeListKeyboard(codes) {
  const rows = codes.map((c) => [
    Markup.button.callback(`${c.active ? '✅' : '🚫'} ${c.code}`, `admin:codes:detail:${c.code}`),
  ]);
  rows.push([Markup.button.callback('⬅️ Back', 'admin:codes:menu')]);
  return Markup.inlineKeyboard(rows);
}

function formatCodeList(codes) {
  if (codes.length === 0) return 'No promo codes created yet. Use /generatecode to make one.';
  return 'Tap a code to view details and manage it:';
}

function formatRewardSummary(c) {
  const parts = [];
  if (c.coins > 0) parts.push(`💰 ${c.coins} coins`);
  if (c.xp > 0) parts.push(`✨ ${c.xp} XP`);
  if (c.item_key) parts.push(`🎒 ${escapeHtml(getItemInfo(c.item_key).label)} x${c.item_qty}`);
  if (c.pokemon_name) parts.push(`🐾 ${c.pokemon_shiny ? 'Shiny ' : ''}${escapeHtml(c.pokemon_name)}`);
  return parts.length ? parts.join(', ') : 'No reward configured';
}

function codeDetailText(c) {
  const usage = c.max_uses === null ? `${c.uses_count}/∞` : `${c.uses_count}/${c.max_uses}`;
  const remaining = c.max_uses === null ? '∞' : Math.max(0, c.max_uses - c.uses_count);
  const expired = promoCodesDb.isExpired(c);
  const expiryText = c.expires_at ? new Date(c.expires_at).toLocaleString() : 'Never';
  const status = !c.active ? '🚫 Disabled' : expired ? '⌛ Expired' : '✅ Active';
  return [
    bold(`🎟️ ${c.code}`),
    '',
    `Status: ${bold(status)}`,
    `Reward: ${formatRewardSummary(c)}`,
    `Uses: ${bold(usage)} (${bold(remaining)} remaining)`,
    `Expires: ${bold(expiryText)}`,
    `Created: ${new Date(c.created_at).toLocaleString()}`,
  ].join('\n');
}

function codeDetailKeyboard(c) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Edit Limit', `admin:codes:editlimit:${c.code}`)],
    [Markup.button.callback('✏️ Edit Expiry', `admin:codes:editexpiry:${c.code}`)],
    [
      c.active
        ? Markup.button.callback('🚫 Disable', `admin:codes:toggle:${c.code}`)
        : Markup.button.callback('✅ Reactivate', `admin:codes:toggle:${c.code}`),
    ],
    [Markup.button.callback('🗑️ Delete', `admin:codes:delconfirm:${c.code}`)],
    [Markup.button.callback('⬅️ Back to List', 'admin:codes:list')],
  ]);
}

function editLimitKeyboard(code) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('5', `admin:codes:setlimit:${code}:5`),
      Markup.button.callback('10', `admin:codes:setlimit:${code}:10`),
      Markup.button.callback('100', `admin:codes:setlimit:${code}:100`),
    ],
    [
      Markup.button.callback('♾️ Unlimited', `admin:codes:setlimit:${code}:unlimited`),
      Markup.button.callback('✏️ Custom', `admin:codes:setlimit:${code}:custom`),
    ],
    [Markup.button.callback('⬅️ Back', `admin:codes:detail:${code}`)],
  ]);
}

function editExpiryKeyboard(code) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Never', `admin:codes:setexpiry:${code}:never`)],
    [
      Markup.button.callback('1 Hour', `admin:codes:setexpiry:${code}:1h`),
      Markup.button.callback('24 Hours', `admin:codes:setexpiry:${code}:24h`),
    ],
    [
      Markup.button.callback('7 Days', `admin:codes:setexpiry:${code}:7d`),
      Markup.button.callback('30 Days', `admin:codes:setexpiry:${code}:30d`),
    ],
    [Markup.button.callback('✏️ Custom Date', `admin:codes:setexpiry:${code}:custom`)],
    [Markup.button.callback('⬅️ Back', `admin:codes:detail:${code}`)],
  ]);
}

function deleteConfirmKeyboard(code) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🗑️ Yes, delete permanently', `admin:codes:delete:${code}`),
      Markup.button.callback('❌ Cancel', `admin:codes:detail:${code}`),
    ],
  ]);
}

function eventsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Manage Events', 'admin:events:list')],
    [Markup.button.callback('⬅️ Main Menu', 'admin:menu')],
  ]);
}

function eventStatusEmoji(status) {
  return { active: '✅', upcoming: '⏳', ended: '⌛', disabled: '🚫' }[status] || '❓';
}

function eventListKeyboard(events) {
  const rows = events.map((e) => [
    Markup.button.callback(
      `${eventStatusEmoji(seasonalEventsDb.computeStatus(e))} ${e.name}`,
      `admin:events:detail:${e.id}`
    ),
  ]);
  rows.push([Markup.button.callback('⬅️ Back', 'admin:events:menu')]);
  return Markup.inlineKeyboard(rows);
}

function eventDetailText(e) {
  const status = seasonalEventsDb.computeStatus(e);
  return [
    bold(`🎉 ${escapeHtml(e.name)}`),
    '',
    `Status: ${bold(eventStatusEmoji(status) + ' ' + status)}`,
    `Themed Pokémon: ${escapeHtml(e.theme_species.split(',').join(', '))}`,
    `Starts: ${bold(new Date(e.starts_at).toLocaleString())}`,
    `Ends: ${bold(new Date(e.ends_at).toLocaleString())}`,
    `Created: ${new Date(e.created_at).toLocaleString()}`,
  ].join('\n');
}

function eventDetailKeyboard(e) {
  return Markup.inlineKeyboard([
    [
      e.active
        ? Markup.button.callback('🚫 Disable', `admin:events:toggle:${e.id}`)
        : Markup.button.callback('✅ Reactivate', `admin:events:toggle:${e.id}`),
    ],
    [Markup.button.callback('🗑️ Delete', `admin:events:delconfirm:${e.id}`)],
    [Markup.button.callback('⬅️ Back to List', 'admin:events:list')],
  ]);
}

function eventDeleteConfirmKeyboard(id) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🗑️ Yes, delete permanently', `admin:events:delete:${id}`),
      Markup.button.callback('❌ Cancel', `admin:events:detail:${id}`),
    ],
  ]);
}

function groupPickerKeyboard(groups) {
  const rows = groups.map((g) => [
    Markup.button.callback(g.title || `Chat ${g.chat_id}`, `admin:g:${g.chat_id}`),
  ]);
  rows.push([Markup.button.callback('⬅️ Main Menu', 'admin:menu')]);
  return Markup.inlineKeyboard(rows);
}

function actionKeyboard(chatId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎲 Force Spawn', `admin:a:${chatId}:spawn:random`),
      Markup.button.callback('✨ Force Shiny', `admin:a:${chatId}:spawn:shiny`),
    ],
    [
      Markup.button.callback('🐉 Force Legendary', `admin:a:${chatId}:spawn:legendary`),
      Markup.button.callback('🌟 Force Mythical', `admin:a:${chatId}:spawn:mythical`),
    ],
    [
      Markup.button.callback('✨🐉 Force Shiny Legendary', `admin:a:${chatId}:spawn:shiny_legendary`),
      Markup.button.callback('✨🌟 Force Shiny Mythical', `admin:a:${chatId}:spawn:shiny_mythical`),
    ],
    [
      Markup.button.callback('🐉 Start Legendary Raid', `admin:a:${chatId}:raid:legendary`),
      Markup.button.callback('🌟 Start Mythical Raid', `admin:a:${chatId}:raid:mythical`),
    ],
    [
      Markup.button.callback('🔴 Start Ultra Rare Raid', `admin:a:${chatId}:raid:ultra_rare`),
    ],
    [
      Markup.button.callback('🌞 Preview Mission', `admin:a:${chatId}:mission`),
      Markup.button.callback('⏰ Preview Streak Alert', `admin:a:${chatId}:streak`),
    ],
    [Markup.button.callback('📊 Group Stats', `admin:a:${chatId}:stats`)],
    [
      Markup.button.callback('🔁 Toggle Auto-Promo', `admin:a:${chatId}:togglepromo`),
      Markup.button.callback('📢 Announcement Help', `admin:a:${chatId}:announcehelp`),
    ],
    [Markup.button.callback('💰 Grant Coins', `admin:a:${chatId}:grantcoins`)],
    [Markup.button.callback('⬅️ Back to group list', 'admin:groups')],
  ]);
}

function buildStatsMessage(chatId) {
  const stats = users.getGroupStats(chatId);
  const lines = [
    bold('📊 Group Stats'),
    '',
    `👥 Total Trainers: ${bold(stats.total_trainers)}`,
    `🎯 Total Catches: ${bold(stats.total_catches)}`,
    `✨ Total Shinies: ${bold(stats.total_shinies)}`,
    `🐉 Total Legendaries: ${bold(stats.total_legendaries)}`,
    `🪙 Coins in Circulation: ${bold(stats.total_coins)}`,
  ];
  if (stats.topUser) {
    lines.push('', `🏆 Top Trainer: ${bold(escapeHtml(stats.topUser.username || 'Trainer'))} (Lv${stats.topUser.level})`);
  }
  return lines.join('\n');
}

async function sendMainMenu(ctx) {
  await ctx.reply(mainMenuText(), { ...HTML, ...mainMenuKeyboard() });
}

async function sendGroupList(ctx) {
  const groups = groupsDb.listActiveGroups();
  if (groups.length === 0) {
    await ctx.reply("No active groups yet — add me to a group first, then it'll show up here.");
    return;
  }
  await ctx.reply(
    [brandTag(), bold('📋 Groups'), '', 'Pick a group to manage:'].join('\n'),
    { ...HTML, ...groupPickerKeyboard(groups) }
  );
}

function broadcastRarityKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎲 Random', 'admin:bc:pick:random'),
      Markup.button.callback('✨ Shiny', 'admin:bc:pick:shiny'),
    ],
    [
      Markup.button.callback('🐉 Legendary', 'admin:bc:pick:legendary'),
      Markup.button.callback('🌟 Mythical', 'admin:bc:pick:mythical'),
    ],
    [
      Markup.button.callback('✨🐉 Shiny Legendary', 'admin:bc:pick:shiny_legendary'),
      Markup.button.callback('✨🌟 Shiny Mythical', 'admin:bc:pick:shiny_mythical'),
    ],
    [Markup.button.callback('⬅️ Back', 'admin:menu')],
  ]);
}

function broadcastConfirmKeyboard(rarity) {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Confirm Broadcast', `admin:bc:confirm:${rarity}`),
    Markup.button.callback('❌ Cancel', 'admin:menu'),
  ]);
}

function register(bot) {
  bot.command('admin', async (ctx) => {
    // Check chat type BEFORE revealing anything — in a group, everyone (admin or not)
    // gets the exact same generic rejection, with zero mention of DMs or a panel. That
    // way the command reveals nothing about who's an admin or that this feature exists.
    if (ctx.chat.type !== 'private') {
      await ctx.reply('🛠 You must be an admin to do this.');
      return;
    }
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    await sendMainMenu(ctx);
  });

  bot.on('text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !pendingGrants.has(replyTo.message_id)) return next ? next() : undefined;

    const pending = pendingGrants.get(replyTo.message_id);
    if (ctx.from.id !== pending.adminId || !isAdmin(ctx.from.id)) return next ? next() : undefined;
    pendingGrants.delete(replyTo.message_id);

    const parts = ctx.message.text.trim().split(/\s+/);
    const targetUserId = Number(parts[0]);
    const amount = Number(parts[1]);
    if (parts.length !== 2 || !Number.isInteger(targetUserId) || !Number.isInteger(amount) || amount <= 0) {
      await ctx.reply('⚠️ Could not parse that. Format: <user_id> <amount>, e.g. "123456789 100". Click 💰 Grant Coins again to retry.');
      return;
    }

    users.getOrCreateUser(pending.chatId, targetUserId, null);
    users.addCoins(pending.chatId, targetUserId, amount);
    const profile = users.getProfile(pending.chatId, targetUserId);
    const group = groupsDb.getGroup(pending.chatId);

    await ctx.reply(
      [
        `✅ Granted ${bold(amount)} coins to user ${bold(targetUserId)} in ${bold(group?.title || `Chat ${pending.chatId}`)}.`,
        `New balance: ${bold(profile.coins)} coins.`,
      ].join('\n'),
      HTML
    );
  });

  bot.on('text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !pendingCodeEdits.has(replyTo.message_id)) return next ? next() : undefined;

    const pending = pendingCodeEdits.get(replyTo.message_id);
    if (ctx.from.id !== pending.adminId || !isAdmin(ctx.from.id)) return next ? next() : undefined;
    pendingCodeEdits.delete(replyTo.message_id);

    const text = ctx.message.text.trim();
    const code = pending.code;

    if (pending.field === 'limit_custom') {
      const limit = Number(text);
      if (!Number.isInteger(limit) || limit <= 0) {
        const prompt = await ctx.reply(
          '⚠️ Please reply with a positive whole number.',
          Markup.forceReply()
        );
        pendingCodeEdits.set(prompt.message_id, pending);
        return;
      }
      promoCodesDb.editCode(code, { maxUses: limit });
      const updated = promoCodesDb.getCode(code);
      await ctx.reply(codeDetailText(updated), { ...HTML, ...codeDetailKeyboard(updated) });
      return;
    }

    if (pending.field === 'expiry_custom') {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        const prompt = await ctx.reply(
          '⚠️ Could not parse that date, or it\'s already in the past. Reply with a future date/time, e.g. "2026-08-01 18:00".',
          Markup.forceReply()
        );
        pendingCodeEdits.set(prompt.message_id, pending);
        return;
      }
      promoCodesDb.editCode(code, { expiresAt: parsed.toISOString() });
      const updated = promoCodesDb.getCode(code);
      await ctx.reply(codeDetailText(updated), { ...HTML, ...codeDetailKeyboard(updated) });
      return;
    }
  });

  bot.command('grantgold', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('🛠 You must be an admin to do this.');
      return;
    }
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    const replyTo = ctx.message.reply_to_message;
    let targetUserId;
    let amount;
    let note;
    if (replyTo) {
      targetUserId = replyTo.from.id;
      amount = Number(parts[0]);
      note = parts.slice(1).join(' ') || null;
    } else {
      targetUserId = Number(parts[0]);
      amount = Number(parts[1]);
      note = parts.slice(2).join(' ') || null;
    }
    if (!Number.isInteger(targetUserId) || !Number.isInteger(amount) || amount <= 0) {
      await ctx.reply(
        '⚠️ Usage: reply to the trainer\'s message with "/grantgold <amount> [note]", or run "/grantgold <user_id> <amount> [note]" directly.'
      );
      return;
    }
    const newBalance = goldWallet.credit(targetUserId, amount, 'admin_grant', ctx.from.id, note);
    await ctx.reply(
      [
        `✅ Granted ${bold(`💎 ${amount}`)} Gold to user ${bold(targetUserId)}.`,
        `New Gold balance: ${bold(newBalance)}.`,
      ].join('\n'),
      HTML
    );
  });

  bot.on('text', async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !pendingStoreInput.has(replyTo.message_id)) return next ? next() : undefined;

    const pending = pendingStoreInput.get(replyTo.message_id);
    if (ctx.from.id !== pending.adminId || !isAdmin(ctx.from.id)) return next ? next() : undefined;
    pendingStoreInput.delete(replyTo.message_id);

    if (pending.field === 'add_listing') {
      const parts = ctx.message.text.trim().split(/\s+/);
      if (parts.length < 4) {
        await ctx.reply(
          '⚠️ Format: &lt;species&gt; &lt;shiny:yes/no&gt; &lt;category&gt; &lt;price&gt; [event_label]. Tap ➕ Add Listing again to retry.',
          HTML
        );
        return;
      }
      const [speciesInput, shinyInput, categoryInput, priceInput, ...labelParts] = parts;
      const species = resolveSpeciesName(speciesInput);
      const shiny = /^y(es)?$/i.test(shinyInput);
      const category = categoryInput.toLowerCase();
      const price = Number(priceInput);
      if (!species) {
        await ctx.reply(`⚠️ "${escapeHtml(speciesInput)}" isn't a known Pokémon name. Tap ➕ Add Listing again to retry.`, HTML);
        return;
      }
      if (!storeListings.CATEGORIES.includes(category)) {
        await ctx.reply(
          `⚠️ Category must be one of: ${storeListings.CATEGORIES.join(', ')}. Tap ➕ Add Listing again to retry.`
        );
        return;
      }
      if (!Number.isInteger(price) || price <= 0) {
        await ctx.reply('⚠️ Price must be a positive whole number. Tap ➕ Add Listing again to retry.');
        return;
      }
      const listing = storeListings.addListing(species, shiny, category, price, {
        eventLabel: labelParts.length ? labelParts.join(' ') : null,
        createdBy: ctx.from.id,
      });
      await ctx.reply(storeDetailText(listing), { ...HTML, ...storeDetailKeyboard(listing) });
      return;
    }

    if (pending.field === 'edit_price') {
      const price = Number(ctx.message.text.trim());
      if (!Number.isInteger(price) || price <= 0) {
        const prompt = await ctx.reply('⚠️ Please reply with a positive whole number.', Markup.forceReply());
        pendingStoreInput.set(prompt.message_id, pending);
        return;
      }
      const updated = storeListings.updateListing(pending.listingId, { priceGold: price });
      if (!updated) {
        await ctx.reply('⚠️ That listing no longer exists.');
        return;
      }
      await ctx.reply(storeDetailText(updated), { ...HTML, ...storeDetailKeyboard(updated) });
      return;
    }
  });

  bot.action('admin:earnings:menu', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply(earningsSummaryText(), { ...HTML, ...earningsMenuKeyboard() });
  });

  bot.action('admin:earnings:topsellers', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(topSellersText(), { ...HTML, ...earningsMenuKeyboard() });
  });

  bot.action('admin:earnings:byadmin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(grantsByAdminText(), { ...HTML, ...earningsMenuKeyboard() });
  });

  bot.action('admin:store:menu', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply(
      [bold('🛒 Store Management'), '', 'Grant Gold to a trainer with /grantgold (reply to their message, or pass a user ID).'].join('\n'),
      { ...HTML, ...storeMenuKeyboard() }
    );
  });

  bot.action('admin:store:list', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    const listings = storeListings.listAll();
    await ctx.reply(
      [bold('📋 Store Listings'), '', storeListText(listings)].join('\n'),
      { ...HTML, ...storeListKeyboard(listings) }
    );
  });

  bot.action(/^admin:store:detail:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const listing = storeListings.getListing(Number(ctx.match[1]));
    if (!listing) {
      await ctx.answerCbQuery('That listing no longer exists.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(storeDetailText(listing), { ...HTML, ...storeDetailKeyboard(listing) });
  });

  bot.action(/^admin:store:toggle:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const id = Number(ctx.match[1]);
    const listing = storeListings.getListing(id);
    if (!listing) {
      await ctx.answerCbQuery('That listing no longer exists.', { show_alert: true });
      return;
    }
    const updated = storeListings.setEnabled(id, !listing.enabled);
    await ctx.answerCbQuery(updated.enabled ? 'Enabled.' : 'Disabled.');
    await ctx.editMessageText(storeDetailText(updated), { ...HTML, ...storeDetailKeyboard(updated) });
  });

  bot.action(/^admin:store:togglefeat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const id = Number(ctx.match[1]);
    const listing = storeListings.getListing(id);
    if (!listing) {
      await ctx.answerCbQuery('That listing no longer exists.', { show_alert: true });
      return;
    }
    const updated = storeListings.setFeatured(id, !listing.featured);
    await ctx.answerCbQuery(updated.featured ? 'Featured.' : 'Unfeatured.');
    await ctx.editMessageText(storeDetailText(updated), { ...HTML, ...storeDetailKeyboard(updated) });
  });

  bot.action(/^admin:store:editprice:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const id = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    const prompt = await ctx.reply('✏️ Reply with the new Gold price for this listing.', Markup.forceReply());
    pendingStoreInput.set(prompt.message_id, { adminId: ctx.from.id, field: 'edit_price', listingId: id });
  });

  bot.action(/^admin:store:delconfirm:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const listing = storeListings.getListing(Number(ctx.match[1]));
    if (!listing) {
      await ctx.answerCbQuery('That listing no longer exists.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🗑️ Permanently delete ${bold(escapeHtml(listing.species_name))}? This can't be undone.`,
      { ...HTML, ...storeDeleteConfirmKeyboard(listing.id) }
    );
  });

  bot.action(/^admin:store:delete:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const id = Number(ctx.match[1]);
    storeListings.deleteListing(id);
    await ctx.answerCbQuery('Deleted.');
    const listings = storeListings.listAll();
    await ctx.editMessageText(
      [bold('📋 Store Listings'), '', storeListText(listings)].join('\n'),
      { ...HTML, ...storeListKeyboard(listings) }
    );
  });

  bot.action('admin:store:add', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    const prompt = await ctx.reply(
      [
        '➕ Reply with: &lt;species&gt; &lt;shiny:yes/no&gt; &lt;category&gt; &lt;price&gt; [event_label]',
        `Categories: ${storeListings.CATEGORIES.join(', ')}`,
        'e.g. "Ho-Oh no legendary 500" or "Rayquaza yes shiny_legendary 800 Anniversary Sale"',
      ].join('\n'),
      { ...HTML, ...Markup.forceReply() }
    );
    pendingStoreInput.set(prompt.message_id, { adminId: ctx.from.id, field: 'add_listing' });
  });

  bot.action('admin:menu', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await sendMainMenu(ctx);
  });

  bot.action('admin:groups', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await sendGroupList(ctx);
  });

  bot.action('admin:globalstats', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply(buildGlobalStatsMessage(), HTML);
  });

  bot.action('admin:codes:menu', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply(
      [bold('🎟️ Promo Codes'), '', 'Codes are global — redeemable in any group, once per trainer.'].join('\n'),
      { ...HTML, ...codesMenuKeyboard() }
    );
  });

  bot.action('admin:codes:list', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    const codes = promoCodesDb.listCodes();
    await ctx.reply(
      [bold('📋 Promo Codes'), '', formatCodeList(codes)].join('\n'),
      { ...HTML, ...codeListKeyboard(codes) }
    );
  });

  bot.action(/^admin:codes:detail:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const code = promoCodesDb.getCode(ctx.match[1]);
    if (!code) {
      await ctx.answerCbQuery('That code no longer exists.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(codeDetailText(code), { ...HTML, ...codeDetailKeyboard(code) });
  });

  bot.action(/^admin:codes:toggle:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const codeText = ctx.match[1];
    const entry = promoCodesDb.getCode(codeText);
    if (!entry) {
      await ctx.answerCbQuery('That code no longer exists.', { show_alert: true });
      return;
    }
    if (entry.active) {
      promoCodesDb.deactivateCode(codeText);
      await ctx.answerCbQuery('Disabled.');
    } else {
      promoCodesDb.reactivateCode(codeText);
      await ctx.answerCbQuery('Reactivated.');
    }
    const updated = promoCodesDb.getCode(codeText);
    await ctx.editMessageText(codeDetailText(updated), { ...HTML, ...codeDetailKeyboard(updated) });
  });

  bot.action(/^admin:codes:editlimit:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const code = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✏️ New usage limit for ${bold(code)}:`, { ...HTML, ...editLimitKeyboard(code) });
  });

  bot.action(/^admin:codes:setlimit:(.+):(5|10|100|unlimited|custom)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const [, code, choice] = ctx.match;
    if (choice === 'custom') {
      await ctx.answerCbQuery();
      const prompt = await ctx.reply(
        `✏️ Reply with the new maximum number of redemptions for ${bold(code)}.`,
        { ...HTML, ...Markup.forceReply() }
      );
      pendingCodeEdits.set(prompt.message_id, { adminId: ctx.from.id, code, field: 'limit_custom' });
      return;
    }
    const maxUses = choice === 'unlimited' ? null : Number(choice);
    promoCodesDb.editCode(code, { maxUses });
    await ctx.answerCbQuery('Limit updated.');
    const updated = promoCodesDb.getCode(code);
    await ctx.editMessageText(codeDetailText(updated), { ...HTML, ...codeDetailKeyboard(updated) });
  });

  bot.action(/^admin:codes:editexpiry:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const code = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✏️ New expiration for ${bold(code)}:`, { ...HTML, ...editExpiryKeyboard(code) });
  });

  bot.action(/^admin:codes:setexpiry:(.+):(never|1h|24h|7d|30d|custom)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const [, code, choice] = ctx.match;
    if (choice === 'custom') {
      await ctx.answerCbQuery();
      const prompt = await ctx.reply(
        `✏️ Reply with a date/time for ${bold(code)}, e.g. "2026-08-01 18:00".`,
        { ...HTML, ...Markup.forceReply() }
      );
      pendingCodeEdits.set(prompt.message_id, { adminId: ctx.from.id, code, field: 'expiry_custom' });
      return;
    }
    const durations = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
    const expiresAt = choice === 'never' ? null : new Date(Date.now() + durations[choice]).toISOString();
    promoCodesDb.editCode(code, { expiresAt });
    await ctx.answerCbQuery('Expiry updated.');
    const updated = promoCodesDb.getCode(code);
    await ctx.editMessageText(codeDetailText(updated), { ...HTML, ...codeDetailKeyboard(updated) });
  });

  bot.action(/^admin:codes:delconfirm:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const code = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🗑️ Permanently delete ${bold(code)}? This can't be undone (though past redemptions of it stay blocked even if recreated).`,
      { ...HTML, ...deleteConfirmKeyboard(code) }
    );
  });

  bot.action(/^admin:codes:delete:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const code = ctx.match[1];
    promoCodesDb.deleteCode(code);
    await ctx.answerCbQuery('Deleted.');
    const codes = promoCodesDb.listCodes();
    await ctx.editMessageText(
      [bold('📋 Promo Codes'), '', formatCodeList(codes)].join('\n'),
      { ...HTML, ...codeListKeyboard(codes) }
    );
  });

  bot.action('admin:events:menu', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply(
      [bold('🎉 Seasonal Events'), '', 'Create new ones with /seasonalevent (DM only).'].join('\n'),
      { ...HTML, ...eventsMenuKeyboard() }
    );
  });

  bot.action('admin:events:list', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    const events = seasonalEventsDb.listEvents();
    const text = events.length === 0
      ? 'No seasonal events created yet. Use /seasonalevent to make one.'
      : 'Tap an event to view details and manage it:';
    await ctx.editMessageText(
      [bold('📋 Seasonal Events'), '', text].join('\n'),
      { ...HTML, ...eventListKeyboard(events) }
    );
  });

  bot.action(/^admin:events:detail:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const event = seasonalEventsDb.getEvent(Number(ctx.match[1]));
    if (!event) {
      await ctx.answerCbQuery('That event no longer exists.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(eventDetailText(event), { ...HTML, ...eventDetailKeyboard(event) });
  });

  bot.action(/^admin:events:toggle:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const id = Number(ctx.match[1]);
    const event = seasonalEventsDb.getEvent(id);
    if (!event) {
      await ctx.answerCbQuery('That event no longer exists.', { show_alert: true });
      return;
    }
    seasonalEventsDb.setActive(id, !event.active);
    await ctx.answerCbQuery(event.active ? 'Disabled.' : 'Reactivated.');
    const updated = seasonalEventsDb.getEvent(id);
    await ctx.editMessageText(eventDetailText(updated), { ...HTML, ...eventDetailKeyboard(updated) });
  });

  bot.action(/^admin:events:delconfirm:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const id = Number(ctx.match[1]);
    const event = seasonalEventsDb.getEvent(id);
    if (!event) {
      await ctx.answerCbQuery('That event no longer exists.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🗑️ Permanently delete ${bold(escapeHtml(event.name))}? This can't be undone.`,
      { ...HTML, ...eventDeleteConfirmKeyboard(id) }
    );
  });

  bot.action(/^admin:events:delete:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const id = Number(ctx.match[1]);
    seasonalEventsDb.deleteEvent(id);
    await ctx.answerCbQuery('Deleted.');
    const events = seasonalEventsDb.listEvents();
    const text = events.length === 0
      ? 'No seasonal events created yet. Use /seasonalevent to make one.'
      : 'Tap an event to view details and manage it:';
    await ctx.editMessageText(
      [bold('📋 Seasonal Events'), '', text].join('\n'),
      { ...HTML, ...eventListKeyboard(events) }
    );
  });

  bot.action(/^admin:g:(-?\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const targetChatId = Number(ctx.match[1]);
    const group = groupsDb.getGroup(targetChatId);
    await ctx.answerCbQuery();
    await ctx.reply(
      [bold('🛠 Managing:'), group?.title || `Chat ${targetChatId}`].join(' '),
      { ...HTML, ...actionKeyboard(targetChatId) }
    );
  });

  bot.action('admin:bc:menu', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.reply(
      [bold('🌍 Broadcast Force Spawn'), '', 'This spawns one Pokémon in every active group at once. Pick a rarity:'].join('\n'),
      { ...HTML, ...broadcastRarityKeyboard() }
    );
  });

  bot.action(/^admin:bc:pick:(random|shiny|legendary|mythical|shiny_legendary|shiny_mythical)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const rarity = ctx.match[1];
    const groupCount = groupsDb.listActiveGroups().length;
    await ctx.answerCbQuery();
    await ctx.reply(
      [
        bold('🌍 Broadcast Force Spawn — Confirm'),
        '',
        `Rarity: ${bold(rarity)}`,
        `This will spawn in all ${bold(groupCount)} active group(s). Proceed?`,
      ].join('\n'),
      { ...HTML, ...broadcastConfirmKeyboard(rarity) }
    );
  });

  bot.action(/^admin:bc:confirm:(random|shiny|legendary|mythical|shiny_legendary|shiny_mythical)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }
    const rarity = ctx.match[1];
    await ctx.answerCbQuery('Broadcasting...');

    const groups = groupsDb.listActiveGroups();
    let sent = 0;
    let failed = 0;
    let removed = 0;
    for (const group of groups) {
      try {
        if (rarity === 'random') {
          await spawnFeature.doSpawn(ctx.telegram, group.chat_id);
        } else {
          await spawnFeature.forceSpawn(ctx.telegram, group.chat_id, rarity, '🛠 Admin panel broadcast spawn.');
        }
        sent++;
      } catch (err) {
        failed++;
        console.error(`Broadcast spawn failed for chat ${group.chat_id}:`, err.message);
        if (deactivateIfGroupGone(group.chat_id, err, 'broadcast spawn')) {
          spawnFeature.stopSpawns(group.chat_id);
          removed++;
        }
      }
    }

    const resultLines = [bold('🌍 Broadcast complete!'), '', `✅ Spawned in ${bold(sent)} group(s)`];
    if (failed > 0) {
      resultLines.push(`⚠️ Failed for ${bold(failed)} group(s) (bot may have been removed from them)`);
    }
    if (removed > 0) {
      resultLines.push(`🚫 Auto-removed ${bold(removed)} group(s) that are no longer reachable`);
    }
    await ctx.editMessageText(resultLines.join('\n'), HTML);
  });

  bot.action(/^admin:a:(-?\d+):([a-z]+):?(\w*)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('🛠 Admins only.');
      return;
    }

    const targetChatId = Number(ctx.match[1]);
    const action = ctx.match[2];
    const param = ctx.match[3];

    if (action === 'spawn') {
      await ctx.answerCbQuery(`Spawning (${param})...`);
      if (param === 'random') {
        await spawnFeature.doSpawn(ctx.telegram, targetChatId);
      } else {
        await spawnFeature.forceSpawn(ctx.telegram, targetChatId, param, '🛠 Admin panel forced spawn.');
      }
      await ctx.reply(`✅ Spawn sent to that group.`);
      return;
    }

    if (action === 'raid') {
      if (bossRaidFeature.isRaidActive(targetChatId)) {
        await ctx.answerCbQuery('A raid is already active in that group.', { show_alert: true });
        return;
      }
      if (raidDailyLimits.getCountToday(targetChatId) >= raidDailyLimits.DAILY_LIMIT) {
        await ctx.answerCbQuery(`This group already ran ${raidDailyLimits.DAILY_LIMIT} raids today.`, { show_alert: true });
        return;
      }
      await ctx.answerCbQuery(`Starting ${param} raid...`);
      raidDailyLimits.increment(targetChatId);
      try {
        await bossRaidFeature.startRaid(bot, targetChatId, param);
        await ctx.reply(`✅ Raid lobby opened in that group.`);
      } catch (err) {
        await ctx.reply("⚠️ Couldn't post the raid in that group — check the bot still has permission to post there.");
      }
      return;
    }

    if (action === 'mission') {
      await ctx.answerCbQuery('Posting mission preview...');
      await morningMissionFeature.postMorningMission(bot, targetChatId);
      await ctx.reply('✅ Mission preview posted in that group.');
      return;
    }

    if (action === 'streak') {
      await ctx.answerCbQuery('Checking streak alerts...');
      await streakReminderFeature.postStreakReminder(bot, targetChatId);
      await ctx.reply('✅ Checked — if nothing posted in the group, nobody is at risk of losing a streak.');
      return;
    }

    if (action === 'stats') {
      await ctx.answerCbQuery();
      await ctx.reply(buildStatsMessage(targetChatId), HTML);
      return;
    }

    if (action === 'togglepromo') {
      const enabled = groupsDb.toggleAutopromo(targetChatId);
      await ctx.answerCbQuery(enabled ? 'Auto-promo enabled!' : 'Auto-promo disabled.');
      await ctx.reply(
        enabled
          ? '🔁 Auto-promo is now ON for that group — a reminder posts every 6 hours. Customize it with /setpromo <text> (run inside the group).'
          : '🔁 Auto-promo is now OFF for that group.'
      );
      return;
    }

    if (action === 'grantcoins') {
      await ctx.answerCbQuery();
      const group = groupsDb.getGroup(targetChatId);
      const prompt = await ctx.reply(
        [
          `💰 Granting coins in ${bold(group?.title || `Chat ${targetChatId}`)}`,
          '',
          'Reply to this message with: &lt;user_id&gt; &lt;amount&gt;',
          'e.g. 123456789 100',
          '',
          "Don't know their ID? Ask the trainer to send /myid (works in DM or the group) and read it back to you.",
        ].join('\n'),
        { ...HTML, ...Markup.forceReply() }
      );
      pendingGrants.set(prompt.message_id, { adminId: ctx.from.id, chatId: targetChatId });
      return;
    }

    if (action === 'announcehelp') {
      await ctx.answerCbQuery();
      await ctx.reply(
        'Use /announcement <message> (in any chat) to broadcast to every active group — you\'ll get a preview and a confirm button before anything is sent.'
      );
      return;
    }

    await ctx.answerCbQuery('Unknown action.');
  });
}

module.exports = { register };
