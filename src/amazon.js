import { proxyFetch } from './proxy.js';

const ENDPOINT = 'https://hiring.amazon.com/graphql';

const SEARCH_JOBS = `query searchJobCardsByLocation($searchJobRequest: SearchJobRequest!) {
  searchJobCardsByLocation(searchJobRequest: $searchJobRequest) {
    nextToken
    jobCards {
      jobId
      jobTitle
      jobType
      employmentType
      city
      state
      postalCode
      locationName
      totalPayRateMin
      totalPayRateMax
      currencyCode
      tagLine
      distance
      featuredJob
      bonusJob
      bonusPay
      scheduleCount
      image
    }
  }
}`;

const SEARCH_SCHEDULES = `query searchScheduleCards($searchScheduleRequest: SearchScheduleRequest!) {
  searchScheduleCards(searchScheduleRequest: $searchScheduleRequest) {
    nextToken
    scheduleCards {
      scheduleId
      jobId
      externalJobTitle
      scheduleText
      scheduleType
      scheduleTypeL10N
      employmentTypeL10N
      hoursPerWeek
      firstDayOnSite
      hireStartDate
      basePay
      basePayL10N
      totalPayRate
      totalPayRateL10N
      signOnBonusL10N
      surgePay
      currencyCode
      address
      city
      state
      postalCode
      siteId
      distance
      scheduleBusinessCategoryL10N
      scheduleBannerText
      laborDemandAvailableCount
      image
    }
  }
}`;

const JOB_DETAIL = `query getJobDetail($getJobDetailRequest: GetJobDetailRequest!) {
  getJobDetail(getJobDetailRequest: $getJobDetailRequest) {
    jobId
    jobTitle
    jobTypeL10N
    employmentTypeL10N
    fullAddress
    city
    state
    postalCode
    locationName
    locationDescription
    tagLine
    jobDescription
    jobQualification
    image
  }
}`;

/** Raised when the WAF rejects us and the caller should re-harvest cookies. */
export class WafBlockedError extends Error {}

export class AmazonHiring {
  constructor({ session, log, country = 'United States', locale = 'en-US', pool = null }) {
    this.session = session;
    this.log = log;
    this.country = country;
    this.locale = locale;
    this.pool = pool;
  }

  async #gql(operationName, query, variables, { retryOnWaf = true } = {}) {
    const cookie = await this.session.cookies();
    const res = await proxyFetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: '*/*',
        'accept-language': this.locale,
        authorization: 'Bearer Status|unauthenticated|Session|',
        country: this.country,
        iscanary: 'false',
        'x-hvh-time': String(Date.now()),
        origin: 'https://hiring.amazon.com',
        referer: 'https://hiring.amazon.com/search/warehouse-jobs',
        'user-agent': this.session.userAgent,
        cookie,
      },
      body: JSON.stringify({ operationName, query, variables }),
      signal: AbortSignal.timeout(30000),
      dispatcher: this.pool?.current()?.dispatcher,
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${operationName}: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    const wafBlocked =
      res.status === 403 ||
      json?.errors?.some((e) => String(e.errorType || '').includes('WAF'));

    if (wafBlocked) {
      if (!retryOnWaf) throw new WafBlockedError(`${operationName}: WAF blocked`);
      this.log.warn('waf: blocked — rotating proxy and refreshing session token');
      // A block usually means this exit IP is flagged, so change IP before
      // spending ~14MB on another harvest.
      this.pool?.rotate('waf block');
      await this.session.refresh();
      return this.#gql(operationName, query, variables, { retryOnWaf: false });
    }

    if (json?.errors?.length) {
      throw new Error(`${operationName}: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    return json.data;
  }

  /** All job cards within `distance` miles of a lat/lng. */
  async searchJobs({ lat, lng, distance, pageSize = 100 }) {
    const data = await this.#gql('searchJobCardsByLocation', SEARCH_JOBS, {
      searchJobRequest: {
        locale: this.locale,
        country: this.country,
        keyWords: '',
        equalFilters: [],
        containFilters: [{ key: 'isPrivateSchedule', val: ['false'] }],
        rangeFilters: [],
        orFilters: [],
        dateFilters: [],
        sorters: [],
        pageSize,
        consolidateSchedule: true,
        geoQueryClause: { lat, lng, unit: 'mi', distance },
      },
    });
    return data?.searchJobCardsByLocation?.jobCards ?? [];
  }

  /**
   * The individual shifts under a job. This is what you actually apply to, and
   * what appears/disappears as Amazon releases capacity.
   */
  async searchSchedules(jobId, { lat, lng, distance } = {}) {
    const req = {
      jobId,
      locale: this.locale,
      country: this.country,
      keyWords: '',
      equalFilters: [],
      containFilters: [{ key: 'isPrivateSchedule', val: ['false'] }],
      rangeFilters: [],
      orFilters: [],
      dateFilters: [],
      excludeFilters: [],
      sorters: [{ fieldName: 'totalPayRateMax', ascending: 'false' }],
      pageSize: 100,
      consolidateSchedule: true,
    };
    if (lat != null && lng != null) {
      req.geoQueryClause = { lat, lng, unit: 'mi', distance };
    }
    const data = await this.#gql('searchScheduleCards', SEARCH_SCHEDULES, {
      searchScheduleRequest: req,
    });
    return data?.searchScheduleCards?.scheduleCards ?? [];
  }

  async jobDetail(jobId) {
    const data = await this.#gql('getJobDetail', JOB_DETAIL, {
      getJobDetailRequest: { locale: this.locale, jobId },
    });
    return data?.getJobDetail ?? null;
  }
}

export function jobUrl(jobId, locale = 'en-US') {
  return `https://hiring.amazon.com/app#/jobDetail?jobId=${jobId}&locale=${locale}`;
}

export function applyUrl(jobId, scheduleId, locale = 'en-US') {
  // Deep-link straight into the application flow for one specific shift.
  return (
    `https://hiring.amazon.com/application/us/?CS=hire&jobId=${jobId}` +
    `&scheduleId=${scheduleId}&locale=${locale}&ssoEnabled=1`
  );
}
