// OFFLINE build: reads only data/raw, writes data/derived/*.csv and data/derived/metrics.json.
// Deterministic: stable ordering, fixed rounding, no wall-clock values in the output.
//
// usage: node scripts/build.mjs [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RAW, readRawJson, hasRaw, loadManifest } from './lib/raw.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'data', 'derived');

const DAY_MS = 86400000;
const START = '2024-10-01';
const dayMs = (d) => Date.parse(d + 'T00:00:00Z');
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => dayStr(dayMs(d) + n * DAY_MS);
const r2 = (x) => (x === null || x === undefined ? null : Number(x.toFixed(2)));
const r4 = (x) => (x === null || x === undefined ? null : Number(x.toFixed(4)));
const r6 = (x) => (x === null || x === undefined ? null : Number(x.toFixed(6)));
const pct = (n, o) => (n === null || o === null || o === 0 ? null : r2((n / o - 1) * 100));

const manifest = loadManifest();
const P = {
  nb: 'nearblocks/charts.json',
  dex: 'defillama/dexs_near-intents.json',
  fee: 'defillama/fees_near-intents.json',
  rev: 'defillama/revenue_near-intents.json',
  nearFee: 'defillama/fees_near.json',
  proto: 'defillama/protocol_near-intents.json',
  bounds: 'fastnear/boundaries.json',
};
const COUNTS = (acct, d) => `fastnear/counts/${acct}/${d}.json`;

// ------------------------------------------------------------------ load raw
const nbRows = new Map();
for (const r of readRawJson(P.nb).charts) nbRows.set(r.date.slice(0, 10), r);
const llamaMap = (rel) => {
  const m = new Map();
  for (const [ts, v] of readRawJson(rel).totalDataChart) m.set(dayStr(ts * 1000), v);
  return m;
};
const dexMap = llamaMap(P.dex);
const feeMap = llamaMap(P.fee);
const revMap = llamaMap(P.rev);
const nearFeeMap = llamaMap(P.nearFee);
const tvlMap = new Map();
for (const p of readRawJson(P.proto).tvl) tvlMap.set(dayStr(p.date * 1000), p.totalLiquidityUSD);
const boundaries = readRawJson(P.bounds).boundaries;
const keyOf = (d) => d + 'T00:00:00Z';

// last complete UTC day: the day before the Nearblocks chart was fetched, capped by available count files
const chartsFetched = manifest.files[P.nb].fetched_at.slice(0, 10);
let END = addDays(chartsFetched, -1);
while (END >= START && !(hasRaw(COUNTS('v1.signer', END)) && hasRaw(COUNTS('intents.near', END)))) END = addDays(END, -1);

const dates = [];
for (let d = START; d <= END; d = addDays(d, 1)) dates.push(d);

const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
const countOf = (acct, d) => (hasRaw(COUNTS(acct, d)) ? readRawJson(COUNTS(acct, d)).txs_count : null);

const daily = dates.map((d) => {
  const nb = nbRows.get(d);
  const b0 = boundaries[keyOf(d)];
  const b1 = boundaries[keyOf(addDays(d, 1))];
  const row = {
    date: d,
    signer_txs: countOf('v1.signer', d),
    intents_txs: countOf('intents.near', d),
    intents_volume_usd: dexMap.has(d) ? dexMap.get(d) : null,
    intents_fees_usd: feeMap.has(d) ? feeMap.get(d) : null,
    intents_revenue_usd: revMap.has(d) ? revMap.get(d) : null,
    near_fees_usd_nearblocks: nb ? r2(num(nb.txn_fee_usd)) : null,
    near_fees_usd_defillama: nearFeeMap.has(d) ? nearFeeMap.get(d) : null,
    near_txns: nb ? num(nb.txns) : null,
    active_accounts: nb ? num(nb.active_accounts) : null,
    new_accounts: nb ? num(nb.new_accounts) : null,
    near_price_usd: nb ? r4(num(nb.near_price)) : null,
    intents_tvl_usd: tvlMap.has(d) ? tvlMap.get(d) : null,
    blocks_nearblocks: nb ? num(nb.blocks) : null,
    blocks_fastnear: b0 && b1 ? b1.height - b0.height : null,
  };
  row.signer_share_of_near_txns = row.signer_txs !== null && row.near_txns ? r6(row.signer_txs / row.near_txns) : null;
  row.blocks_diff_pct = row.blocks_fastnear !== null && row.blocks_nearblocks ? r4((row.blocks_fastnear / row.blocks_nearblocks - 1) * 100) : null;
  return row;
});
const byDate = new Map(daily.map((r) => [r.date, r]));

