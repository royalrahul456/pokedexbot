# 📟 PokéDex Bot

Pokémon GO themed daily-engagement bot for Telegram groups: morning missions, wild spawns,
daily streaks, spin wheel, mystery chest, and Poké Quiz.

Brand identity: every major broadcast message (help, guide, morning mission, streak alerts, admin
panel, announcements) carries a consistent `📟 PokéDex Bot` tag via `brandTag()` in
[src/utils/text.js](src/utils/text.js), so the bot feels like one product across every feature instead
of a pile of separate commands.

## Setup

1. **Get a bot token** — message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`, follow the prompts.
2. **Disable privacy mode** so the bot can see group messages (needed for passive chat XP and quiz answers):
   in BotFather, `/mybots` → your bot → *Bot Settings* → *Group Privacy* → **Turn off**.
3. Copy `.env.example` to `.env` and paste your token in:
   ```
   BOT_TOKEN=123456:your-token-here
   ADMIN_IDS=
   ```
4. Install dependencies:
   ```
   npm install
   ```
5. Run it. For quick local testing, `npm start` is fine — but it dies the moment you close that
   terminal, the PC sleeps, or it crashes. **For a bot that actually stays online, run it under pm2
   instead** (see "Running 24/7" below).
6. Add the bot to your Telegram group. It registers itself and starts its spawn loop automatically
   the first time anyone sends a message after that.

Requires Node.js 22.5+ (uses the built-in `node:sqlite` module — no native build tools needed).

## Running 24/7 (pm2)

Running via `npm start` in a terminal window is fragile — closing the window, the PC sleeping, or any
crash kills the bot with nothing to bring it back. [pm2](https://pm2.keymetrics.io/) fixes this: it runs
the bot as a background process, auto-restarts it on crash, and can resurrect it automatically after a
Windows reboot.

**One-time setup:**
```
npm install -g pm2 pm2-windows-startup
pm2-startup install
```

**Start the bot under pm2** (from this project's folder):
```
pm2 start ecosystem.config.js
pm2 save
```
`pm2 save` is what makes it resurrect after a reboot — re-run it any time you change how the bot is
started.

**Everyday management:**
```
pm2 status              # is it running?
pm2 logs daily-trainer-bot     # tail live logs
pm2 restart daily-trainer-bot  # restart (e.g. after pulling code changes)
pm2 stop daily-trainer-bot     # stop it
```

Logs are written to `logs/out.log` and `logs/error.log` in this project folder.

**Important:** never run the bot via both `npm start` *and* pm2 at the same time — Telegram only allows
one connection per bot token, and two processes fighting over it will cause both to error out.

**Raid Battle Arena's tunnel** runs as its own pm2 process, `raid-tunnel` (see
[Raid Battle Arena](#raid-battle-arena-telegram-mini-app) below) — `pm2 start ecosystem.config.js --only
raid-tunnel` starts it, `pm2 logs raid-tunnel` shows its connection status and current public URL. The
Mini App's backend itself is *not* a separate process — it starts automatically inside
`daily-trainer-bot` on every restart.

## Commands

- `/profile` — trainer profile (level, XP, coins, streak, catches, quiz wins)
- `/leaderboard` — top 10 trainers in the group
- `/checkin` — daily streak check-in (milestones at day 7/15/30/100)
- `/mission` — preview today's Goals checklist and mystery-Pokémon mission (info only, doesn't spawn anything)
- `/spin` — free daily spin wheel (animated reveal)
- `/chest` — free daily mystery chest (animated reveal)
- `/quiz` — start a Poké Quiz; first correct reply wins XP
- `/inventory` — see items you've earned and what each one does
- `/use <item>` — consume an item, e.g. `/use shiny_ticket`, `/use mystery_box`
- `/guide` — full step-by-step onboarding walkthrough (also reachable via a button on `/start`/`/help`)
- `/invite` — get your personal invite link for this group; earn XP/Coins when a friend joins and posts
- `/collection` (or `/mycollection`) — browse your Pokémon, items, and more through a category menu
- `/games` — mini-games menu with a rulebook for each game (see [Mini-games](#mini-games) below)
- `/shop` — spend coins on titles and badges shown on your `/profile` (see [Cosmetic Shop](#cosmetic-shop) below)
- `/redeem <code>` — redeem an admin-created promo code for coins, an item, and/or a Pokémon (see [Promo Codes](#promo-codes) below)
- `/friend` — reply to a group member's message to send them a friend request
- `/friends` — view your friends list
- `/gift` — reply to a friend's message to send them today's free gift (once a day, any one friend)
- `/unfriend` — reply to a friend's message to remove them (confirm-gated)
- `/breed` — breed two of your own Pokémon, or reply to a friend to breed with theirs (see [Breeding](#breeding))
- `/egg` — incubate an egg (from `/spin`/`/chest`/`/breed`) and hatch it into a new Pokémon
- `/jointeam <red|blue>` — pick a side for this group's Team Wars
- `/warstatus` — check the current Team War's live standings
- `/battle` — challenge someone to a 1v1 Pokémon battle using your real `/collection`
- `/raid [legendary|mythical]` — admin-only, starts a multiplayer Boss Raid (see [Boss Raids](#boss-raids))
- `/raidstats` — check your own Boss Raid record in this group

Wild Pokémon spawn automatically every 30–60 minutes per group with a "Catch!" button. A short "get
ready" teaser (e.g. "👀 Something's rustling in the bushes...") posts 20–60 seconds before every spawn,
so people notice before it appears instead of missing it cold. Each spawn also has a catch window
before it disappears — rarer Pokémon give less time, since they're worth more:

| Rarity | Catch window |
|---|---|
| Common | 10 min |
| Rare | 8 min |
| Shiny | 6 min |
| Legendary | 4 min |
| Mythical | 3 min |
| ✨ Shiny Legendary | 2.5 min |
| ✨ Shiny Mythical | 2 min |

Shiny Legendary and Shiny Mythical are their own (extremely rare) weighted spawn tiers, not a random
shiny roll layered on top of a normal legendary/mythical spawn — real shiny official artwork, bigger
XP/coin payouts, and a shorter catch window than anything else in the game. Admins can also force one
via `/forcespawn shiny_legendary` (or `shiny_mythical`), or from `/admin`'s per-group action panel /
Broadcast Force Spawn.

If nobody taps "Catch!" in time, the message updates to "💨 It got away!" and the button stops working.

Every spawn also shows its real type(s) with emoji (e.g. "Dragon 🐉 / Flying 🕊️ Types") and a gender
symbol (♂️/♀️) when applicable — Legendaries and Mythicals are genderless, matching the actual games.

Every spawn is posted with real official artwork of that Pokémon (shiny spawns use the actual shiny
artwork variant), sourced from PokeAPI's public sprite repo — no API key needed. The catch button and
countdown work exactly the same as before, just attached to a photo message instead of plain text.

### Quiz images

107 of the 196 quiz questions are "🖼️ Which Pokémon is this?" — auto-generated from the same Pokédex
data used for spawns (107 species: 40 common, 27 rare, 25 legendary, 15 mythical, every one with
verified real official artwork), so every entry in the roster gets a real-artwork guessing question for
free with no manual authoring — growing the roster in `src/data/pokemon.js` grows both the spawn pool
and the quiz automatically. The rest are text trivia across types, evolutions, legendaries, moves, and
GO-specific facts.

### Mini-games

Seven free-time mini-games sit alongside the quiz for when there's no spawn to catch. Send `/games` any
time for a menu with a full rulebook for each one (tap a game to see its rules, "⬅️ Back to Games" to
return to the menu). Every challenge message also has its own "📖 Rules" button that posts the rulebook
as a fresh reply, so it never disturbs an in-progress challenge or board.

- `/tictactoe` (or `/ttt`), `/rps`, and `/connect4` (or `/c4`) — 1v1 (or vs-Bot) challenge games. Reply
  to someone's message to challenge them directly, or send the command bare for an open challenge
  anyone in the group can accept. Add `bet` (e.g. `/tictactoe bet`) to play for coins — 50 for
  Tic-Tac-Toe, 30 for RPS, 40 for Connect 4. Challenges/matches are in-memory and ephemeral (an
  unaccepted challenge expires after 5 minutes, an idle match after 10 minutes for Tic-Tac-Toe/Connect 4
  / 2 minutes for RPS) — only the final win/loss and any bet settle to the database. Bets are deducted
  from both players the moment a challenge is accepted (not at game end), so a match can never fail
  partway through from insufficient funds; the winner receives both stakes, and a draw refunds everyone.
  The bot opponent plays a simple win/block/center/random heuristic — no coin risk playing against it.
  Connect 4 renders its 7x6 board as an emoji grid with 7 column-select buttons underneath (gravity:
  a piece drops to the lowest empty row in that column).
- `/scramble`, `/whosthat`, and `/hangman` — solo-friendly, group-collaborative word games, built on
  the same pattern as `/quiz` (one active round per group, timeout reveals the answer if nobody
  finishes it). Who's That Pokémon? generates a real silhouette on the fly (via `jimp`) from the same
  official artwork used for spawns and quiz, rather than just hiding the name. Hangman is guessed
  letter-by-letter (any group member can contribute a letter; 6 wrong guesses ends the round) rather
  than answered in one shot — typing the full name outright is still an instant win.
- `/battle` — real 1v1 Pokémon combat, not just a trainer-stats minigame. Challenge/accept/vs-Bot/bet
  works the same as the other 1v1 games, but after accepting, **both trainers pick one Pokémon from
  their actual `/collection`** (only species that aren't currently resting show up). Stats are derived
  from the species' rarity tier (shinies hit ~15% harder); each turn a trainer picks a move by type —
  one button per type the Pokémon actually has, plus a guaranteed Normal-type Tackle — and a move that's
  super effective against the opponent's type(s) deals 1.5x damage (a simplified version of the real
  type chart: no resistances/immunities, just "strong against"). First Pokémon to 0 HP loses. A fainted
  Pokémon can't battle again for 1 hour, so bringing a deep collection actually matters. Betting is 60
  coins a side (no bet vs the bot); the bot opponent prefers a super-effective move when it has one.
  Each move plays out as a short animated reveal (a brief "winding up..." cycle with the buttons
  hidden so a fast double-tap can't queue two moves, then the move name/damage/super-effective flag),
  and a fainting blow gets its own "down..." beat before the win/reward text lands — same
  suspense-before-reveal feel as `/spin` and `/chest`, just applied turn-by-turn.

Each game adds a small XP reward and its own win counter (`ttt_wins`, `rps_wins`, `scramble_wins`,
`whosthat_wins`, `connect4_wins`, `hangman_wins`, `battle_wins`) to a trainer's profile, per-group like
the rest of the economy.

### Cosmetic Shop

`/shop` lets a trainer spend **that group's** coins on purely cosmetic titles and badges — no gameplay
effect, just bragging rights shown on `/profile` right under their name. Titles and badges are bought
once (global ownership, like the Pokémon collection/inventory) and can be equipped/unequipped freely
afterward at no extra cost, one title + one badge at a time. Catalog: 5 titles (50–500 coins) and 4
badges (100–450 coins) — see `src/data/items.js` to add more (give a new entry `cosmeticType: 'title'`
or `'badge'`, a `price`, and for titles a `displayText`).

### Promo Codes

Admin-created codes redeemable once per trainer, globally, via `/redeem <code>` in any group — rewards
credit to whichever group the code was redeemed in (coins/XP) or to the trainer's global inventory/
collection (items/Pokémon). A code can never be redeemed twice by the same trainer even across
different groups — same anti-farming design as the referral system.

**Creating a code** — `/generatecode` (DM only, admin only) walks through a step-by-step wizard:
1. **Code** — reply with a unique code, e.g. `FF2026`, `DRAGON`, `EVENT01`.
2. **Reward type** — 💰 Poké Coins, 🎒 Inventory Item (pick from the item catalog + a quantity),
   🐾 Pokémon (pick a rarity tier → species → Shiny yes/no — credits straight into the trainer's global
   Pokémon collection, same as a real catch), or 🎁 Multiple Rewards (all three combined, each
   skippable).
3. **Usage limit** — 5 / 10 / 100 / ♾️ Unlimited / ✏️ Custom.
4. **Expiration** — Never / 1 Hour / 24 Hours / 7 Days / 30 Days / ✏️ Custom Date. Checked at redemption
   time (and when viewing the code), so an expired code stops working without any scheduled job.
5. **Confirm** — a full summary before the code is actually created.

`/cancel` aborts an in-progress wizard at any point.

**Managing codes** — `/admin`'s main menu → 🎟️ Promo Codes → 📋 Manage Codes lists every code; tapping
one opens a detail screen (status, reward summary, uses `12/200` with remaining count, expiry) with
✏️ Edit Limit, ✏️ Edit Expiry, 🚫 Disable/✅ Reactivate, and 🗑️ Delete (behind a confirmation, since it's
irreversible — deleting a code's *definition* does not erase its redemption history, so the same code
text can never be redeemed twice by the same trainer even if it's recreated later).

### Friends

`/friend` (reply to a group member's message) sends a friend request — global, not per-group, same as
the Pokémon collection. The other person taps ✅ Accept on the request message to confirm it; if they'd
already sent *you* a request first, replying with `/friend` back to them auto-accepts instead of leaving
two redundant pending requests sitting around. `/friends` lists everyone you're friends with. `/unfriend`
(reply to a friend's message) removes them, behind a Confirm/Cancel prompt since it's easy to fat-finger.

`/gift` (reply to a friend's message) sends them a small free reward — Coins, XP, Rare Candy, or a Lucky
Egg, picked at random — once a day, globally (you can only send one gift a day total, to whichever friend
you choose). It has no jackpot tier; it's meant as a light daily touchpoint between friends, not another
`/spin`.

### Seasonal Events

Admins create time-boxed events with `/seasonalevent` (DM only, admin only) — a step-by-step wizard just
like `/generatecode`: name the event, list which Pokémon are "themed" for it (comma-separated, any
rarity), pick a start (now or a custom date), then a duration (1/3/7/14 days or a custom end date), and
confirm. While an event is live, its themed Pokémon show up far more often *within their normal rarity
tier* — a themed Pikachu is still a "common" spawn worth common XP/coins, it's just the common roll that
lands on it much more frequently — so the event doesn't distort the overall rarity economy, only which
familiar faces you see. Every spawn and the morning mission both show a short "🎉 `<Event Name>` Event!"
banner while one is active.

`/admin`'s main menu → 🎉 Seasonal Events → 📋 Manage Events lists every event (✅ active / ⏳ upcoming /
⌛ ended / 🚫 disabled) — tapping one shows its themed roster and dates with 🚫 Disable (an admin
kill-switch to end it early) / ✅ Reactivate and 🗑️ Delete (confirm-gated). Whether an event is actually
live is always computed from its start/end dates at read time, the same dynamic-expiry style as promo
codes — no cron sweep needed, and ending one early via Disable doesn't delete its definition.

### Global Pokémon Collection & Items

Unlike XP/Coins/Level (which stay **per-group**, unchanged), a trainer's **Pokémon collection and
items are global** — the same across every group the bot is in. Catch a Charizard in one group, and
it shows up in your `/collection` no matter which other group you check it from. This is a real
architectural decision, not a display trick: `inventory` and the new `pokemon_collection` table are
keyed by `user_id` alone, with no `chat_id` at all. (Older installs are migrated forward automatically
on first startup — see the migration note in [src/db/index.js](src/db/index.js).)

`/collection` opens an interactive menu with 8 categories, each with Next/Previous pagination:

- 🐾 **Pokémon** — every species you've caught, one at a time with real artwork, quantity owned, type,
  rarity, and shiny status
- 🎒 **Items** — same data as `/inventory`, paginated
- 💰 **Coins & Currency** — your balance in the group you're currently in (still per-group, by design)
- 🥚 **Eggs** — placeholder; lands when the breeding system ships
- 🍬 **Candy** — shows Rare Candy owned
- 🏅 **Badges & Achievements** — cosmetic items you've earned (Avatar Frame/Badge, Mythical Reward)
- 🎁 **Event Items** — shows Event Keys owned; more once seasonal events ship
- ⭐ **Special & Rare Collectibles** — a filtered view of your collection: shiny, Legendary, or Mythical catches only

**Pokémon browsing extras:** tapping 🐾 first shows a summary (distinct species caught, total catches)
before "📖 View Collection" drops you into the actual browser. From there:
- **Sort** — a button cycles through Rarity → Most Caught → A-Z, re-rendering the list in that order
- **Search** — reply to the bot's prompt with a name (or partial name) to jump straight to that species
  instead of paging through everything

**Privacy:** every button is tagged with the command-runner's Telegram ID. If this menu is posted in a
group and someone *other* than the owner taps a button, they get a private "this isn't your collection"
alert and see none of the owner's data — nothing is exposed to the group. Buttons also go stale after
15 minutes of inactivity (a sliding window, refreshed on every real tap), so an old forgotten menu can't
be revived and used later.

### What items actually do

Every reward from `/spin` and `/chest` is either instant (Coins/XP, credited immediately)
or an item that lands in `/inventory` for you to `/use` later:

- **Rare Candy** → `/use` for an instant XP boost
- **Lucky Egg** → `/use` for a bonus Coin payout
- **Shiny Ticket** → `/use` to summon a Shiny Pokémon into the group right now
- **Rare Pokémon Encounter** → `/use` to summon a Rare-tier Pokémon right now
- **Mystery Box** → `/use` to crack it open for a random reward, no cooldown
- **Lucky Ticket** → your entry into that night's Lucky Draw (see below) — no `/use` needed, just hold one
- **Common Egg / Rare Egg** → incubate with `/egg` (see below) to hatch a new Pokémon
- **Event Key** → saved for future features
- **Avatar Frame / Avatar Badge / Mythical Reward** → flex/collection items, shown in `/collection`'s Badges tab, not consumable (distinct from the equippable titles/badges sold in `/shop`, which do show on `/profile`)

### Admin testing mode

Admins can run `/forcespawn [common|rare|shiny|legendary|mythical|shiny_legendary|shiny_mythical]` inside
a group to trigger a wild Pokémon immediately, instead of waiting for the normal 30–60 minute random
window — useful for testing the catch flow without waiting. `/raid [legendary|mythical]` starts a Boss
Raid immediately (see [Boss Raids](#boss-raids) above). Similarly, `/teststreakreminder` previews
tonight's 9 PM streak-loss reminder, `/testluckydraw` previews tonight's 10 PM Lucky Draw,
`/testhiddenevent` forces a random surprise event, and `/testteamwar` resolves the current group's Team
War immediately — all without waiting for their real schedule (each only shows something if the
relevant condition is actually met, e.g. someone at risk of losing a streak, or someone holding a Lucky
Ticket).

`/spin` and `/chest` have the normal 24h cooldown for everyone, including admins — there is no bypass.

**Adding a new admin:** have them send `/myid` to the bot to get their numeric Telegram ID, then add it
to `ADMIN_IDS` in `.env` (comma-separated) and restart the bot. Make sure you edit `.env`, not
`.env.example` — only `.env` is actually loaded; `.env.example` is just a template.

### Admin panel (DM only)

`/admin` **only works in a private chat with the bot** — running it inside any group is rejected outright
and shows no button menu at all. This is deliberate: a persistent admin panel with buttons is not
something that should ever render where group members can see it. To use it, message the bot directly
(not in any group) and send `/admin`:

1. You land on a compact main menu — 📋 Groups, 🌍 Broadcast Force Spawn, 🎟️ Promo Codes (global,
   not tied to one group — see [Promo Codes](#promo-codes) above), and 📊 Bot Stats (total trainers,
   active/total groups, catches, shinies, legendaries, coins in circulation, mini-game wins, and promo
   code redemptions, all summed across every group) — not a raw list of every group dumped on screen
   at once.
2. Tap 📋 Groups to get the group list, then tap the one you want to manage. That opens the action
   panel for that specific group, still inside your DM:
   - 🎲 Force Spawn (random rarity) / ✨ Shiny / 🐉 Legendary / 🌟 Mythical / ✨🐉 Shiny Legendary / ✨🌟 Shiny Mythical
   - 🐉 Start Legendary Raid / 🌟 Start Mythical Raid
   - 🌞 Preview today's mission
   - ⏰ Preview tonight's streak-loss alert
   - 📊 Group stats — total trainers, catches, shinies, legendaries, coins in circulation, top trainer
   - 🔁 Toggle Auto-Promo — turns that group's recurring promo message on/off
   - 📢 Announcement Help — reminds you how `/announcement` works (see below)
   - 💰 Grant Coins — prompts you (force-reply) for `<user_id> <amount>` and credits that user's coin
     balance in that specific group. This is a manual ledger tool only — the bot has no payment
     processing built in; however you collect payment from a trainer happens entirely outside the bot,
     you just credit the coins here afterward. Ask the trainer to send `/myid` to get their numeric ID
     if you don't have it. Coins are per-group (see [Data storage](#data-storage)), so grant separately
     in each group a trainer wants topped up.
3. Actions that produce group content (spawns, mission preview, streak alert) post into the **target
   group**; confirmations and stats reply back to you in the **DM** — nothing extra leaks into the group.
4. "⬅️ Back to group list" returns to 📋 Groups; "⬅️ Main Menu" (shown on the group list and the
   broadcast screen) returns all the way to the top-level menu.

Every button still re-checks admin status when pressed, as defense in depth.

### Auto-removal of dead groups

Groups the bot can no longer reach — kicked, removed, chat deleted, or demoted to where it can't post
— get deactivated automatically, so they stop cluttering `/admin`'s group list and stop wasting spawn
cycles retrying forever:

- **Instant**: `src/index.js`'s `my_chat_member` handler deactivates the group the moment Telegram
  reports the bot was kicked or left — no waiting for the next scheduled attempt.
- **Fallback**: every broadcast path (spawn loop, morning mission, auto-promo, streak reminder,
  `/announcement`, and the admin panel's broadcast force-spawn) checks each failure against
  [`src/utils/groupHealth.js`](src/utils/groupHealth.js) — if the error means the chat is permanently
  unreachable (not a transient network blip), the group is deactivated right there and, for the spawn
  loop specifically, its recurring timer stops instead of retrying forever.

A deactivated group can always come back — any future interaction (someone re-adds the bot, or an
existing member sends any message) re-activates it the same way a brand-new group would.

### Hidden/surprise events

Unlike Seasonal Events (admin-scheduled, announced ahead of time), these are genuinely unpredictable —
every 15 minutes, each active group has a small independent chance (4%) of a surprise firing with no
warning. When one hits, it's one of two things at random: an extra 🎁 "Surprise Bonus!" race (first 3
trainers to tap Claim win 75 coins each, 5-minute window), or an unscheduled ✨ bonus wild Pokémon spawn
outside the normal 30–60 minute timer. Admins can force one immediately in the current group with
`/testhiddenevent` for testing.

### Lucky Draw

Every night at 10 PM, each active group runs its own raffle: everyone currently holding a Lucky Ticket
(from `/chest`) is automatically entered — no command needed. One ticket is consumed per entrant
(extras don't buy extra entries), one winner is drawn at random, and they get 300 Coins, 100 XP, and a
Mystery Box 🎁. Everyone else's ticket is spent too — that's the raffle, get another from `/chest` for
next time. If nobody in a group holds a ticket that night, nothing posts. Admins can preview it early
with `/testluckydraw` instead of waiting for 10 PM.

### Team Wars

`/jointeam red` or `/jointeam blue` puts a trainer on a side, per group. Admins start a time-boxed war
with `/teamwar [hours]` (defaults to 24h, capped at 7 days) — whichever team earns the most **XP gained
during the war window** wins (not raw totals, so it's fair to join partway through — your personal
baseline is captured the moment you join). Anyone can check live standings with `/warstatus`. When the
window ends (checked every 10 minutes, no exact-time cron needed), every member of the winning team gets
+150 XP and +300 Coins, announced with the final tally; a tie gives no bonus. Trainers can freely switch
teams any time **except while a war is actively running** in that group — otherwise people could hop to
whichever side is winning right before it ends. Admins can resolve the current war immediately with
`/testteamwar`, for testing.

### Boss Raids

A full multiplayer raid system, always against a Legendary or Mythical boss. Admins start one with
`/raid` (or `/raid mythical` for a tougher boss — defaults to legendary) or from `/admin`'s per-group
action panel. Each group gets **at most 5 raids per day**, and only one can be active at a time.

**Lobby** — the boss posts with a real animated sprite (Pokémon Showdown's public sprite CDN, always the
correct species — falls back to static official artwork, then plain text, if the animation ever fails to
load) and a ⚔️ Join Raid button. Up to **20 trainers** can join; the battle starts the moment the lobby
fills or after a **90-second countdown**, whichever comes first. If literally nobody joins, the raid is
cancelled instead of starting with an empty lobby.

**Team selection** — joining requires picking **3 Pokémon** from your collection (a 3-step picker); your
team is locked in for the whole raid, no changing mid-fight.

**Battle** — tap ⚔️ Attack as fast as you want (no cooldown) to hit the boss with your *currently active*
Pokémon — damage factors in the attacker's rarity-tier stats, a shiny bonus, type effectiveness, and the
trainer's own `/profile` level (higher level hits harder). **The boss fights back**: every ~45 seconds it
auto-attacks a random still-fighting trainer's active Pokémon. When a Pokémon faints, the trainer's next
one automatically steps in; once all 3 have fainted, that trainer is **eliminated** and can't attack
again (but stays counted in the player list). If every trainer gets eliminated, or nobody finishes the
boss off within 20 minutes of battle starting, the raid fails with no rewards.

**Victory** — when the boss's HP hits 0, every trainer who dealt damage gets XP/Coins/Raid Points scaled
to their share of total damage dealt, plus bonuses: the top damage dealer gets an MVP bonus (extra
XP/Coins/Points + 2 Rare Candy) and whoever landed the finishing blow gets a Final Hit bonus. Every
participant then gets **one independent Legendary/Mythical Encounter** — their own catch attempt at the
just-defeated boss (65% catch chance for Legendary, 50% for Mythical, with a small independent 2% shiny
roll each). Results are never guaranteed and never shared between players — one trainer can walk away
shiny while everyone else doesn't, purely by chance.

**Stats** — `/raidstats` shows a trainer's own raid record for that group: raids participated/completed,
Legendary/Mythical wins, total and highest-single-hit damage, MVP awards, and Raid Points earned.

### Breeding

`/breed` is the real breeding mechanic — two actual Pokémon combine to produce an egg, separate from
just incubating eggs you already own (see [Breeding / Eggs](#breeding--eggs) below for that half).

- **Solo** — `/breed` with no reply picks two of your own Pokémon (two-step picker: parent 1, then
  parent 2 from what's left). You get one egg.
- **With a friend** — reply to a friend's message with `/breed` (must already be
  [friends](#friends) — that's deliberate, breeding is an intimate thing). You pick which of your
  Pokémon to offer, then a request posts for your friend to pick one of theirs (or Decline, 10-minute
  window). If they accept, **both trainers get an egg** — cooperating is more rewarding than breeding
  solo.
- **Egg tier** — if either parent is Rare or higher, you get a Rare Egg; two Commons breeding together
  gives a Common Egg. No parent is ever consumed — breed with your best Pokémon as often as the cooldown
  allows (4 hours, global, applies to whoever initiates a breed).
- Either egg then goes through the normal `/egg` incubation flow below.

### Breeding / Eggs

Common Eggs and Rare Eggs drop occasionally from `/spin`, `/chest`, or from `/breed` above. `/egg` with no egg currently
incubating shows a picker for any eggs you're holding — tap one to start incubating (only one egg
can incubate at a time, globally, same as the Pokémon collection). Common Eggs take 2 hours and hatch
mostly common/rare Pokémon (80/20); Rare Eggs take 3 hours and hatch mostly rare with a real shot at
legendary (70/30) — eggs never hatch mythical, so that tier stays earnable only through wild spawns or
promo codes. Once ready, `/egg` reveals the hatch with real official artwork (never shiny) and adds it
straight to your global `/collection`, plus a small XP bonus. **You don't have to remember to check** —
the bot pings you in the group where you started incubating it the moment it's ready (checked every
5 minutes), so it's easy to catch even if you're not actively watching. The `/collection` → 🥚 Eggs tab
shows how many eggs you're holding and your current incubation status.

### Referral system

`/invite` (any user, run inside a group) generates a personal link like
`https://t.me/YourBotUsername?start=ref_<chatId>_<userId>`. When someone new opens that link and hits
Start, the bot records a *pending* referral — but the reward only pays out once that new person actually
posts a message back in the specific group they were invited to (not just for clicking the link). This
prevents people from farming rewards with fake clicks. Each person can only ever be referred once,
globally, so the same "friend" can't be used twice.

