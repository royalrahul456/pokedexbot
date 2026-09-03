const { Markup } = require('telegraf');
const users = require('../db/users');
const pokemonCollectionDb = require('../db/pokemonCollection');
const battleCooldowns = require('../db/battleCooldowns');
const raidTeams = require('../db/raidTeams');
const { COMMON, RARE, getPokedexEntry, getBaseRarity } = require('../data/pokemon');
const { computeStats, movesFor, calcDamage, hpBar, TYPE_CHART, TYPE_EMOJI } = require('../data/battleData');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatDuration } = require('../utils/format');
const { formatRules } = require('../data/gameRules');
const { react } = require('../utils/reactions');
const { getTunnelUrl } = require('../webapp/tunnelUrl');
const { parseRetryAfterMs } = require('../utils/telegramRetry');

const BET_COINS = 60;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MOVE_TTL_MS = 10 * 60 * 1000;
const BOT_ID = 'BOT';
const BATTLE_EDIT_THROTTLE_MS = 2000;
const EVENT_LOG_MAX = 20;

// Team battles (2026-07-24) — 3 Pokémon per side, Pokémon GO PvP-style: a fainted Pokémon is
// swapped out for the next one in line automatically rather than ending the match, so the whole
// squad matters, not just whichever single mon you happened to pick.
const TEAM_SIZE = 3;

// Telegram rate-limits edits to roughly 1/sec per chat — a real user hit a 429 in production
// with the original 2-frame/400ms suspense (up to 4 edits inside ~1.3s). Fewer frames, spaced
// further apart, keeps the same "juicy" feel without tripping that limit. A second, later round
// of real 429s (found while building the PvP Mini App) showed that spacing WITHIN one turn
// wasn't enough on its own — two separate rapid turns (e.g. both players tapping fast) could
// still stack edits closer together than Telegram allows, since nothing tracked timing ACROSS
// turns. `throttledBattleEdit` below fixes that at the match level.
const SUSPENSE_FRAMES = 1;
const SUSPENSE_DELAY_MS = 700;
const BOT_THINK_DELAY_MS = 700;
const KO_FLASH_DELAY_MS = 700;
const SWAP_DELAY_MS = 700;
const NO_KEYBOARD = { reply_markup: { inline_keyboard: [] } };

// Rotating flavor text — same one edit per beat as before, just more personality per edit
// instead of the old fixed phrasing. `{name}`/`{move}` are filled in per use.
const SUSPENSE_TEMPLATES = [
  '{name} is winding up {move}...',
  '{name} charges up {move}...',
  '{name} braces and unleashes {move}...',
  '{name} channels power into {move}...',
  '{name} locks on with {move}...',
];
const BOT_THINK_LINES = [
  '🤖 Bot is choosing a move...',
  '🤖 Bot is calculating the odds...',
  '🤖 Bot is sizing up the opponent...',
  '🤖 Bot is plotting its next move...',
];
const KO_FLAVOR = [
  '{mon} is down...',
  '{mon} can\'t continue...',
  '{mon} hits the ground...',
  '{mon} has nothing left...',
];
const SWAP_FLAVOR = [
  '{name} sends out {mon}!',
  '{name} calls on {mon}!',
  '{name} switches in {mon}!',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const matches = new Map(); // matchId -> match (phase: 'challenge' | 'battle' | 'ended')
let nextId = 1;

// Lets the Mini App backend (src/webapp/server.js) subscribe to every battle state change —
// same pattern as bossRaid.js's onRaidChange/emitRaidChange, so a move from either surface
// (Telegram buttons or the web arena) keeps both in sync automatically.
const battleChangeListeners = [];
function onBattleChange(fn) {
  battleChangeListeners.push(fn);
}
function emitBattleChange(match) {
  for (const fn of battleChangeListeners) {
    try {
      fn(match);
    } catch (err) {
      console.error('Battle change listener threw (ignored):', err.message);
    }
  }
}

function addBattleEvent(match, text) {
  if (!match.eventLog) match.eventLog = [];
  match.eventLog.push({ text, at: Date.now() });
  if (match.eventLog.length > EVENT_LOG_MAX) match.eventLog.shift();
}

// ── Pre-built team (shared with raids via `/myteam`) ────────────────────────
//
// The old in-chat 3-Pokémon picker is gone (2026-08-03). It posted up to 3 sequential picker
// messages PER player into the group and edited them on every tap — under real use this lagged,
// dropped picks to Telegram rate limits, and hit a race where a completed pick could report
// "your team is already full" while the battle never actually started. Exactly the same problem
// (and the same fix) as the raid team picker: battles now use the trainer's pre-built saved team
// from `/myteam` (the `raid_saved_teams` table + team.html Mini App — shared, one team per
// trainer for both raids and battles), resolved instantly with zero in-chat picking. Teams are
// re-validated against live ownership + faint cooldowns at battle-start time, so a saved pick
// that's since been traded away or is currently resting is caught, not silently used.

// Duplicate-aware, cooldown-aware resolution — mirrors bossRaid.js's resolveSavedTeam exactly,
// but builds battle-shaped mons (makeMonFromCollectionRow adds `owned: true`, which battle's
// faint-cooldown logic needs). Returns an array of 3 battle mons, or null if the saved team is
// missing / no longer fully owned / not enough free (non-resting) copies right now.
function resolveSavedTeamForBattle(userId) {
  const savedTeam = raidTeams.getTeam(userId);
  if (!savedTeam) return null;
  const allOwned = pokemonCollectionDb.listCollection(userId);
  const usedCount = new Map();
  const team = [];
  for (const pick of savedTeam) {
    const row = allOwned.find((r) => r.species_name === pick.speciesName && Boolean(r.shiny) === pick.shiny);
    if (!row || row.quantity <= 0) return null;
    const key = `${pick.speciesName}|${pick.shiny}`;
    const alreadyUsed = usedCount.get(key) || 0;
    const resting = battleCooldowns.restingCount(userId, pick.speciesName, pick.shiny);
    if (alreadyUsed + 1 > row.quantity - resting) return null;
    usedCount.set(key, alreadyUsed + 1);
    team.push(makeMonFromCollectionRow(row));
  }
  return team;
}

// Distinguishes WHY a saved team is currently unusable so the DM prompt can say the right thing
// — same three-way distinction (and same duplicate-aware allocation) as bossRaid.js.
function savedTeamIssueForBattle(userId) {
  const savedTeam = raidTeams.getTeam(userId);
  if (!savedTeam) return 'no_team';
  const allOwned = pokemonCollectionDb.listCollection(userId);
  const usedCount = new Map();
  for (const pick of savedTeam) {
    const row = allOwned.find((r) => r.species_name === pick.speciesName && Boolean(r.shiny) === pick.shiny);
    if (!row || row.quantity <= 0) return 'not_owned';
    const key = `${pick.speciesName}|${pick.shiny}`;
    const alreadyUsed = usedCount.get(key) || 0;
    const resting = battleCooldowns.restingCount(userId, pick.speciesName, pick.shiny);
    if (alreadyUsed + 1 > row.quantity - resting) return 'resting';
    usedCount.set(key, alreadyUsed + 1);
  }
  return null;
}

// DMs the trainer the team-builder Mini App link (the same team.html raids use). Returns true if
// the DM landed, false if the bot can't message them yet (never opened a private chat) — callers
// surface those two cases differently. Never throws.
async function promptBattleTeamSetup(telegram, userId, issue) {
  const tunnelUrl = getTunnelUrl();
  const intro =
    issue === 'resting'
      ? '⏳ One of your saved team Pokémon is still resting after a recent faint — build a fresh team (or wait it out) before battling.'
      : issue === 'not_owned'
        ? '⚠️ Your saved team includes a Pokémon you no longer have — build a new team before battling.'
        : "🐾 You don't have a battle team set up yet — pick your 3 Pokémon once, then every battle starts instantly.";
  const keyboard = tunnelUrl
    ? Markup.inlineKeyboard([[Markup.button.webApp('🛠 Build My Team', `${tunnelUrl}/team.html`)]])
    : undefined;
  try {
    await telegram.sendMessage(
      userId,
      `${bold(intro)}\n\nBuild it with /myteam, then start the battle again.`,
      keyboard ? { ...HTML, ...keyboard } : HTML
    );
    return true;
  } catch (err) {
    return false;
  }
}

function challengeKeyboard(matchId, isTargeted) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(isTargeted ? '⚔️ Accept' : '⚔️ Accept Challenge', `battle:${matchId}:accept`)],
    [Markup.button.callback('🤖 Play vs Bot', `battle:${matchId}:bot`)],
    [
      Markup.button.callback('📖 Rules', `battle:${matchId}:rules`),
      Markup.button.callback('❌ Cancel', `battle:${matchId}:cancel`),
    ],
  ]);
}

