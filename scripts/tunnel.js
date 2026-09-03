// Launches a Cloudflare Quick Tunnel pointed at the local Mini App server and writes the
// generated public URL to data/tunnel_url.txt, so the bot can build a fresh "Open Battle
// Arena" link even after the tunnel restarts and gets a brand new *.trycloudflare.com address
// (Quick Tunnels have no stable hostname — that requires a real domain on Cloudflare, which
// this project doesn't have yet).
//
// Self-healing added 2026-08-03 — this exact tunnel has now silently died (pm2 still shows it
// "online" while cloudflared is stuck retrying "control stream encountered a failure" forever)
// repeatedly in production, once for a full 2 days before anyone noticed the Mini Apps were
// down. pm2's own health check only confirms the Node PROCESS is alive, not that the actual
// Cloudflare connection underneath it still works, so it was never going to catch this.
//
// First attempt polled the tunnel's own public URL over HTTPS on a timer — reverted after
// testing revealed a real false-positive risk: this machine's local DNS resolver briefly failed
// to resolve a legitimate, freshly-registered *.trycloudflare.com name (confirmed via Google's
// 8.8.8.8 resolving it fine, and cloudflared's own log showing a clean "Registered tunnel
// connection") — an external check like that would have killed a perfectly healthy tunnel over
// a local network hiccup unrelated to Cloudflare at all.
//
// Fixed instead by watching cloudflared's OWN log output for the exact failure signature this
// bug has produced every single time it's been diagnosed by hand this project: repeated
// "failed to serve tunnel connection" / "control stream encountered a failure" lines with no
// intervening successful reconnect. That's a direct, DNS-independent signal — if cloudflared
// itself is telling us it can't hold a connection, believe it; a transient external network
// check that can fail for unrelated reasons should not be trusted the same way.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { WEBAPP_PORT } = require('../src/webapp/port');

const CLOUDFLARED_PATHS = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  'cloudflared',
];
const URL_FILE = path.join(__dirname, '..', 'data', 'tunnel_url.txt');
const URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
const FAILURE_PATTERN = /failed to serve tunnel connection|control stream encountered a failure/g;
const SUCCESS_PATTERN = /Registered tunnel connection/;
// Each stuck retry attempt logs its failure lines within a matter of seconds, so 3 consecutive
// failures with no successful reconnect between them reliably means "stuck in the loop", not
// "one-off blip" — this project has observed this exact failure mode stay stuck for hours/days
// once it starts, never self-resolving, so there's no benefit to waiting longer to be sure.
const FAILURE_THRESHOLD = 3;

function findCloudflared() {
  for (const candidate of CLOUDFLARED_PATHS) {
    if (candidate === 'cloudflared') return candidate; // let PATH resolve it as a last resort
    if (fs.existsSync(candidate)) return candidate;
  }
  return CLOUDFLARED_PATHS[0];
}

function start() {
  const bin = findCloudflared();
  console.log(`[tunnel] Starting cloudflared from: ${bin}`);
  const proc = spawn(bin, ['tunnel', '--url', `http://localhost:${WEBAPP_PORT}`]);

  let written = false;
  let consecutiveFailures = 0;
  let killedForUnhealthy = false;

  const handleOutput = (data) => {
    const text = data.toString();
    process.stdout.write(text);

    if (!written) {
      const match = text.match(URL_PATTERN);
      if (match) {
        fs.writeFileSync(URL_FILE, match[0]);
        written = true;
        console.log(`\n[tunnel] Public URL is now: ${match[0]}\n[tunnel] Written to ${URL_FILE}\n`);
      }
    }

    if (SUCCESS_PATTERN.test(text)) {
      consecutiveFailures = 0;
    } else {
      // Count actual occurrences, not just presence — a single stdout chunk can contain
      // several of these lines batched together (Node streams don't guarantee one-line-per-
      // event), and under-counting would delay hitting the threshold.
      const occurrences = (text.match(FAILURE_PATTERN) || []).length;
      consecutiveFailures += occurrences;
      if (consecutiveFailures >= FAILURE_THRESHOLD && !killedForUnhealthy) {
        killedForUnhealthy = true;
        console.error(
          `[tunnel] Detected ${consecutiveFailures} consecutive tunnel-connection failures with no successful reconnect — cloudflared is stuck in its retry loop. Killing it so pm2 restarts this script fresh with a new tunnel registration.`
        );
        proc.kill();
      }
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  proc.on('exit', (code) => {
    console.error(`[tunnel] cloudflared exited with code ${code} — pm2 will restart it.`);
    // Clear the stale URL so the bot doesn't build links to a dead tunnel while it's down.
    try {
      fs.unlinkSync(URL_FILE);
    } catch (err) {
      // fine if it never existed
    }
    process.exit(code || 1);
  });

  proc.on('error', (err) => {
    console.error('[tunnel] Failed to launch cloudflared:', err.message);
    process.exit(1);
  });
}

start();