### Auto-promo

Each group can have a recurring promotional message that posts automatically every 6 hours, off by
default. Admins toggle it per-group via the `/admin` panel ("🔁 Toggle Auto-Promo"), and customize the
text with `/setpromo <message>` (or `/setpromo` with no text to reset to the rotating default pool).

The default messages aren't one static line — there's a pool of 6 playful, competitive, FOMO-driven
variants (e.g. "There's a hole in this leaderboard... and it has your friend's name on it 🔥") picked
at random each time, so regular users don't see the same nag over and over. Anyone can preview the
current promo message on demand with `/promo` — handy for sharing manually or testing without waiting
for the 6-hour cron.

### Announcement broadcast

`/announcement <message>` (admin-only) broadcasts to **every active group the bot is in at once** —
this is the highest-blast-radius action in the bot, so it never fires immediately. It always shows a
preview first ("Send this to all N active group(s)?") with Confirm/Cancel buttons, and only actually
sends after you tap Confirm. The result message reports exactly how many groups succeeded and how many
failed (e.g. if the bot was removed from one). Only admins can trigger the confirm/cancel buttons, even
though they're visible to the whole group where you ran the command.

### Animated reactions

Big moments get a real animated Telegram message reaction (native client-side animation, not a hosted
GIF/sticker) instead of just text: a Shiny catch gets 🔥, a Legendary/Mythical/Shiny Legendary/Shiny
Mythical catch gets 🏆 or 🎉, a Pokémon Battle win gets 🏆, and a streak milestone (day 7/15/30/100) gets
🔥. Common/Rare catches deliberately don't react — with spawns every 30–60 minutes across many active
groups, reacting on every single catch would get noisy fast. A rejected reaction (Telegram only accepts
a fixed emoji whitelist) never breaks the underlying feature — it's purely decorative and fails silently
if Telegram ever rejects a specific emoji.

