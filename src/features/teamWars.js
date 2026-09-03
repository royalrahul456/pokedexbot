const cron = require('node-cron');
const teamWarsDb = require('../db/teamWars');
const users = require('../db/users');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML, brandTag } = require('../utils/text');
const { formatDuration } = require('../utils/format');
const { deactivateIfGroupGone } = require('../utils/groupHealth');
const { ADMIN_IDS } = require('../config');

const TEAM_WAR_WIN_COINS = 300;
const DEFAULT_HOURS = 24;
const MAX_HOURS = 168; // 7 days
const TEAM_EMOJI = { red: '🔴', blue: '🔵' };

function teamLabel(team) {
  return `${TEAM_EMOJI[team] || ''} Team ${team[0].toUpperCase()}${team.slice(1)}`;
}

// Computes each side's total XP gained since the war started (or since each member joined,
// for late joiners) — live, so it can be shown any time without waiting for the war to end.
function tallyWar(chatId, war) {
  const participants = teamWarsDb.listParticipants(war.id);
  const totals = { red: 0, blue: 0 };
  const counts = { red: 0, blue: 0 };
  for (const p of participants) {
    const profile = users.getProfile(chatId, p.user_id);
    const currentXp = profile ? profile.xp : p.xp_at_join;
    const gained = Math.max(0, currentXp - p.xp_at_join);
    totals[p.team] = (totals[p.team] || 0) + gained;
    counts[p.team] = (counts[p.team] || 0) + 1;
  }
  return { totals, counts, participants };
}

function statusText(chatId, war) {
  const { totals, counts } = tallyWar(chatId, war);
  const msRemaining = Date.parse(war.ends_at) - Date.now();
  return [
    brandTag(),
    bold('⚔️ Team War — Live Standings'),
    '',
    `${teamLabel('red')}: ${bold(totals.red)} XP (${counts.red || 0} members)`,
    `${teamLabel('blue')}: ${bold(totals.blue)} XP (${counts.blue || 0} members)`,
    '',
    msRemaining > 0 ? `⏳ Ends in ${bold(formatDuration(msRemaining))}` : '⏳ Wrapping up shortly...',
  ].join('\n');
}

async function resolveWar(bot, war) {
  const chatId = war.chat_id;
  const { totals, participants } = tallyWar(chatId, war);
  teamWarsDb.endWar(war.id);

  let winner = null;
  if (totals.red !== totals.blue) {
    winner = totals.red > totals.blue ? 'red' : 'blue';
  }

  const lines = [
    brandTag(),
    bold('🏁 Team War Results!'),
    '',
    `${teamLabel('red')}: ${bold(totals.red)} XP`,
    `${teamLabel('blue')}: ${bold(totals.blue)} XP`,
    '',
  ];

  if (!winner) {
    lines.push("🤝 It's a tie! No bonus this time — go again with /teamwar.");
  } else {
    lines.push(`🏆 ${bold(teamLabel(winner))} wins!`);
    for (const p of participants) {
      if (p.team !== winner) continue;
      grantRewards(chatId, p.user_id, { xp: XP.TEAM_WAR_WIN, coins: TEAM_WAR_WIN_COINS });
    }
    lines.push(`Every ${teamLabel(winner)} member earned +${XP.TEAM_WAR_WIN} XP, +${TEAM_WAR_WIN_COINS} Coins!`);
  }

  await bot.telegram.sendMessage(chatId, lines.join('\n'), HTML);
}

function register(bot) {
  bot.command('jointeam', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    if (arg !== 'red' && arg !== 'blue') {
      await ctx.reply('Usage: /jointeam red — or /jointeam blue');
      return;
    }

    users.getOrCreateUser(chatId, userId, ctx.from.username || ctx.from.first_name);
    const existingTeam = teamWarsDb.getTeam(chatId, userId);
    const activeWar = teamWarsDb.getActiveWar(chatId);

    if (activeWar && existingTeam && existingTeam !== arg && teamWarsDb.getParticipant(activeWar.id, userId)) {
      await ctx.reply("⚔️ You can't switch teams while a war is active in this group — wait for it to end.");
      return;
    }

    teamWarsDb.setTeam(chatId, userId, arg);
    if (activeWar) {
      const profile = users.getProfile(chatId, userId);
      teamWarsDb.ensureParticipant(activeWar.id, userId, arg, profile.xp);
    }

    await ctx.reply(`You're now on ${bold(teamLabel(arg))}!${activeWar ? ' You\'ve been entered into the active war.' : ''}`, HTML);
  });

  bot.command('teamwar', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
      await ctx.reply('Run /teamwar inside a group.');
      return;
    }
    if (teamWarsDb.getActiveWar(ctx.chat.id)) {
      await ctx.reply('⚔️ A Team War is already active in this group.');
      return;
    }

    const hoursArg = Number(ctx.message.text.split(' ')[1]);
    const hours = Number.isFinite(hoursArg) && hoursArg > 0 ? Math.min(hoursArg, MAX_HOURS) : DEFAULT_HOURS;
    const endsAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const warId = teamWarsDb.startWar(ctx.chat.id, endsAt, ctx.from.id);

    for (const member of teamWarsDb.listMembers(ctx.chat.id)) {
      const profile = users.getProfile(ctx.chat.id, member.user_id) || { xp: 0 };
      teamWarsDb.ensureParticipant(warId, member.user_id, member.team, profile.xp);
    }

    await ctx.reply(
      [
        brandTag(),
        bold('⚔️ Team War Started!'),
        '',
        `Running for ${bold(formatDuration(hours * 60 * 60 * 1000))}. Whichever team earns the most XP wins —`,
        `everyone on the winning side gets +${XP.TEAM_WAR_WIN} XP, +${TEAM_WAR_WIN_COINS} Coins.`,
        '',
        `Not on a team yet? /jointeam red or /jointeam blue to join in.`,
        `Check progress any time with /warstatus.`,
      ].join('\n'),
      HTML
    );
  });

  bot.command('warstatus', async (ctx) => {
    const war = teamWarsDb.getActiveWar(ctx.chat.id);
    if (!war) {
      await ctx.reply('No Team War is active in this group right now.');
      return;
    }
    await ctx.reply(statusText(ctx.chat.id, war), HTML);
  });

  // Checked every 10 minutes — resolves any war whose window has ended, same dynamic-expiry
  // style as promo codes/seasonal events rather than needing an exact-time cron per war.
  cron.schedule('*/10 * * * *', async () => {
    const dueWars = teamWarsDb.listDueWars(new Date().toISOString());
    for (const war of dueWars) {
      try {
        await resolveWar(bot, war);
      } catch (err) {
        console.error(`Failed to resolve team war ${war.id} for chat ${war.chat_id}:`, err.message);
        deactivateIfGroupGone(war.chat_id, err, 'team war resolution');
        teamWarsDb.endWar(war.id); // don't retry forever even if the group is gone
      }
    }
  });

  // Admin-only: resolve the current group's war immediately, for testing.
  bot.command('testteamwar', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    const war = teamWarsDb.getActiveWar(ctx.chat.id);
    if (!war) {
      await ctx.reply('No active war to resolve in this group.');
      return;
    }
    await resolveWar(bot, war);
  });
}

module.exports = { register };
