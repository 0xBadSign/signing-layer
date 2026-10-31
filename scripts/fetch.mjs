// Incremental, resumable fetch of all raw data into data/raw (keyless public APIs only).
//
// usage: node scripts/fetch.mjs [--only static|counts|sample] [--sample-step N] [--sample-days N]
//                               [--end YYYY-MM-DD] [--refresh-static]
//
// Day windows: day D covers the block heights [B(D), B(D+1) - 1], where B(D) is the first block whose
// timestamp is >= D 00:00:00 UTC. Both ends are inclusive in the FastNEAR query (verified: a window whose
// from and to equal the same height returns exactly the transactions in that block).
import fs from 'node:fs';
import { requestJson, request, stats } from './lib/http.mjs';
import { RAW, saveRaw, saveRawGzJson, hasRaw, readRawJson, readRawText, flushManifest, sha256, rawPath } from './lib/raw.mjs';
import { post, locate, blockFromCache, blockStats, trimTx } from './lib/fastnear.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const only = opt('only', 'all');
const sampleStep = Number(opt('sample-step', '2'));
const sampleDays = Number(opt('sample-days', '90'));
const refreshStatic = args.includes('--refresh-static');

const DAY_MS = 86400000;
const START_DAY = '2024-10-01';
const ACCOUNTS = ['v1.signer', 'intents.near'];
const SAMPLE_ACCOUNT = 'v1.signer';
const SAMPLE_HOUR = 12; // 12:00:00 to 12:59:59 UTC
const t0 = Date.now();

const dayMs = (d) => Date.parse(d + 'T00:00:00Z');
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => dayStr(dayMs(d) + n * DAY_MS);
const tsNs = (ms) => BigInt(ms) * 1000000n;

const todayMs = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const lastComplete = opt('end', dayStr(todayMs - DAY_MS));