// ------------------------------------------------------------------ csv helpers
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function writeCsv(name, cols, rows) {
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), lines.join('\n') + '\n');
}

const DAILY_COLS = ['date', 'signer_txs', 'intents_txs', 'intents_volume_usd', 'intents_fees_usd', 'intents_revenue_usd', 'near_fees_usd_nearblocks', 'near_fees_usd_defillama', 'near_txns', 'active_accounts', 'new_accounts', 'signer_share_of_near_txns', 'near_price_usd', 'intents_tvl_usd', 'blocks_nearblocks', 'blocks_fastnear', 'blocks_diff_pct'];
writeCsv('daily.csv', DAILY_COLS, daily);

// ------------------------------------------------------------------ series definitions
const SERIES = [
  { key: 'signer_txs', agg: 'sum', unit: 'transactions per day touching v1.signer', sources: ['fastnear/counts/v1.signer/<date>.json', P.bounds], method: 'FastNEAR POST /v0/account txs_count for account v1.signer over block window [B(D), B(D+1)-1] inclusive; B(D) = first block with timestamp >= D 00:00 UTC (fastnear/boundaries.json). Counts every transaction in which v1.signer is signer, predecessor or receiver, so it includes MPC node respond calls, callbacks and housekeeping, not only user sign requests.' },
  { key: 'intents_txs', agg: 'sum', unit: 'transactions per day touching intents.near', sources: ['fastnear/counts/intents.near/<date>.json', P.bounds], method: 'FastNEAR POST /v0/account txs_count for account intents.near over the same daily block windows as signer_txs.' },
  { key: 'intents_volume_usd', agg: 'sum', unit: 'USD per day', sources: [P.dex], method: 'DefiLlama summary/dexs/near-intents totalDataChart, daily volume (day = UTC date of the timestamp). Data starts 2024-12-10; earlier days are missing, not zero.' },
  { key: 'intents_fees_usd', agg: 'sum', unit: 'USD per day', sources: [P.fee], method: 'DefiLlama summary/fees/near-intents totalDataChart, daily gross fees. Data starts 2025-05-10; earlier days are missing, not zero.' },
  { key: 'intents_revenue_usd', agg: 'sum', unit: 'USD per day', sources: [P.rev], method: 'DefiLlama summary/fees/near-intents?dataType=dailyRevenue totalDataChart: the net Intents revenue captured by NEAR (NEAR/wNEAR swept into its revenue wallets). DefiLlama states that since 2026-02-23 this revenue funds open-market NEAR buybacks (not burned). Data starts 2025-05-10.' },
  { key: 'near_fees_usd_nearblocks', agg: 'sum', unit: 'USD per day', sources: [P.nb], method: 'Nearblocks /v1/charts txn_fee_usd per day (NEAR-denominated fee burned/paid times price, as computed by Nearblocks).' },
  { key: 'near_fees_usd_defillama', agg: 'sum', unit: 'USD per day', sources: [P.nearFee], method: 'DefiLlama summary/fees/near totalDataChart, daily chain fees in USD.' },
  { key: 'near_txns', agg: 'sum', unit: 'transactions per day (all NEAR)', sources: [P.nb], method: 'Nearblocks /v1/charts txns per day.' },
  { key: 'active_accounts', agg: 'mean', unit: 'accounts active per day (monthly/quarterly rows: mean of daily values, NOT unique accounts per period)', sources: [P.nb], method: 'Nearblocks /v1/charts active_accounts per day.' },
  { key: 'new_accounts', agg: 'sum', unit: 'accounts created per day', sources: [P.nb], method: 'Nearblocks /v1/charts new_accounts per day.' },
  { key: 'signer_share_of_near_txns', agg: 'ratio', num: 'signer_txs', den: 'near_txns', unit: 'fraction', sources: ['fastnear/counts/v1.signer/<date>.json', P.nb], method: 'signer_txs / near_txns. Aggregates (windows, months) are ratios of sums, not averages of daily ratios. Numerator and denominator come from different providers and slightly different transaction definitions; read as an order of magnitude.' },
];

