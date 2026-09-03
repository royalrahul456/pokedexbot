const { Markup } = require('telegraf');
const { ADMIN_IDS } = require('../config');
const users = require('../db/users');
const pokemonCollectionDb = require('../db/pokemonCollection');
const inventory = require('../db/inventory');
const raidDailyLimits = require('../db/raidDailyLimits');
const raidStats = require('../db/raidStats');
const raidTeams = require('../db/raidTeams');
const battleCooldowns = require('../db/battleCooldowns');
const {
  LEGENDARY,
  MYTHICAL,
  getPokedexEntry,
  getArtworkUrl,
  getAnimatedSpriteUrl,
  formatTypeLine,
} = require('../data/pokemon');

// Ultra Rare isn't a real Pokédex category — it's a curated subset of the most iconic
// box-legendary-tier species already in LEGENDARY/MYTHICAL (same verified artwork/types, no new
// roster data needed), used as a distinct hardest raid tier above Mythical.
const ULTRA_RARE = [
  'Rayquaza', 'Mewtwo', 'Arceus', 'Zacian', 'Zamazenta', 'Eternatus', 'Giratina', 'Dialga',
  'Palkia', 'Koraidon', 'Miraidon', 'Calyrex', 'Necrozma', 'Lugia', 'Ho-Oh',
];
const { computeStats, movesFor, calcDamage, hpBar, TYPE_CHART } = require('../data/battleData');
const { grantRewards } = require('../utils/rewards');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatDuration } = require('../utils/format');
const { react } = require('../utils/reactions');
const { getTunnelUrl } = require('../webapp/tunnelUrl');
const { parseRetryAfterMs } = require('../utils/telegramRetry');

const LOBBY_SIZE = 20;
const TEAM_SIZE = 3;
const LOBBY_COUNTDOWN_MS = 3 * 60 * 1000;
const BATTLE_TTL_MS = 20 * 60 * 1000;
// A Pokémon the boss faints can't be brought into another raid (or /battle — shared cooldown
// table) for 20 minutes. Shorter than /battle's own 1-hour faint cooldown since raids already
// have a much higher-stakes AoE model now (see BOSS_AOE_SPLIT_EXPONENT) — 20 min keeps team
// rotation meaningful without locking a trainer's whole collection out for the rest of the day.
const RAID_FAINT_COOLDOWN_MS = 20 * 60 * 1000;
// Boss attacks on a randomized cadence within this range (not a fixed interval) — makes the
// pace unpredictable/tenser, and dramatically raises total damage output over a battle purely
// from frequency alone (was a flat 25s before; a ~7.5s average here is over 3x more attacks
// across the same 20-min battle window).
const BOSS_ATTACK_INTERVAL_MIN_MS = 5 * 1000;
const BOSS_ATTACK_INTERVAL_MAX_MS = 10 * 1000;
function nextBossAttackDelay() {
  return BOSS_ATTACK_INTERVAL_MIN_MS + Math.random() * (BOSS_ATTACK_INTERVAL_MAX_MS - BOSS_ATTACK_INTERVAL_MIN_MS);
}
const EDIT_THROTTLE_MS = 3000;

// Difficulty pass #3 2026-07-23 (three rounds same day, each from real user feedback) — final
// shape: three tiers with real difficulty labels, HP big enough that even a full 20-person raid
// needs sustained effort, and a boss ATK stat that's genuinely dangerous but is NOT applied at
// full value to every single AoE target — see BOSS_AOE_SPLIT_EXPONENT below for why. (Earlier in
// this pass, applying the raw ATK to literally every alive participant on every 5-10s tick was
// modeled out and found to wipe an ENTIRE raid's teams within ~15-30 seconds regardless of size —
// instant guaranteed failure, not "difficult but winnable". Fixed by splitting the boss's attack
// power across however many trainers it's currently hitting.)
const RAID_HP = { legendary: 25000, mythical: 40000, ultra_rare: 60000 };
// Toned down ~30% from 190/220/260 on 2026-07-23 — user feedback: boss attacks were hitting too
// hard (a solo/near-wipe trainer could get one-shot by a single tick even against a Legendary
// boss, since the AoE split exponent has no effect at N=1). HP is untouched — raids should still
// take real sustained effort, just without individual hits feeling this punishing.
const BOSS_ATK = { legendary: 130, mythical: 150, ultra_rare: 180 };
const LEVEL_ATK_BONUS_PER_LEVEL = 0.03; // +3% attack per level above 1, both trainers and bosses ignore this (bosses are flat)

// The boss's AoE hits every still-fighting trainer each tick, but divides its attack power by
// (alive participants ^ exponent) instead of applying it in full to everyone at once — a solo
// or near-wipe scenario still takes a near-full, dangerous hit (exponent has no effect at N=1),
// while a full 20-person raid takes real but survivable per-person damage, forcing attrition
// across a party's full 20-minute battle window rather than an instant, guaranteed team-wipe in
// the opening seconds. 0.5 (square root) is a standard "split among N" damping curve.
const BOSS_AOE_SPLIT_EXPONENT = 0.5;

const CATCH_CHANCE = { legendary: 0.65, mythical: 0.5, ultra_rare: 0.35 };
const RAID_SHINY_CHANCE = 0.02;

const MVP_BONUS_XP = 150;
const MVP_BONUS_COINS = 300;
const MVP_RAID_POINTS = 50;
const FINAL_HIT_BONUS_XP = 50;
const FINAL_HIT_BONUS_COINS = 100;
const BASE_REWARD_XP = 40;
const BASE_REWARD_COINS = 60;
const BASE_RAID_POINTS = 20;
const SHARE_BONUS_XP = 250; // scaled by this participant's share of total damage dealt
const SHARE_BONUS_COINS = 500;
const SHARE_BONUS_POINTS = 100;

const activeRaids = new Map(); // chatId -> raid

// Lets the Mini App backend (src/webapp/server.js) subscribe to every raid state change —
// same in-memory raid objects Telegram uses, so both surfaces are always in sync automatically
// rather than needing two separate copies of the game state.
const raidChangeListeners = [];
function onRaidChange(fn) {
  raidChangeListeners.push(fn);
}
const EVENT_LOG_MAX = 25;
function addEvent(raid, text) {
  raid.eventLog.push({ text, at: Date.now() });
  if (raid.eventLog.length > EVENT_LOG_MAX) raid.eventLog.shift();
}

function emitRaidChange(raid) {
  for (const fn of raidChangeListeners) {
    try {
      fn(raid);
    } catch (err) {
      console.error('Raid change listener threw (ignored):', err.message);
    }
  }
}
const catchEncounters = new Map(); // chatId -> encounter state
const catchAttempts = new Map(); // chatId -> Set(userId) who already tried the post-raid encounter

