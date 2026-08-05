import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

/**
 * Amazon's hiring site sits behind AWS WAF. Raw requests get a 403
 * WAFForbiddenException, so we drive a real headless browser once to solve the
 * challenge, harvest its cookies (aws-waf-token + session), and then replay
 * cheap fetch() calls from Node using those cookies. When the cookies rot the
 * API starts returning 403 again and we transparently re-harvest.
 *
 * Harvesting costs ~14MB (Amazon's React bundle must load for the challenge to
 * run — blocking it yields no token). API polls cost ~2KB. So the token is
 * cached on disk and reused: the issued cookie is valid for 96 hours, and
 * re-harvesting every 20 minutes would waste ~1GB/day of proxy bandwidth for
 * nothing.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const WARMUP_URL = 'https://hiring.amazon.com/search/warehouse-jobs';
const DEFAULT_MAX_AGE = 12 * 60 * 60 * 1000; // 12h, well inside the 96h TTL

export class Session {
  constructor({ log, proxy = null, maxAgeMs = DEFAULT_MAX_AGE, cacheFile = null }) {
    this.log = log;
    this.proxy = proxy;
    this.maxAgeMs = maxAgeMs;
    this.cacheFile = cacheFile;
    this.cookieHeader = null;
    this.harvestedAt = 0;
    this.refreshing = null;
    this.loaded = false;
  }

  get userAgent() {
    return UA;
  }

  isStale() {
    return !this.cookieHeader || Date.now() - this.harvestedAt > this.maxAgeMs;
  }

  /** Reads a previously harvested token off disk, if still fresh. */
  async #loadCache() {
    this.loaded = true;
    if (!this.cacheFile) return;
    try {
      const raw = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'));
      const age = Date.now() - raw.harvestedAt;
      if (raw.cookieHeader && age < this.maxAgeMs) {
        this.cookieHeader = raw.cookieHeader;
        this.harvestedAt = raw.harvestedAt;
        this.log.info(`session: reusing cached token (${(age / 60000).toFixed(0)} min old)`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn(`session: cache unreadable (${err.message})`);
    }
  }

  async #saveCache() {
    if (!this.cacheFile) return;
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(
        this.cacheFile,
        JSON.stringify({ cookieHeader: this.cookieHeader, harvestedAt: this.harvestedAt })
      );
    } catch (err) {
      this.log.warn(`session: could not cache token (${err.message})`);
    }
  }

  /** Returns a cookie header string, harvesting a fresh one if needed. */
  async cookies({ force = false } = {}) {
    if (!this.loaded) await this.#loadCache();
    if (force || this.isStale()) await this.refresh();
    return this.cookieHeader;
  }

  /** Collapses concurrent refreshes into a single browser launch. */
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.#harvest().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async #harvest() {
    this.log.info('session: harvesting fresh WAF token via headless browser (~14MB)...');
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        proxy: this.proxy?.playwright,
        // Shared-memory is tiny in most containers; without this Chromium
        // crashes on load in Docker.
        args: ['--disable-dev-shm-usage', '--no-sandbox'],
      });
      const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
      const page = await ctx.newPage();

      // Wait until the site itself successfully calls its GraphQL endpoint —
      // that is the signal that the WAF challenge has actually been solved.
      const solved = page
        .waitForResponse(
          (r) => r.request().url() === 'https://hiring.amazon.com/graphql' && r.status() === 200,
          { timeout: 45000 }
        )
        .catch(() => null);

      await page.goto(WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await solved;
      // Let the WAF SDK finish writing its final token.
      await page.waitForTimeout(3000);

      const cookies = await ctx.cookies();
      const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      if (!cookies.some((c) => c.name === 'aws-waf-token')) {
        throw new Error(
          'no aws-waf-token cookie was issued — this IP is likely blocked ' +
            '(run scripts/diagnose-waf.js to confirm)'
        );
      }

      this.cookieHeader = header;
      this.harvestedAt = Date.now();
      await this.#saveCache();
      this.log.info('session: token acquired');
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
}
