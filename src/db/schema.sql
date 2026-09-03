-- All player state is scoped per (chat_id, user_id) so each group has its own economy/leaderboard.

CREATE TABLE IF NOT EXISTS users (
  chat_id       INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  username      TEXT,
  xp            INTEGER NOT NULL DEFAULT 0,
  level         INTEGER NOT NULL DEFAULT 1,
  coins         INTEGER NOT NULL DEFAULT 0,
  catches       INTEGER NOT NULL DEFAULT 0,
  quiz_wins     INTEGER NOT NULL DEFAULT 0,
  shiny_count   INTEGER NOT NULL DEFAULT 0,
  legendary_count INTEGER NOT NULL DEFAULT 0,
  ttt_wins      INTEGER NOT NULL DEFAULT 0,
  rps_wins      INTEGER NOT NULL DEFAULT 0,
  scramble_wins INTEGER NOT NULL DEFAULT 0,
  whosthat_wins INTEGER NOT NULL DEFAULT 0,
  connect4_wins INTEGER NOT NULL DEFAULT 0,
  hangman_wins  INTEGER NOT NULL DEFAULT 0,
  battle_wins   INTEGER NOT NULL DEFAULT 0,
  raids_participated  INTEGER NOT NULL DEFAULT 0,
  raids_completed     INTEGER NOT NULL DEFAULT 0,
  raid_damage_total   INTEGER NOT NULL DEFAULT 0,
  raid_mvp_awards     INTEGER NOT NULL DEFAULT 0,
  legendary_raids_won INTEGER NOT NULL DEFAULT 0,
  mythical_raids_won  INTEGER NOT NULL DEFAULT 0,
  ultra_rare_raids_won INTEGER NOT NULL DEFAULT 0,
  highest_raid_damage INTEGER NOT NULL DEFAULT 0,
  raid_points         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS streaks (
  chat_id         INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  current_streak  INTEGER NOT NULL DEFAULT 0,
  longest_streak  INTEGER NOT NULL DEFAULT 0,
  last_checkin    TEXT,
  PRIMARY KEY (chat_id, user_id)
);

-- Generic per-user cooldown tracker: one row per (chat_id, user_id, action_key)
-- action_key examples: 'spin', 'chest', 'checkin'
CREATE TABLE IF NOT EXISTS cooldowns (
  chat_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  action_key  TEXT NOT NULL,
  last_used   TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id, action_key)
);

-- Global per-user inventory — items are the same for a trainer in every group they're in.
-- (Older installs had this scoped per-group; src/db/index.js migrates that forward once.)
CREATE TABLE IF NOT EXISTS inventory (
  user_id   INTEGER NOT NULL,
  item_key  TEXT NOT NULL,
  quantity  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_key)
);

-- NOTE: the old `pokemon_collection` (per-user quantity counter) table has been superseded by
-- `pokemon_instances` below (2026-07-23) — every Pokémon now gets its own permanent row/ID.
-- No longer created here; src/db/index.js migrates any pre-existing pokemon_collection data
-- into pokemon_instances once, then drops it. src/db/pokemonCollection.js is now a thin
-- compatibility wrapper (recordCatch/listCollection/getCollectionStats) over pokemonInstances.js
-- so existing consumers (battle/raid/breed/collection/friends) need zero code changes.

-- Groups that have the bot's scheduled jobs (morning mission, spawns) turned on
CREATE TABLE IF NOT EXISTS groups (
  chat_id           INTEGER PRIMARY KEY,
  title             TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  joined_at         TEXT NOT NULL DEFAULT (datetime('now')),
  autopromo_enabled INTEGER NOT NULL DEFAULT 0,
  promo_text        TEXT
);

-- One row per referred user, globally unique — a person can only ever be referred once,
-- so the reward can't be farmed by repeatedly "inviting" the same friend.
CREATE TABLE IF NOT EXISTS referrals (
  referred_user_id  INTEGER PRIMARY KEY,
  referrer_user_id  INTEGER NOT NULL,
  chat_id           INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  rewarded          INTEGER NOT NULL DEFAULT 0
);

