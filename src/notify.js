import { applyUrl, jobUrl } from './amazon.js';

const AMAZON_ORANGE = 0xff9900;

function money(v, l10n) {
  if (l10n) return l10n;
  return v == null ? null : `$${Number(v).toFixed(2)}`;
}

function buildEmbed(job, sched, locale) {
  const city = sched.city || job.city;
  const state = sched.state || job.state;
  const zip = sched.postalCode || job.postalCode;
  const where = [city, state].filter(Boolean).join(', ');

  const pay = money(sched.totalPayRate, sched.totalPayRateL10N) ?? money(job.totalPayRateMax);
  const base = money(sched.basePay, sched.basePayL10N);

  const fields = [];
  const push = (name, value, inline = true) => {
    if (value != null && value !== '') fields.push({ name, value: String(value), inline });
  };

  push('💵 Pay', pay ? `**${pay}/hr**` : null);
  if (base && pay && base !== pay) push('Base', `${base}/hr`);
  if (sched.surgePay) push('⚡ Surge', `+$${Number(sched.surgePay).toFixed(2)}/hr`);
  push('🕐 Shift', sched.scheduleText, false);
  push('Type', [sched.scheduleTypeL10N, sched.employmentTypeL10N].filter(Boolean).join(' · '));
  push('Hours/wk', sched.hoursPerWeek);
  push('📅 Starts', sched.firstDayOnSite || sched.hireStartDate);
  push('📍 Location', [sched.address, where, zip].filter(Boolean).join(', ') || job.locationName, false);
  push('🏭 Site', [sched.siteId, sched.scheduleBusinessCategoryL10N].filter(Boolean).join(' · '));
  if (sched.distance != null) push('Distance', `${Number(sched.distance).toFixed(1)} mi`);
  if (sched.laborDemandAvailableCount != null) {
    push('🎯 Slots left', sched.laborDemandAvailableCount);
  }
  if (sched.signOnBonusL10N) push('🎁 Sign-on', sched.signOnBonusL10N);
  if (sched.scheduleBannerText) push('ℹ️', sched.scheduleBannerText, false);

  const apply = applyUrl(job.jobId, sched.scheduleId, locale);
  return {
    title: `🚨 ${sched.externalJobTitle || job.jobTitle}${where ? ` — ${where}` : ''}`,
    url: apply,
    color: AMAZON_ORANGE,
    description:
      `**[▶︎ APPLY NOW](${apply})**  ·  [job page](${jobUrl(job.jobId, locale)})\n` +
      (job.tagLine ? `_${job.tagLine}_` : ''),
    fields: fields.slice(0, 25),
    thumbnail: sched.image || job.image ? { url: sched.image || job.image } : undefined,
    footer: { text: `${job.jobId} · ${sched.scheduleId}` },
    timestamp: new Date().toISOString(),
  };
}

export class DiscordNotifier {
  constructor({ webhookUrl, mentionUserId, mentionRoleId, log }) {
    this.webhookUrl = webhookUrl;
    this.mentionUserId = mentionUserId;
    this.mentionRoleId = mentionRoleId;
    this.log = log;
  }

  #mention() {
    const bits = [];
    if (this.mentionUserId) bits.push(`<@${this.mentionUserId}>`);
    if (this.mentionRoleId) bits.push(`<@&${this.mentionRoleId}>`);
    return bits.join(' ');
  }

  async #post(payload, attempt = 0) {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (res.status === 429 && attempt < 5) {
      const body = await res.json().catch(() => ({}));
      const waitMs = Math.ceil((body.retry_after ?? 1) * 1000) + 250;
      this.log.warn(`discord: rate limited, retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.#post(payload, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`discord webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }

  /** One ping per newly-opened shift, so each has its own apply link. */
  async alert(job, schedules, locale) {
    const mention = this.#mention();
    for (const sched of schedules) {
      await this.#post({
        content: mention
          ? `${mention} **new Amazon opening** — ${sched.externalJobTitle || job.jobTitle}`
          : `**New Amazon opening** — ${sched.externalJobTitle || job.jobTitle}`,
        embeds: [buildEmbed(job, sched, locale)],
        allowed_mentions: {
          parse: [],
          users: this.mentionUserId ? [this.mentionUserId] : [],
          roles: this.mentionRoleId ? [this.mentionRoleId] : [],
        },
      });
    }
  }

  async notice(text) {
    await this.#post({ content: text, allowed_mentions: { parse: [] } }).catch((e) =>
      this.log.warn(`discord notice failed: ${e.message}`)
    );
  }
}
