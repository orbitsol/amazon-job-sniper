/**
 * Measures real bytes-over-the-wire for each phase, so proxy cost can be
 * budgeted rather than guessed.
 */
import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const BLOCK_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);
const BLOCK_HOSTS = [
  'youtube.com', 'ytimg.com', 'doubleclick', 'adsystem', 'demdex.net',
  'omtrdc.net', 'qualtrics.com', 'ninthdecimal', 'adnxs', 'rlcdn',
  'rum.us-east-1.amazonaws.com', 'media-amazon.com', 'googletagmanager',
  'google-analytics', 'scorecardresearch', 'adobedtm',
];

async function harvest({ block }) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
  const page = await ctx.newPage();

  let bytes = 0;
  let requests = 0;
  let blocked = 0;

  if (block) {
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = req.url();
      if (BLOCK_TYPES.has(req.resourceType()) || BLOCK_HOSTS.some((h) => url.includes(h))) {
        blocked++;
        return route.abort();
      }
      return route.continue();
    });
  }

  page.on('response', async (r) => {
    requests++;
    try {
      const len = r.headers()['content-length'];
      if (len) bytes += Number(len);
      else bytes += (await r.body().catch(() => Buffer.alloc(0))).length;
    } catch {}
  });

  const t0 = Date.now();
  await page.goto('https://hiring.amazon.com/search/warehouse-jobs', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  let token = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    token = (await ctx.cookies()).find((c) => c.name === 'aws-waf-token');
    if (token) break;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  await browser.close();

  return { bytes, requests, blocked, secs, ok: !!token, cookies };
}

function mb(b) {
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}
function kb(b) {
  return (b / 1024).toFixed(1) + ' KB';
}

console.log('=== Phase 1: token harvest, full page load ===');
const full = await harvest({ block: false });
console.log(`  ${mb(full.bytes)} over ${full.requests} requests in ${full.secs}s — token: ${full.ok}`);

console.log('\n=== Phase 2: token harvest, with resource blocking ===');
const lean = await harvest({ block: true });
console.log(
  `  ${mb(lean.bytes)} over ${lean.requests} requests (${lean.blocked} blocked) in ${lean.secs}s — token: ${lean.ok}`
);

console.log('\n=== Phase 3: one API poll ===');
const session = lean.ok ? lean.cookies : full.cookies;
const body = JSON.stringify({
  operationName: 'searchJobCardsByLocation',
  variables: {
    searchJobRequest: {
      locale: 'en-US', country: 'United States', keyWords: '',
      equalFilters: [], containFilters: [{ key: 'isPrivateSchedule', val: ['false'] }],
      rangeFilters: [], orFilters: [], dateFilters: [], sorters: [],
      pageSize: 100, consolidateSchedule: true,
      geoQueryClause: { lat: 32.7491, lng: -96.4598, unit: 'mi', distance: 50 },
    },
  },
  query: `query searchJobCardsByLocation($searchJobRequest: SearchJobRequest!) {
    searchJobCardsByLocation(searchJobRequest: $searchJobRequest) {
      nextToken
      jobCards { jobId jobTitle jobType employmentType city state postalCode
        locationName totalPayRateMin totalPayRateMax currencyCode tagLine
        distance featuredJob bonusJob bonusPay scheduleCount image }
    }
  }`,
});
const res = await fetch('https://hiring.amazon.com/graphql', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer Status|unauthenticated|Session|',
    country: 'United States', accept: '*/*', 'accept-language': 'en-US',
    iscanary: 'false', 'x-hvh-time': String(Date.now()),
    origin: 'https://hiring.amazon.com',
    referer: 'https://hiring.amazon.com/search/warehouse-jobs',
    'user-agent': UA, cookie: session,
  },
  body,
});
const respText = await res.text();
const reqBytes = Buffer.byteLength(body) + Buffer.byteLength(session) + 600;
const respBytes = Buffer.byteLength(respText);
console.log(`  request  ~${kb(reqBytes)} (cookie header is ${kb(Buffer.byteLength(session))} of it)`);
console.log(`  response  ${kb(respBytes)}  [status ${res.status}]`);
console.log(`  total per poll: ~${kb(reqBytes + respBytes)}`);

console.log('\n=== Monthly projections ===');
const pollBytes = reqBytes + respBytes;

function project(label, harvestBytes, harvestsPerDay, pollsPerDay) {
  const perDay = harvestBytes * harvestsPerDay + pollBytes * pollsPerDay;
  const perMonth = perDay * 30;
  console.log(
    `  ${label}\n     ${mb(perDay)}/day → ${(perMonth / 1024 / 1024 / 1024).toFixed(2)} GB/month`
  );
}

// Long-running: harvest every 20 min, poll every 20s
project('Long-running, full page load  ', full.bytes, 72, 4320);
project('Long-running, blocked resources', lean.bytes, 72, 4320);
// GitHub Actions --once every 5 min: fresh harvest EVERY run
project('GH Actions (harvest every run)', lean.bytes, 288, 288);
