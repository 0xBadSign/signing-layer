// FastNEAR tx API helpers: block lookup, exact day-boundary search, transaction trimming.
import { request } from './http.mjs';

const BASE = 'https://tx.main.fastnear.com/v0/';

export async function post(endpoint, body) {
  const r = await request(BASE + endpoint, { method: 'POST', body });
  if (r.status !== 200) throw new Error(`FastNEAR ${endpoint} HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  return { text: r.text, json: JSON.parse(r.text) };
}

// ---- blocks -------------------------------------------------------------

const blockCache = new Map(); // height -> {h, tsNs (BigInt), prev} | null (height has no block)
export const blockStats = { network_lookups: 0 };

export async function getBlock(h) {
  if (blockCache.has(h)) return blockCache.get(h);
  blockStats.network_lookups++;
  const { json } = await post('block', { block_id: h });
  const b = json.block;
  const entry = b ? { h: b.block_height, tsNs: BigInt(b.block_timestamp), prev: b.prev_block_height } : null;
  blockCache.set(h, entry);
  return entry;
}

/** First existing block at height >= h and <= maxH (inclusive). Skipped heights return null from the API. */
async function blockFwd(h, maxH = h + 80) {
  for (let x = h; x <= maxH; x++) {
    const b = await getBlock(x);
    if (b) return b;
  }
  throw new Error(`no block found in [${h}, ${maxH}] (beyond chain head?)`);
}

export function blockFromCache(entry) {
  return { h: entry.height, tsNs: BigInt(entry.ts_ns), prev: entry.prev_height };
}

/**
 * Find the first block whose timestamp is >= tNs (BigInt, nanoseconds).
 * Correct for skipped heights: every probe walks forward to the next existing block,
 * and the search ends only when the candidate's prev_block_height is not above the last
 * known block with timestamp < tNs, so no existing block can sit between them.
 *
 * opts: guess (height), rate (seconds per block), lo / hi (known bracketing blocks).
 * Returns {height, ts_ns, prev_height, lo_height}.
 */
export async function locate(tNs, opts) {
  let { guess, rate, lo = null, hi = null } = opts;
  const classify = (b) => {
    if (b.tsNs < tNs) {
      if (!lo || b.h > lo.h) lo = b;
    } else if (!hi || b.h < hi.h) hi = b;
  };
  if (lo && hi && lo.h >= hi.h) throw new Error('inconsistent bracket');
  if (!lo && !hi) classify(await blockFwd(Math.max(1, Math.round(guess))));
  let extra = 1;
  while (!lo || !hi) {
    let h;
    if (!hi) {
      const dt = Number(tNs - lo.tsNs) / 1e9;
      h = lo.h + Math.max(500, Math.ceil((dt / rate) * 1.05)) * extra;
      classify(await blockFwd(h));
    } else {
      const dt = Number(hi.tsNs - tNs) / 1e9;
      h = Math.max(1, hi.h - Math.max(500, Math.ceil((dt / rate) * 1.05)) * extra);
      const b = await blockFwd(h, hi.h);
      classify(b);
    }
    extra *= 2;
  }
  let iter = 0;
  for (;;) {
    if (hi.prev <= lo.h) break; // nothing can exist strictly between lo and hi
    const top = hi.prev; // an existing block below hi
    let c;
    if (iter % 4 === 3) {
      c = (lo.h + top) >> 1;
    } else {
      const frac = Number(tNs - lo.tsNs) / Number(hi.tsNs - lo.tsNs);
      c = lo.h + Math.floor(frac * (hi.h - lo.h));
    }
    c = Math.min(Math.max(c, lo.h + 1), top);
    classify(await blockFwd(c, top));
    iter++;
    if (iter > 80) throw new Error('boundary search did not converge');
  }
  return { height: hi.h, ts_ns: hi.tsNs.toString(), prev_height: hi.prev, lo_height: lo.h };
}

// ---- transaction trimming ------------------------------------------------

const V1 = 'v1.signer';

/**
 * Reduce a /v0/transactions entry to the fields the analysis needs. The full response is about
 * 6 KB per transaction (all receipts, Merkle data, signatures); keeping it for ~50k+ transactions would
 * exceed the repo size budget. Kept: tx identity and signer, outcome status, tx-level method names, and every
 * receipt addressed to v1.signer with its predecessor, method, original base64 args and receipt status.
 */
export function trimTx(x) {
  const t = x.transaction;
  const eo = x.execution_outcome;
  const out = {
    hash: t.hash,
    signer_id: t.signer_id,
    receiver_id: t.receiver_id,
    block_height: eo.block_height,
    block_timestamp: eo.block_timestamp,
    status: Object.keys(eo.outcome.status || {})[0] || null,
    tx_methods: t.actions.map((a) => (a.FunctionCall ? a.FunctionCall.method_name : Object.keys(a)[0])),
    v1_receipts: [],
  };
  for (const r of x.receipts || []) {
    const rr = r.receipt;
    if (!rr || rr.receiver_id !== V1) continue;
    const acts = rr.receipt?.Action?.actions;
    if (!acts) continue;
    out.v1_receipts.push({
      predecessor_id: rr.predecessor_id,
      status: Object.keys(r.execution_outcome?.outcome?.status || {})[0] || null,
      calls: acts.map((a) =>
        a.FunctionCall
          ? { method_name: a.FunctionCall.method_name, args: a.FunctionCall.args, deposit: a.FunctionCall.deposit }
          : { action: Object.keys(a)[0] },
      ),
    });
  }
  return out;
}
