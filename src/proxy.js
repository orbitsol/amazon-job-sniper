import { ProxyAgent } from 'undici';

/**
 * Optional egress proxy. Cloud hosts run on datacenter IP ranges, which AWS WAF
 * scrutinises far more aggressively than home broadband. If the bot starts
 * getting persistently blocked after you deploy it, routing through a
 * residential proxy is the fix. Format:
 *   http://user:pass@host:port
 */
export function parseProxy(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`PROXY_URL is not a valid URL: ${url}`);
  }
  return {
    url,
    // Shape Playwright's launch() expects.
    playwright: {
      server: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    },
    // Shape fetch() expects.
    dispatcher: new ProxyAgent(url),
    label: `${parsed.protocol}//${parsed.hostname}:${parsed.port || ''}`,
  };
}
