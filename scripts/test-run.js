/**
 * One-shot check: hits the live Amazon API for your configured area and prints
 * what it finds. Does not touch Discord and does not write the seen-store.
 * Usage: npm test  [--zip 60085] [--radius 50]
 */
import { AmazonHiring } from '../src/amazon.js';
import { geocodeZip } from '../src/config.js';
import { log } from '../src/log.js';
import { Session } from '../src/session.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const zip = arg('zip', '75126');
const radius = Number(arg('radius', 50));

const origin = await geocodeZip(zip);
log.info(`Searching ${origin.label} (${origin.lat}, ${origin.lng}) within ${radius} mi\n`);

const session = new Session({ log });
const amazon = new AmazonHiring({ session, log });

const jobs = await amazon.searchJobs({ lat: origin.lat, lng: origin.lng, distance: radius });
log.info(`${jobs.length} job(s) in range\n`);

for (const job of jobs) {
  const schedules = await amazon.searchSchedules(job.jobId, {
    lat: origin.lat,
    lng: origin.lng,
    distance: radius,
  });
  console.log(
    `▸ ${job.jobTitle} — ${job.city ?? '?'}, ${job.state ?? '?'} ${job.postalCode ?? ''} ` +
      `[${job.jobId}] (${schedules.length} shift(s))`
  );
  for (const s of schedules) {
    console.log(
      `    · ${s.scheduleText || '-'} | ${s.totalPayRateL10N || '$' + s.totalPayRate}/hr | ` +
        `${s.hoursPerWeek ?? '?'}h/wk | starts ${s.firstDayOnSite ?? '?'} | ` +
        `${s.city}, ${s.state} | slots:${s.laborDemandAvailableCount ?? '?'} | ${s.scheduleId}`
    );
  }
}

if (!jobs.length) {
  log.warn(
    'No openings right now — that is normal for a quiet ZIP. ' +
      'Try a busier area to confirm the pipeline works, e.g. `npm test -- --zip 60085`.'
  );
}
process.exit(0);