function isRaidActive(chatId) {
  return activeRaids.has(chatId);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function displayName(user) {
  return escapeHtml(user.username || user.first_name || 'Trainer');
}

function isSuperEffective(moveType, defenderTypes) {
  const strong = TYPE_CHART[moveType] || [];
  return defenderTypes.some((t) => strong.includes(t));
}

function chooseMove(attackerTypes, defenderTypes) {
  const moves = movesFor(attackerTypes);
  const effective = moves.find((m) => isSuperEffective(m.type, defenderTypes));
  return effective || moves[Math.floor(Math.random() * moves.length)];
}

function levelMultiplier(level) {
  return 1 + Math.max(0, (level || 1) - 1) * LEVEL_ATK_BONUS_PER_LEVEL;
}

function eligibleCollection(userId) {
  return pokemonCollectionDb
    .listCollection(userId)
    .filter((row) => row.quantity > 0 && !battleCooldowns.isResting(userId, row.species_name, row.shiny, row.quantity));
}

function makeMon(row) {
  const entry = getPokedexEntry(row.species_name);
  const stats = computeStats(row.base_rarity, Boolean(row.shiny), row.species_name);
  return {
    speciesName: row.species_name,
    shiny: Boolean(row.shiny),
    types: entry.types,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    atk: stats.atk,
  };
}

// Telegram's `web_app` inline button type is ONLY valid on messages in a private chat with
// the bot — attaching one directly to a group message is rejected outright with
// "400: Bad Request: BUTTON_TYPE_INVALID" (confirmed live in production; this was a real bug,
// not a config issue). The correct, standard pattern group game bots use instead: a normal
// `callback_data` button (always legal in groups) that DMs the tapper their real web_app
// launch button, which IS legal there since that message is in their private chat.
function arenaButtonRow(chatId) {
  if (!getTunnelUrl()) return [];
  return [Markup.button.callback('🎮 Open Battle Arena', `raid:${chatId}:arena`)];
}

function lobbyKeyboard(chatId) {
  // No group-visible "start now" button here — Telegram can't show a button to admins only,
  // and a visible-but-admin-gated button just confused regular players (real feedback from
  // production). Admins force-start via the /raidstart command instead (see register()).
  const rows = [[Markup.button.callback('⚔️ Join Raid', `raid:${chatId}:join`)], arenaButtonRow(chatId)].filter(
    (row) => row.length
  );
  return Markup.inlineKeyboard(rows);
}

function battleKeyboard(chatId) {
  const rows = [[Markup.button.callback('⚔️ Attack!', `raid:${chatId}:attack`)], arenaButtonRow(chatId)].filter(
    (row) => row.length
  );
  return Markup.inlineKeyboard(rows);
}

const DIFFICULTY_TAG = { legendary: '🟡 Hard', mythical: '🟠 Very Hard', ultra_rare: '🔴 Ultra Hard' };

function lobbyText(raid, extra) {
  const msRemaining = Date.parse(raid.countdownEndsAt) - Date.now();
  const lines = [
    bold(`🐉 RAID BOSS: ${escapeHtml(raid.bossName)}`),
    DIFFICULTY_TAG[raid.tier] || '',
    '',
    bold(formatTypeLine(raid.bossTypes)),
    '',
    `👥 Players: ${bold(raid.players.size)}/${LOBBY_SIZE}`,
    msRemaining > 0 ? `⏳ Starting in: ${bold(formatDuration(msRemaining))} (or when the lobby fills)` : '⏳ Starting now...',
    '',
    `Tap ⚔️ Join Raid, then pick ${TEAM_SIZE} Pokémon from your collection to bring into battle.`,
  ];
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

function battleText(raid, extra) {
  const msRemaining = raid.battleEndsAt ? Date.parse(raid.battleEndsAt) - Date.now() : BATTLE_TTL_MS;
  const activeCount = [...raid.players.values()].filter((p) => !p.eliminated).length;
  const lines = [
    bold(`🐉 RAID BOSS: ${escapeHtml(raid.bossName)}`),
    DIFFICULTY_TAG[raid.tier] || '',
    '',
    bold(formatTypeLine(raid.bossTypes)),
    hpBar(raid.hp, raid.maxHp),
    '',
    `👥 Players: ${bold(raid.players.size)}/${LOBBY_SIZE} (${activeCount} still fighting)`,
    `⏳ Time Remaining: ${bold(msRemaining > 0 ? formatDuration(msRemaining) : '0m')}`,
  ];
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// If a call 429s, waits out exactly the retry_after Telegram reported (capped, so this can
// never hang indefinitely) and tries ONE more time before giving up. Root-caused a real
// production bug: the catch encounter (sendRaidMedia, right after victory) fires moments after
// a flurry of rapid boss-attack edits — the whole chat is very likely STILL under the same
// active 429 cooldown at that exact moment, so all 3 fallback methods (animation/photo/text)
// were hitting the identical still-active cooldown back-to-back within the same second and all
// failing — the catch encounter (the reward players actually care about) silently vanished even
// though battle rewards were already granted. Waiting out the cooldown once fixes it for the
// realistic case (a single active cooldown), without risking a long hang.
const SEND_RETRY_MAX_WAIT_MS = 20 * 1000;
async function sendWithBackoffRetry(fn, label) {
  try {
    return await fn();
  } catch (err) {
    const retryMs = parseRetryAfterMs(err.message);
    if (!retryMs || retryMs > SEND_RETRY_MAX_WAIT_MS) throw err;
    console.error(`${label} hit a 429 — waiting ${retryMs}ms (Telegram's own retry_after) and trying once more:`, err.message);
    await sleep(retryMs + 200);
    return fn();
  }
}

// Returns { message, isMedia } — `isMedia` records whether the sent message actually has a
// caption (photo/animation) or is plain text, so later edits use the matching Telegram method.
// (A prior version always assumed media and called editMessageText/editMessageCaption
// inconsistently — caused real "no text/caption to edit" 400s in production.)
async function sendRaidMedia(bot, chatId, bossName, dexNumber, caption, keyboard) {
  try {
    const message = await sendWithBackoffRetry(
      () =>
        bot.telegram.sendAnimation(chatId, getAnimatedSpriteUrl(bossName), {
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup,
        }),
      `Animated raid intro for ${bossName}`
    );
    return { message, isMedia: true };
  } catch (err) {
    console.error(`Failed to send animated raid intro for ${bossName}, falling back to static artwork:`, err.message);
  }
  try {
    const imageUrl = getArtworkUrl(dexNumber, false);
    if (imageUrl) {
      const message = await sendWithBackoffRetry(
        () => bot.telegram.sendPhoto(chatId, imageUrl, { caption, parse_mode: 'HTML', reply_markup: keyboard.reply_markup }),
        `Static raid artwork for ${bossName}`
      );
      return { message, isMedia: true };
    }
  } catch (err) {
    console.error(`Failed to send static raid artwork for ${bossName}, falling back to plain text:`, err.message);
  }
  // Last resort. This used to be unguarded on the theory that a plain sendMessage "always
  // succeeds unless the bot lost access to the chat" — wrong in practice: a live 429 (e.g.
  // Telegram throttling the bot from cumulative traffic) hits this exact call too, and an
  // uncaught throw here meant a just-won raid's catch encounter silently never got created
  // even though rewards were already granted. Never throws now — callers check `message`.
  try {
    const message = await sendWithBackoffRetry(
      () => bot.telegram.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }),
      `Raid message for ${bossName}`
    );
    return { message, isMedia: false };
  } catch (err) {
    console.error(`Failed to send raid message for ${bossName} via any method:`, err.message);
    return { message: null, isMedia: false };
  }
}

// Returns false only when the message is permanently gone (deleted, or the bot lost access) —
// callers that repeat on a timer (boss auto-attack) use this to stop retrying forever instead
// of erroring every few seconds against a message that will never succeed again. A 429 or transient
// error still returns true (this specific edit was skipped, but the raid keeps going).
// Always stamps raid.lastEditAt (even direct, non-throttled callers like bossAttack) so
// scheduleRaidEdit's throttle stays accurate no matter which path actually sent the last edit.
async function editRaidMessage(bot, raid, text, keyboard) {
  raid.lastEditAt = Date.now();
  const extra = { ...HTML, ...(keyboard || { reply_markup: { inline_keyboard: [] } }) };
  try {
    if (raid.isMedia) {
      await bot.telegram.editMessageCaption(raid.chatId, raid.messageId, undefined, text, extra);
    } else {
      await bot.telegram.editMessageText(raid.chatId, raid.messageId, undefined, text, extra);
    }
    return true;
  } catch (err) {
    // Telegram told us exactly how long it's blocking edits for — honor it so the very next
    // scheduled edit doesn't immediately 429 again too (this is what kept happening in
    // production at a fixed 1.2s throttle: real 20-person raids sustain a rate Telegram's
    // per-message edit limit can't keep up with, so it self-throttled harder than we did).
    const retryAfterMs = parseRetryAfterMs(err.message);
    if (retryAfterMs) raid.editBlockedUntil = Date.now() + retryAfterMs;
    console.error('Failed to edit raid message:', err.message);
    return !/message to edit not found/i.test(err.message);
  }
}

// Player-triggered attacks (Telegram button or Mini App) can burst — with up to 20 people
// tapping within the same second, editing the raid message on every single attack would spam
// Telegram's per-message edit rate limit (causing slow/429'd edits) and, on the Mini App path,
// would block each attacker's HTTP response on that edit's network round trip. This coalesces
// bursts into at most one edit per EDIT_THROTTLE_MS (or longer if Telegram just told us to back
// off further), always showing the latest text, and is fire-and-forget so callers never wait.
function scheduleRaidEdit(bot, raid, text, keyboard) {
  raid.pendingEdit = { text, keyboard };
  if (raid.editTimerHandle) return;
  const earliestByThrottle = (raid.lastEditAt || 0) + EDIT_THROTTLE_MS;
  const earliestByBackoff = raid.editBlockedUntil || 0;
  const wait = Math.max(0, earliestByThrottle - Date.now(), earliestByBackoff - Date.now());
  raid.editTimerHandle = setTimeout(async () => {
    raid.editTimerHandle = null;
    const pending = raid.pendingEdit;
    raid.pendingEdit = null;
    if (!pending || activeRaids.get(raid.chatId) !== raid) return;
    try {
      await editRaidMessage(bot, raid, pending.text, pending.keyboard);
    } catch (err) {
      console.error('Throttled raid edit failed:', err.message);
    }
  }, wait);
}

async function endRaidBecauseMessageGone(bot, raid) {
  clearRaidTimers(raid);
  activeRaids.delete(raid.chatId);
  try {
    await bot.telegram.sendMessage(
      raid.chatId,
      '⚠️ The raid message was deleted, so this raid had to be ended early. No rewards — sorry! Start a fresh one with /raid.'
    );
  } catch (err) {
    console.error('Failed to announce raid ended (message gone):', err.message);
  }
}

// Every raid timer (lobby countdown, battle timeout, boss-attack interval) calls its async
// handler bare via setTimeout/setInterval, with no `.catch` — if the handler ever threw
// uncaught, that becomes an unhandled promise rejection, and Node terminates the whole
// process on those by default. One bad raid could crash the entire bot (all ~25 groups) and
// wipe every other feature's in-memory state on the pm2 restart that follows — this is almost
// certainly what "raid never starts after the timer" actually was. Every timer callback goes
// through this wrapper now: errors are caught and logged, and if anything unexpected breaks
// mid-raid, the raid ends cleanly instead of hanging forever with no explanation.
function safeRaidTick(bot, raid, label, fn) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`Unexpected error in raid ${label} for chat ${raid.chatId}:`, err.stack || err.message);
      if (activeRaids.get(raid.chatId) === raid) {
        clearRaidTimers(raid);
        activeRaids.delete(raid.chatId);
        try {
          await bot.telegram.sendMessage(raid.chatId, '⚠️ Something went wrong with this raid and it had to be ended early. Sorry! Start a fresh one with /raid.');
        } catch (sendErr) {
          console.error('Failed to announce unexpected raid failure:', sendErr.message);
        }
      }
    }
  };
}

