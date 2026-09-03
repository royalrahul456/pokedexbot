# Running PokéDex Bot 24/7 on an Android phone (Termux)

Same phone/approach as the Pogo Showcase Bot's `deploy/TERMUX.md` — this bot is Node.js
instead of Python, and needs one extra piece (`cloudflared`) for the Mini Apps (Store,
Battle Arena, Trade Window, raid arena) to have a public link. No card, no cost.

## 0. Prerequisites
If Termux + Termux:Boot are already installed for the Pogo bot, skip to step 1 — this is
shared infrastructure, not per-bot setup.

Install both from **F-Droid** (not the Play Store — that version is outdated and broken):
- **Termux**: https://f-droid.org/packages/com.termux/
- **Termux:Boot**: https://f-droid.org/packages/com.termux.boot/

## 1. Base setup
```bash
termux-setup-storage        # tap Allow on the popup
pkg update -y && pkg upgrade -y
```

## 2. Install packages
```bash
pkg install -y nodejs git cloudflared
node -v
```
This bot needs **Node ≥22.5** (uses the built-in `node:sqlite` module). If `node -v` shows
something older, install `nodejs-lts` instead or check Termux's package repo for a newer
build — don't skip this check, an old Node version will fail at startup.

Nothing here needs Rust/build-tools the way the Pogo bot's `cryptography`/Pillow did — this
project deliberately avoids native addons (`node:sqlite` instead of `better-sqlite3`, `jimp`
instead of `sharp`), so `npm install` should be quick with no compilation step.

## 3. Get the code
```bash
cd ~
git clone <YOUR_GITHUB_REPO_URL> new_bot
cd new_bot
npm install
```

## 4. Create your `.env`
```bash
nano .env
```
Paste your real values (from the PC's `.env` — never `.env.bak`, and never commit either to
git), then Ctrl+O, Enter, Ctrl+X:
```
BOT_TOKEN=your_real_bot_token
ADMIN_IDS=your_telegram_numeric_id
```
```bash
chmod 600 .env
```

## 5. Test run before automating anything
```bash
termux-wake-lock          # stop Android sleeping the process while testing
node src/index.js
```
You should see `[webapp] Raid Mini App server listening on port 3001` and
`Daily Trainer Bot is running.`. Message the bot on Telegram to confirm it responds, then
Ctrl+C to stop before setting up pm2.

## 6. Install pm2 and start both processes
This project already ships an `ecosystem.config.js` with both processes defined (the bot
itself + the `raid-tunnel` cloudflared wrapper) — same pm2 setup already used on the PC.
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs --lines 20
```
Confirm `tunnel-out.log` shows a `Public URL is now: https://....trycloudflare.com` line —
that's the Mini App tunnel working. If you also run the Pogo Showcase Bot, bring it into pm2
too for one consistent way to manage everything on the phone:
```bash
cd ~/pogo-showcase-bot
pm2 start bot.py --interpreter python3 --name pogo-bot
```
```bash
pm2 save
```

## 7. Auto-start on boot + survive Termux closing
```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-bots.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
pm2 resurrect
EOF
chmod +x ~/.termux/boot/start-bots.sh
```
`pm2 resurrect` brings back every process you `pm2 save`d — the PokéDex bot, the tunnel, and
the Pogo bot if you added it — in one call, on every reboot (Termux:Boot must be installed).

To start everything right now without rebooting:
```bash
sh ~/.termux/boot/start-bots.sh
```

## Keeping it alive (important on Android)
- Leave the phone **plugged in**.
- Android Settings → Apps → Termux → Battery → **Unrestricted**.
- Keep `termux-wake-lock` active (the boot script does this).
- **After any phone restart or pm2 resurrect, verify the tunnel is actually reachable** —
  `pm2 status` showing "online" is not proof the Cloudflare connection underneath it is
  healthy (this has bitten this exact bot's tunnel multiple times on a PC too — it's a
  Cloudflare Quick Tunnel quirk, not Termux-specific). Check with:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$(cat data/tunnel_url.txt)"
  ```
  A `200` means it's genuinely working. Anything else (especially `000`): `pm2 restart raid-tunnel`.

## Updating later
```bash
cd ~/new_bot && git pull && npm install
pm2 restart daily-trainer-bot
```
(No need to restart `raid-tunnel` unless `scripts/tunnel.js` itself changed.)

## Reminder
Only ONE copy of this bot may run at a time — stop it on the PC (`pm2 stop daily-trainer-bot`
or close the PC session entirely) before running it on the phone, same rule as the Pogo bot.
Running the same Telegram bot token from two places at once causes duplicate/garbled replies.
