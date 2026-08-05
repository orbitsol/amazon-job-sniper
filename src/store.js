import fs from 'fs/promises';
import path from 'path';

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

  add(key) {
    this.map.set(key, Date.now());
  }

  get size() {
    return this.map.size;
  }

  async save() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [k, ts] of this.map) if (ts <= cutoff) this.map.delete(k);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(this.map), null, 0));
    await fs.rename(tmp, this.file);
  }
}