const valOf = (r, k) => r[k];
function windowStats(s, endDate, n) {
  // window = n days ending at endDate (inclusive)
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const r = byDate.get(addDays(endDate, -i));
    days.push(r || null);
  }
  const rows = days.filter(Boolean);
  if (s.agg === 'ratio') {
    const ok = rows.filter((r) => r[s.num] !== null && r[s.den] !== null);
    if (ok.length < n * 0.9) return { value: null, n_days: ok.length };
    const a = ok.reduce((t, r) => t + r[s.num], 0);
    const b = ok.reduce((t, r) => t + r[s.den], 0);
    return { value: b ? a / b : null, n_days: ok.length };
  }
  const ok = rows.filter((r) => valOf(r, s.key) !== null);
  if (ok.length < n * 0.9) return { value: null, n_days: ok.length };
  return { value: ok.reduce((t, r) => t + r[s.key], 0) / ok.length, n_days: ok.length };
}
const roundFor = (s, v) => (v === null ? null : s.agg === 'ratio' ? r6(v) : r2(v));

// ------------------------------------------------------------------ rolling 30-day csv
const rolling = [];
for (const d of dates) {
  if (d < addDays(START, 29)) continue;
  const row = { date: d };
  for (const s of SERIES) row[s.key + '_30d'] = roundFor(s, windowStats(s, d, 30).value);
  rolling.push(row);
}
writeCsv('rolling30.csv', ['date', ...SERIES.map((s) => s.key + '_30d')], rolling);

