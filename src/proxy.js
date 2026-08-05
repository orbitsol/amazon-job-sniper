import fs from 'fs';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

/**
 * Node's global fetch is backed by its own bundled undici, which rejects a
 * dispatcher created by the separately-installed undici package
 * ("invalid onRequestStart method"). Always pair undici's fetch with undici's
 * ProxyAgent, or proxied requests fail with an opaque "fetch failed".
 */
export const proxyFetch = undiciFetch;

/**
 * Optional egress proxy. Amazon blocks cloud datacenter IPs at CloudFront
 * before the WAF challenge is even served, so any non-residential host needs
 * one of these to work at all.
 *
 * Accepts the formats proxy sellers actually hand out:
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   http://user:pass@host:port
 *   socks5://user:pass@host:port
 */
export function parseProxyLine(raw) {
  const line = String(raw).trim();
  if (!line || line.startsWith('#')) return null;

  // Already a URL.
  if (/^[a-z0-9+.-]+:\/\//i.test(line)) return normalize(line);

  const parts = line.split(':');

  // host:port:user:pass  — the most common bulk-list format.
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return normalize(
      `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`
    );
  }

  // user:pass@host:port
  if (line.includes('@')) return normalize(`http://${line}`);

  // host:port
  if (parts.length === 2) return normalize(`http://${line}`);

  throw new Error(`unrecognised proxy format: ${line}`);
}

function normalize(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid proxy URL: ${url}`);
  }
  return {
    url: u.toString(),
    playwright: {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    },
    get dispatcher() {
      // Built lazily and cached — creating an agent per request leaks sockets.
      if (!this._agent) this._agent = new ProxyAgent(this.url);
      return this._agent;
    },
    label: `${u.hostname}:${u.port || '80'}`,
  };
}

/** Back-compat single-proxy helper. */
export function parseProxy(url) {
  return url ? parseProxyLine(url) : null;
}

/**
 * Reads proxies from an explicit list, a newline/comma separated env var, or a
 * file. Rotates on failure so one dead entry doesn't stop the bot.
 */
export class ProxyPool {
  constructor(entries, { log } = {}) {
    this.log = log;
    this.proxies = entries;
    this.index = 0;
    this.bad = new Set();
  }

  static fromConfig({ proxyUrl, proxyList, proxyFile, log }) {
    const lines = [];

    if (proxyFile && fs.existsSync(proxyFile)) {
      lines.push(...fs.readFileSync(proxyFile, 'utf8').split('\n'));
    }
    if (proxyList) lines.push(...String(proxyList).split(/[\n,]/));
    if (proxyUrl) lines.push(proxyUrl);

    const parsed = [];
    const errors = [];
    for (const line of lines) {
      try {
        const p = parseProxyLine(line);
        if (p) parsed.push(p);
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (errors.length && log) {
      log.warn(`proxy: skipped ${errors.length} unparseable line(s): ${errors[0]}`);
    }
    if (!parsed.length) return null;

    // Start somewhere random so parallel deployments don't all hammer entry #1.
    const pool = new ProxyPool(parsed, { log });
    pool.index = Math.floor(Math.random() * parsed.length);
    return pool;
  }

  get size() {
    return this.proxies.length;
  }

  get healthy() {
    return this.proxies.length - this.bad.size;
  }

  current() {
    return this.proxies[this.index] ?? null;
  }

  /** Marks the current proxy dead and moves to the next healthy one. */
  rotate(reason = '') {
    const dead = this.current();
    if (dead) this.bad.add(dead.url);

    if (this.bad.size >= this.proxies.length) {
      // Everything is marked bad — most likely a transient network issue, so
      // clear the slate rather than giving up permanently.
      this.log?.warn('proxy: all proxies marked bad, resetting pool');
      this.bad.clear();
    }

    for (let i = 0; i < this.proxies.length; i++) {
      this.index = (this.index + 1) % this.proxies.length;
      if (!this.bad.has(this.current().url)) break;
    }

    this.log?.warn(
      `proxy: rotated ${dead ? `off ${dead.label} ` : ''}` +
        `to ${this.current().label}${reason ? ` (${reason})` : ''} ` +
        `[${this.healthy}/${this.size} healthy]`
    );
    return this.current();
  }
}
