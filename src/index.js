import { AmazonHiring } from './amazon.js';
import { geocodeZip, loadConfig } from './config.js';
import { log } from './log.js';
import { DiscordNotifier } from './notify.js';
import { ProxyPool } from './proxy.js';
import { Session } from './session.js';
import { SeenStore } from './store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function passesFilters(cfg, job, sched) {
  if (cfg.titleIncludes.length) {
    const title = `${sched.externalJobTitle || ''} ${job.jobTitle || ''}`.toLowerCase();
    if (!cfg.titleIncludes.some((t) => title.includes(String(t).toLowerCase()))) return false;
  }
  if (cfg.minPay != null) {
    const pay = sched.totalPayRate ?? sched.basePay ?? job.totalPayRateMax;
    if (pay != null && Number(pay) < cfg.minPay) return false;
  }
  if (cfg.maxDistanceMiles != null && sched.distance != null) {
    if (Number(sched.distance) > cfg.maxDistanceMiles) return false;
  }
  return true;
}

async function main() {
  const cfg = loadConfig();

  const origin =
    cfg.lat != null && cfg.lng != null
      ? { lat: cfg.lat, lng: cfg.lng, label: `${cfg.lat}, ${cfg.lng}` }
      : await geocodeZip(cfg.zip);

  log.info(`Amazon job sniper starting`);
  log.info(`  area:     ${origin.label} (${origin.lat}, ${origin.lng}) within ${cfg.radiusMiles} mi`);
  log.info(`  interval: ~${cfg.pollSeconds}s (±${cfg.jitterSeconds}s jitter)`);
  if (cfg.minPay != null) log.info(`  min pay:  $${cfg.minPay}/hr`);
  if (cfg.titleIncludes.length) log.info(`  titles:   ${cfg.titleIncludes.join(', ')}`);

  const pool = ProxyPool.fromConfig({
    proxyUrl: cfg.proxyUrl,
    proxyList: cfg.proxyList,
    proxyFile: cfg.proxyFile,
    log,
  });
  if (pool) log.info(`  proxy:    ${pool.size} proxy(s), starting on ${pool.current().label}`);

  const seen = await new SeenStore(cfg.seenFile).load();
  const session = new Session({
    log,
    pool,
    cacheFile: cfg.sessionFile,
    maxAgeMs: cfg.sessionMaxAgeHours * 60 * 60 * 1000,
  });
  const amazon = new AmazonHiring({
    session,
    log,
    country: cfg.country,
    locale: cfg.locale,
    pool,
  });
  const discord = new DiscordNotifier({
    webhookUrl: cfg.webhookUrl,
    mentionUserId: cfg.mentionUserId,
    mentionRoleId: cfg.mentionRoleId,
    log,
  });

  let firstRun = !seen.baselined;
  if (firstRun && !cfg.alertOnFirstRun) {
    log.info('first run: recording current openings as baseline (no pings for these)');
  }

  let consecutiveErrors = 0;
  let cycles = 0;
  let lastHeartbeat = Date.now();
  let stopping = false;

  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    log.warn(`\n${sig} received — saving state and exiting`);
    await seen.save().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A cron-style host restarts us constantly; an "online" ping each time would
  // be pure spam.
  if (!cfg.once && !cfg.quiet) {
    await discord.notice(
      `✅ Amazon job sniper online — watching **${origin.label}** within **${cfg.radiusMiles} mi**, polling every ~${cfg.pollSeconds}s.`
    );
  }

  while (!stopping) {
    const started = Date.now();
    try {
      const jobs = await amazon.searchJobs({
        lat: origin.lat,
        lng: origin.lng,
        distance: cfg.radiusMiles,
      });

      let newCount = 0;
      for (const job of jobs) {
        // A job card can linger while individual shifts open and close, so the
        // schedule is the real unit of "a position opened".
        let schedules = [];
        try {
          schedules = await amazon.searchSchedules(job.jobId, {
            lat: origin.lat,
            lng: origin.lng,
            distance: cfg.radiusMiles,
          });
        } catch (err) {
          log.warn(`schedules for ${job.jobId} failed: ${err.message}`);
          continue;
        }

        // If a job somehow exposes no schedules, still alert on the job itself.
        const units = schedules.length
          ? schedules
          : [{ scheduleId: `${job.jobId}:nosched`, externalJobTitle: job.jobTitle }];

        const fresh = [];
        for (const sched of units) {
          const key = `${job.jobId}:${sched.scheduleId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (firstRun && !cfg.alertOnFirstRun) continue;
          if (!passesFilters(cfg, job, sched)) continue;
          fresh.push(sched);
        }

        if (fresh.length) {
          newCount += fresh.length;
          for (const s of fresh) {
            log.hit(
              `NEW → ${s.externalJobTitle || job.jobTitle} | ${s.scheduleText || '-'} | ` +
                `$${s.totalPayRate ?? job.totalPayRateMax ?? '?'}/hr | ${s.city || job.city}, ${s.state || job.state}`
            );
          }
          await discord.alert(job, fresh, cfg.locale);
        }
      }

      await seen.save();
      consecutiveErrors = 0;
      cycles += 1;

      if (firstRun) {
        seen.markBaselined();
        await seen.save();
        log.info(`baseline recorded: ${jobs.length} job(s), ${seen.size} shift(s) — now sniping`);
        firstRun = false;
      } else if (newCount === 0 && cycles % 10 === 0) {
        log.info(`no openings (${jobs.length} job(s) in range) · check #${cycles}`);
      }

      if (cfg.heartbeatMinutes > 0 && Date.now() - lastHeartbeat > cfg.heartbeatMinutes * 60000) {
        lastHeartbeat = Date.now();
        await discord.notice(
          `💓 Still watching ${origin.label} — ${jobs.length} job(s) in range, ${cycles} checks done.`
        );
      }
    } catch (err) {
      consecutiveErrors += 1;
      log.error(`poll failed (${consecutiveErrors}): ${err.message}`);
      if (consecutiveErrors === 5) {
        await discord.notice(`⚠️ Sniper hitting repeated errors: \`${err.message}\``);
      }
      // Back off on sustained failure, capped so we recover quickly.
      await sleep(Math.min(60000, 2000 * consecutiveErrors));
      await session.refresh().catch(() => {});
    }

    if (cfg.once) {
      await seen.save();
      if (consecutiveErrors > 0) {
        // Exiting 0 here would paint a green check over a check that never
        // actually ran — the worst possible failure mode for a monitor.
        log.error('single-run mode: check FAILED, exiting non-zero');
        process.exit(1);
      }
      log.info('single-run mode: done');
      break;
    }

    const jitter = (Math.random() * 2 - 1) * cfg.jitterSeconds * 1000;
    const wait = Math.max(3000, cfg.pollSeconds * 1000 + jitter - (Date.now() - started));
    await sleep(wait);
  }
}

main().catch(async (err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
