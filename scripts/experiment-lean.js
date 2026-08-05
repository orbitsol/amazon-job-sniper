/**
 * Two questions that decide proxy cost:
 *   1. How long is an aws-waf-token actually valid? (drives harvest frequency)
 *   2. Can we get a token without downloading Amazon's whole app bundle?
 */
import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function harvest(routeFn, label) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
  const page = await ctx.newPage();

  let bytes = 0;
  let blocked = 0;
  if (routeFn) {
    await page.route('**/*', (route) => {
      if (routeFn(route.request())) {
        blocked++;
        return route.abort();
      }
      return route.continue();
    });
  }
  page.on('response', async (r) => {
    try {
      const len = r.headers()['content-length'];
      bytes += len ? Number(len) : (await r.body().catch(() => Buffer.alloc(0))).length;
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

  console.log(
    `${label}\n   ${(bytes / 1024 / 1024).toFixed(2)} MB, ${blocked} blocked, ${secs}s, token=${!!token}`
  );
  if (token?.expires && token.expires > 0) {
    const mins = ((token.expires * 1000 - Date.now()) / 60000).toFixed(0);
    console.log(`   cookie expires in ${mins} min (${(mins / 60).toFixed(1)} h)`);
  }
  return { token, cookies, bytes };
}

async function apiWorks(cookies) {
  const res = await fetch('https://hiring.amazon.com/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer Status|unauthenticated|Session|',
      country: 'United States', accept: '*/*', 'accept-language': 'en-US',
      iscanary: 'false', 'x-hvh-time': String(Date.now()),
      origin: 'https://hiring.amazon.com',
      referer: 'https://hiring.amazon.com/search/warehouse-jobs',
      'user-agent': UA, cookie: cookies,
    },
    body: JSON.stringify({
      operationName: 'searchJobCardsByLocation',
      variables: { searchJobRequest: {
        locale: 'en-US', country: 'United States', keyWords: '', equalFilters: [],
        containFilters: [{ key: 'isPrivateSchedule', val: ['false'] }], rangeFilters: [],
        orFilters: [], dateFilters: [], sorters: [], pageSize: 5, consolidateSchedule: true,
        geoQueryClause: { lat: 41.8781, lng: -87.6298, unit: 'mi', distance: 60 },
      }},
      query: `query searchJobCardsByLocation($searchJobRequest: SearchJobRequest!) {
        searchJobCardsByLocation(searchJobRequest: $searchJobRequest) { jobCards { jobId } }
      }`,
    }),
  });
  const t = await res.text();
  return res.status === 200 && !t.includes('WAF');
}

console.log('=== A: baseline, everything allowed ===');
const a = await harvest(null, 'full');

console.log('\n=== B: block the app bundle, keep WAF machinery ===');
// The WAF challenge is served by awswaf.com + a small inline loader. Amazon's
// React bundle is the expensive part and may not be needed to earn a token.
const b = await harvest((req) => {
  const u = req.url();
  if (u.includes('awswaf')) return false; // never block the challenge itself
  if (u.includes('/app/main.prod.js')) return true;
  if (u.includes('/mfe/')) return true;
  if (u.includes('.chunk.js')) return true;
  const t = req.resourceType();
  return t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet';
}, 'lean');

console.log('\n=== Do the tokens actually work against the API? ===');
if (a.token) console.log('  full-load token :', (await apiWorks(a.cookies)) ? 'WORKS' : 'REJECTED');
if (b.token) console.log('  lean-load token :', (await apiWorks(b.cookies)) ? 'WORKS' : 'REJECTED');
else console.log('  lean-load token : none issued');
