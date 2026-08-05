/**
 * Sends sample alerts to your Discord webhook so you can see how real openings
 * will render before one actually drops.
 *
 *   npm run test:discord           # 10 varied samples
 *   npm run test:discord -- 1      # just one
 *
 * Every sample is fabricated and marked [TEST] so it can't be mistaken for a
 * real posting — the apply links point at job IDs that do not exist.
 */
import { loadConfig } from '../src/config.js';
import { log } from '../src/log.js';
import { DiscordNotifier } from '../src/notify.js';

const cfg = loadConfig();
const count = Number(process.argv.find((a) => /^\d+$/.test(a)) || 10);

const discord = new DiscordNotifier({
  webhookUrl: cfg.webhookUrl,
  mentionUserId: cfg.mentionUserId,
  mentionRoleId: cfg.mentionRoleId,
  log,
});

// Spread across the shapes Amazon actually returns: different facilities, pay
// bands, shift patterns, and the optional fields that only sometimes appear.
const SAMPLES = [
  {
    job: {
      jobId: 'JOB-US-TEST000001', jobTitle: 'Fulfillment Center Warehouse Associate',
      city: 'Forney', state: 'TX', postalCode: '75126',
      tagLine: 'Pick, pack and ship customer orders.', totalPayRateMax: 20.5,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000001', externalJobTitle: 'Fulfillment Center Warehouse Associate',
      scheduleText: 'Mon, Tue, Wed, Thu 6:00 AM - 4:30 PM', scheduleTypeL10N: 'Full Time',
      employmentTypeL10N: 'Regular', hoursPerWeek: 40, firstDayOnSite: '2026-08-18',
      basePay: 20.5, basePayL10N: '$20.50', totalPayRate: 20.5, totalPayRateL10N: '$20.50',
      address: '2601 W FM 1641', city: 'Forney', state: 'TX', postalCode: '75126',
      siteId: 'DFW9', distance: 3.2, scheduleBusinessCategoryL10N: 'Fulfillment Center',
      laborDemandAvailableCount: 12,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000002', jobTitle: 'Sortation Center Warehouse Associate',
      city: 'Mesquite', state: 'TX', postalCode: '75149',
      tagLine: 'Sort packages by destination.', totalPayRateMax: 23,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000002', externalJobTitle: 'Sortation Center Warehouse Associate',
      scheduleText: 'Sun, Thu, Fri 8:30 PM - 6:00 AM', scheduleTypeL10N: 'Part Time',
      employmentTypeL10N: 'Seasonal', hoursPerWeek: 28, firstDayOnSite: '2026-08-12',
      basePay: 21, basePayL10N: '$21.00', totalPayRate: 23, totalPayRateL10N: '$23.00',
      surgePay: 2, address: '1000 Rodeo Dr', city: 'Mesquite', state: 'TX', postalCode: '75149',
      siteId: 'DAL3', distance: 14.8, scheduleBusinessCategoryL10N: 'Sort Center',
      scheduleBannerText: 'Up to $2/hr extra on shifts starting between 07:00 PM and 06:00 AM',
      laborDemandAvailableCount: 3,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000003', jobTitle: 'Delivery Station Warehouse Associate',
      city: 'Terrell', state: 'TX', postalCode: '75160',
      tagLine: 'Prepare orders for delivery.', totalPayRateMax: 19.25,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000003', externalJobTitle: 'Delivery Station Warehouse Associate',
      scheduleText: 'Sat, Sun 1:20 AM - 9:50 AM', scheduleTypeL10N: 'Reduced Time',
      employmentTypeL10N: 'Regular', hoursPerWeek: 17, firstDayOnSite: '2026-08-09',
      basePay: 19.25, basePayL10N: '$19.25', totalPayRate: 19.25, totalPayRateL10N: '$19.25',
      address: '1650 US-80', city: 'Terrell', state: 'TX', postalCode: '75160',
      siteId: 'DYY6', distance: 11.1, scheduleBusinessCategoryL10N: 'Delivery Station',
      laborDemandAvailableCount: 1,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000004', jobTitle: 'Robotics Warehouse Associate',
      city: 'Dallas', state: 'TX', postalCode: '75241',
      tagLine: 'Work alongside robotics technology.', totalPayRateMax: 24.5,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000004', externalJobTitle: 'Robotics Warehouse Associate',
      scheduleText: 'Wed, Thu, Fri, Sat 6:00 PM - 4:30 AM', scheduleTypeL10N: 'Full Time',
      employmentTypeL10N: 'Regular', hoursPerWeek: 40, firstDayOnSite: '2026-08-19',
      basePay: 22, basePayL10N: '$22.00', totalPayRate: 24.5, totalPayRateL10N: '$24.50',
      surgePay: 2.5, signOnBonusL10N: '$1,500', address: '3402 S Lancaster Rd',
      city: 'Dallas', state: 'TX', postalCode: '75241', siteId: 'DFW6', distance: 26.4,
      scheduleBusinessCategoryL10N: 'AR Sort', laborDemandAvailableCount: 8,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000005', jobTitle: 'Warehouse Equipment Operator',
      city: 'Wilmer', state: 'TX', postalCode: '75172',
      tagLine: 'Operate powered industrial trucks.', totalPayRateMax: 22.75,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000005', externalJobTitle: 'Warehouse Equipment Operator',
      scheduleText: 'Mon, Tue, Wed 7:00 AM - 5:30 PM', scheduleTypeL10N: 'Part Time',
      employmentTypeL10N: 'Regular', hoursPerWeek: 30, firstDayOnSite: '2026-08-25',
      basePay: 22.75, basePayL10N: '$22.75', totalPayRate: 22.75, totalPayRateL10N: '$22.75',
      address: '1005 E Belt Line Rd', city: 'Wilmer', state: 'TX', postalCode: '75172',
      siteId: 'FTW6', distance: 22.9, scheduleBusinessCategoryL10N: 'Fulfillment Center',
      laborDemandAvailableCount: 2,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000006', jobTitle: 'Grocery Warehouse Associate',
      city: 'Garland', state: 'TX', postalCode: '75041',
      tagLine: 'Handle fresh and frozen groceries.', totalPayRateMax: 21,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000006', externalJobTitle: 'Grocery Warehouse Associate',
      scheduleText: 'Thu, Fri, Sat, Sun 4:00 AM - 2:30 PM', scheduleTypeL10N: 'Full Time',
      employmentTypeL10N: 'Seasonal', hoursPerWeek: 40, firstDayOnSite: '2026-08-14',
      basePay: 20, basePayL10N: '$20.00', totalPayRate: 21, totalPayRateL10N: '$21.00',
      surgePay: 1, address: '1720 Forest Ln', city: 'Garland', state: 'TX', postalCode: '75041',
      siteId: 'DFW4', distance: 19.6, scheduleBusinessCategoryL10N: 'Grocery',
      scheduleBannerText: 'Cold environment role — insulated gear provided',
      laborDemandAvailableCount: 5,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000007', jobTitle: 'XL Warehouse Associate',
      city: 'Rockwall', state: 'TX', postalCode: '75032',
      tagLine: 'Handle oversized customer orders.', totalPayRateMax: 23.5,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000007', externalJobTitle: 'XL Warehouse Associate',
      scheduleText: 'Fri, Sat, Sun 6:00 PM - 6:30 AM', scheduleTypeL10N: 'Full Time',
      employmentTypeL10N: 'Regular', hoursPerWeek: 36, firstDayOnSite: '2026-08-21',
      basePay: 21.5, basePayL10N: '$21.50', totalPayRate: 23.5, totalPayRateL10N: '$23.50',
      surgePay: 2, address: '900 Justin Rd', city: 'Rockwall', state: 'TX', postalCode: '75032',
      siteId: 'DAL9', distance: 16.3, scheduleBusinessCategoryL10N: 'XL',
      laborDemandAvailableCount: 1,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000008', jobTitle: 'Air Associate',
      city: 'Fort Worth', state: 'TX', postalCode: '76177',
      tagLine: 'Load and unload air freight.', totalPayRateMax: 22,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000008', externalJobTitle: 'Amazon Air Associate',
      scheduleText: 'Tue, Wed, Thu 11:00 PM - 7:30 AM', scheduleTypeL10N: 'Part Time',
      employmentTypeL10N: 'Regular', hoursPerWeek: 25, firstDayOnSite: '2026-09-02',
      basePay: 22, basePayL10N: '$22.00', totalPayRate: 22, totalPayRateL10N: '$22.00',
      address: '15000 Heritage Pkwy', city: 'Fort Worth', state: 'TX', postalCode: '76177',
      siteId: 'AFW5', distance: 48.7, scheduleBusinessCategoryL10N: 'Air Hub',
      laborDemandAvailableCount: 20,
    },
  },
  {
    // Sparse record — several optional fields absent, which does happen.
    job: {
      jobId: 'JOB-US-TEST000009', jobTitle: 'Warehouse Team Member',
      city: 'Kaufman', state: 'TX', postalCode: '75142', totalPayRateMax: 18.5,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000009', externalJobTitle: 'Warehouse Team Member',
      scheduleText: 'Flexible — pick your own shifts', scheduleTypeL10N: 'Flex Time',
      employmentTypeL10N: 'Seasonal', firstDayOnSite: '2026-08-10',
      totalPayRate: 18.5, totalPayRateL10N: '$18.50',
      city: 'Kaufman', state: 'TX', postalCode: '75142', distance: 17.4,
    },
  },
  {
    job: {
      jobId: 'JOB-US-TEST000010', jobTitle: 'Distribution Center Associate',
      city: 'Waxahachie', state: 'TX', postalCode: '75165',
      tagLine: 'Move inventory between facilities.', totalPayRateMax: 25,
    },
    sched: {
      scheduleId: 'SCH-US-TEST000010', externalJobTitle: 'Distribution Center Associate',
      scheduleText: 'Sat, Sun, Mon, Tue 5:00 PM - 3:30 AM', scheduleTypeL10N: 'Full Time',
      employmentTypeL10N: 'Regular', hoursPerWeek: 40, firstDayOnSite: '2026-08-26',
      basePay: 22, basePayL10N: '$22.00', totalPayRate: 25, totalPayRateL10N: '$25.00',
      surgePay: 3, signOnBonusL10N: '$3,000', address: '400 N Interstate 35E',
      city: 'Waxahachie', state: 'TX', postalCode: '75165', siteId: 'DFW7', distance: 44.2,
      scheduleBusinessCategoryL10N: 'Distribution Center',
      scheduleBannerText: 'Highest-paying shift currently available at this site',
      laborDemandAvailableCount: 4,
    },
  },
];

const chosen = SAMPLES.slice(0, Math.min(count, SAMPLES.length));
log.info(`Sending ${chosen.length} sample alert(s) to Discord...`);

await discord.notice(
  `🧪 **${chosen.length} TEST alerts incoming** — these are fabricated samples so you can ` +
    `see the format. The apply links point at job IDs that do not exist.`
);

for (const [i, { job, sched }] of chosen.entries()) {
  await discord.alert(job, [sched], cfg.locale);
  log.hit(`[${i + 1}/${chosen.length}] ${sched.externalJobTitle} — ${sched.city}, ${sched.state}`);
  // Stay well inside Discord's webhook rate limit.
  await new Promise((r) => setTimeout(r, 900));
}

await discord.notice('🧪 **End of test alerts.** Real openings will look identical to the above.');
log.info('Done — check your Discord channel.');