// ---- Lobby ----

// `forcedBossName` (optional) lets an admin pick an exact species instead of a random roll from
// the tier's pool — e.g. `/raid mewtwo ultra` runs Mewtwo specifically, at Ultra Rare's HP/ATK
// even though Mewtwo's "natural" pool is Legendary. Species (types/dex/artwork) and difficulty
// tier (HP/ATK/catch chance) are fully independent inputs — the boss's stats always come from
// `tier`, regardless of which pool the species is normally rolled from.
async function startRaid(bot, chatId, tier, forcedBossName) {
  const pool = tier === 'ultra_rare' ? ULTRA_RARE : tier === 'mythical' ? MYTHICAL : LEGENDARY;
  const bossName = forcedBossName || pick(pool);
  const entry = getPokedexEntry(bossName);
  const maxHp = RAID_HP[tier] || RAID_HP.legendary;

  const raid = {
    chatId,
    tier,
    bossName,
    bossTypes: entry.types,
    bossDex: entry.dexNumber,
    bossAtk: BOSS_ATK[tier] || BOSS_ATK.legendary,
    phase: 'lobby',
    hp: maxHp,
    maxHp,
    players: new Map(), // userId -> { name, team, activeIndex, eliminated, damageDealt }
    eventLog: [], // plain-text battle feed for the Mini App, capped — Telegram gets its own HTML-formatted lines
    messageId: null,
    isMedia: true,
    countdownEndsAt: new Date(Date.now() + LOBBY_COUNTDOWN_MS).toISOString(),
    countdownHandle: null,
    battleEndsAt: null,
    attackIntervalHandle: null,
    battleTimeoutHandle: null,
    finalHitUserId: null,
    editTimerHandle: null,
    lastEditAt: 0,
    editBlockedUntil: 0,
    pendingEdit: null,
  };
  activeRaids.set(chatId, raid);

  try {
    const caption = lobbyText(raid);
    const { message, isMedia } = await sendRaidMedia(bot, chatId, bossName, entry.dexNumber, caption, lobbyKeyboard(chatId));
    if (!message) throw new Error('sendRaidMedia could not post via any method (animation, photo, or plain text)');
    raid.messageId = message.message_id;
    raid.isMedia = isMedia;
  } catch (err) {
    // Couldn't post anything at all (e.g. bot lost post rights mid-command, or Telegram is
    // throttling this hard) — don't leave a phantom raid blocking this group's daily cap and
    // "one raid at a time" slot forever.
    console.error(`Failed to start raid in chat ${chatId}, aborting:`, err.message);
    activeRaids.delete(chatId);
    throw err;
  }

  raid.countdownHandle = setTimeout(
    safeRaidTick(bot, raid, 'lobby countdown', () => onLobbyCountdownEnd(bot, raid)),
    LOBBY_COUNTDOWN_MS
  );
}