### Engagement hooks

A few things are deliberately written to create urgency rather than just inform:

- Every spawn message shows a live countdown ("⏳ Disappears in 6m!") plus a hype line that gets more
  urgent for rarer Pokémon — a Mythical spawn screams "🚨🚨 MYTHICAL SPAWN! Blink and it's gone forever!"
  while a Common one is much more relaxed about it.
- If nobody catches it in time, the message updates with a varied "it got away" line (randomly picked
  from a few options) so repeat misses don't feel copy-pasted.
- Every evening at 9 PM, the bot checks for anyone in the group who built up a streak but hasn't
  checked in that day, and posts a public reminder tagging them by name with their current streak —
  directly targeting "don't let people forget to open the group."

### Morning mission — guaranteed spawn

At 9 AM, every active group gets a "Today's Goals" checklist (check-in, mission, spin, chest, quiz)
plus the day's mystery Pokémon target. 3–6 minutes later, the bot posts a teaser and then **guarantees
that exact Pokémon actually spawns** with a real Catch button — it doesn't rely on the independent
random spawn timer happening to roll that specific name, which could otherwise take hours or never
happen at all in a given day. Catching it completes the mission automatically, same as any other catch.

### How catches and missions are verified (anti-cheat)

Catching a Pokémon only ever happens through the inline "🎯 Catch!" button — there is no text command
or phrase a user can type to fake a catch. When tapped, Telegram sends a `callback_query` bound to the
tapper's real account, and the bot does an atomic database update (`UPDATE ... WHERE caught_by IS NULL`)
so only the first tap can ever win, even under simultaneous taps. The daily mission works the same way:
the bot decides the target Pokémon itself and compares it server-side against whichever Pokémon was
actually caught — a user's claim or message text is never part of that check.

