/**
 * Tests a bulk proxy list against Amazon and writes out only the ones that work.
 *
 *   node scripts/test-proxies.js                 # reads proxies.txt
 *   node scripts/test-proxies.js my-list.txt
 *   node scripts/test-proxies.js --concurrency 20 --limit 100
 *
 * Costs ~13KB per proxy: it fetches the job-search page and checks whether
 * CloudFront served the real page or a 403 block. That is the same signal that
 * decides whether the bot can work from a given IP, without paying the ~14MB
 * cost of a full token harvest.
 *
 * Writes working entries to proxies.working.txt.
 */
import fs from 'fs';
import { parseProxyLine, proxyFetch } from '../src/proxy.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TARGET = 'https://hiring.amazon.com/search/warehouse-jobs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const positional = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));

const file = positional || 'proxies.txt';
const concurrency = Number(flag('concurrency', 15));
const limit = Number(flag('limit', 0));
const timeoutMs = Number(flag('timeout', 25000)) ;

if (!fs.existsSync(file)) {
  console.error(`No proxy list found at ${file}`);
  console.error('Create it with one proxy per line, e.g. host:port:user:pass');
  process.exit(1);
}

let lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
if (limit) lines = lines.slice(0, limit);

console.log(`Testing ${lines.length} proxies against Amazon (concurrency ${concurrency})\n`);

const results = { working: [], blocked: [], dead: [], bad_format: [] };

async function test(line) {
  let proxy;
  try {
    proxy = parseProxyLine(line);
  } catch {
    results.bad_format.push(line);
    return { line, status: 'bad_format' };
  }
  if (!proxy) return null;

  try {
    const res = await proxyFetch(TARGET, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      dispatcher: proxy.dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();

    const isBlocked =
      res.status === 403 ||
      body.includes('could not be satisfied') ||
      body.includes('Request blocked');

    if (isBlocked) {
      results.blocked.push(line);
      return { line, status: 'blocked', label: proxy.label };
    }
    if (res.status === 200 && body.includes('Warehouse Jobs')) {
      results.working.push(line);
      return { line, status: 'working', label: proxy.label };
    }
    results.blocked.push(line);
    return { line, status: `unexpected(${res.status})`, label: proxy.label };
  } catch (err) {
    results.dead.push(line);
    const reason = err.name === 'TimeoutError' ? 'timeout' : err.message.slice(0, 40);
    return { line, status: 'dead', label: proxy.label, reason };
  }
}

let done = 0;
const queue = [...lines];

async function worker() {
  while (queue.length) {
    const line = queue.shift();
    const r = await test(line);
    done++;
    if (r) {
      const icon =
        r.status === 'working' ? '\x1b[32m✓\x1b[0m'
        : r.status === 'blocked' ? '\x1b[31m✗\x1b[0m'
        : '\x1b[33m·\x1b[0m';
      const detail = r.reason ? ` (${r.reason})` : '';
      process.stdout.write(
        `${icon} [${String(done).padStart(4)}/${lines.length}] ${(r.label || r.line).padEnd(34)} ${r.status}${detail}\n`
      );
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, lines.length) }, worker));

console.log('\n' + '='.repeat(58));
console.log(`  working (Amazon accepts) : ${results.working.length}`);
console.log(`  blocked by CloudFront    : ${results.blocked.length}`);
console.log(`  dead / unreachable       : ${results.dead.length}`);
if (results.bad_format.length) console.log(`  unparseable              : ${results.bad_format.length}`);
console.log('='.repeat(58));

if (results.working.length) {
  fs.writeFileSync('proxies.working.txt', results.working.join('\n') + '\n');
  console.log(`\nWrote ${results.working.length} working proxies to proxies.working.txt`);
  console.log('Point the bot at them with:  PROXY_FILE=proxies.working.txt');
} else {
  console.log('\nNo working proxies found. If everything is "blocked", the whole');
  console.log('range is flagged by Amazon — you need residential IPs, not datacenter.');
  process.exit(1);
}
