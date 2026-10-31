// Polite HTTP client: per-host rate limiting, 429 backoff, timeouts, call statistics.
// Keyless public APIs only.

const HOST_MIN_INTERVAL_MS = {
  'tx.main.fastnear.com': 650, // about 1.5 req/s
  'api.nearblocks.io': 12500, // about 5 req/min
  'api.llama.fi': 2000, // 1 req per 2 s
};
const DEFAULT_MIN_INTERVAL_MS = 2000;
const BACKOFF_429_MS = 15000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stats = {
  calls: {}, // host -> number of HTTP requests actually sent (including retries)
  status_429: {}, // host -> number of 429 responses
  retries: 0,
  timeouts: 0,
  network_errors: 0,
  server_errors: 0,
};

const nextSlot = {}; // host -> earliest epoch ms for the next request

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

async function waitSlot(host) {
  const interval = HOST_MIN_INTERVAL_MS[host] ?? DEFAULT_MIN_INTERVAL_MS;
  const now = Date.now();
  const at = Math.max(now, nextSlot[host] || 0);
  nextSlot[host] = at + interval;
  if (at > now) await sleep(at - now);
}

/**
 * request(url, {method, body, headers, timeoutMs, maxRetries})
 * Returns {status, text, attempts}. Retries on 429 (15 s, then growing), 5xx,
 * timeouts and network errors. Other 4xx statuses are returned to the caller.
 */
export async function request(url, opts = {}) {
  const { method = 'GET', body, headers = {}, timeoutMs = 60000, maxRetries = 8 } = opts;
  const host = new URL(url).host;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    await waitSlot(host);
    bump(stats.calls, host);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      const h = { accept: 'application/json', ...headers };
      if (body !== undefined) h['content-type'] = 'application/json';
      res = await fetch(url, {
        method,
        headers: h,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: ac.signal,
      });
      const text = await res.text();
      clearTimeout(timer);
      if (res.status === 429) {
        bump(stats.status_429, host);
        stats.retries++;
        const wait = Math.min(BACKOFF_429_MS * attempt, 90000);
        nextSlot[host] = Date.now() + wait;
        lastErr = new Error(`429 from ${host}`);
        console.error(`[http] 429 from ${host}, backing off ${wait / 1000}s (attempt ${attempt})`);
        continue;
      }
      if (res.status >= 500) {
        bump(stats, 'server_errors');
        stats.retries++;
        const wait = Math.min(5000 * attempt, 60000);
        nextSlot[host] = Date.now() + wait;
        lastErr = new Error(`HTTP ${res.status} from ${host}: ${text.slice(0, 120)}`);
        console.error(`[http] ${res.status} from ${host}, retry in ${wait / 1000}s (attempt ${attempt})`);
        continue;
      }
      return { status: res.status, text, attempts: attempt };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') stats.timeouts++;
      else stats.network_errors++;
      stats.retries++;
      lastErr = e;
      const wait = Math.min(5000 * attempt, 60000);
      nextSlot[host] = Date.now() + wait;
      console.error(`[http] ${e.name === 'AbortError' ? 'timeout' : 'network error'} on ${host}: ${e.message}; retry in ${wait / 1000}s`);
    }
  }
  throw new Error(`giving up on ${url}: ${lastErr?.message}`);
}

export async function requestJson(url, opts = {}) {
  const r = await request(url, opts);
  if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}: ${r.text.slice(0, 200)}`);
  return { ...r, json: JSON.parse(r.text) };
}