async function onLobbyCountdownEnd(bot, raid) {
  if (raid.phase !== 'lobby') return; // already started early from a full lobby
  if (raid.players.size === 0) {
    activeRaids.delete(raid.chatId);
    await editRaidMessage(bot, raid, lobbyText(raid, '💨 Nobody joined in time — raid cancelled.'), null);
    return;
  }
  await startBattle(bot, raid);
}

async function startBattle(bot, raid) {
  clearTimeout(raid.countdownHandle);
  raid.phase = 'battle';
  raid.battleEndsAt = new Date(Date.now() + BATTLE_TTL_MS).toISOString();
  for (const participant of raid.players.values()) {
    participant.activeIndex = 0;
    participant.eliminated = false;
    participant.damageDealt = 0;
    raidStats.recordParticipation(raid.chatId, participant.userId);
  }

  addEvent(raid, '⚔️ The battle begins!');
  emitRaidChange(raid);
  await editRaidMessage(bot, raid, battleText(raid, '⚔️ The battle begins!'), battleKeyboard(raid.chatId));

  scheduleBossAttack(bot, raid);
  raid.battleTimeoutHandle = setTimeout(
    safeRaidTick(bot, raid, 'battle timeout', () => onBattleTimeout(bot, raid)),
    BATTLE_TTL_MS
  );
}

// Self-rescheduling instead of setInterval so each gap can be independently randomized
// (5-10s) rather than fixed. Re-arms itself after each attack only if the raid is still a
// live battle — avoids scheduling a phantom attack after victory/failure/timeout already
// ended it (those all clear raid.attackIntervalHandle via clearRaidTimers, but this guard
// covers the brief window where a tick is already in flight when the raid ends).
function scheduleBossAttack(bot, raid) {
  raid.attackIntervalHandle = setTimeout(
    safeRaidTick(bot, raid, 'boss auto-attack', async () => {
      await bossAttack(bot, raid);
      if (activeRaids.get(raid.chatId) === raid && raid.phase === 'battle') {
        scheduleBossAttack(bot, raid);
      }
    }),
    nextBossAttackDelay()
  );
}

async function onBattleTimeout(bot, raid) {
  if (!activeRaids.has(raid.chatId)) return;
  await endRaidFailed(bot, raid, '💨 The raid boss got away — time ran out. No rewards this time.');
}

function clearRaidTimers(raid) {
  clearTimeout(raid.countdownHandle);
  clearTimeout(raid.attackIntervalHandle); // setTimeout now (randomized cadence), not setInterval
  clearTimeout(raid.battleTimeoutHandle);
  clearTimeout(raid.editTimerHandle);
}

async function endRaidFailed(bot, raid, reason) {
  clearRaidTimers(raid);
  activeRaids.delete(raid.chatId);
  addEvent(raid, reason);
  emitRaidChange(raid);
  await editRaidMessage(bot, raid, battleText(raid, reason), null);
}

// ---- Boss auto-attack ----

function summarizeNames(names, cap = 10) {
  if (names.length <= cap) return names.join(', ');
  return `${names.slice(0, cap).join(', ')} +${names.length - cap} more`;
}

// AoE — Pokémon GO-style: the boss hits EVERY still-fighting trainer's active Pokémon on the
// same attack, not one random victim (was single-target before). User-requested difficulty
// pass, 2026-07-23 — a raid boss should threaten the whole party at once, not pick on one
// person at a time. Move is chosen from the boss's own types (there's no longer a single
// "defender" to optimize against), but damage/effectiveness is still computed per-target since
// each trainer's active mon has its own types. The boss's raw ATK is split across however many
// trainers are currently in the fight (BOSS_AOE_SPLIT_EXPONENT) — see the constant's own comment
// for why this is load-bearing, not just flavor: without it, a full raid's teams are wiped in
// the opening seconds no matter how many people join.
async function bossAttack(bot, raid) {
  if (!activeRaids.has(raid.chatId) || raid.phase !== 'battle') return;
  const alive = [...raid.players.entries()].filter(([, p]) => !p.eliminated);
  if (alive.length === 0) {
    await endRaidFailed(bot, raid, '💀 Every trainer has been knocked out — the raid boss remains undefeated.');
    return;
  }

  const move = pick(movesFor(raid.bossTypes));
  const perTargetAtk = Math.max(1, Math.round(raid.bossAtk / Math.pow(alive.length, BOSS_AOE_SPLIT_EXPONENT)));
  let superEffectiveCount = 0;
  const faintedNames = [];
  const eliminatedNames = [];

  for (const [, target] of alive) {
    const mon = target.team[target.activeIndex];
    const { damage, superEffective } = calcDamage(perTargetAtk, move.type, mon.types);
    mon.hp = Math.max(0, mon.hp - damage);
    if (superEffective) superEffectiveCount++;

    if (mon.hp <= 0) {
      faintedNames.push(`${target.name}'s ${mon.speciesName}`);
      battleCooldowns.applyFaintCooldown(target.userId, mon.speciesName, mon.shiny, RAID_FAINT_COOLDOWN_MS);
      target.activeIndex += 1;
      if (target.activeIndex >= TEAM_SIZE) {
        target.eliminated = true;
        eliminatedNames.push(target.name);
      }
    }
  }

  const lines = [
    `🐉 ${bold(escapeHtml(raid.bossName))} used ${bold(move.name)} — it hit ${bold('the whole raid party')}!${
      superEffectiveCount ? ` 💥 Super effective on ${bold(superEffectiveCount)}!` : ''
    }`,
  ];
  if (faintedNames.length) {
    lines.push(`❌ Fainted (resting ${formatDuration(RAID_FAINT_COOLDOWN_MS)}): ${faintedNames.map(escapeHtml).join(', ')}`);
  }
  if (eliminatedNames.length) lines.push(`💀 ${bold('Eliminated')} (no Pokémon left): ${eliminatedNames.map(escapeHtml).join(', ')}`);

  addEvent(
    raid,
    `🐉 ${raid.bossName} used ${move.name} — hit everyone!${superEffectiveCount ? ` (${superEffectiveCount} super effective)` : ''}`
  );
  if (faintedNames.length) addEvent(raid, `❌ Fainted: ${summarizeNames(faintedNames)}`);
  if (eliminatedNames.length) addEvent(raid, `💀 Eliminated: ${summarizeNames(eliminatedNames)}`);

  emitRaidChange(raid);
  const stillEditable = await editRaidMessage(bot, raid, battleText(raid, lines.join('\n')), battleKeyboard(raid.chatId));
  if (!stillEditable) {
    // The raid message itself is gone (deleted, or the bot lost access) — retrying every
    // few seconds forever would just spam errors and permanently occupy this group's one-raid
    // slot and daily cap for no reason. End it cleanly instead.
    await endRaidBecauseMessageGone(bot, raid);
  }
}