## What's built (MVP) vs. not yet

Built: core economy, levels/ranks, daily streak, morning mission, random spawns with
rarity tiers (shiny/legendary/mythical/shiny legendary/shiny mythical) and real artwork across a
107-species roster, spin wheel, mystery chest, 196-question quiz game with images, global Pokémon
collection + items, interactive `/collection` menu, admin panel (with auto-removal of dead groups),
referral system, a friend system (`/friend`/`/friends`/`/gift`/`/unfriend`), seasonal events
(`/seasonalevent` admin wizard, themed spawn bias, event banners), auto-promo, cross-group
announcements, 7 mini-games (Tic-Tac-Toe, Rock-Paper-Scissors, Connect 4, Scramble, Who's That Pokémon?,
Hangman, and real 1v1 Pokémon Battle using your actual collection), Boss Raids (group-wide cooperative
fights), Team Wars (`/jointeam` + admin-scheduled XP competitions), Breeding/Eggs (`/egg` incubation),
a nightly Lucky Draw raffle, Hidden/surprise events (random unscheduled bonuses), animated message
reactions on big moments, a Cosmetic Shop (titles/badges), and a Promo Code system (`/generatecode`
wizard — coins/item/Pokémon/multi rewards, usage limits, time-based expiration, full admin management).

Not yet built — good candidates for a future phase:
Friendship levels/gifting beyond the daily gift, Pokémon trading between friends, Gigantamax/Dynamax
spawn tiers (checked against the PokeAPI REST API — Gmax/Mega forms don't have `official-artwork`, only
a low-res sprite, so they're on hold until real artwork files are supplied).

## Raid Battle Arena (Telegram Mini App)

Boss Raids have a real animated companion web app, not just Telegram chat buttons. It shows an animated
boss sprite, live HP bars with smooth fill/color-change animations, a hit-flash + shake effect on every
attack, a scrolling battle log, and haptic feedback on attack (where the device supports it) —
everything Telegram chat bubbles alone can't do.

**How trainers open it**: the group raid message has a "🎮 Open Battle Arena" button — tapping it DMs
you a second message with the actual launch button. This two-step hop is required, not optional:
Telegram's Bot API only allows `web_app` buttons on messages inside a **private chat with the bot** —
attaching one directly to a group message is rejected outright (`BUTTON_TYPE_INVALID`, hit this for
real in production once). If the bot can't DM you yet (you've never messaged it privately), the group
button tells you to tap the bot's name, hit Start, then try again.