function makeMonFromCollectionRow(row) {
  const entry = getPokedexEntry(row.species_name);
  const stats = computeStats(row.base_rarity, Boolean(row.shiny), row.species_name);
  return {
    speciesName: row.species_name,
    shiny: Boolean(row.shiny),
    types: entry.types,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    atk: stats.atk,
    owned: true, // real caught mon — faints apply a cooldown
  };
}

function rollBotMon() {
  const pool = Math.random() < 0.7 ? COMMON : RARE;
  const name = pool[Math.floor(Math.random() * pool.length)];
  const entry = getPokedexEntry(name);
  const stats = computeStats(getBaseRarity(name), false, name);
  return {
    speciesName: name,
    shiny: false,
    types: entry.types,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    atk: stats.atk,
    owned: false,
  };
}

function rollBotTeam() {
  return Array.from({ length: TEAM_SIZE }, rollBotMon);
}

function monLabel(mon) {
  return `${mon.shiny ? '✨ Shiny ' : ''}${escapeHtml(mon.speciesName)}`;
}

// The currently-active (not-yet-fainted) mon for a side — always read fresh through this rather
// than caching a reference, since which index is "active" changes as the team's mons faint.
// Clamped to the last slot: once a side's activeIndex reaches TEAM_SIZE (all 3 fainted, side
// eliminated), there's no "next" mon to point at — the last (fainted) one is what finishBattle's
// KO line and final caption should still show.
function activeMon(match, side) {
  const idx = Math.min(match.activeIndex[side], TEAM_SIZE - 1);
  return match.teams[side][idx];
}

// A 3-icon "how many of this team are still standing" row, Pokémon-GO-style — 🟢 active, ⚪ alive
// and waiting, 💀 fainted. Cheap, no extra message edits needed, just part of the existing caption.
function benchRow(match, side) {
  return match.teams[side]
    .map((mon, i) => (mon.hp <= 0 ? '💀' : i === match.activeIndex[side] ? '🟢' : '⚪'))
    .join('');
}