// ---- Player attacks ----

// Core attack resolution — the ONE place damage gets calculated and state gets mutated for a
// player's turn, shared by both the Telegram button and the Mini App's attack request so the
// two surfaces can never drift out of sync with each other.
// Returns { ok: false, reason } or { ok: true, participant, mon, move, damage, superEffective, victory }.
function resolvePlayerAttack(raid, userId) {
  const participant = raid.players.get(userId);
  if (!participant) return { ok: false, reason: 'not_in_raid' };
  if (participant.eliminated) return { ok: false, reason: 'eliminated' };

  const mon = participant.team[participant.activeIndex];
  const profile = users.getProfile(raid.chatId, userId);
  const move = chooseMove(mon.types, raid.bossTypes);
  const { damage, superEffective } = calcDamage(mon.atk * levelMultiplier(profile?.level), move.type, raid.bossTypes);
  raid.hp = Math.max(0, raid.hp - damage);
  participant.damageDealt += damage;
  raidStats.addDamage(raid.chatId, userId, damage);

  const victory = raid.hp <= 0;
  if (victory) raid.finalHitUserId = userId;

  addEvent(
    raid,
    `⚔️ ${participant.name}'s ${mon.speciesName} used ${move.name}! -${damage} HP${superEffective ? ' Super effective!' : ''}`
  );

  return { ok: true, participant, mon, move, damage, superEffective, victory };
}

function attackReasonMessage(reason) {
  return reason === 'not_in_raid'
    ? "You're not in this raid — join before it starts."
    : 'All 3 of your Pokémon have fainted — you can no longer attack this raid.';
}

async function playerAttack(bot, ctx, raid, userId) {
  const result = resolvePlayerAttack(raid, userId);
  if (!result.ok) {
    await ctx.answerCbQuery(attackReasonMessage(result.reason), { show_alert: true });
    return;
  }
  const { participant, mon, move, damage, superEffective, victory } = result;
  await ctx.answerCbQuery(`${mon.speciesName} used ${move.name}! ${superEffective ? '💥 Super effective! ' : ''}-${damage} HP`);
  emitRaidChange(raid);

  if (victory) {
    await endRaidVictory(bot, raid);
    return;
  }

  const extra = `${bold(participant.name)}'s ${escapeHtml(mon.speciesName)} used ${bold(move.name)}!${
    superEffective ? ' 💥' : ''
  } -${damage} HP`;
  scheduleRaidEdit(bot, raid, battleText(raid, extra), battleKeyboard(raid.chatId));
}

// Same attack, triggered from the Mini App instead of a Telegram button tap — keeps the
// Telegram chat message in sync too (edits it exactly like a Telegram-triggered attack would),
// since both surfaces share the same underlying raid object.
async function attackFromWeb(bot, chatId, userId) {
  const raid = activeRaids.get(chatId);
  if (!raid || raid.phase !== 'battle') return { ok: false, reason: 'no_active_raid' };

  const result = resolvePlayerAttack(raid, userId);
  if (!result.ok) return result;

  emitRaidChange(raid);
  if (result.victory) {
    await endRaidVictory(bot, raid);
  } else {
    const extra = `${bold(result.participant.name)}'s ${escapeHtml(result.mon.speciesName)} used ${bold(result.move.name)}!${
      result.superEffective ? ' 💥' : ''
    } -${result.damage} HP`;
    // Fire-and-forget: the Telegram group message edit is throttled/coalesced separately and
    // must NOT block this response — otherwise every attacker's button lag would be at the
    // mercy of Telegram's API latency (and its per-message edit rate limit under 20 concurrent
    // attackers). The Mini App already has the real result below and the WS broadcast above.
    scheduleRaidEdit(bot, raid, battleText(raid, extra), battleKeyboard(raid.chatId));
  }
  // bossHp/bossMaxHp let the Mini App update the boss HP bar instantly from this same HTTP
  // response instead of waiting for a second WebSocket round trip.
  return { ...result, bossHp: raid.hp, bossMaxHp: raid.maxHp };
}

// ---- Victory / rewards / catch encounter ----

async function endRaidVictory(bot, raid) {
  clearRaidTimers(raid);
  activeRaids.delete(raid.chatId);
  addEvent(raid, `🎉 ${raid.bossName} was defeated!`);
  emitRaidChange(raid);

  const totalDamage = [...raid.players.values()].reduce((sum, p) => sum + p.damageDealt, 0) || 1;
  let mvpId = null;
  let mvpDamage = -1;
  for (const [userId, p] of raid.players) {
    if (p.damageDealt > mvpDamage) {
      mvpDamage = p.damageDealt;
      mvpId = userId;
    }
  }

  const resultLines = [bold('🎉 The Raid Boss was defeated!'), ''];
  for (const [userId, p] of raid.players) {
    const share = p.damageDealt / totalDamage;
    let xp = BASE_REWARD_XP + Math.round(SHARE_BONUS_XP * share);
    let coins = BASE_REWARD_COINS + Math.round(SHARE_BONUS_COINS * share);
    let points = BASE_RAID_POINTS + Math.round(SHARE_BONUS_POINTS * share);
    const tags = [];

    if (userId === mvpId && p.damageDealt > 0) {
      xp += MVP_BONUS_XP;
      coins += MVP_BONUS_COINS;
      points += MVP_RAID_POINTS;
      raidStats.addMvp(raid.chatId, userId);
      inventory.addItem(userId, 'rare_candy', 2);
      tags.push('🏆 MVP (+2 Rare Candy)');
    }
    if (userId === raid.finalHitUserId) {
      xp += FINAL_HIT_BONUS_XP;
      coins += FINAL_HIT_BONUS_COINS;
      tags.push('🎯 Final Hit');
    }

    grantRewards(raid.chatId, userId, { xp, coins });
    raidStats.addPoints(raid.chatId, userId, points);
    raidStats.recordVictory(raid.chatId, userId, raid.tier);

    const tagText = tags.length ? ` (${tags.join(', ')})` : '';
    resultLines.push(`⚔️ ${bold(p.name)}${tagText} — ${p.damageDealt} dmg: +${xp} XP, +${coins} Coins, +${points} Raid Points`);
  }

  await editRaidMessage(bot, raid, battleText(raid, resultLines.join('\n')), null);
  await react(bot.telegram, raid.chatId, raid.messageId, '🏆');

  // Rewards above are already granted at this point no matter what happens next — the catch
  // encounter is a bonus on top, so a failure here (e.g. Telegram throttling) must never look
  // like the whole victory failed. Guarded directly since this runs from a live user tap
  // (playerAttack), not a timer — safeRaidTick only wraps the 3 timer call sites.
  try {
    await startCatchEncounter(bot, raid);
  } catch (err) {
    console.error(`Failed to start catch encounter for chat ${raid.chatId} (rewards were still granted):`, err.message);
  }
}