**Architecture** (`src/webapp/`): the Mini App's backend runs **in the same Node process as the bot**
(started from `src/index.js`, not a separate pm2 app) — this is deliberate, not incidental: it needs to
`require('../features/bossRaid')` and get the *exact same* in-memory `activeRaids` state the Telegram
handlers use, so an attack from the Mini App and an attack from a Telegram button both mutate one shared
raid object and stay perfectly in sync (verified in tests: attacking via the web API measurably reduces
the same `raid.hp` Telegram sees, and Telegram sees the resulting message update too).

- `src/webapp/server.js` — Express + `ws` WebSocket server. `GET /api/raid/:chatId/state` and
  `POST /api/raid/:chatId/attack` are both authenticated via Telegram's official Mini App `initData`
  HMAC-SHA256 validation (`src/webapp/telegramAuth.js`) — never trusts a bare user ID from the client.
  WebSocket clients get the current raid state immediately on connect, then a live push (`bossRaidFeature.onRaidChange`)
  every time *anything* changes the raid — a player attacks (from either surface), the boss counter-attacks
  on its own 45s timer, a trainer faints/gets eliminated, or the raid ends.
- `src/webapp/public/` — the actual page (`index.html`/`style.css`/`app.js`), vanilla JS, no build step.
  Sprites are Pokémon Showdown's animated GIFs (same source as the Telegram-side boss art).