-- Today's mission per group: catch the named Pokemon once to complete it
CREATE TABLE IF NOT EXISTS daily_missions (
  chat_id       INTEGER NOT NULL,
  mission_date  TEXT NOT NULL,
  pokemon_name  TEXT NOT NULL,
  completed_by  TEXT, -- comma-separated user_ids who already claimed today's mission reward
  PRIMARY KEY (chat_id, mission_date)
);

-- Tracks today's active spawn/mission per group so catch buttons resolve correctly
CREATE TABLE IF NOT EXISTS active_spawns (
  chat_id       INTEGER PRIMARY KEY,
  pokemon_name  TEXT NOT NULL,
  rarity        TEXT NOT NULL,
  message_id    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  caught_by     INTEGER,
  expired       INTEGER NOT NULL DEFAULT 0,
  gender        TEXT
);

-- Admin-created codes redeemable via /redeem. `code` is stored uppercase. `max_uses` NULL
-- means unlimited. Reward xp/coins credit to whichever group chat the user redeems it in.
CREATE TABLE IF NOT EXISTS promo_codes (
  code            TEXT PRIMARY KEY,
  xp              INTEGER NOT NULL DEFAULT 0,
  coins           INTEGER NOT NULL DEFAULT 0,
  item_key        TEXT,
  item_qty        INTEGER,
  pokemon_name    TEXT,
  pokemon_shiny   INTEGER NOT NULL DEFAULT 0,
  max_uses        INTEGER,
  uses_count      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  expires_at      TEXT,
  created_by      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (user, code), globally unique — same anti-farming shape as `referrals`, so a
-- code can only ever be redeemed once per trainer regardless of which group they're in.
CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  user_id      INTEGER NOT NULL,
  code         TEXT NOT NULL,
  chat_id      INTEGER NOT NULL,
  redeemed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, code)
);

-- Global per-user equipped cosmetics (one title + one badge at a time). Separate from the
-- stackable-quantity `inventory` table, which only tracks ownership, not which one is active.
CREATE TABLE IF NOT EXISTS equipped_cosmetics (
  user_id    INTEGER PRIMARY KEY,
  title_key  TEXT,
  badge_key  TEXT
);

-- Global friendships (not group-scoped — a friendship carries across every group). Always
-- stored with user_id_a < user_id_b so a pair has exactly one row regardless of who acted.
-- `requested_by` is whichever id sent the original request, needed so the other side is the
-- only one who can Accept. usernames are a best-effort display cache captured at request/accept
-- time (not kept live-synced) — purely cosmetic, never used for identity checks.
CREATE TABLE IF NOT EXISTS friendships (
  user_id_a     INTEGER NOT NULL,
  user_id_b     INTEGER NOT NULL,
  username_a    TEXT,
  username_b    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | accepted
  requested_by  INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id_a, user_id_b)
);

-- Global, one row per user — only one egg can incubate at a time. `egg_key` matches an item
-- in src/data/items.js (egg_common | egg_rare); the item itself is consumed the moment
-- incubation starts, same as any other "spend it now" action.
CREATE TABLE IF NOT EXISTS egg_incubation (
  user_id     INTEGER PRIMARY KEY,
  egg_key     TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ready_at    TEXT NOT NULL,
  chat_id     INTEGER, -- which group to notify in once it's ready
  notified    INTEGER NOT NULL DEFAULT 0
);

-- Per-group team choice (Team Wars). A trainer can switch freely EXCEPT while a war is
-- actively running in that group (checked in code, not here) — otherwise people could hop
-- to whichever side is winning right before it ends.
CREATE TABLE IF NOT EXISTS team_membership (
  chat_id  INTEGER NOT NULL,
  user_id  INTEGER NOT NULL,
  team     TEXT NOT NULL, -- 'red' | 'blue'
  PRIMARY KEY (chat_id, user_id)
);

