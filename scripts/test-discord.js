/**
 * Sends one fake opening to your Discord webhook so you can confirm the ping,
 * the embed layout and the @-mention all work before relying on it.
 * Usage: npm run test:discord
 */
import { loadConfig } from '../src/config.js';
import { log } from '../src/log.js';
import { DiscordNotifier } from '../src/notify.js';

const cfg = loadConfig();
const discord = new DiscordNotifier({
  webhookUrl: cfg.webhookUrl,
  mentionUserId: cfg.mentionUserId,
  mentionRoleId: cfg.mentionRoleId,
  log,
});

const job = {
  jobId: 'JOB-US-0000019240',
  jobTitle: 'Sortation Center Warehouse Associate',
  city: 'Forney',
  state: 'TX',
  postalCode: '75126',
  tagLine: 'Sort packages by destination.',
  totalPayRateMax: 21,
};

const sched = {
  scheduleId: 'SCH-US-TEST000000',
  externalJobTitle: 'Sortation Center Warehouse Associate',
  scheduleText: 'Sun, Thu, Fri 8:30 PM - 6:00 AM',
  scheduleTypeL10N: 'Part Time',
  employmentTypeL10N: 'Seasonal',
  hoursPerWeek: 28,
  firstDayOnSite: '2026-08-13',
  basePay: 21,
  basePayL10N: '$21.00',
  totalPayRate: 21,
  totalPayRateL10N: '$21.00',
  surgePay: 2,
  address: '3940 S. Lakeside Dr.',
  city: 'Forney',
  state: 'TX',
  postalCode: '75126',
  siteId: 'DFW9',
  distance: 12.4,
  scheduleBusinessCategoryL10N: 'Sort Center',
  scheduleBannerText: 'Up to $2/hr on shifts starting between 07:00 PM to 06:00 AM',
  laborDemandAvailableCount: 3,
};

await discord.alert(job, [sched], cfg.locale);
log.hit('Test alert sent — check your Discord channel (this is a FAKE listing).');
