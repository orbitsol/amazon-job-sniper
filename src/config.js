import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader — avoids a dependency for four variables. */
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

/** Resolve a US ZIP to coordinates so the geo search is centred correctly. */
export async function geocodeZip(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`could not geocode ZIP ${zip} (HTTP ${res.status})`);
  const body = await res.json();
  const place = body.places?.[0];
  if (!place) throw new Error(`no coordinates for ZIP ${zip}`);
  return {
    lat: Number(place.latitude),
    lng: Number(place.longitude),
    label: `${place['place name']}, ${place['state abbreviation']} ${zip}`,
  };
}

export function loadConfig() {
  loadEnvFile();

  const file = path.join(ROOT, 'config.json');
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || cfg.discordWebhookUrl;
  if (!webhookUrl) {
    throw new Error(
      'Missing Discord webhook. Set DISCORD_WEBHOOK_URL in .env (copy .env.example to .env).'
    );
  }

  const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');

  return {
    root: ROOT,
    dataDir,
    zip: String(process.env.ZIP || cfg.zip || '75126'),
    lat: cfg.lat ?? null,
    lng: cfg.lng ?? null,
    radiusMiles: Number(process.env.RADIUS_MILES || cfg.radiusMiles || 50),
    pollSeconds: Number(process.env.POLL_SECONDS || cfg.pollSeconds || 20),
    jitterSeconds: Number(cfg.jitterSeconds ?? 5),
    locale: cfg.locale || 'en-US',
    country: cfg.country || 'United States',
    // Optional filters — leave empty to catch everything.
    titleIncludes: cfg.titleIncludes || [],
    minPay: cfg.minPay ?? null,
    maxDistanceMiles: cfg.maxDistanceMiles ?? null,
    webhookUrl,
    mentionUserId: process.env.DISCORD_USER_ID || cfg.discordUserId || null,
    mentionRoleId: process.env.DISCORD_ROLE_ID || cfg.discordRoleId || null,
    proxyUrl: process.env.PROXY_URL || cfg.proxyUrl || null,
    // Bulk list: newline/comma separated in PROXY_LIST, or a file of one
    // proxy per line. Sellers hand these out as host:port:user:pass.
    proxyList: process.env.PROXY_LIST || null,
    proxyFile: process.env.PROXY_FILE || cfg.proxyFile || path.join(ROOT, 'proxies.txt'),
    seenFile: path.join(dataDir, 'seen.json'),
    sessionFile: path.join(dataDir, 'session.json'),
    // The issued aws-waf-token is valid ~96h; re-harvesting costs ~14MB, so
    // reuse it for a long time and let the 403 handler catch early expiry.
    sessionMaxAgeHours: Number(process.env.SESSION_MAX_AGE_HOURS || cfg.sessionMaxAgeHours || 12),
    heartbeatMinutes: Number(cfg.heartbeatMinutes ?? 0),
    alertOnFirstRun: Boolean(cfg.alertOnFirstRun ?? false),
    // Run a single check then exit — for cron-style hosts (GitHub Actions).
    once: process.argv.includes('--once') || process.env.ONCE === '1',
    quiet: process.env.QUIET === '1',
  };
}