-- One time-boxed Team War per group. Winner is decided by each team's total XP GAINED
-- during the window, not raw totals — see team_war_participants for the per-member
-- baseline that makes that delta possible even for members who join mid-war.
CREATE TABLE IF NOT EXISTS team_wars (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1, -- flips to 0 once resolved/announced
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per member who was on a team at any point during the war, capturing their XP
-- (in that group) at the moment they joined the war, so a late joiner's delta is still fair.
CREATE TABLE IF NOT EXISTS team_war_participants (
  war_id      INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  team        TEXT NOT NULL,
  xp_at_join  INTEGER NOT NULL,
  PRIMARY KEY (war_id, user_id)
);

-- Enforces the "5 raids per group per day" cap — one row per (group, date).
CREATE TABLE IF NOT EXISTS raid_daily_limits (
  chat_id  INTEGER NOT NULL,
  date     TEXT NOT NULL, -- YYYY-MM-DD, server-local
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, date)
);

-- Admin-created seasonal events. `theme_species` is a comma-separated list of exact
-- POKEDEX names — while an event is active, the spawn loop biases toward those species
-- within their normal rarity tier (a themed Pikachu still rolls as "common" like always,
-- it's just far more likely to be the one picked). Whether an event is "active" is always
-- computed from starts_at/ends_at at read time (same dynamic-expiry style as promo_codes),
-- no cron sweep needed — `active` is only an admin kill-switch for ending one early.
-- A fainted Pokémon (species+shiny, global — not per-group, matching pokemon_collection)
-- can't battle again until this expires. Only real players get rows here; the bot's
-- auto-rolled opponent in vs-Bot matches isn't owned, so it never needs a cooldown.
-- Superseded 2026-07-23 by battle_cooldown_instances below — this old table could only track
-- ONE resting flag per (user, species, shiny) regardless of how many copies a trainer owned, so
-- a trainer with 2 Ho-Oh had BOTH blocked the moment either one fainted. Left in place
-- (unused going forward) rather than dropped, since it holds live short-lived data and dropping
-- a table on a live DB isn't worth the risk for a table that just stops growing on its own.
CREATE TABLE IF NOT EXISTS battle_cooldowns (
  user_id       INTEGER NOT NULL,
  species_name  TEXT NOT NULL,
  shiny         INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT NOT NULL,
  PRIMARY KEY (user_id, species_name, shiny)
);

-- One row per RESTING COPY (not per species) — a trainer who owns 2 Ho-Oh and has one faint
-- gets exactly one row here; the other copy stays usable. "Is this species fully resting?"
-- means "count of rows here >= how many copies the trainer owns", checked against
-- pokemon_collection.quantity at query time (see battleCooldowns.js).
CREATE TABLE IF NOT EXISTS battle_cooldown_instances (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  species_name   TEXT NOT NULL,
  shiny          INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_battle_cooldown_instances_lookup
  ON battle_cooldown_instances (user_id, species_name, shiny);

CREATE TABLE IF NOT EXISTS seasonal_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  theme_species  TEXT NOT NULL,
  starts_at      TEXT NOT NULL,
  ends_at        TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A trainer's pre-built raid team (global, one per user — not per-group, matching
-- pokemon_collection). Built once via the Mini App team builder so joining a raid in
-- the group is a single instant tap instead of a live multi-step picker (that picker
-- was replaced entirely — it couldn't survive 20 people picking during the same lobby,
-- see bossRaid.js). Re-validated against the live collection at join time in case a
-- saved pick is no longer owned.
CREATE TABLE IF NOT EXISTS raid_saved_teams (
  user_id     INTEGER PRIMARY KEY,
  m1_species  TEXT NOT NULL,
  m1_shiny    INTEGER NOT NULL DEFAULT 0,
  m2_species  TEXT NOT NULL,
  m2_shiny    INTEGER NOT NULL DEFAULT 0,
  m3_species  TEXT NOT NULL,
  m3_shiny    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Source of truth for Pokémon ownership. One row per individual Pokémon, each with a
-- permanent unique ID — this is what makes a purchased Pokémon a real, specific, ID-tagged
-- individual rather than +1 to a stack, and sets up future 1-of-1 trading. `pokemon_collection`
-- (below) becomes a compatibility view/wrapper over this table so every existing consumer
-- (battle/raid/breed/collection/friends) keeps reading the same aggregate shape unchanged.
CREATE TABLE IF NOT EXISTS pokemon_instances (
  instance_id   TEXT PRIMARY KEY,        -- 8-char unique ID, e.g. "A1B2C3D4"
  user_id       INTEGER NOT NULL,
  species_name  TEXT NOT NULL,
  base_rarity   TEXT NOT NULL,
  shiny         INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'catch', -- catch | egg | promo | purchase | breed
  acquired_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pokemon_instances_owner ON pokemon_instances (user_id, species_name, shiny);

-- Global Gold balance, one row per user — not per-group, unlike regular Coins. Gold is only
-- ever credited via the admin's manual /grantgold command (real money paid off-platform),
-- never earned through gameplay, which is what makes /store purchases a real paid feature.
CREATE TABLE IF NOT EXISTS gold_wallet (
  user_id    INTEGER PRIMARY KEY,
  gold       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit trail for every Gold change — needed once real money is involved (support disputes,
-- refunds, "did I actually get credited" questions).
CREATE TABLE IF NOT EXISTS gold_transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  amount     INTEGER NOT NULL,           -- positive = credit, negative = debit
  reason     TEXT NOT NULL,              -- admin_grant | store_purchase | refund
  admin_id   INTEGER,                    -- who granted it, for manual credits
  note       TEXT,
  listing_id INTEGER,                    -- set on store_purchase rows, points at store_listings.id
                                          -- (nullable — admin_grant/refund rows have no listing)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin-managed store catalog. Gigantamax/Dynamax categories are schema-ready but stay
-- empty/unlisted at launch — no real artwork exists for those forms (verified against
-- PokeAPI and Pokémon Showdown earlier in this project).
CREATE TABLE IF NOT EXISTS store_listings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  species_name     TEXT NOT NULL,
  shiny            INTEGER NOT NULL DEFAULT 0,
  category         TEXT NOT NULL,        -- rare | legendary | mythical | shiny | shiny_legendary | shiny_mythical | gigantamax | dynamax
  price_gold       INTEGER NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  featured         INTEGER NOT NULL DEFAULT 0,
  event_label      TEXT,                 -- e.g. "Halloween 2026", null for permanent stock
  available_from   TEXT,
  available_until  TEXT,
  created_by       INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Player-to-player trading (2026-07-24). One row per trade session. A trade can carry Pokémon
-- (by instance_id — this is exactly why every Pokémon got a permanent unique ID), items, and/or
-- Coins on EITHER side — "friendly barter" and "paid trade" are just different configurations of
-- the same offer, not separate features: a straight swap has 0 coins both sides, a paid deal has
-- one side offering only coins. Coins are per-group (unlike Gold), so `chat_id` is the group whose
-- coin economy this trade's coin transfer (if any) settles in — the group /trade was run in.
-- A user may only be in ONE pending trade at a time (enforced in trades.js), which is what keeps
-- "is this instance/item already promised elsewhere" simple — no cross-trade locking needed.
CREATE TABLE IF NOT EXISTS trades (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id            INTEGER NOT NULL,
  initiator_id       INTEGER NOT NULL,
  target_id          INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | completed | cancelled | declined | expired
  initiator_ready    INTEGER NOT NULL DEFAULT 0,
  target_ready       INTEGER NOT NULL DEFAULT 0,
  initiator_coins    INTEGER NOT NULL DEFAULT 0,
  target_coins       INTEGER NOT NULL DEFAULT 0,
  message_id         INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trades_participants ON trades (initiator_id, target_id, status);

CREATE TABLE IF NOT EXISTS trade_offer_pokemon (
  trade_id     INTEGER NOT NULL,
  side         TEXT NOT NULL, -- initiator | target
  instance_id  TEXT NOT NULL,
  PRIMARY KEY (trade_id, instance_id)
);

CREATE TABLE IF NOT EXISTS trade_offer_items (
  trade_id     INTEGER NOT NULL,
  side         TEXT NOT NULL,
  item_key     TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  PRIMARY KEY (trade_id, side, item_key)
);
