import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DERIVED = path.join(ROOT, 'data', 'derived');
const metrics = JSON.parse(fs.readFileSync(path.join(DERIVED, 'metrics.json'), 'utf8'));

function readCsv(name) {
  const lines = fs.readFileSync(path.join(DERIVED, name), 'utf8').trimEnd().split('\n');
  const cols = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] === '' ? null : cells[i]]));
  });
}

test('rebuild into a temp dir is byte-identical to committed data/derived', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-layer-'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs'), '--out', tmp], { stdio: 'pipe' });
    const a = fs.readdirSync(DERIVED).sort();
    const b = fs.readdirSync(tmp).sort();
    assert.deepEqual(b, a, 'file lists differ');
    for (const f of a) {
      assert.ok(fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(DERIVED, f))), `${f} differs after rebuild`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('daily table is contiguous and the core FastNEAR series have no gaps', () => {
  const rows = readCsv('daily.csv');
  assert.equal(rows[0].date, metrics.window.start);
  assert.equal(rows[rows.length - 1].date, metrics.window.end);
  for (let i = 1; i < rows.length; i++) {
    const expect = new Date(Date.parse(rows[i - 1].date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    assert.equal(rows[i].date, expect, `date gap before ${rows[i].date}`);
  }
  for (const k of ['signer_txs', 'intents_txs', 'near_txns', 'active_accounts']) {
    assert.deepEqual(metrics.series[k].missing_days_after_first_observation, [], `${k} has gaps`);
    assert.equal(metrics.series[k].first_observation, metrics.window.start, `${k} does not start at window start`);
  }
});

test('gaps in the other series are listed explicitly in metrics.json and match the table', () => {
  const rows = readCsv('daily.csv');
  for (const [k, m] of Object.entries(metrics.series)) {
    if (k === 'signer_share_of_near_txns') continue;
    const first = m.first_observation;
    const missing = rows.filter((r) => first && r.date >= first && r[k] === null).map((r) => r.date);
    assert.deepEqual(missing, m.missing_days_after_first_observation, `${k}: listed gaps differ from table`);
  }
  console.log('series with internal gaps:', JSON.stringify(metrics.daily_series_gaps.series_with_internal_gaps));
});

test('block boundaries are monotonic, exact, and cover every day', () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'raw', 'fastnear', 'boundaries.json'), 'utf8')).boundaries;
  const keys = Object.keys(b).sort();
  let prevH = 0;
  for (const k of keys) {
    const h = b[k].height;
    assert.ok(h > prevH, `height not increasing at ${k}`);
    prevH = h;
    const keyNs = BigInt(Date.parse(k)) * 1000000n;
    const ts = BigInt(b[k].ts_ns);
    assert.ok(ts >= keyNs, `${k}: first block timestamp is before the boundary`);
    assert.ok(ts - keyNs < 30n * 1000000000n, `${k}: first block is more than 30 s after the boundary (suspicious)`);
    assert.ok(b[k].prev_height < h && b[k].lo_height >= b[k].prev_height, `${k}: prev/lo heights inconsistent`);
  }
  for (let d = metrics.window.start; d <= addDays(metrics.window.end, 1); d = addDays(d, 1)) {
    assert.ok(b[d + 'T00:00:00Z'], `missing boundary for ${d}`);
  }
});

function addDays(d, n) {
  return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

test('blocks per day: FastNEAR height spans agree with Nearblocks block counts (flagged days are reported)', () => {
  const c = metrics.blocks_per_day_check;
  assert.ok(c.days_compared > 700);
  const flagged = c.flagged_over_2pct;
  if (flagged.length) console.log(`days differing by more than 2%: ${flagged.length}`, JSON.stringify(flagged.slice(0, 20)));
  // the thesis relies on window correctness; a handful of provider-side anomalies is tolerated, systematic drift is not
  assert.ok(flagged.length <= Math.ceil(0.02 * c.days_compared), `${flagged.length} flagged days is too many`);
  assert.ok(c.median_abs_diff_pct < 0.5, 'median block-count difference is too large');
});

test('Nearblocks vs DefiLlama NEAR fees: report the disagreement (does not fail on tolerance)', (t) => {
  const c = metrics.near_fees_cross_check;
  assert.ok(c.days_compared > 0);
  console.log('NEAR fee cross-check:', JSON.stringify(c));
  const TOL = 0.25; // stated tolerance for the 30-day-scale total ratio
  const off = Math.abs(c.total_ratio_nearblocks_over_defillama - 1);
  if (off > TOL) t.diagnostic(`providers disagree by ${(off * 100).toFixed(1)}% on total fees (tolerance ${TOL * 100}%)`);
  assert.ok(Number.isFinite(c.total_ratio_nearblocks_over_defillama));
});

test('sample files are internally consistent', () => {
  const rows = readCsv('sample_daily.csv');
  assert.ok(rows.length > 0, 'no sampled days');
  for (const r of rows) {
    const expected = Number(r.expected_txs);
    assert.equal(Number(r.decoded_txs) + Number(r.missing_txs), expected, `${r.date}: decoded + missing != expected txs_count`);
    assert.ok(expected <= Number(r.day_signer_txs), `${r.date}: sampled hour has more txs than the whole day`);
  }
  console.log(`sampled days: ${rows.length}; total missing txs: ${rows.reduce((t, r) => t + Number(r.missing_txs), 0)}`);
});
