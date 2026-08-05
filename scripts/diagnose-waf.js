/**
 * Diagnostic: what does Amazon actually serve us from this machine's IP?
 * Prints the challenge outcome, cookies issued, and whether the site's own
 * GraphQL call succeeds. Run locally and on the target host to compare.
 */
import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const ip = await fetch('https://api.ipify.org?format=json')
  .then((r) => r.json())
  .then((j) => j.ip)
  .catch(() => 'unknown');
console.log('egress IP:', ip);

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--no-sandbox'],
});
const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
const page = await ctx.newPage();

const wafCalls = [];
const gqlCalls = [];
page.on('response', (r) => {
  const u = r.request().url();
  if (u.includes('awswaf')) wafCalls.push(`${r.status()} ${u.split('/').slice(-1)[0]}`);
  if (u === 'https://hiring.amazon.com/graphql') gqlCalls.push(r.status());
});

console.log('navigating...');
const t0 = Date.now();
await page.goto('https://hiring.amazon.com/search/warehouse-jobs', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});

// Poll for the token rather than waiting a fixed period, so we learn how long
// it actually takes on this host.
let token = null;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(2500);
  const c = await ctx.cookies();
  token = c.find((x) => x.name === 'aws-waf-token');
  if (token) {
    console.log(`aws-waf-token appeared after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    break;
  }
}

console.log('final URL   :', page.url());
console.log('page title  :', await page.title().catch(() => '?'));
console.log('waf calls   :', wafCalls.length ? wafCalls.join(', ') : 'NONE');
console.log('graphql     :', gqlCalls.length ? gqlCalls.join(', ') : 'NONE');
console.log('token       :', token ? `YES (${token.value.slice(0, 24)}...)` : 'NO');

const cookies = await ctx.cookies();
console.log('cookie count:', cookies.length);
console.log('cookies     :', cookies.map((c) => c.name).join(', ').slice(0, 400));

const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 600) || '');
console.log('--- visible page text ---');
console.log(bodyText.replace(/\n{2,}/g, '\n'));

// Does the API actually work from here?
if (token) {
  const res = await fetch('https://hiring.amazon.com/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer Status|unauthenticated|Session|',
      country: 'United States',
      accept: '*/*',
      'accept-language': 'en-US',
      iscanary: 'false',
      'x-hvh-time': String(Date.now()),
      origin: 'https://hiring.amazon.com',
      referer: 'https://hiring.amazon.com/search/warehouse-jobs',
      'user-agent': UA,
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    },
    body: JSON.stringify({
      operationName: 'searchJobCardsByLocation',
      variables: {
        searchJobRequest: {
          locale: 'en-US',
          country: 'United States',
          keyWords: '',
          equalFilters: [],
          containFilters: [{ key: 'isPrivateSchedule', val: ['false'] }],
          rangeFilters: [],
          orFilters: [],
          dateFilters: [],
          sorters: [],
          pageSize: 5,
          consolidateSchedule: true,
          geoQueryClause: { lat: 41.8781, lng: -87.6298, unit: 'mi', distance: 60 },
        },
      },
      query: `query searchJobCardsByLocation($searchJobRequest: SearchJobRequest!) {
        searchJobCardsByLocation(searchJobRequest: $searchJobRequest) {
          jobCards { jobId jobTitle city state }
        }
      }`,
    }),
  });
  console.log('--- replayed API call ---');
  console.log('status:', res.status);
  console.log((await res.text()).slice(0, 400));
}

await browser.close();