async function startCatchEncounter(bot, raid) {
  catchAttempts.set(raid.chatId, new Set());
  const entry = getPokedexEntry(raid.bossName);
  const caption = [
    bold(`🎯 ${escapeHtml(raid.bossName)} Encounter!`),
    '',
    'Every trainer who fought gets one independent catch attempt — tap below!',
    '',
    'Results:',
  ].join('\n');

  const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🎯 Catch!', `raidcatch:${raid.chatId}`)]]);
  const { message, isMedia } = await sendRaidMedia(bot, raid.chatId, raid.bossName, entry.dexNumber, caption, keyboard);
  if (!message) {
    catchAttempts.delete(raid.chatId);
    throw new Error('sendRaidMedia could not post the catch encounter via any method');
  }

  catchEncounters.set(raid.chatId, {
    chatId: raid.chatId,
    messageId: message.message_id,
    isMedia,
    bossName: raid.bossName,
    bossDex: entry.dexNumber,
    tier: raid.tier,
    participantIds: new Set(raid.players.keys()),
    results: [],
  });
}

async function attemptCatch(bot, ctx, chatId, userId) {
  const encounter = catchEncounters.get(chatId);
  if (!encounter) {
    await ctx.answerCbQuery('This encounter has ended.', { show_alert: true });
    return;
  }
  if (!encounter.participantIds.has(userId)) {
    await ctx.answerCbQuery("You didn't fight in this raid, so you don't get an encounter.", { show_alert: true });
    return;
  }
  const attempted = catchAttempts.get(chatId);
  if (attempted.has(userId)) {
    await ctx.answerCbQuery("You've already used your catch attempt.", { show_alert: true });
    return;
  }
  attempted.add(userId);

  const name = displayName(ctx.from);
  const chance = CATCH_CHANCE[encounter.tier] || CATCH_CHANCE.legendary;
  const caught = Math.random() < chance;
  let resultLine;
  if (caught) {
    const shiny = Math.random() < RAID_SHINY_CHANCE;
    pokemonCollectionDb.recordCatch(userId, encounter.bossName, encounter.tier, shiny);
    resultLine = `✅ ${bold(name)} caught ${shiny ? '✨ SHINY ' : ''}${bold(encounter.bossName)}!`;
    await ctx.answerCbQuery(shiny ? `✨ SHINY catch!! ${encounter.bossName} is yours!` : `Caught! ${encounter.bossName} is yours!`);
  } else {
    resultLine = `💨 ${bold(name)}'s attempt broke free.`;
    await ctx.answerCbQuery(`💨 It broke free — better luck next raid!`);
  }
  encounter.results.push(resultLine);

  const caption = [
    bold(`🎯 ${escapeHtml(encounter.bossName)} Encounter!`),
    '',
    'Every trainer who fought gets one independent catch attempt — tap below!',
    '',
    'Results:',
    ...encounter.results,
  ].join('\n');

  const stillOpen = attempted.size < encounter.participantIds.size;
  const keyboard = stillOpen
    ? { reply_markup: { inline_keyboard: [[{ text: '🎯 Catch!', callback_data: `raidcatch:${chatId}` }]] } }
    : { reply_markup: { inline_keyboard: [] } };
  try {
    if (encounter.isMedia) {
      await bot.telegram.editMessageCaption(chatId, encounter.messageId, undefined, caption, { ...HTML, ...keyboard });
    } else {
      await bot.telegram.editMessageText(chatId, encounter.messageId, undefined, caption, { ...HTML, ...keyboard });
    }
  } catch (err) {
    console.error('Failed to edit raid catch encounter message:', err.message);
  }

  if (!stillOpen) {
    catchEncounters.delete(chatId);
    catchAttempts.delete(chatId);
  }
}

// ---- Pre-built raid teams ----
//
// Replaces the old in-group, live, multi-step team picker entirely — that flow posted up to
// 3 sequential messages PER PLAYER directly into the group chat, all competing for that one
// chat's shared Telegram rate-limit budget. With ~20 people picking around the same moment
// (exactly the raid lobby scenario) this reliably produced dropped/rate-limited edits, which
// showed up live as "No active raid team selection — tap Join Raid again" and, because state
// mutation order bugs compounded it, occasional stuck/duplicate picks. None of that is
// reachable anymore: a team is built ahead of time (or any time) in the Mini App team builder
// (`src/webapp/public/team.html`, backed by `raid_saved_teams`), and joining a raid in the
// group is a single synchronous, no-Telegram-API-calls-per-pick action.

// Re-validates a saved team against the trainer's CURRENT collection at join time (they may
// have saved it a while ago) — returns the resolved battle-ready team, or null if they have no
// saved team, a saved pick is no longer owned, or not enough FREE copies remain.
//
// Duplicate-aware: a saved team can legitimately pick the same species+shiny more than once if
// the trainer owns multiple copies (e.g. 2 Ho-Oh) — `usedCount` tracks how many copies this
// resolution has already allocated to earlier team slots, so a team needing 2 Ho-Oh only
// succeeds if at least 2 copies are both owned AND not currently resting (each copy rests
// independently — see battleCooldowns.restingCount).
function resolveSavedTeam(userId) {
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
    const freeCopies = row.quantity - resting;
    if (alreadyUsed + 1 > freeCopies) return null;
    usedCount.set(key, alreadyUsed + 1);
    team.push(makeMon(row));
  }
  return team;
}