// ------------------------------------------------------------------ monthly and quarterly
function aggregate(periodKey, label) {
  const groups = new Map();
  for (const r of daily) {
    const k = periodKey(r.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const rows = [];
  for (const k of [...groups.keys()].sort()) {
    const rs = groups.get(k);
    const row = { [label]: k, days: rs.length, first_day: rs[0].date, last_day: rs[rs.length - 1].date };
    const partial = [];
    for (const s of SERIES) {
      if (s.agg === 'ratio') {
        const ok = rs.filter((r) => r[s.num] !== null && r[s.den] !== null);
        const a = ok.reduce((t, r) => t + r[s.num], 0);
        const b = ok.reduce((t, r) => t + r[s.den], 0);
        row[s.key] = ok.length && b ? r6(a / b) : null;
        if (ok.length !== rs.length) partial.push(s.key);
        continue;
      }
      const ok = rs.filter((r) => r[s.key] !== null);
      if (ok.length !== rs.length) partial.push(s.key);
      if (!ok.length) row[s.key] = null;
      else {
        const sum = ok.reduce((t, r) => t + r[s.key], 0);
        row[s.key] = r2(s.agg === 'mean' ? sum / ok.length : sum);
      }
    }
    row.partial_series = partial.join('|');
    rows.push(row);
  }
  return rows;
}
const monthKey = (d) => d.slice(0, 7);
const quarterKey = (d) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const monthly = aggregate(monthKey, 'month');
const quarterly = aggregate(quarterKey, 'quarter');
const AGG_COLS = (label) => [label, 'days', 'first_day', 'last_day', ...SERIES.map((s) => s.key), 'partial_series'];
writeCsv('monthly.csv', AGG_COLS('month'), monthly);
writeCsv('quarterly.csv', AGG_COLS('quarter'), quarterly);

// ------------------------------------------------------------------ sample analysis (v1.signer, 12:00-12:59 UTC)
const SAMPLE_ROOT = path.join(RAW, 'fastnear', 'sample', 'v1.signer');
const sampleDates = fs.existsSync(SAMPLE_ROOT) ? fs.readdirSync(SAMPLE_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
const b64json = (s) => {
  try {
    return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};
function domainOf(args) {
  const j = b64json(args);
  if (!j) return 'undecodable';
  const req = j.request ?? j;
  if (req && req.domain_id !== undefined && req.domain_id !== null) return String(typeof req.domain_id === 'object' ? JSON.stringify(req.domain_id) : req.domain_id);
  if (req && req.key_version !== undefined) return 'legacy_key_version_' + req.key_version;
  return 'absent';
}
const inc = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const sortedEntries = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

const sampleDaily = [];
const methodLong = [];
const callersLong = [];
const domainLong = [];
const overallPrimary = new Map();
const overallEntry = new Map();
const overallSignCallers = new Map();
const overallSignReceivers = new Map();
const overallDomains = new Map();
const overallRespondNodes = new Map();
let verifyForeignCount = 0;

for (const d of sampleDates) {
  const rowsRel = `fastnear/sample/v1.signer/${d}/account_rows.json.gz`;
  const txRel = `fastnear/sample/v1.signer/${d}/transactions.json.gz`;
  if (!hasRaw(rowsRel) || !hasRaw(txRel)) continue;
  const rows = readRawJson(rowsRel);
  const tx = readRawJson(txRel);
  const primary = new Map();
  const entry = new Map();
  const signCallers = new Map();
  const signTxSigners = new Map();
  const signReceivers = new Map();
  const respondNodes = new Map();
  const domains = new Map();
  let direct = 0;
  let wrapper = 0;
  let failed = 0;
  for (const t of tx.transactions) {
    const calls = [];
    for (const r of t.v1_receipts) for (const c of r.calls) calls.push({ pred: r.predecessor_id, method: c.method_name || '<' + c.action + '>', args: c.args });
    const external = calls.filter((c) => c.pred !== 'v1.signer');
    const p = external.length ? external[0].method : 'none';
    inc(primary, p);
    inc(overallPrimary, p);
    const e = t.tx_methods[0] || 'none';
    inc(entry, e);
    inc(overallEntry, e);
    if (t.receiver_id === 'v1.signer') direct++;
    else wrapper++;
    if (t.status && t.status !== 'SuccessValue' && t.status !== 'SuccessReceiptId') failed++;
    if (t.tx_methods.includes('verify_foreign_transaction') || calls.some((c) => c.method === 'verify_foreign_transaction')) verifyForeignCount++;
    const signs = external.filter((c) => c.method === 'sign');
    if (signs.length) {
      inc(signTxSigners, t.signer_id);
      inc(signReceivers, t.receiver_id);
      inc(overallSignReceivers, t.receiver_id);
      for (const c of signs) {
        inc(signCallers, c.pred);
        inc(overallSignCallers, c.pred);
        const dom = domainOf(c.args);
        inc(domains, dom);
        inc(overallDomains, dom);
      }
    }
    for (const c of external)
      if (c.method === 'respond') {
        inc(respondNodes, c.pred);
        inc(overallRespondNodes, c.pred);
      }
  }
  const n = tx.transactions.length;
  const dayRow = byDate.get(d);
  const cat = (k) => primary.get(k) || 0;
  const respondOther = [...primary.entries()].filter(([k]) => k.startsWith('respond_')).reduce((t, [, v]) => t + v, 0);
  const known = cat('respond') + respondOther + cat('sign') + cat('verify_foreign_transaction') + cat('none');
  sampleDaily.push({
    date: d,
    window_utc: '12:00-12:59',
    expected_txs: rows.expected_txs_count,
    decoded_txs: n,
    missing_txs: tx.missing.length,
    failed_txs: failed,
    primary_respond: cat('respond'),
    primary_respond_other: respondOther,
    primary_sign: cat('sign'),
    primary_verify_foreign_transaction: cat('verify_foreign_transaction'),
    primary_other: n - known,
    primary_none: cat('none'),
    sign_share: n ? r6(cat('sign') / n) : null,
    respond_share: n ? r6(cat('respond') / n) : null,
    tx_direct_to_v1_signer: direct,
    tx_via_wrapper_contract: wrapper,
    distinct_sign_callers: signCallers.size,
    distinct_sign_tx_signers: signTxSigners.size,
    distinct_respond_nodes: respondNodes.size,
    day_signer_txs: dayRow ? dayRow.signer_txs : null,
    hour_share_of_day: dayRow && dayRow.signer_txs ? r6(rows.expected_txs_count / dayRow.signer_txs) : null,
  });
  for (const [k, v] of sortedEntries(primary)) methodLong.push({ date: d, kind: 'primary_v1_signer_method', method: k, count: v, share: r6(v / n) });
  for (const [k, v] of sortedEntries(entry)) methodLong.push({ date: d, kind: 'tx_entry_method', method: k, count: v, share: r6(v / n) });
  for (const [k, v] of sortedEntries(signCallers)) callersLong.push({ date: d, role: 'sign_caller_predecessor', account: k, count: v });
  for (const [k, v] of sortedEntries(signReceivers)) callersLong.push({ date: d, role: 'sign_tx_receiver', account: k, count: v });
  for (const [k, v] of sortedEntries(signTxSigners)) callersLong.push({ date: d, role: 'sign_tx_signer', account: k, count: v });
  for (const [k, v] of sortedEntries(respondNodes)) callersLong.push({ date: d, role: 'respond_node', account: k, count: v });
  for (const [k, v] of sortedEntries(domains)) domainLong.push({ date: d, domain: k, sign_calls: v });
}
writeCsv('sample_daily.csv', Object.keys(sampleDaily[0] || { date: '' }), sampleDaily);
writeCsv('sample_method_mix.csv', ['date', 'kind', 'method', 'count', 'share'], methodLong);
writeCsv('sample_callers.csv', ['date', 'role', 'account', 'count'], callersLong);
writeCsv('sample_domains.csv', ['date', 'domain', 'sign_calls'], domainLong);

// ------------------------------------------------------------------ metrics.json
const metrics = {};
const seriesMetrics = {};
for (const s of SERIES) {
  const latest = windowStats(s, END, 30);
  const prev = windowStats(s, addDays(END, -30), 30);
  const q = windowStats(s, addDays(END, -91), 30);
  const y = windowStats(s, addDays(END, -364), 30);
  // peak of the rolling 30-day value
  let peak = null;
  let peakDate = null;
  for (const d of dates) {
    if (d < addDays(START, 29)) continue;
    const w = windowStats(s, d, 30);
    if (w.value !== null && (peak === null || w.value > peak)) {
      peak = w.value;
      peakDate = d;
    }
  }
  const obs = daily.filter((r) => (s.agg === 'ratio' ? r[s.num] !== null && r[s.den] !== null : r[s.key] !== null));
  const firstObs = obs.length ? obs[0].date : null;
  const lastObs = obs.length ? obs[obs.length - 1].date : null;
  // internal gaps: dates between first and last observation without a value
  const gaps = [];
  if (firstObs) for (let d = firstObs; d <= END; d = addDays(d, 1)) {
    const r = byDate.get(d);
    const ok = s.agg === 'ratio' ? r[s.num] !== null && r[s.den] !== null : r[s.key] !== null;
    if (!ok) gaps.push(d);
  }
  seriesMetrics[s.key] = {
    unit: s.unit,
    source: s.sources,
    method: s.method,
    window_end: END,
    latest_30d_avg: roundFor(s, latest.value),
    latest_30d_n_days: latest.n_days,
    prev_30d_avg: roundFor(s, prev.value),
    mom_pct: pct(latest.value, prev.value),
    avg_30d_ending_91d_earlier: roundFor(s, q.value),
    change_vs_91d_earlier_pct: pct(latest.value, q.value),
    avg_30d_ending_364d_earlier: roundFor(s, y.value),
    yoy_pct: pct(latest.value, y.value),
    peak_30d_avg: roundFor(s, peak),
    peak_30d_avg_date: peakDate,
    latest_vs_peak_pct: pct(latest.value, peak),
    first_observation: firstObs,
    last_observation: lastObs,
    missing_days_after_first_observation: gaps,
  };
}
metrics.series = seriesMetrics;

// last two complete calendar quarters, plus the same quarter a year earlier
function daysInQuarter(qk) {
  const y = Number(qk.slice(0, 4));
  const qi = Number(qk.slice(6)) - 1;
  return (Date.UTC(y, qi * 3 + 3, 1) - Date.UTC(y, qi * 3, 1)) / DAY_MS;
}
// A quarter is "complete" if all its days are present; series that start late are checked per series.
function quarterRows() {
  const rows = quarterly.filter((q) => q.days === daysInQuarter(q.quarter));
  return rows;
}
const fullQ = quarterRows();
const lastQ = fullQ.length ? fullQ[fullQ.length - 1] : null;
const prevQ = fullQ.length > 1 ? fullQ[fullQ.length - 2] : null;
const yoyQKey = lastQ ? `${Number(lastQ.quarter.slice(0, 4)) - 1}${lastQ.quarter.slice(4)}` : null;
const yoyQ = fullQ.find((q) => q.quarter === yoyQKey) || null;
const quarterGrowth = {};
if (lastQ) {
  for (const s of SERIES) {
    const okFor = (q) => q && !q.partial_series.split('|').includes(s.key);
    quarterGrowth[s.key] = {
      last_complete_quarter: lastQ.quarter,
      value: lastQ[s.key],
      prior_quarter: prevQ ? prevQ.quarter : null,
      prior_quarter_value: okFor(prevQ) ? prevQ[s.key] : null,
      qoq_pct: okFor(lastQ) && okFor(prevQ) ? pct(lastQ[s.key], prevQ[s.key]) : null,
      same_quarter_prior_year: yoyQKey,
      same_quarter_prior_year_value: okFor(yoyQ) ? yoyQ[s.key] : null,
      yoy_pct: okFor(lastQ) && okFor(yoyQ) ? pct(lastQ[s.key], yoyQ[s.key]) : null,
    };
  }
}
metrics.calendar_quarter_growth = {
  source: ['data/derived/quarterly.csv (built from the daily series above)'],
  method: 'Last fully covered calendar quarter versus the previous quarter (QoQ) and the same quarter one year earlier (YoY). Sums for flow series, mean of daily values for active_accounts, ratio of sums for the share. Null where either quarter is partially covered for that series.',
  by_series: quarterGrowth,
};

// block-count sanity
const flagged = daily.filter((r) => r.blocks_diff_pct !== null && Math.abs(r.blocks_diff_pct) > 2).map((r) => ({ date: r.date, blocks_fastnear: r.blocks_fastnear, blocks_nearblocks: r.blocks_nearblocks, diff_pct: r.blocks_diff_pct }));
const diffs = daily.filter((r) => r.blocks_diff_pct !== null).map((r) => Math.abs(r.blocks_diff_pct)).sort((a, b) => a - b);
metrics.blocks_per_day_check = {
  source: [P.bounds, P.nb],
  method: 'blocks_fastnear = B(D+1) - B(D) (height span, includes skipped heights) versus Nearblocks blocks for D. Days differing by more than 2% are listed.',
  days_compared: diffs.length,
  max_abs_diff_pct: diffs.length ? r4(diffs[diffs.length - 1]) : null,
  median_abs_diff_pct: diffs.length ? r4(diffs[Math.floor(diffs.length / 2)]) : null,
  flagged_over_2pct: flagged,
};

// NEAR fee cross-check between providers
const pairs = daily.filter((r) => r.near_fees_usd_nearblocks !== null && r.near_fees_usd_defillama !== null && r.near_fees_usd_defillama > 0);
const rel = pairs.map((r) => r.near_fees_usd_nearblocks / r.near_fees_usd_defillama - 1).sort((a, b) => a - b);
const absRel = rel.map(Math.abs).sort((a, b) => a - b);
const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
const sumNb = pairs.reduce((t, r) => t + r.near_fees_usd_nearblocks, 0);
const sumDl = pairs.reduce((t, r) => t + r.near_fees_usd_defillama, 0);
const last90 = pairs.slice(-90);
metrics.near_fees_cross_check = {
  source: [P.nb, P.nearFee],
  method: 'Per-day ratio of Nearblocks txn_fee_usd to DefiLlama fees/near. Reported, not enforced: the two providers may define fees differently (burnt vs paid, price source).',
  days_compared: pairs.length,
  total_ratio_nearblocks_over_defillama: sumDl ? r4(sumNb / sumDl) : null,
  median_rel_diff_pct: rel.length ? r2(q(rel, 0.5) * 100) : null,
  p90_abs_rel_diff_pct: absRel.length ? r2(q(absRel, 0.9) * 100) : null,
  max_abs_rel_diff_pct: absRel.length ? r2(absRel[absRel.length - 1] * 100) : null,
  days_over_25pct: absRel.filter((x) => x > 0.25).length,
  last_90_days_total_ratio: last90.length ? r4(last90.reduce((t, r) => t + r.near_fees_usd_nearblocks, 0) / last90.reduce((t, r) => t + r.near_fees_usd_defillama, 0)) : null,
};

// gaps overview
metrics.daily_series_gaps = {
  source: ['data/derived/daily.csv'],
  method: 'Range of the daily table and, per series, missing dates after the first observation (leading absence is listed as first_observation in series metrics).',
  start: START,
  end: END,
  days: dates.length,
  series_with_internal_gaps: Object.fromEntries(Object.entries(seriesMetrics).filter(([, v]) => v.missing_days_after_first_observation.length).map(([k, v]) => [k, v.missing_days_after_first_observation])),
};

// sample metrics
const shareMap = (m, total) => Object.fromEntries(sortedEntries(m).map(([k, v]) => [k, { count: v, share: total ? r6(v / total) : null }]));
const totalDecoded = sampleDaily.reduce((t, r) => t + r.decoded_txs, 0);
const med = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null;
};
const halves = () => {
  if (sampleDaily.length < 4) return null;
  const mid = Math.floor(sampleDaily.length / 2);
  const f = (rows) => {
    const tot = rows.reduce((t, r) => t + r.decoded_txs, 0);
    return { from: rows[0].date, to: rows[rows.length - 1].date, decoded_txs: tot, sign_share: tot ? r6(rows.reduce((t, r) => t + r.primary_sign, 0) / tot) : null, respond_share: tot ? r6(rows.reduce((t, r) => t + r.primary_respond, 0) / tot) : null, median_distinct_sign_callers_per_hour: med(rows.map((r) => r.distinct_sign_callers)) };
  };
  return { first_half: f(sampleDaily.slice(0, mid)), second_half: f(sampleDaily.slice(mid)) };
};
const SAMPLE_CAVEAT = 'Stratified sample: one fixed hour (12:00-12:59 UTC) per sampled day, every transaction in that hour decoded (not a random sample of the day). Method shares describe that hour only and can be biased by time-of-day patterns and by single large callers. Distinct callers per sampled hour are LOWER BOUNDS for distinct callers per day and must not be scaled up or compared with all-day or all-time counts. Transactions are classified by the first receipt addressed to v1.signer whose predecessor is not v1.signer itself (callbacks are ignored); wrapper methods such as sign_transfer and sign_btc_transaction appear under tx_entry_method and resolve to sign at the v1.signer level. Methods starting with respond_ (respond_ckd, respond_verify_foreign_tx) are node-side responses counted in primary_respond_other. The domain label legacy_key_version_N marks sign requests in the older argument format that carries key_version and no domain_id; their signature scheme is not decoded here.';
metrics.sample = {
  source: ['fastnear/sample/v1.signer/<date>/account_rows.json.gz', 'fastnear/sample/v1.signer/<date>/transactions.json.gz'],
  method: SAMPLE_CAVEAT,
  window_utc: '12:00-12:59',
  sampled_days: sampleDaily.length,
  first_day: sampleDaily.length ? sampleDaily[0].date : null,
  last_day: sampleDaily.length ? sampleDaily[sampleDaily.length - 1].date : null,
  total_decoded_txs: totalDecoded,
  total_expected_txs: sampleDaily.reduce((t, r) => t + r.expected_txs, 0),
  total_missing_txs: sampleDaily.reduce((t, r) => t + r.missing_txs, 0),
  hour_share_of_day: { median: med(sampleDaily.map((r) => r.hour_share_of_day).filter((x) => x !== null)), note: 'expected txs in the sampled hour divided by that day total from signer_txs; 1/24 = 0.0417 would be a perfectly flat day' },
  primary_v1_signer_method_mix: shareMap(overallPrimary, totalDecoded),
  tx_entry_method_mix: shareMap(overallEntry, totalDecoded),
  verify_foreign_transaction_occurrences: verifyForeignCount,
  sign_domain_mix: shareMap(overallDomains, [...overallDomains.values()].reduce((a, b) => a + b, 0)),
  distinct_sign_callers_per_sampled_hour: {
    median: med(sampleDaily.map((r) => r.distinct_sign_callers)),
    min: sampleDaily.length ? Math.min(...sampleDaily.map((r) => r.distinct_sign_callers)) : null,
    max: sampleDaily.length ? Math.max(...sampleDaily.map((r) => r.distinct_sign_callers)) : null,
    latest: sampleDaily.length ? sampleDaily[sampleDaily.length - 1].distinct_sign_callers : null,
    definition: 'distinct predecessor_id of sign calls received by v1.signer (the contract or account that called sign, e.g. a bridge contract), per sampled hour',
  },
  distinct_sign_tx_signers_per_sampled_hour: {
    median: med(sampleDaily.map((r) => r.distinct_sign_tx_signers)),
    min: sampleDaily.length ? Math.min(...sampleDaily.map((r) => r.distinct_sign_tx_signers)) : null,
    max: sampleDaily.length ? Math.max(...sampleDaily.map((r) => r.distinct_sign_tx_signers)) : null,
    latest: sampleDaily.length ? sampleDaily[sampleDaily.length - 1].distinct_sign_tx_signers : null,
    definition: 'distinct transaction signer_id among transactions containing a sign call (the account that paid for and signed the NEAR transaction, often a relayer)',
  },
  distinct_respond_nodes_per_sampled_hour: { median: med(sampleDaily.map((r) => r.distinct_respond_nodes)), max: sampleDaily.length ? Math.max(...sampleDaily.map((r) => r.distinct_respond_nodes)) : null },
  distinct_over_whole_sample: { sign_callers: overallSignCallers.size, sign_tx_receivers: overallSignReceivers.size, respond_nodes: overallRespondNodes.size, note: 'union over the sampled hours only; still a lower bound' },
  top_sign_callers: Object.fromEntries(sortedEntries(overallSignCallers).slice(0, 10).map(([k, v]) => [k, { count: v, share_of_sign_calls: r6(v / [...overallSignCallers.values()].reduce((a, b) => a + b, 0)) }])),
  top_sign_tx_receivers: Object.fromEntries(sortedEntries(overallSignReceivers).slice(0, 10).map(([k, v]) => [k, v])),
  halves: halves(),
};

const out = {
  schema: 1,
  window: { start: START, end: END },
  note: 'Generated by scripts/build.mjs from data/raw only. Every entry lists its raw source files and method.',
  raw_provenance: Object.fromEntries([P.nb, P.dex, P.fee, P.nearFee, P.proto, P.bounds].map((rel) => [rel, { fetched_at: manifest.files[rel].fetched_at, sha256: manifest.files[rel].sha256 }])),
  ...metrics,
};
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`built ${dates.length} daily rows (${START}..${END}), ${sampleDaily.length} sampled days -> ${OUT}`);