const log = (...a) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m]`, ...a);

// ---------------------------------------------------------------- static sources
const STATIC = [
  ['nearblocks/charts.json', 'https://api.nearblocks.io/v1/charts'],
  ['defillama/dexs_near-intents.json', 'https://api.llama.fi/summary/dexs/near-intents'],
  ['defillama/fees_near-intents.json', 'https://api.llama.fi/summary/fees/near-intents'],
  ['defillama/fees_near.json', 'https://api.llama.fi/summary/fees/near'],
  ['defillama/protocol_near-intents.json', 'https://api.llama.fi/protocol/near-intents'],
  // NEAR's captured Intents revenue (used for open-market NEAR buybacks since 2026-02-23, per DefiLlama's methodology).
  ['defillama/revenue_near-intents.json', 'https://api.llama.fi/summary/fees/near-intents?dataType=dailyRevenue'],
];

async function fetchStatic() {
  for (const [rel, url] of STATIC) {
    if (hasRaw(rel) && !refreshStatic) {
      log('static cached', rel);
      continue;
    }
    const fetched_at = new Date().toISOString();
    const r = await requestJson(url);
    saveRaw(rel, r.text, { url, method: 'GET', fetched_at });
    log('static fetched', rel, r.text.length, 'bytes');
    flushManifest();
  }
}

// ---------------------------------------------------------------- boundaries
const BOUNDS_REL = 'fastnear/boundaries.json';
let bounds = { version: 1, definition: 'first block with block_timestamp >= key (UTC); heights inclusive-start', boundaries: {} };
if (hasRaw(BOUNDS_REL)) bounds = readRawJson(BOUNDS_REL);
let boundsDirty = 0;
function flushBounds(force = false) {
  if (!boundsDirty || (!force && boundsDirty < 5)) return;
  const sorted = {};
  for (const k of Object.keys(bounds.boundaries).sort()) sorted[k] = bounds.boundaries[k];
  bounds.boundaries = sorted;
  saveRaw(BOUNDS_REL, JSON.stringify(bounds, null, 1) + '\n', {
    url: 'https://tx.main.fastnear.com/v0/block',
    method: 'POST',
    body: { block_id: '<height probes from binary search; see README>' },
    note: 'Cache of exact boundary search results. Key = UTC instant; height = first block with timestamp >= key.',
  });
  flushManifest();
  boundsDirty = 0;
}

let nbBlocks = {}; // date -> blocks per day according to Nearblocks
function loadNbBlocks() {
  const j = readRawJson('nearblocks/charts.json');
  for (const r of j.charts) nbBlocks[r.date.slice(0, 10)] = Number(r.blocks);
}

const keyOf = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

async function boundaryAt(ms, ctx) {
  const key = keyOf(ms);
  if (bounds.boundaries[key]) return bounds.boundaries[key];
  const res = await locate(tsNs(ms), ctx);
  bounds.boundaries[key] = { height: res.height, ts_ns: res.ts_ns, prev_height: res.prev_height, lo_height: res.lo_height };
  boundsDirty++;
  return bounds.boundaries[key];
}

const bnd = (ms) => bounds.boundaries[keyOf(ms)];

async function dayBoundary(d) {
  const ms = dayMs(d);
  if (bnd(ms)) return bnd(ms);
  const prevD = addDays(d, -1);
  const prev = bnd(dayMs(prevD));
  const rateFor = (dd) => (nbBlocks[dd] ? 86400 / nbBlocks[dd] : 0.65);
  if (prev) {
    const guess = prev.height + (nbBlocks[prevD] || Math.round(86400 / 0.65));
    return boundaryAt(ms, { guess, rate: rateFor(prevD), lo: blockFromCache(prev) });
  }
  // very first boundary: anchor on the known fact that height 130,000,000 is on 2024-10-11
  const guess = 130000000 - Math.round(10 * (nbBlocks[d] || 86400));
  return boundaryAt(ms, { guess, rate: rateFor(d) });
}

// ---------------------------------------------------------------- daily counts
async function fetchCounts() {
  const days = [];
  for (let d = START_DAY; d <= lastComplete; d = addDays(d, 1)) days.push(d);
  log(`daily counts: ${days.length} days ${days[0]}..${days[days.length - 1]}`);
  let done = 0;
  for (const d of days) {
    const b0 = await dayBoundary(d);
    const b1 = await dayBoundary(addDays(d, 1));
    for (const acct of ACCOUNTS) {
      const rel = `fastnear/counts/${acct}/${d}.json`;
      if (hasRaw(rel)) continue;
      const body = { account_id: acct, limit: 1, from_tx_block_height: b0.height, to_tx_block_height: b1.height - 1 };
      const fetched_at = new Date().toISOString();
      const r = await post('account', body);
      saveRaw(rel, r.text, {
        url: 'https://tx.main.fastnear.com/v0/account',
        method: 'POST',
        body,
        fetched_at,
        note: 'window is [from, to] inclusive; to = first block of next UTC day minus 1',
      });
    }
    flushBounds();
    flushManifest();
    done++;
    if (done % 10 === 0 || d === lastComplete) log(`counts through ${d}; block lookups ${blockStats.network_lookups}; http ${JSON.stringify(stats.calls)}`);
  }
  flushBounds(true);
}

// ---------------------------------------------------------------- sample
function validGz(rel) {
  if (!hasRaw(rel)) return false;
  try {
    readRawJson(rel);
    return true;
  } catch {
    return false;
  }
}

async function fetchSample() {
  const all = [];
  for (let i = sampleDays - 1; i >= 0; i--) all.push(addDays(lastComplete, -i));
  // newest day first, then every sampleStep-th day counting back from the last complete day
  const chosen = all.filter((d, idx) => (all.length - 1 - idx) % sampleStep === 0).reverse();
  log(`sample: ${chosen.length} days (step ${sampleStep}) of the last ${sampleDays} complete days`);
  let n = 0;
  for (const d of chosen) {
    const dir = `fastnear/sample/${SAMPLE_ACCOUNT}/${d}`;
    const relRows = `${dir}/account_rows.json.gz`;
    const relTx = `${dir}/transactions.json.gz`;
    n++;
    if (validGz(relRows) && validGz(relTx)) continue; // partial or corrupt files are refetched and overwritten
    const b0 = await dayBoundary(d);
    const b1 = await dayBoundary(addDays(d, 1));
    const h0 = dayMs(d) + SAMPLE_HOUR * 3600000;
    const h1 = h0 + 3600000;
    const lo0 = blockFromCache(b0);
    const hi1 = blockFromCache(b1);
    const rate = 86400 / (b1.height - b0.height);
    const s = await boundaryAt(h0, { guess: b0.height + Math.round((SAMPLE_HOUR * 3600) / rate), rate, lo: lo0, hi: hi1 });
    const e = await boundaryAt(h1, { guess: s.height + Math.round(3600 / rate), rate, lo: blockFromCache(s), hi: hi1 });
    flushBounds(true);
    const from = s.height;
    const to = e.height - 1;

    // page the account rows
    const pages = [];
    let resume = null;
    for (;;) {
      const body = { account_id: SAMPLE_ACCOUNT, limit: 200, from_tx_block_height: from, to_tx_block_height: to };
      if (resume) body.resume_token = resume;
      const r = await post('account', body);
      pages.push({ request: { ...body, resume_token: resume ? '<token>' : undefined }, response: r.json });
      resume = r.json.resume_token || null;
      if (!resume || !r.json.account_txs.length) break;
    }
    const expected = pages[0].response.txs_count;
    const hashes = [];
    const seen = new Set();
    let rowCount = 0;
    for (const p of pages)
      for (const row of p.response.account_txs) {
        rowCount++;
        if (!seen.has(row.transaction_hash)) {
          seen.add(row.transaction_hash);
          hashes.push(row.transaction_hash);
        }
      }
    const fetchedRows = new Date().toISOString();
    saveRawGzJson(
      relRows,
      { account_id: SAMPLE_ACCOUNT, window: { from_tx_block_height: from, to_tx_block_height: to, utc_start: keyOf(h0), utc_end_exclusive: keyOf(h1) }, expected_txs_count: expected, row_count: rowCount, unique_hashes: hashes.length, pages },
      { url: 'https://tx.main.fastnear.com/v0/account', method: 'POST', body: { account_id: SAMPLE_ACCOUNT, limit: 200, from_tx_block_height: from, to_tx_block_height: to, resume_token: '<paged>' }, fetched_at: fetchedRows, note: 'gzip JSON; all pages of the 12:00-12:59 UTC window' },
    );

    // decode
    const batches = [];
    const txs = [];
    const missing = [];
    const fetchedTx = new Date().toISOString();
    for (let i = 0; i < hashes.length; i += 20) {
      const chunk = hashes.slice(i, i + 20);
      const r = await post('transactions', { tx_hashes: chunk });
      const got = new Map();
      for (const x of r.json.transactions || []) got.set(x.transaction.hash, x);
      for (const h of chunk) {
        if (got.has(h)) txs.push(trimTx(got.get(h)));
        else missing.push(h);
      }
      batches.push({ n: chunk.length, returned: got.size, response_sha256: sha256(Buffer.from(r.text, 'utf8')), response_bytes: r.text.length });
    }
    saveRawGzJson(
      relTx,
      { account_id: SAMPLE_ACCOUNT, window: { from_tx_block_height: from, to_tx_block_height: to, utc_start: keyOf(h0), utc_end_exclusive: keyOf(h1) }, note: 'Trimmed from /v0/transactions responses (see scripts/lib/fastnear.mjs trimTx); response_sha256 identifies each full original response.', batches, missing, transactions: txs },
      { url: 'https://tx.main.fastnear.com/v0/transactions', method: 'POST', body: { tx_hashes: '<20 hashes per call, see account_rows file>' }, fetched_at: fetchedTx },
    );
    flushManifest();
    log(`sample ${d} (${n}/${chosen.length}): expected ${expected}, rows ${rowCount}, unique ${hashes.length}, decoded ${txs.length}, missing ${missing.length}; http ${JSON.stringify(stats.calls)}`);
  }
}

// ---------------------------------------------------------------- main
function writeStats() {
  const p = rawPath('fetch-stats.json');
  let runs = [];
  try {
    runs = JSON.parse(fs.readFileSync(p, 'utf8')).runs;
  } catch {}
  runs.push({ started_at: new Date(t0).toISOString(), ended_at: new Date().toISOString(), wall_minutes: Number(((Date.now() - t0) / 60000).toFixed(1)), args: args.join(' '), block_lookups: blockStats.network_lookups, stats });
  fs.writeFileSync(p, JSON.stringify({ note: 'operational log of fetch runs; not used by build', runs }, null, 1) + '\n');
}

try {
  fs.mkdirSync(RAW, { recursive: true });
  if (only === 'all' || only === 'static') await fetchStatic();
  loadNbBlocks();
  if (only === 'all' || only === 'counts') await fetchCounts();
  if (only === 'all' || only === 'sample') await fetchSample();
} finally {
  flushBounds(true);
  flushManifest();
  writeStats();
  log('done', JSON.stringify(stats));
}