// DMs the trainer a link to the team builder — thrown (not swallowed) on DM failure so the
// caller can show a distinct "start a DM with me first" alert vs. the normal "check your DMs"
// one.
//
// Distinguishes WHY a saved team is currently unusable — genuinely no longer owned, vs. just
// resting from a recent faint (now that raid faints apply a real cooldown) — since those need
// different messaging; "you no longer have this" would be misleading for a mon the trainer
// still owns but can't use for a few more minutes. Same duplicate-aware allocation as
// resolveSavedTeam so a team needing 2 copies correctly reports "resting" only when there
// genuinely aren't 2 free copies, not just because ANY cooldown row exists for that species.
function savedTeamIssue(userId) {
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

async function promptTeamSetup(bot, userId) {
  const tunnelUrl = getTunnelUrl();
  if (!tunnelUrl) {
    throw new Error('tunnel_unavailable');
  }
  const issue = savedTeamIssue(userId);
  const intro =
    issue === 'resting'
      ? '⏳ One of your saved raid team members is still resting after a recent faint — pick a fresh team (or wait it out) before joining.'
      : issue === 'not_owned'
        ? '⚠️ Your saved raid team includes a Pokémon you no longer have — pick a new team before joining.'
        : "🐾 You don't have a raid team set up yet — pick your 3 Pokémon once, then Join Raid instantly every time.";
  await bot.telegram.sendMessage(userId, `${bold(intro)}\n\nOnce it's saved, come back and tap ⚔️ Join Raid again.`, {
    ...HTML,
    ...Markup.inlineKeyboard([[Markup.button.webApp('🛠 Build My Raid Team', `${tunnelUrl}/team.html`)]]),
  });
}

const TIER_KEYWORDS = {
  legendary: 'legendary',
  mythical: 'mythical',
  ultra: 'ultra_rare',
  ultrarare: 'ultra_rare',
  ultra_rare: 'ultra_rare',
};

// The species a raid boss can be, and the difficulty tier it fights at, are independent —
// this only resolves the SPECIES half. Only real raid-eligible species (Legendary, Mythical,
// or the Ultra Rare curated subset) can be forced; common/rare species were never meant to be
// raid bosses.
function resolveRaidBossName(input) {
  if (!input) return null;
  const target = input.trim().toLowerCase();
  const pool = [...new Set([...LEGENDARY, ...MYTHICAL, ...ULTRA_RARE])];
  return pool.find((name) => name.toLowerCase() === target) || null;
}

// The tier a forced species naturally "belongs to" when no explicit tier is given —
// Ultra Rare first (it's the most exclusive/specific pool), then Mythical, else Legendary.
function naturalTierFor(bossName) {
  if (ULTRA_RARE.includes(bossName)) return 'ultra_rare';
  if (MYTHICAL.includes(bossName)) return 'mythical';
  return 'legendary';
}

function register(bot) {
  bot.command('raid', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
      await ctx.reply('Run /raid inside a group.');
      return;
    }

    // Deletes the triggering command itself so regular members never see that a specific boss
    // (or tier) was hand-picked — from their side, a raid should just appear to start "on its
    // own". Needs the bot to have "Delete Messages" rights in the group; if it doesn't, this
    // silently no-ops and the raid still starts normally, just without the concealment.
    try {
      await ctx.deleteMessage();
    } catch (err) {
      console.error('Could not delete /raid command message (bot likely lacks delete rights in this group):', err.message);
    }

    if (activeRaids.has(ctx.chat.id)) {
      await ctx.reply('⚔️ A raid is already active in this group — wait for it to end or fail before starting another.');
      return;
    }
    const countToday = raidDailyLimits.getCountToday(ctx.chat.id);
    if (countToday >= raidDailyLimits.DAILY_LIMIT) {
      await ctx.reply(`⚔️ This group has already run ${raidDailyLimits.DAILY_LIMIT} raids today — try again tomorrow.`);
      return;
    }

    // Accepts, in any order: a tier keyword (legendary/mythical/ultra), a specific boss name
    // (e.g. "mewtwo", "tapu koko"), both together (e.g. "mewtwo ultra" — Mewtwo fought at Ultra
    // Rare's HP/ATK, not its natural Legendary tier), or neither (random Legendary, as before).
    const rawArgs = ctx.message.text.split(' ').slice(1);
    let explicitTier = null;
    const nameTokens = [];
    for (const token of rawArgs) {
      const keyword = TIER_KEYWORDS[token.toLowerCase()];
      if (keyword && !explicitTier) explicitTier = keyword;
      else nameTokens.push(token);
    }
    const requestedName = nameTokens.join(' ').trim();

    let bossName = null;
    if (requestedName) {
      bossName = resolveRaidBossName(requestedName);
      if (!bossName) {
        await ctx.reply(
          `⚠️ "${escapeHtml(requestedName)}" isn't a valid raid boss — it needs to be a real Legendary, Mythical, or Ultra Rare Pokémon. Try /raid ultra to see the Ultra Rare roster, or just /raid for a random Legendary.`,
          HTML
        );
        return;
      }
    }
    const tier = explicitTier || (bossName ? naturalTierFor(bossName) : 'legendary');

    raidDailyLimits.increment(ctx.chat.id);
    try {
      await startRaid(bot, ctx.chat.id, tier, bossName);
    } catch (err) {
      await ctx.reply("⚠️ Couldn't post the raid — check the bot still has permission to post here, then try again.");
    }
  });

  bot.action(/^raid:(-?\d+):join$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const raid = activeRaids.get(chatId);
    if (!raid || raid.phase !== 'lobby') {
      await ctx.answerCbQuery('This raid is no longer accepting new players.', { show_alert: true });
      return;
    }
    const userId = ctx.from.id;
    users.getOrCreateUser(chatId, userId, ctx.from.username || ctx.from.first_name);
    if (raid.players.has(userId)) {
      await ctx.answerCbQuery("You've already joined this raid.");
      return;
    }
    if (raid.players.size >= LOBBY_SIZE) {
      await ctx.answerCbQuery('This raid lobby is full.', { show_alert: true });
      return;
    }

    // Instant join using the trainer's pre-built team — no live picking, so joining can never
    // lag or drop state no matter how many people tap it in the same second.
    const team = resolveSavedTeam(userId);
    if (!team) {
      try {
        await promptTeamSetup(bot, userId);
        await ctx.answerCbQuery('📩 Check your DMs to set up your raid team, then tap Join Raid again.', { show_alert: true });
      } catch (err) {
        await ctx.answerCbQuery(
          "I can't message you privately yet — tap my name, hit Start, then tap Join Raid again.",
          { show_alert: true }
        );
      }
      return;
    }

    const name = displayName(ctx.from);
    raid.players.set(userId, { userId, name, team, activeIndex: 0, eliminated: false, damageDealt: 0 });
    emitRaidChange(raid);
    await ctx.answerCbQuery(`✅ Joined with ${team.map((m) => m.speciesName).join(', ')}!`);
    scheduleRaidEdit(bot, raid, lobbyText(raid), lobbyKeyboard(raid.chatId));

    if (raid.players.size >= LOBBY_SIZE) {
      clearTimeout(raid.countdownHandle);
      await startBattle(bot, raid);
    }
  });

  bot.command('raidstart', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      await ctx.reply('🛠 Admin-only command.');
      return;
    }
    const raid = activeRaids.get(ctx.chat.id);
    if (!raid || raid.phase !== 'lobby') {
      await ctx.reply('No raid lobby is waiting to start in this group.');
      return;
    }
    if (raid.players.size === 0) {
      await ctx.reply('No trainers have joined yet — wait for at least one before starting.');
      return;
    }
    await ctx.reply('⚔️ Starting the battle now!');
    await startBattle(bot, raid);
  });

  bot.command('myteam', async (ctx) => {
    const userId = ctx.from.id;
    const tunnelUrl = getTunnelUrl();
    if (!tunnelUrl) {
      await ctx.reply('⚠️ The team builder is temporarily unavailable — try again in a bit.');
      return;
    }
    const keyboard = Markup.inlineKeyboard([[Markup.button.webApp('🛠 Build My Raid Team', `${tunnelUrl}/team.html`)]]);
    if (ctx.chat.type === 'private') {
      await ctx.reply('🐾 Pick the 3 Pokémon you want to bring into every raid:', { ...HTML, ...keyboard });
      return;
    }
    try {
      await bot.telegram.sendMessage(userId, '🐾 Pick the 3 Pokémon you want to bring into every raid:', { ...HTML, ...keyboard });
      await ctx.reply('📩 Sent you a DM to set up your raid team!');
    } catch (err) {
      await ctx.reply("I can't message you privately yet — tap my name, hit Start, then run /myteam again.");
    }
  });

  bot.action(/^raid:(-?\d+):attack$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const raid = activeRaids.get(chatId);
    if (!raid || raid.phase !== 'battle') {
      await ctx.answerCbQuery('This raid has ended.', { show_alert: true });
      return;
    }
    await playerAttack(bot, ctx, raid, ctx.from.id);
  });

  bot.action(/^raidcatch:(-?\d+)$/, async (ctx) => {
    await attemptCatch(bot, ctx, Number(ctx.match[1]), ctx.from.id);
  });

  // Tapped from a GROUP message — web_app buttons are illegal there (Telegram: "Available
  // only in private chats"), so DM the tapper their actual launch button instead, which is
  // legal in that context.
  bot.action(/^raid:(-?\d+):arena$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const tunnelUrl = getTunnelUrl();
    if (!tunnelUrl) {
      await ctx.answerCbQuery('Battle Arena is temporarily unavailable — use the buttons here instead.', { show_alert: true });
      return;
    }
    try {
      await bot.telegram.sendMessage(
        ctx.from.id,
        bold('🎮 Tap below to open your animated Battle Arena:'),
        {
          ...HTML,
          ...Markup.inlineKeyboard([[Markup.button.webApp('⚔️ Open Battle Arena', `${tunnelUrl}/?chatId=${chatId}`)]]),
        }
      );
      await ctx.answerCbQuery('Check your DMs! 📩');
    } catch (err) {
      console.error(`Failed to DM Battle Arena link to user ${ctx.from.id}:`, err.message);
      await ctx.answerCbQuery(
        "I can't message you privately yet — tap my name, hit Start, then tap this button again.",
        { show_alert: true }
      );
    }
  });

  bot.command('raidstats', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const profile = users.getOrCreateUser(chatId, userId, ctx.from.username || ctx.from.first_name);
    await ctx.reply(
      [
        bold('🏆 Your Raid Stats (this group)'),
        '',
        `⚔️ Raids Participated: ${bold(profile.raids_participated)}`,
        `🏁 Raids Completed: ${bold(profile.raids_completed)}`,
        `🐉 Legendary Raids Won: ${bold(profile.legendary_raids_won)}`,
        `🌟 Mythical Raids Won: ${bold(profile.mythical_raids_won)}`,
        `🔴 Ultra Rare Raids Won: ${bold(profile.ultra_rare_raids_won)}`,
        `💥 Total Raid Damage: ${bold(profile.raid_damage_total)}`,
        `📈 Highest Single-Attack Damage: ${bold(profile.highest_raid_damage)}`,
        `🏆 MVP Awards: ${bold(profile.raid_mvp_awards)}`,
        `🎫 Raid Points: ${bold(profile.raid_points)}`,
      ].join('\n'),
      HTML
    );
  });
}

