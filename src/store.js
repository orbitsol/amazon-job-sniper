import fs from 'fs/promises';
import path from 'path';

const BASELINE_KEY = '__baselined__';

/**
 * Remembers which schedules we've already alerted on so a restart doesn't
 * re-ping everything. Entries expire so a shift that vanishes and genuinely
 * reopens weeks later still counts as new.
 */
export class SeenStore {
  constructor(file, { ttlMs = 14 * 24 * 60 * 60 * 1000 } = {}) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const cutoff = Date.now() - this.ttlMs;
      for (const [k, ts] of Object.entries(raw)) {
        if (ts > cutoff) this.map.set(k, ts);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return this;
  }

  has(key) {
    return this.map.has(key);
  }

  /**
   * Whether a baseline has ever been completed. Deliberately not "is the store
   * empty" — a quiet area legitimately has zero openings for days, and treating
   * every run as a first run would silently swallow the very first posting.
   */
  get baselined() {
    return this.map.has(BASELINE_KEY);
  }

  markBaselined() {
    // Re-stamped on every save so the TTL sweep never expires it.
    this.map.set(BASELINE_KEY, Date.now());
  }

  add(key) {
    this.map.set(key, Date.now());
  }

  get size() {
    return this.map.has(BASELINE_KEY) ? this.map.size - 1 : this.map.size;
  }

  async save() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [k, ts] of this.map) {
      if (k !== BASELINE_KEY && ts <= cutoff) this.map.delete(k);
    }
    if (this.map.has(BASELINE_KEY)) this.markBaselined();
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(this.map), null, 0));
    await fs.rename(tmp, this.file);
  }
}