- **Public hosting**: this project has no server of its own, so a **Cloudflare Quick Tunnel**
  (`scripts/tunnel.js`, its own pm2 process `raid-tunnel`) exposes the local Mini App server publicly.
  Quick Tunnels have no stable hostname — the address changes every time the tunnel restarts — so the
  bot never hardcodes it: `scripts/tunnel.js` parses cloudflared's own output for the fresh
  `*.trycloudflare.com` URL and writes it to `data/tunnel_url.txt`, and `src/features/bossRaid.js` reads
  that file fresh every time it builds a raid message. **If the tunnel is down when a raid starts, the
  "🎮 Open Battle Arena" button is simply omitted** from the group message — the DM it would generate
  would point at a dead URL, so skipping it entirely is safer — and the native Join/Attack buttons keep
  working regardless, so a tunnel hiccup never blocks a raid. Upgrading to a stable custom domain later
  (once one is added to the Cloudflare account) is a one-line change to `scripts/tunnel.js`, nothing
  else needs to change.
- `data/tunnel_url.txt` is git/backup-irrelevant scratch state, not part of the trainer database.

## Data storage

SQLite file at `data/trainer.sqlite`, created automatically on first run.

- **Per-group** (independent per Telegram group): XP, Coins, Level, streaks, cooldowns,
  daily missions, active spawns, leaderboards.
- **Global** (same for a trainer across every group): Pokémon collection, inventory items
  (including purchased-but-unequipped cosmetics), equipped title/badge, and promo code redemptions
  (a code can only ever be redeemed once per trainer, regardless of which group they use it in).

Older databases are migrated forward automatically the first time the bot starts after an
update — e.g. the inventory table's per-group → global conversion sums quantities across
a user's groups and runs inside a transaction, so it's safe to interrupt or re-run.