function getRaid(chatId) {
  return activeRaids.get(chatId) || null;
}

// Builds the exact JSON the Mini App renders — never exposes other trainers' team contents
// beyond what's already public in the Telegram message (species/HP/name), and never leaks
// internal handles (timeouts, intervals) to the client.
function sanitizeRaidForWeb(raid, userId) {
  if (!raid) return null;
  const you = raid.players.get(userId) || null;
  return {
    chatId: raid.chatId,
    tier: raid.tier,
    bossName: raid.bossName,
    bossTypes: raid.bossTypes,
    hp: raid.hp,
    maxHp: raid.maxHp,
    phase: raid.phase,
    countdownEndsAt: raid.countdownEndsAt,
    battleEndsAt: raid.battleEndsAt,
    eventLog: raid.eventLog.slice(-10),
    playerCount: raid.players.size,
    lobbySize: LOBBY_SIZE,
    isParticipant: Boolean(you),
    you: you
      ? {
          name: you.name,
          activeIndex: you.activeIndex,
          eliminated: you.eliminated,
          damageDealt: you.damageDealt,
          team: you.team.map((m) => ({
            speciesName: m.speciesName,
            shiny: m.shiny,
            types: m.types,
            hp: m.hp,
            maxHp: m.maxHp,
          })),
        }
      : null,
    players: [...raid.players.values()].map((p) => ({
      name: p.name,
      eliminated: p.eliminated,
      damageDealt: p.damageDealt,
      activeSpecies: p.team[p.activeIndex]?.speciesName ?? null,
    })),
  };
}

// ---- Web-facing team builder API (backs GET/POST /api/collection, /api/team) ----

function collectionForWeb(userId) {
  return eligibleCollection(userId).map((row) => ({
    speciesName: row.species_name,
    shiny: Boolean(row.shiny),
    rarity: row.base_rarity,
    quantity: row.quantity,
  }));
}

function teamForWeb(userId) {
  return raidTeams.getTeam(userId) || [];
}

// Returns { ok: true } or { ok: false, reason }. Never trusts the client's picks blindly —
// re-checks length, uniqueness, and live ownership server-side before writing anything.
// Allows the SAME species+shiny to be picked more than once, up to however many the trainer
// actually owns (e.g. 2 Ho-Oh can fill 2 of the 3 team slots) — `duplicate_pick` now specifically
// means "more copies requested than owned", not "any repeat at all".
function saveTeamForWeb(userId, picks) {
  if (!Array.isArray(picks) || picks.length !== TEAM_SIZE) {
    return { ok: false, reason: 'invalid_team_size' };
  }
  const owned = eligibleCollection(userId);
  const usedCount = new Map();
  for (const pick of picks) {
    if (!pick || typeof pick.speciesName !== 'string') return { ok: false, reason: 'invalid_pick' };
    const key = `${pick.speciesName}|${Boolean(pick.shiny)}`;
    const row = owned.find((r) => r.species_name === pick.speciesName && Boolean(r.shiny) === Boolean(pick.shiny));
    if (!row) return { ok: false, reason: 'not_owned' };
    const used = (usedCount.get(key) || 0) + 1;
    if (used > row.quantity) return { ok: false, reason: 'duplicate_pick' };
    usedCount.set(key, used);
  }
  raidTeams.saveTeam(userId, picks.map((p) => ({ speciesName: p.speciesName, shiny: Boolean(p.shiny) })));
  return { ok: true };
}

module.exports = {
  register,
  startRaid,
  isRaidActive,
  getRaid,
  sanitizeRaidForWeb,
  attackFromWeb,
  onRaidChange,
  collectionForWeb,
  teamForWeb,
  saveTeamForWeb,
  LOBBY_SIZE,
  TEAM_SIZE,
  // Test-only hooks into real internal logic — lets tests trigger the same code paths that
  // normally fire on real timers (5-10s randomized boss-attack cadence, 3min lobby countdown)
  // without waiting on them. Never used by production code.
  __test: {
    activeRaids,
    bossAttack,
    startBattle,
    onLobbyCountdownEnd,
    safeRaidTick,
    resolveSavedTeam,
    nextBossAttackDelay,
    sendRaidMedia,
    RAID_HP,
    BOSS_ATK,
    BOSS_ATTACK_INTERVAL_MIN_MS,
    BOSS_ATTACK_INTERVAL_MAX_MS,
    BOSS_AOE_SPLIT_EXPONENT,
    ULTRA_RARE,
    CATCH_CHANCE,
    resolveRaidBossName,
    naturalTierFor,
    savedTeamIssue,
    eligibleCollection,
    RAID_FAINT_COOLDOWN_MS,
  },
};