function battleCaption(match, extra) {
  const a = activeMon(match, 'A');
  const b = activeMon(match, 'B');
  const lines = [
    bold('⚔️ Pokémon Battle (3v3)'),
    '',
    `${bold(match.names.A)} ${benchRow(match, 'A')}`,
    `${monLabel(a)}`,
    hpBar(a.hp, a.maxHp),
    '',
    `${bold(match.names.B)} ${benchRow(match, 'B')}`,
    `${monLabel(b)}`,
    hpBar(b.hp, b.maxHp),
    '',
    match.bet ? `💰 Bet: ${bold(match.bet)} coins` : '🎮 Friendly match',
    `Turn: ${bold(match.turn === 'A' ? match.names.A : match.names.B)}`,
  ];
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

function moveKeyboard(matchId, mover) {
  const moves = movesFor(mover.types);
  const rows = moves.map((m, i) => [
    Markup.button.callback(`${m.name} (${m.type})`, `battle:${matchId}:mv:${i}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

async function refundBet(match) {
  if (!match.bet) return;
  if (match.challengerId !== BOT_ID) users.addCoins(match.chatId, match.challengerId, match.bet);
  if (match.opponentId !== BOT_ID) users.addCoins(match.chatId, match.opponentId, match.bet);
}

function clearAllTimeouts(match) {
  if (match.timeoutHandle) clearTimeout(match.timeoutHandle);
  if (match.syncTimerHandle) clearTimeout(match.syncTimerHandle);
}

// Every Telegram edit made during a live battle — suspense frame, bot-thinking beat, KO flash,
// swap-in beat, turn reveal, and the web arena's background group-message sync — goes through
// this single per-match gate, so timing is tracked ACROSS separate calls/turns, not just within
// one. Waits out any pending cooldown before editing, and on a real 429 extends the cooldown by
// exactly the `retry after` Telegram reports instead of guessing (same fix already proven on the
// raid message throttle). `editFn` should be a zero-arg function performing the actual edit
// call; its error is swallowed here (matching every call site's prior "cosmetic only"/logged-and-
// ignored behavior) so a rate-limited or failed edit never breaks the underlying battle logic.
async function throttledBattleEdit(match, editFn, onError) {
  const wait = Math.max(0, (match.nextEditNotBefore || 0) - Date.now());
  if (wait > 0) await sleep(wait);
  try {
    await editFn();
    match.nextEditNotBefore = Date.now() + 700;
  } catch (err) {
    const retryMs = parseRetryAfterMs(err.message);
    match.nextEditNotBefore = Date.now() + (retryMs || 700);
    if (onError) onError(err);
  }
}

// Short group notice used instead of the full turn-by-turn layout whenever the animated arena is
// actually available — the fight itself happens in the DM'd Mini App, so the group only needs to
// know a battle started, not see every HP bar/move line update live.
function arenaStartNoticeText(match) {
  return [
    bold('⚔️ Pokémon Battle Started! (3v3)'),
    '',
    `${bold(match.names.A)} vs ${bold(match.names.B)}`,
    match.bet ? `💰 Bet: ${bold(match.bet)} coins` : '🎮 Friendly match',
    '',
    '📩 Check your DMs for your animated Battle Arena link — that\'s where the fight happens. This message will update with the result when it\'s over.',
  ].join('\n');
}

// Matching short "who won" text for arena-mode matches, instead of the full battleCaption layout
// the group never saw the live version of.
function arenaResultText(match, resultLine) {
  return [
    bold('⚔️ Pokémon Battle Ended! (3v3)'),
    '',
    `${bold(match.names.A)} vs ${bold(match.names.B)}`,
    '',
    resultLine,
  ].join('\n');
}

async function maybeStartBattle(ctx, match) {
  const bothReady = match.challengerMons.length === TEAM_SIZE && (match.vsBot || match.opponentMons.length === TEAM_SIZE);
  if (!bothReady) return;

  clearAllTimeouts(match);
  match.phase = 'battle';
  match.teams = { A: match.challengerMons, B: match.opponentMons };
  match.activeIndex = { A: 0, B: 0 };
  match.names = { A: match.challengerName, B: match.vsBot ? '🤖 Bot' : match.opponentName };
  match.players = { A: match.challengerId, B: match.vsBot ? BOT_ID : match.opponentId };
  match.turn = 'A';
  match.eventLog = [];
  match.arenaMode = false;

  const tunnelUrl = getTunnelUrl();

  if (tunnelUrl) {
    // Try the animated-arena path: post a short notice (never the full turn-by-turn layout) and
    // DM both real players their arena link. Only commit to "arena mode" (hiding the group
    // battle layout for the rest of the match) once every DM that needed to land actually did —
    // a player who genuinely can't be DMed still needs some way to play, so that case falls back
    // to revealing the full in-group layout with Telegram move buttons for them.
    const sent = await ctx.telegram.sendMessage(match.chatId, arenaStartNoticeText(match), HTML);
    match.messageId = sent.message_id;

    // A DM can fail if the player has never opened a private chat with the bot — happened for
    // real in production right after the Mini App shipped (403: bot can't initiate conversation).
    const challengerDMOk = await sendArenaLinkDM(ctx.telegram, match.challengerId, match.id);
    const opponentDMOk = match.vsBot || (await sendArenaLinkDM(ctx.telegram, match.opponentId, match.id));

    if (challengerDMOk && opponentDMOk) {
      match.arenaMode = true;
      scheduleMoveTimeout(ctx, match);
      emitBattleChange(match);
      return;
    }

    const unreachable = [];
    if (!challengerDMOk) unreachable.push(match.challengerName);
    if (!opponentDMOk) unreachable.push(match.opponentName);
    await ctx.telegram.editMessageText(
      match.chatId,
      match.messageId,
      undefined,
      battleCaption(
        match,
        `📩 ${bold(unreachable.join(' and '))}: I couldn't DM you the animated Battle Arena link — tap my name, hit Start, then you'll get it next time. Playing right here with the buttons below works too.`
      ),
      { ...HTML, ...moveKeyboard(match.id, activeMon(match, 'A')) }
    );
    scheduleMoveTimeout(ctx, match);
    emitBattleChange(match);
    return;
  }

  // No tunnel configured at all — the only way to play is the full in-group Telegram-button
  // battle, same behavior as before the Mini App existed.
  const sent = await ctx.telegram.sendMessage(match.chatId, battleCaption(match), {
    ...HTML,
    ...moveKeyboard(match.id, activeMon(match, 'A')),
  });
  match.messageId = sent.message_id;
  scheduleMoveTimeout(ctx, match);
  emitBattleChange(match);
}

// Group buttons can't be `web_app` type (Telegram: private chats only, same rule the raid
// arena hit), but unlike raids a battle only ever has exactly 2 known participants, so there's
// no need for an in-group "tap to get your link" button — just DM both of them the moment the
// battle actually starts. Returns true on success, false if the DM failed (caller decides how
// to surface that).
async function sendArenaLinkDM(telegram, userId, matchId) {
  const tunnelUrl = getTunnelUrl();
  if (!tunnelUrl) return true; // no tunnel configured — not a per-user failure, don't flag it
  try {
    await telegram.sendMessage(userId, bold('⚔️ Tap below to open your animated Battle Arena:'), {
      ...HTML,
      ...Markup.inlineKeyboard([[Markup.button.webApp('⚔️ Open Battle Arena', `${tunnelUrl}/pvp.html?matchId=${matchId}`)]]),
    });
    return true;
  } catch (err) {
    console.error(`Failed to DM PvP Battle Arena link to user ${userId} (harmless — Telegram buttons still work):`, err.message);
    return false;
  }
}

function scheduleMoveTimeout(ctx, match) {
  clearAllTimeouts(match);
  match.timeoutHandle = setTimeout(async () => {
    if (!matches.has(match.id) || match.phase !== 'battle') return;
    matches.delete(match.id);
    await refundBet(match);
    const text = match.arenaMode
      ? [arenaResultText(match, `⌛ Battle expired from inactivity.${match.bet ? ' Bet refunded.' : ''}`)].join('\n')
      : [battleCaption(match), '', `⌛ Battle expired from inactivity.${match.bet ? ' Bet refunded.' : ''}`].join('\n');
    try {
      await ctx.telegram.editMessageText(match.chatId, match.messageId, undefined, text, HTML);
    } catch (err) {
      console.error('Failed to edit expired battle:', err.message);
    }
  }, MOVE_TTL_MS);
}

// Briefly cycles the battle message before a move lands, and clears the keyboard so a
// fast double-tap can't queue a second move mid-animation (restored on the final reveal).
// Icon and phrasing are themed to the move's type and randomized per use, so the same move
// doesn't read identically every time it's used.
async function playAttackSuspense(ctx, match, attackerSide, move) {
  const attacker = activeMon(match, attackerSide);
  const icon = TYPE_EMOJI[move.type] || '💫';
  const windUpText = pickRandom(SUSPENSE_TEMPLATES)
    .replace('{name}', bold(`${match.names[attackerSide]}'s ${monLabel(attacker)}`))
    .replace('{move}', bold(move.name));
  for (let i = 0; i < SUSPENSE_FRAMES; i++) {
    await throttledBattleEdit(
      match,
      () => ctx.editMessageText(battleCaption(match, `${icon} ${windUpText} ${icon}`), { ...HTML, ...NO_KEYBOARD }),
      () => {} // Telegram 400s on "message is not modified" if frames render identically — cosmetic, ignore.
    );
    await sleep(SUSPENSE_DELAY_MS);
  }
}

function formatMoveLine(attackerName, attacker, move, damage, superEffective) {
  const effectTag = superEffective ? ' 💥 Super effective!' : '';
  return `${bold(attackerName)}'s ${monLabel(attacker)} used ${bold(move.name)}!${effectTag} ${bold(`-${damage} HP`)}`;
}

// Applies a faint cooldown to the mon that just went down (every fainted mon gets one, not just
// the match-ending one) and advances that side's active index to their next team member. Returns
// true if that was their LAST standing Pokémon (side is fully defeated), false if they still have
// one to send out.
function handleFaint(match, side) {
  const mon = activeMon(match, side);
  const ownerId = match.players[side];
  if (mon.owned && ownerId !== BOT_ID) {
    battleCooldowns.applyFaintCooldown(ownerId, mon.speciesName, mon.shiny);
  }
  match.activeIndex[side] += 1;
  return match.activeIndex[side] >= TEAM_SIZE;
}

// Pokémon-GO-style swap-in beat — one extra throttled edit showing who's coming in next,
// mirrors the KO flash's timing/budget (still just one edit for this whole moment).
async function playSwapIn(ctx, match, side, priorLines) {
  const mon = activeMon(match, side);
  const line = pickRandom(SWAP_FLAVOR).replace('{name}', bold(match.names[side])).replace('{mon}', monLabel(mon));
  await throttledBattleEdit(match, () =>
    ctx.editMessageText(battleCaption(match, [...priorLines, `🔄 ${line}`].join('\n')), { ...HTML, ...NO_KEYBOARD })
  );
  await sleep(SWAP_DELAY_MS);
  addBattleEvent(match, `🔄 ${match.names[side]} sent out ${mon.speciesName}!`);
  emitBattleChange(match);
}

async function finishBattle(ctx, match, winnerSide, priorLines = []) {
  const loserSide = winnerSide === 'A' ? 'B' : 'A';

  // Flag the match as ended and push one last state before it's removed from `matches` below —
  // a Mini App viewer (possibly the OTHER player, who might be on Telegram while this player
  // used the web arena, or vice versa) needs to see the finishing blow land, not just silently
  // stop receiving updates.
  match.phase = 'ended';
  match.winnerSide = winnerSide;
  emitBattleChange(match);

  // A short "K.O.!" beat before the win/rewards text lands, so the kill doesn't feel abrupt —
  // skipped in arena mode, where the group never saw the live layout to begin with, so there's
  // nothing to flash; it goes straight to the final result below.
  if (!match.arenaMode) {
    const koLine = pickRandom(KO_FLAVOR).replace('{mon}', monLabel(activeMon(match, loserSide)));
    await throttledBattleEdit(match, () =>
      ctx.telegram.editMessageText(
        match.chatId,
        match.messageId,
        undefined,
        battleCaption(match, [...priorLines, `💀 ${bold(koLine)}`].join('\n')),
        { ...HTML, ...NO_KEYBOARD }
      )
    );
    await sleep(KO_FLASH_DELAY_MS);
  }

  clearAllTimeouts(match);
  matches.delete(match.id);

  // The loser's whole team is fainted by definition of losing — every mon along the way already
  // got its cooldown applied in handleFaint() as it fainted, so nothing more to do here.

  const winnerId = match.players[winnerSide];
  const loserId = match.players[loserSide];
  let resultLine = `🏆 ${bold(match.names[winnerSide])} wins — ${bold(match.names[loserSide])}'s whole team fainted!`;

  if (winnerId !== BOT_ID) {
    users.incrementCounter(match.chatId, winnerId, 'battle_wins');
    const levelUpMsg = grantRewards(match.chatId, winnerId, { xp: XP.BATTLE_WIN });
    resultLine += ` +${XP.BATTLE_WIN} XP`;
    if (match.bet) {
      users.addCoins(match.chatId, winnerId, match.bet * 2);
      resultLine += ` +${match.bet * 2} coins`;
    }
    if (levelUpMsg) resultLine += `\n${levelUpMsg}`;
  } else {
    resultLine += ' 🤖';
  }
  if (loserId !== BOT_ID) {
    resultLine += `\n😵 ${bold(match.names[loserSide])}'s team needs to rest — each fainted Pokémon is out for ${formatDuration(
      battleCooldowns.FAINT_COOLDOWN_MS
    )}.`;
  }

  const text = match.arenaMode
    ? arenaResultText(match, resultLine)
    : [battleCaption(match, priorLines.join('\n')), '', resultLine].join('\n');
  await throttledBattleEdit(
    match,
    () => ctx.telegram.editMessageText(match.chatId, match.messageId, undefined, text, HTML),
    (err) => console.error('Failed to edit finished battle:', err.message)
  );
  if (winnerId !== BOT_ID) {
    await react(ctx.telegram, match.chatId, match.messageId, '🏆');
  }
}

// Simple heuristic: prefer a super-effective move if one exists, otherwise random.
function botChooseMove(mon, defenderTypes) {
  const moves = movesFor(mon.types);
  const effective = moves.find((m) => isSuperEffectiveLocal(m.type, defenderTypes));
  return effective ? moves.indexOf(effective) : Math.floor(Math.random() * moves.length);
}

function isSuperEffectiveLocal(moveType, defenderTypes) {
  const strong = TYPE_CHART[moveType] || [];
  return defenderTypes.some((t) => strong.includes(t));
}

async function performMove(ctx, match, moveIndex) {
  const attackerSide = match.turn;
  const defenderSide = attackerSide === 'A' ? 'B' : 'A';
  const attacker = activeMon(match, attackerSide);
  const defender = activeMon(match, defenderSide);

  const moves = movesFor(attacker.types);
  const move = moves[moveIndex];
  if (!move) return;

  await playAttackSuspense(ctx, match, attackerSide, move);

  const { damage, superEffective } = calcDamage(attacker.atk, move.type, defender.types);
  defender.hp = Math.max(0, defender.hp - damage);
  const lines = [formatMoveLine(match.names[attackerSide], attacker, move, damage, superEffective)];
  addBattleEvent(match, lines[0]);
  emitBattleChange(match);

  if (defender.hp <= 0) {
    const eliminated = handleFaint(match, defenderSide);
    if (eliminated) {
      await finishBattle(ctx, match, attackerSide, lines);
      return;
    }
    await playSwapIn(ctx, match, defenderSide, lines);
  }

  match.turn = defenderSide;
  scheduleMoveTimeout(ctx, match);

  if (match.players[match.turn] === BOT_ID) {
    await throttledBattleEdit(match, () =>
      ctx.editMessageText(battleCaption(match, [...lines, pickRandom(BOT_THINK_LINES)].join('\n')), {
        ...HTML,
        ...NO_KEYBOARD,
      })
    );
    await sleep(BOT_THINK_DELAY_MS);

    const botMon = activeMon(match, match.turn);
    const botDefenderSide = match.turn === 'A' ? 'B' : 'A';
    const botDefender = activeMon(match, botDefenderSide);
    const botMoveIdx = botChooseMove(botMon, botDefender.types);
    const botMoves = movesFor(botMon.types);
    const botMove = botMoves[botMoveIdx];
    const botResult = calcDamage(botMon.atk, botMove.type, botDefender.types);
    botDefender.hp = Math.max(0, botDefender.hp - botResult.damage);
    lines.push(formatMoveLine(match.names[match.turn], botMon, botMove, botResult.damage, botResult.superEffective));
    addBattleEvent(match, lines[lines.length - 1]);
    emitBattleChange(match);

    if (botDefender.hp <= 0) {
      const botEliminated = handleFaint(match, botDefenderSide);
      if (botEliminated) {
        await finishBattle(ctx, match, match.turn, lines);
        return;
      }
      await playSwapIn(ctx, match, botDefenderSide, lines);
    }
    match.turn = match.turn === 'A' ? 'B' : 'A';
    scheduleMoveTimeout(ctx, match);
    emitBattleChange(match);
  }

  await throttledBattleEdit(
    match,
    () =>
      ctx.editMessageText(battleCaption(match, lines.join('\n')), {
        ...HTML,
        ...moveKeyboard(match.id, activeMon(match, match.turn)),
      }),
    (err) => console.error('Failed to edit battle turn:', err.message)
  );
}

// ---- Web-facing attack path (Mini App arena) ----
//
// Deliberately a SEPARATE function from performMove rather than a shared refactor — the
// Telegram path's suspense choreography (ctx.editMessageText shorthand, timed frames) is
// specific to that surface and already proven in production; this reuses the same underlying
// math (movesFor/calcDamage/botChooseMove) and, critically, the same finishBattle() for match
// resolution (rewards, cooldowns, group message, reaction) so a web-ending battle can never
// diverge from a Telegram-ending one. `finishBattle` only ever touches `ctx.telegram` (never
// the ctx-bound edit shorthand) for its real side effects, so a bot-like object with just a
// `.telegram` property works as its `ctx` here.
async function attackFromWeb(bot, matchId, userId, moveIndex) {
  const match = matches.get(matchId);
  if (!match || match.phase !== 'battle') return { ok: false, reason: 'no_active_battle' };

  const side = match.players.A === userId ? 'A' : match.players.B === userId ? 'B' : null;
  if (!side) return { ok: false, reason: 'not_in_battle' };
  if (match.turn !== side) return { ok: false, reason: 'not_your_turn' };

  const attackerSide = side;
  const defenderSide = attackerSide === 'A' ? 'B' : 'A';
  const attacker = activeMon(match, attackerSide);
  const defender = activeMon(match, defenderSide);
  const moves = movesFor(attacker.types);
  const move = moves[moveIndex];
  if (!move) return { ok: false, reason: 'invalid_move' };

  const ctx = { telegram: bot.telegram };
  const { damage, superEffective } = calcDamage(attacker.atk, move.type, defender.types);
  defender.hp = Math.max(0, defender.hp - damage);
  const lines = [formatMoveLine(match.names[attackerSide], attacker, move, damage, superEffective)];
  addBattleEvent(match, lines[0]);
  const outcome = { ok: true, damage, superEffective, moveName: move.name };

  if (defender.hp <= 0) {
    const eliminated = handleFaint(match, defenderSide);
    if (eliminated) {
      emitBattleChange(match);
      await finishBattle(ctx, match, attackerSide, lines);
      return { ...outcome, matchOver: true, winnerSide: attackerSide };
    }
    outcome.swappedIn = { side: defenderSide, speciesName: activeMon(match, defenderSide).speciesName };
  }

  match.turn = defenderSide;
  scheduleMoveTimeout(ctx, match);
  emitBattleChange(match);

  // vs-Bot matches resolve the bot's reply turn immediately, same as the Telegram path.
  if (match.players[match.turn] === BOT_ID) {
    const botMon = activeMon(match, match.turn);
    const botDefenderSide = match.turn === 'A' ? 'B' : 'A';
    const botDefender = activeMon(match, botDefenderSide);
    const botMoveIdx = botChooseMove(botMon, botDefender.types);
    const botMoves = movesFor(botMon.types);
    const botMove = botMoves[botMoveIdx];
    const botResult = calcDamage(botMon.atk, botMove.type, botDefender.types);
    botDefender.hp = Math.max(0, botDefender.hp - botResult.damage);
    lines.push(formatMoveLine(match.names[match.turn], botMon, botMove, botResult.damage, botResult.superEffective));
    addBattleEvent(match, lines[lines.length - 1]);

    if (botDefender.hp <= 0) {
      const botEliminated = handleFaint(match, botDefenderSide);
      if (botEliminated) {
        emitBattleChange(match);
        await finishBattle(ctx, match, match.turn, lines);
        return { ...outcome, matchOver: true, winnerSide: match.turn };
      }
      outcome.botSwappedIn = { side: botDefenderSide, speciesName: activeMon(match, botDefenderSide).speciesName };
    }
    match.turn = botDefenderSide;
    scheduleMoveTimeout(ctx, match);
    emitBattleChange(match);
  }

  // Best-effort, throttled sync of the Telegram group message — never blocks this response.
  // A move made in the Mini App must not have its latency held hostage to Telegram API/rate
  // limit behavior, exactly the lesson learned fixing the raid attack button.
  scheduleBattleTelegramSync(bot, match, lines.join('\n'));

  return {
    ...outcome,
    matchOver: false,
    hpA: activeMon(match, 'A').hp,
    hpB: activeMon(match, 'B').hp,
    turn: match.turn,
  };
}

function scheduleBattleTelegramSync(bot, match, text) {
  // Arena mode deliberately shows only the start notice and the final result in the group — no
  // live turn-by-turn sync, so there's nothing to schedule here.
  if (match.arenaMode) return;
  match.pendingSync = text;
  if (match.syncTimerHandle) return;
  const wait = Math.max(0, BATTLE_EDIT_THROTTLE_MS - (Date.now() - (match.lastSyncAt || 0)));
  match.syncTimerHandle = setTimeout(async () => {
    match.syncTimerHandle = null;
    const pending = match.pendingSync;
    match.pendingSync = null;
    if (!pending || matches.get(match.id) !== match || match.phase !== 'battle') return;
    match.lastSyncAt = Date.now();
    // Routes through the same per-match throttle/backoff as the Telegram-path animation edits
    // — a 429 hit via one surface correctly delays the next edit from either surface.
    await throttledBattleEdit(
      match,
      () =>
        bot.telegram.editMessageText(match.chatId, match.messageId, undefined, battleCaption(match, pending), {
          ...HTML,
          ...moveKeyboard(match.id, activeMon(match, match.turn)),
        }),
      (err) => console.error('Battle web-move Telegram sync failed (harmless — arena stays in sync via WebSocket regardless):', err.message)
    );
  }, wait);
}

function getMatch(matchId) {
  return matches.get(matchId) || null;
}

// `phase` is 'battle' while live; a caller that just received an 'ended' push (from
// finishBattle, right before the match is deleted) should treat it as the final frame.
// `team` exposes all 3 slots (species/shiny/fainted, no HP for bench mons) so the Mini App can
// render the Pokémon-GO-style 3-icon bench row; `mon` stays the active one for the main sprite.
function sanitizeMatchForWeb(match, userId) {
  const side = match.players.A === userId ? 'A' : match.players.B === userId ? 'B' : null;
  const opponentSide = side === 'A' ? 'B' : side === 'B' ? 'A' : null;
  const monView = (m) => (m ? { speciesName: m.speciesName, shiny: m.shiny, types: m.types, hp: m.hp, maxHp: m.maxHp } : null);
  const teamView = (s) =>
    s
      ? match.teams[s].map((m, i) => ({
          speciesName: m.speciesName,
          shiny: m.shiny,
          fainted: m.hp <= 0,
          active: i === match.activeIndex[s],
        }))
      : [];
  return {
    phase: match.phase,
    matchId: match.id,
    isParticipant: Boolean(side),
    yourSide: side,
    turn: match.turn,
    vsBot: Boolean(match.vsBot),
    winnerSide: match.winnerSide ?? null,
    you: side ? { name: match.names[side], mon: monView(activeMon(match, side)), team: teamView(side) } : null,
    opponent: opponentSide
      ? { name: match.names[opponentSide], mon: monView(activeMon(match, opponentSide)), team: teamView(opponentSide) }
      : null,
    moves: side && match.teams ? movesFor(activeMon(match, side).types) : [],
    eventLog: (match.eventLog || []).slice(-10),
  };
}

function register(bot) {
  const startHandler = async (ctx) => {
    const chatId = ctx.chat.id;
    const challenger = ctx.from;
    users.getOrCreateUser(chatId, challenger.id, challenger.username || challenger.first_name);

    const args = ctx.message.text.split(' ').slice(1);
    const bet = args.some((a) => a.toLowerCase() === 'bet') ? BET_COINS : 0;

    const repliedUser = ctx.message.reply_to_message?.from;
    const targetId = repliedUser && !repliedUser.is_bot ? repliedUser.id : null;
    const targetName = repliedUser ? escapeHtml(repliedUser.username || repliedUser.first_name) : null;

    if (targetId === challenger.id) {
      await ctx.reply("You can't challenge yourself — use the 🤖 Play vs Bot option instead.");
      return;
    }

    if (bet) {
      const profile = users.getProfile(chatId, challenger.id);
      if (!profile || profile.coins < bet) {
        await ctx.reply(`🪙 You need at least ${bet} coins to start a bet match.`);
        return;
      }
    }

    // The challenger must already have a valid pre-built team (via /myteam) — battles no longer
    // pick in-chat. Checked up front so a challenge is never posted that can't actually start.
    const challengerIssue = savedTeamIssueForBattle(challenger.id);
    if (challengerIssue) {
      const dmOk = await promptBattleTeamSetup(ctx.telegram, challenger.id, challengerIssue);
      await ctx.reply(
        challengerIssue === 'no_team'
          ? dmOk
            ? '🐾 Set up your battle team first — I just DMed you the team builder. Run /myteam, pick your 3 Pokémon, then /battle again.'
            : "🐾 Set up your battle team first with /myteam (DM me — tap my name and hit Start if you haven't yet), then /battle again."
          : challengerIssue === 'resting'
            ? '⏳ One of your saved team Pokémon is resting after a recent faint — swap your team with /myteam or wait it out, then /battle again.'
            : '⚠️ Your saved team has a Pokémon you no longer own — rebuild it with /myteam, then /battle again.'
      );
      return;
    }

    const matchId = nextId++;
    const challengerName = escapeHtml(challenger.username || challenger.first_name);

    const match = {
      id: matchId,
      phase: 'challenge',
      chatId,
      challengerId: challenger.id,
      challengerName,
      targetId,
      targetName,
      bet,
      messageId: null,
      timeoutHandle: null,
    };
    matches.set(matchId, match);

    const lines = [
      bold('⚔️ Pokémon Battle Challenge! (3v3)'),
      '',
      targetId
        ? `${bold(challengerName)} is challenging ${bold(targetName)}!`
        : `${bold(challengerName)} wants to battle — who's in?`,
      bet ? `💰 Bet: ${bold(bet)} coins` : '🎮 Friendly match (no bet)',
      '',
      "⚡ Uses your saved /myteam — no picking needed. Once accepted, real players get DM'd an animated Battle Arena link!",
    ];

    const sent = await ctx.reply(lines.join('\n'), { ...HTML, ...challengeKeyboard(matchId, Boolean(targetId)) });
    match.messageId = sent.message_id;

    match.timeoutHandle = setTimeout(async () => {
      if (!matches.has(matchId) || match.phase !== 'challenge') return;
      matches.delete(matchId);
      try {
        await ctx.telegram.editMessageText(chatId, sent.message_id, undefined, '⌛ Challenge expired — nobody accepted in time.', HTML);
      } catch (err) {
        console.error('Failed to edit expired battle challenge:', err.message);
      }
    }, CHALLENGE_TTL_MS);
  };

  bot.command('battle', startHandler);

  bot.action(/^battle:(\d+):accept$/, async (ctx) => {
    const matchId = Number(ctx.match[1]);
    const match = matches.get(matchId);
    if (!match || match.phase !== 'challenge') {
      await ctx.answerCbQuery('This challenge is no longer available.', { show_alert: true });
      return;
    }
    if (match.targetId && ctx.from.id !== match.targetId) {
      await ctx.answerCbQuery("This challenge isn't for you.", { show_alert: true });
      return;
    }
    if (ctx.from.id === match.challengerId) {
      await ctx.answerCbQuery("You can't accept your own challenge.", { show_alert: true });
      return;
    }
    users.getOrCreateUser(match.chatId, ctx.from.id, ctx.from.username || ctx.from.first_name);

    // Opponent must have a valid saved team too. Checked BEFORE any coin deduction so a missing
    // team never touches anyone's balance.
    const opponentIssue = savedTeamIssueForBattle(ctx.from.id);
    if (opponentIssue) {
      const dmOk = await promptBattleTeamSetup(ctx.telegram, ctx.from.id, opponentIssue);
      await ctx.answerCbQuery(
        opponentIssue === 'no_team'
          ? dmOk
            ? '🐾 You need a saved team first — check your DMs, run /myteam, then accept again.'
            : "🐾 Set up your team with /myteam first (DM me — tap my name and hit Start), then accept again."
          : opponentIssue === 'resting'
            ? '⏳ A saved team Pokémon is resting after a faint — swap it via /myteam or wait, then accept again.'
            : '⚠️ Your saved team has a Pokémon you no longer own — rebuild it with /myteam, then accept again.',
        { show_alert: true }
      );
      return;
    }

    // Re-resolve BOTH teams against live ownership/cooldowns at accept time (a saved pick could
    // have been traded away or fainted elsewhere since the challenge was posted). Do the
    // challenger first, before any coins move, so we can bail cleanly if their team went stale.
    const challengerTeam = resolveSavedTeamForBattle(match.challengerId);
    if (!challengerTeam) {
      matches.delete(matchId);
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `⚠️ ${bold(match.challengerName)}'s team is no longer battle-ready (a Pokémon was traded away or is resting). Challenge cancelled — they can set a new team with /myteam.`,
        HTML
      );
      return;
    }
    const opponentTeam = resolveSavedTeamForBattle(ctx.from.id);
    if (!opponentTeam) {
      // Extremely unlikely (savedTeamIssueForBattle just returned null), but guard anyway.
      await ctx.answerCbQuery('Your team is no longer battle-ready — rebuild it with /myteam.', { show_alert: true });
      return;
    }

    if (match.bet) {
      const challengerOk = users.deductCoins(match.chatId, match.challengerId, match.bet);
      if (!challengerOk) {
        await ctx.answerCbQuery("The challenger no longer has enough coins for this bet.", { show_alert: true });
        matches.delete(matchId);
        return;
      }
      const opponentOk = users.deductCoins(match.chatId, ctx.from.id, match.bet);
      if (!opponentOk) {
        users.addCoins(match.chatId, match.challengerId, match.bet);
        await ctx.answerCbQuery("You don't have enough coins to accept this bet.", { show_alert: true });
        return;
      }
    }

    match.opponentId = ctx.from.id;
    match.opponentName = escapeHtml(ctx.from.username || ctx.from.first_name);
    match.vsBot = false;
    match.challengerMons = challengerTeam;
    match.opponentMons = opponentTeam;
    clearAllTimeouts(match);
    await ctx.answerCbQuery('⚔️ Battle starting!');
    await ctx.editMessageText(`⚔️ Match accepted! ${bold(match.challengerName)} vs ${bold(match.opponentName)} — starting battle...`, HTML);
    await maybeStartBattle(ctx, match);
  });

  bot.action(/^battle:(\d+):bot$/, async (ctx) => {
    const matchId = Number(ctx.match[1]);
    const match = matches.get(matchId);
    if (!match || match.phase !== 'challenge') {
      await ctx.answerCbQuery('This challenge is no longer available.', { show_alert: true });
      return;
    }
    if (ctx.from.id !== match.challengerId) {
      await ctx.answerCbQuery('Only the challenger can start the bot match.', { show_alert: true });
      return;
    }

    // Re-resolve the challenger's saved team (it was valid when they issued the challenge, but
    // could have gone stale since — trade, faint elsewhere). Bail cleanly if so.
    const challengerTeam = resolveSavedTeamForBattle(match.challengerId);
    if (!challengerTeam) {
      const issue = savedTeamIssueForBattle(match.challengerId) || 'no_team';
      await promptBattleTeamSetup(ctx.telegram, match.challengerId, issue);
      matches.delete(matchId);
      await ctx.answerCbQuery('Your team is no longer battle-ready — rebuild it with /myteam.', { show_alert: true });
      await ctx.editMessageText('⚠️ Battle cancelled — your saved team is no longer battle-ready. Set a new one with /myteam.', HTML);
      return;
    }

    match.opponentId = BOT_ID;
    match.opponentName = '🤖 Bot';
    match.vsBot = true;
    match.bet = 0; // no betting against the bot, same rule as the other mini-games
    match.challengerMons = challengerTeam;
    match.opponentMons = rollBotTeam();
    clearAllTimeouts(match);
    await ctx.answerCbQuery('⚔️ Battle starting!');
    await ctx.editMessageText(`⚔️ ${bold(match.challengerName)} vs 🤖 Bot — starting battle...`, HTML);
    await maybeStartBattle(ctx, match);
  });

  bot.action(/^battle:(\d+):rules$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(formatRules('battle'), HTML);
  });

  bot.action(/^battle:(\d+):cancel$/, async (ctx) => {
    const matchId = Number(ctx.match[1]);
    const match = matches.get(matchId);
    if (!match || match.phase !== 'challenge') {
      await ctx.answerCbQuery('Already gone.');
      return;
    }
    if (ctx.from.id !== match.challengerId) {
      await ctx.answerCbQuery('Only the challenger can cancel this.', { show_alert: true });
      return;
    }
    clearAllTimeouts(match);
    matches.delete(matchId);
    await ctx.answerCbQuery('Challenge cancelled.');
    await ctx.editMessageText('❌ Challenge cancelled.');
  });

  bot.action(/^battle:(\d+):mv:(\d+)$/, async (ctx) => {
    const matchId = Number(ctx.match[1]);
    const moveIndex = Number(ctx.match[2]);
    const match = matches.get(matchId);
    if (!match || match.phase !== 'battle') {
      await ctx.answerCbQuery('This battle has ended.', { show_alert: true });
      return;
    }
    const turnUserId = match.players[match.turn];
    if (ctx.from.id !== turnUserId) {
      await ctx.answerCbQuery("It's not your turn.", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await performMove(ctx, match, moveIndex);
  });
}

module.exports = {
  register,
  getMatch,
  sanitizeMatchForWeb,
  attackFromWeb,
  onBattleChange,
  TEAM_SIZE,
  __test: { matches, throttledBattleEdit },
};
