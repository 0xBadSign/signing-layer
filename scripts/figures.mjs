// Prints every figure quoted in THESIS.md (and reused in README, the dashboard notes and the video captions),
// computed from data/derived only. Offline, no dependencies. A reader can run it and compare line by line.
//
// usage: node scripts/figures.mjs
import fs from 'node:fs';
import path from 'node:path';

const DER = path.resolve(import.meta.dirname, '..', 'data', 'derived');
const m = JSON.parse(fs.readFileSync(path.join(DER, 'metrics.json'), 'utf8'));
function csv(name) {
  const [head, ...lines] = fs.readFileSync(path.join(DER, name), 'utf8').trimEnd().split('\n');
  const cols = head.split(',');
  return lines.map((l) => {
    const c = l.split(',');
    return Object.fromEntries(cols.map((k, i) => [k, c[i] === '' ? null : /^-?[\d.]+$/.test(c[i]) ? Number(c[i]) : c[i]]));
  });
}
const daily = csv('daily.csv');
const monthly = csv('monthly.csv');
const sd = csv('sample_daily.csv');
const callers = csv('sample_callers.csv').filter((r) => r.role === 'sign_caller_predecessor');
const domains = csv('sample_domains.csv');
const S = m.series;
const vc = m.value_capture;
const sm = m.sample;
const ns = m.net_supply_growth;

const DAY = 86400000;
const ms = (d) => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const int = (v) => Math.round(v).toLocaleString('en-US');
const p1 = (v) => (v * 100).toFixed(1) + '%';
const sgn = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const usd = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
  return '$' + v.toFixed(0);
};
const out = (label, value, src) => console.log(`${label.padEnd(64)} ${String(value).padEnd(26)} ${src}`);
const head = (t) => console.log(`\n## ${t}`);
const mon = (k) => monthly.find((r) => r.month === k);

console.log(`window ${m.window.start} to ${m.window.end}; 30-day averages end ${m.window.end}; sample ${sm.first_day} to ${sm.last_day}`);

head('Signing layer (v1.signer)');
const st = S.signer_txs;
out('signer_txs 30-day average', int(st.latest_30d_avg), 'metrics.series.signer_txs.latest_30d_avg');
out('  30-day average ending 364 days earlier', int(st.avg_30d_ending_364d_earlier), 'avg_30d_ending_364d_earlier');
out('  YoY', `${sgn(st.yoy_pct)} (${(st.latest_30d_avg / st.avg_30d_ending_364d_earlier).toFixed(1)}x)`, 'yoy_pct');
out('  MoM (vs previous 30 days)', `${sgn(st.mom_pct)} (prev ${int(st.prev_30d_avg)})`, 'mom_pct, prev_30d_avg');
out('  peak 30-day average', `${int(st.peak_30d_avg)} on ${st.peak_30d_avg_date}`, 'peak_30d_avg(_date)');
out('  latest vs peak', sgn(st.latest_vs_peak_pct), 'latest_vs_peak_pct');
const sh = S.signer_share_of_near_txns;
out('signer share of all NEAR txs, 30-day', `${(sh.latest_30d_avg * 100).toFixed(2)}% (year earlier ${(sh.avg_30d_ending_364d_earlier * 100).toFixed(2)}%, ${(sh.latest_30d_avg / sh.avg_30d_ending_364d_earlier).toFixed(0)}x)`, 'signer_share_of_near_txns');
for (const k of ['2026-05', '2026-09', '2026-10', '2026-11']) out(`  monthly signer_txs ${k} (${mon(k).days} days)`, int(mon(k).signer_txs), 'monthly.csv signer_txs');

head('Sample (12:00-12:59 UTC, decoded)');
const gaps = {};
for (let i = 1; i < sd.length; i++) {
  const g = (ms(sd[i].date) - ms(sd[i - 1].date)) / DAY;
  gaps[g] = (gaps[g] || 0) + 1;
}
const runs = [];
for (const r of sd) {
  const last = runs[runs.length - 1];
  if (last && (ms(r.date) - ms(last.to)) / DAY === 1) last.to = r.date;
  else runs.push({ from: r.date, to: r.date });
}
out('sampled days', `${sm.sampled_days} (${sm.first_day} to ${sm.last_day})`, 'metrics.sample');
out('  gaps between sampled days (days: count)', JSON.stringify(gaps), 'sample_daily.csv date');
out('  longest run of consecutive days', (() => { const r = runs.reduce((a, b) => ((ms(b.to) - ms(b.from)) > (ms(a.to) - ms(a.from)) ? b : a)); return `${r.from} to ${r.to} (${(ms(r.to) - ms(r.from)) / DAY + 1} days)`; })(), 'sample_daily.csv date');
out('  days outside that run', sd.filter((r) => runs.length && !runs.some((x) => x.from !== x.to && r.date >= x.from && r.date <= x.to)).map((r) => r.date).join(' '), 'sample_daily.csv date');
out('decoded transactions (= expected)', `${int(sm.total_decoded_txs)} (expected ${int(sm.total_expected_txs)}, missing ${sm.total_missing_txs})`, 'metrics.sample');
const mix = sm.primary_v1_signer_method_mix;
out('sign share / respond share', `${p1(mix.sign.share)} / ${p1(mix.respond.share)}`, 'sample.primary_v1_signer_method_mix');
out('verify_foreign_transaction calls', `${sm.verify_foreign_transaction_occurrences} (${p1(mix.verify_foreign_transaction.share)})`, 'sample.verify_foreign_transaction_occurrences');
out('MPC respond nodes per hour (median, max); whole sample', `${sm.distinct_respond_nodes_per_sampled_hour.median}, ${sm.distinct_respond_nodes_per_sampled_hour.max}; ${sm.distinct_over_whole_sample.respond_nodes}`, 'sample.distinct_respond_nodes_*');
const dc = sm.distinct_sign_callers_per_sampled_hour;
out('distinct sign callers per hour, median (min-max)', `${dc.median} (${dc.min}-${dc.max})`, 'sample.distinct_sign_callers_per_sampled_hour');
out('  first half / second half median', `${sm.halves.first_half.median_distinct_sign_callers_per_hour} (${sm.halves.first_half.from}..${sm.halves.first_half.to}) / ${sm.halves.second_half.median_distinct_sign_callers_per_hour} (${sm.halves.second_half.from}..${sm.halves.second_half.to})`, 'sample.halves');
out('distinct sign callers, whole sample', sm.distinct_over_whole_sample.sign_callers, 'sample.distinct_over_whole_sample');
out('user-driven sign requests per day (sign share x signer_txs 30d)', int(mix.sign.share * st.latest_30d_avg), 'derived: share x 30-day average');

// caller classes, same rule as web/app.js callerClass
const cls = (a) => (a === 'fast-auth.near' ? 'native' : a === 'omni.bridge.near' || /\.bridge\.near$/.test(a) || a.includes('connector') ? 'bridge' : 'other');
const shares = (rows) => {
  const c = { native: 0, bridge: 0, other: 0 };
  let t = 0;
  for (const r of rows) { c[cls(r.account)] += r.count; t += r.count; }
  return { bridge: c.bridge / t, native: c.native / t, other: c.other / t, n: t, days: new Set(rows.map((r) => r.date)).size };
};
const fmtSh = (x) => `bridge ${p1(x.bridge)}, fast-auth ${p1(x.native)}, other ${p1(x.other)} (${int(x.n)} sign calls, ${x.days} sampled days)`;
out('caller classes, whole sample (ratio of sums)', fmtSh(shares(callers)), 'sample_callers.csv sign_caller_predecessor');
for (const k of [...new Set(callers.map((r) => r.date.slice(0, 7)))]) out(`  calendar month ${k}`, fmtSh(shares(callers.filter((r) => r.date.startsWith(k)))), 'sample_callers.csv, rows in that month');
const c0 = addDays(sm.first_day, 29), c1 = addDays(sm.last_day, -29);
out(`  first 30 calendar days (${sm.first_day}..${c0})`, fmtSh(shares(callers.filter((r) => r.date <= c0))), 'sample_callers.csv');
out(`  last 30 calendar days (${c1}..${sm.last_day}) = signal S3`, fmtSh(shares(callers.filter((r) => r.date >= c1))), 'sample_callers.csv');
const per = {};
let calTot = 0;
for (const r of callers) { per[r.account] = (per[r.account] || 0) + r.count; calTot += r.count; }
const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 5);
for (const [a, n] of top) out(`  top caller ${a}`, p1(n / calTot), 'sample_callers.csv');
out('  top 5 callers together', p1(top.reduce((t, [, n]) => t + n, 0) / calTot), 'sample_callers.csv');
const dom = {};
let domTot = 0;
for (const r of domains) { dom[r.domain] = (dom[r.domain] || 0) + r.sign_calls; domTot += r.sign_calls; }
for (const [k, n] of Object.entries(dom).sort((a, b) => b[1] - a[1])) out(`  sign domain ${k}`, p1(n / domTot), 'sample_domains.csv');
// absolute sign calls per sampled hour by class: shows whether a share change comes from the numerator or the denominator
const perHour = (rows) => {
  const c = { native: 0, bridge: 0, other: 0 };
  for (const r of rows) c[cls(r.account)] += r.count;
  const n = new Set(rows.map((r) => r.date)).size;
  return `bridge ${int(c.bridge / n)}, fast-auth ${int(c.native / n)}, other ${int(c.other / n)}, all ${int((c.bridge + c.native + c.other) / n)} (${n} hours)`;
};
for (const k of [...new Set(callers.map((r) => r.date.slice(0, 7)))]) out(`  sign calls per sampled hour, ${k}`, perHour(callers.filter((r) => r.date.startsWith(k))), 'sample_callers.csv count / sampled days');
out('  sign calls per sampled hour, first 30 days', perHour(callers.filter((r) => r.date <= c0)), 'sample_callers.csv');
out('  sign calls per sampled hour, last 30 days', perHour(callers.filter((r) => r.date >= c1)), 'sample_callers.csv');
const s2 = sd.filter((r) => r.date >= c1).map((r) => r.distinct_sign_callers).sort((a, b) => a - b);
out('S2: median distinct sign callers, last 30 days of samples', `${s2.length % 2 ? s2[(s2.length - 1) / 2] : (s2[s2.length / 2 - 1] + s2[s2.length / 2]) / 2} (${s2.length} hours)`, 'sample_daily.csv distinct_sign_callers');
out('sampled hour share of day, median', p1(sm.hour_share_of_day.median), 'sample.hour_share_of_day');

head('Settlement layer (NEAR Intents)');
for (const [k, f] of [['intents_volume_usd', usd], ['intents_fees_usd', usd], ['intents_revenue_usd', usd], ['intents_txs', int]]) {
  const s = S[k];
  out(`${k} 30-day average`, f(s.latest_30d_avg), `metrics.series.${k}`);
  out('  vs 91 days earlier / YoY / MoM', `${sgn(s.change_vs_91d_earlier_pct)} / ${sgn(s.yoy_pct)} (base ${f(s.avg_30d_ending_364d_earlier)}) / ${sgn(s.mom_pct)}`, 'change_vs_91d_earlier_pct, yoy_pct, mom_pct');
  out('  peak 30-day average', `${f(s.peak_30d_avg)} on ${s.peak_30d_avg_date} (latest ${sgn(s.latest_vs_peak_pct)})`, 'peak_30d_avg');
}
for (const k of ['2025-03', '2025-09', '2025-10', '2025-11', '2025-12', '2026-08', '2026-09', '2026-10', '2026-11']) out(`  monthly volume ${k} (${mon(k).days} days)`, `${usd(mon(k).intents_volume_usd)} (${usd(mon(k).intents_volume_usd / mon(k).days)}/day)`, 'monthly.csv intents_volume_usd');
// sensitivity of the volume YoY to where the year-earlier window falls
{
  const roll = csv('rolling30.csv');
  const yb = addDays(m.window.end, -364);
  const later = roll.filter((r) => r.date >= yb && r.date <= addDays(yb, 60) && r.intents_volume_usd_30d !== null);
  const pk = later.reduce((a, b) => (b.intents_volume_usd_30d > a.intents_volume_usd_30d ? b : a));
  out(`  highest 30-day volume average in the 60 days after ${yb}`, `${usd(pk.intents_volume_usd_30d)} (30 days ending ${pk.date})`, 'rolling30.csv intents_volume_usd_30d');
  out('  latest 30-day volume vs that level', sgn((S.intents_volume_usd.latest_30d_avg / pk.intents_volume_usd_30d - 1) * 100), 'derived');
  // captured revenue: how many days of the year-earlier window carry revenue
  const base = daily.filter((r) => r.date > addDays(yb, -30) && r.date <= yb);
  const nz = base.filter((r) => r.intents_revenue_usd > 0);
  out(`  captured revenue, year-earlier window: days with revenue > 0`, `${nz.length} of ${base.length} (${nz.map((r) => `${r.date} ${usd(r.intents_revenue_usd)}`).join(', ')})`, 'daily.csv intents_revenue_usd');
}
const h1 = monthly.filter((r) => r.month >= '2026-01' && r.month <= '2026-06');
const lo = h1.reduce((a, b) => (b.intents_volume_usd < a.intents_volume_usd ? b : a)), hi = h1.reduce((a, b) => (b.intents_volume_usd > a.intents_volume_usd ? b : a));
out('  monthly volume range 2026-01..2026-06', `${usd(lo.intents_volume_usd)} (${lo.month}) to ${usd(hi.intents_volume_usd)} (${hi.month})`, 'monthly.csv intents_volume_usd');
const rec = monthly.filter((r) => r.days >= 28 && r.intents_volume_usd !== null).reduce((a, b) => (b.intents_volume_usd > a.intents_volume_usd ? b : a));
out('  record full month', `${rec.month} ${usd(rec.intents_volume_usd)}`, 'monthly.csv');
const perDay = (k) => mon(k).intents_volume_usd / mon(k).days;
out('  volume per day: 2026-09 / 2026-10 / 2026-11 (partial)', `${usd(perDay('2026-09'))} / ${usd(perDay('2026-10'))} / ${usd(perDay('2026-11'))}`, 'monthly.csv volume / days');
const vol = S.intents_volume_usd, itx = S.intents_txs;
out('volume per intents.near tx, 30-day: now / a year earlier', `$${int(vol.latest_30d_avg / itx.latest_30d_avg)} / $${int(vol.avg_30d_ending_364d_earlier / itx.avg_30d_ending_364d_earlier)}`, 'ratio of 30-day averages');
const q = m.calendar_quarter_growth.by_series;
out(`quarter ${q.intents_volume_usd.last_complete_quarter}: volume QoQ / YoY`, `${sgn(q.intents_volume_usd.qoq_pct)} / ${sgn(q.intents_volume_usd.yoy_pct)}`, 'calendar_quarter_growth');
out(`quarter ${q.intents_txs.last_complete_quarter}: intents_txs QoQ / YoY`, `${sgn(q.intents_txs.qoq_pct)} / ${sgn(q.intents_txs.yoy_pct)}`, 'calendar_quarter_growth');

head('Value capture');
const rev = S.intents_revenue_usd, fee = S.intents_fees_usd;
out('revenue annualized (30-day x 365)', usd(vc.intents_revenue_annualized_usd), 'value_capture');
out('L1 fees annualized', usd(vc.l1_fees_annualized_usd), 'value_capture');
out('revenue / L1 fees', vc.intents_revenue_over_l1_fees + 'x', 'value_capture');
out('market cap snapshot', `${usd(vc.market_cap_usd)} at $${vc.near_price_usd} (${vc.snapshot_fetched_at})`, 'value_capture');
out('buyback funding / market cap, annualized', vc.buyback_yield_annualized_pct + '%', 'value_capture');
out('L1 fees / market cap, annualized', vc.l1_fee_yield_annualized_pct + '%', 'value_capture');
out('NEAR captured share of gross Intents fees, 30-day', `${p1(rev.latest_30d_avg / fee.latest_30d_avg)} (${usd(rev.latest_30d_avg)} of ${usd(fee.latest_30d_avg)})`, 'ratio of 30-day averages');
out('captured revenue / volume, 30-day (take rate)', `${((rev.latest_30d_avg / vol.latest_30d_avg) * 1e4).toFixed(2)} bp`, 'ratio of 30-day averages');
const qr = q.intents_revenue_usd.value / q.intents_volume_usd.value;
out(`captured revenue / volume, ${q.intents_revenue_usd.last_complete_quarter}`, `${(qr * 1e4).toFixed(2)} bp`, 'calendar_quarter_growth values');
for (const k of ['2025-11', '2026-04', '2026-08', '2026-09', '2026-10', '2026-11']) out(`  monthly captured revenue ${k} (${mon(k).days} days)`, usd(mon(k).intents_revenue_usd), 'monthly.csv intents_revenue_usd');
{
  const mr = monthly.filter((r) => r.month >= '2025-12' && r.month <= '2026-08');
  const a = mr.reduce((x, y) => (y.intents_revenue_usd < x.intents_revenue_usd ? y : x)), b = mr.reduce((x, y) => (y.intents_revenue_usd > x.intents_revenue_usd ? y : x));
  out('  monthly captured revenue range 2025-12..2026-08', `${usd(a.intents_revenue_usd)} (${a.month}) to ${usd(b.intents_revenue_usd)} (${b.month})`, 'monthly.csv intents_revenue_usd');
  const bp = monthly.filter((r) => r.month >= '2026-01' && r.month <= '2026-10').map((r) => [r.month, (r.intents_revenue_usd / r.intents_volume_usd) * 1e4]);
  out('  monthly capture rate, bp of volume, 2026-01..2026-10', bp.map(([k, v]) => `${k.slice(5)}:${v.toFixed(2)}`).join(' '), 'monthly.csv revenue / volume');
  const ja = bp.filter(([k]) => k <= '2026-08').map(([, v]) => v).sort((x, y) => x - y);
  out('  median monthly capture rate 2026-01..2026-08', `${((ja[ja.length / 2 - 1] + ja[ja.length / 2]) / 2).toFixed(2)} bp (range ${ja[0].toFixed(2)}-${ja[ja.length - 1].toFixed(2)})`, 'monthly.csv revenue / volume');
}
{
  const l30 = daily.slice(-30).map((r) => r.near_fees_usd_nearblocks).sort((x, y) => x - y);
  out('L1 fees, last 30 days: mean / median day', `${usd(S.near_fees_usd_nearblocks.latest_30d_avg)} / ${usd((l30[14] + l30[15]) / 2)}`, 'daily.csv near_fees_usd_nearblocks');
}
out('market cap / price (implied supply), total supply, circulating supply', `${int(vc.market_cap_usd / vc.near_price_usd / 1e6)}M / ${int(vc.total_supply_near / 1e6)}M / ${int(vc.circulating_supply_near / 1e6)}M NEAR`, 'value_capture');
out('  on circulating supply: market cap, buyback share', `${usd(vc.circulating_supply_near * vc.near_price_usd)}, ${((vc.intents_revenue_annualized_usd / (vc.circulating_supply_near * vc.near_price_usd)) * 100).toFixed(2)}%`, 'value_capture');
const over = daily.filter((r) => r.intents_revenue_usd !== null && r.intents_fees_usd !== null && r.intents_revenue_usd > r.intents_fees_usd);
const both = daily.filter((r) => r.intents_revenue_usd !== null && r.intents_fees_usd !== null);
out('days where captured revenue > gross fees', `${over.length} of ${both.length} days with both values`, 'daily.csv');
if (over.length) {
  out('  dates', over.map((r) => r.date).join(' '), 'daily.csv');
  out('  of them in the last 90 days', over.filter((r) => r.date > addDays(m.window.end, -90)).length, 'daily.csv');
  const ex = over.reduce((t, r) => t + r.intents_revenue_usd - r.intents_fees_usd, 0);
  out('  summed excess (revenue minus fees on those days)', usd(ex), 'daily.csv');
}

head('Net supply growth and the buyback');
if (ns && ns.measured) {
  out('total supply', `${int(ns.from.total_supply_near)} NEAR (${ns.from.date}) -> ${int(ns.to.total_supply_near)} NEAR (${ns.to.date})`, 'metrics.net_supply_growth');
  out('net change over ' + ns.days + ' days', `${int(ns.net_change_near)} NEAR, ${ns.net_growth_pct.toFixed(2)}%`, 'metrics.net_supply_growth');
  out('net new supply valued at the snapshot price', usd(vc.net_new_supply_usd_at_snapshot_price), 'value_capture');
  out('net new supply value / market cap', p1(vc.net_new_supply_usd_at_snapshot_price / vc.market_cap_usd), 'derived');
  out('annualized buyback funding / net new supply value', vc.buyback_over_net_new_supply.toFixed(2), 'value_capture.buyback_over_net_new_supply');
  const be = vc.net_new_supply_usd_at_snapshot_price / 365;
  out('captured revenue per day that offsets net new supply', `${usd(be)} (${(be / rev.latest_30d_avg).toFixed(1)}x the 30-day average)`, 'derived');
  out('captured revenue per day that offsets half', usd(be / 2), 'derived');
} else out('net supply growth', 'not measured', 'metrics.net_supply_growth');

head('Scenarios, next 12 months (ASSUMPTIONS, not data)');
const take = rev.latest_30d_avg / vol.latest_30d_avg;
const SCEN = [
  ['bear', 50e6, 3],
  ['base', 130e6, 5],
  ['bull', 300e6, 5],
];
for (const [name, v, bp] of SCEN) {
  const perDayRev = v * bp / 1e4;
  const yr = perDayRev * 365;
  const vsSupply = ns && ns.measured ? (yr / vc.net_new_supply_usd_at_snapshot_price).toFixed(2) : 'n/a';
  out(`${name}: volume ${usd(v)}/day, capture ${bp} bp`, `${usd(perDayRev)}/day, ${usd(yr)}/yr, ${((yr / vc.market_cap_usd) * 100).toFixed(2)}% of mcap, ${vsSupply} of net new supply`, 'assumption x value_capture');
}
out('(current capture rate, for reference)', `${(take * 1e4).toFixed(2)} bp`, '30-day revenue / 30-day volume');
if (ns && ns.measured) out('volume/day needed to offset net new supply at 5 bp', usd(vc.net_new_supply_usd_at_snapshot_price / 365 / 5e-4), 'derived');

head('Classic L1 (counter-evidence)');
const aa = S.active_accounts;
out('active accounts, monthly mean 2024-10', int(mon('2024-10').active_accounts), 'monthly.csv active_accounts');
out('active accounts, monthly mean 2025-10 / 2026-10', `${int(mon('2025-10').active_accounts)} / ${int(mon('2026-10').active_accounts)} (${sgn((mon('2026-10').active_accounts / mon('2025-10').active_accounts - 1) * 100)})`, 'monthly.csv active_accounts');
out('  2026-10 vs 2024-10', sgn((mon('2026-10').active_accounts / mon('2024-10').active_accounts - 1) * 100), 'monthly.csv');
out('active accounts 30-day average / a year earlier', `${int(aa.latest_30d_avg)} / ${int(aa.avg_30d_ending_364d_earlier)} (${sgn(aa.yoy_pct)}); MoM ${sgn(aa.mom_pct)}`, 'metrics.series.active_accounts');
const nt = S.near_txns, na = S.new_accounts;
out('NEAR txs: peak 30-day average (window ending)', `${(nt.peak_30d_avg / 1e6).toFixed(2)}M (${nt.peak_30d_avg_date})`, 'near_txns.peak_30d_avg');
out('NEAR txs: 30-day now, YoY, vs peak', `${(nt.latest_30d_avg / 1e6).toFixed(2)}M, ${sgn(nt.yoy_pct)}, ${sgn(nt.latest_vs_peak_pct)}`, 'near_txns');
out('new accounts: peak 30-day average (window ending)', `${int(na.peak_30d_avg)} (${na.peak_30d_avg_date})`, 'new_accounts.peak_30d_avg');
out('new accounts: 30-day now, YoY, vs peak', `${int(na.latest_30d_avg)}, ${sgn(na.yoy_pct)}, ${sgn(na.latest_vs_peak_pct)}`, 'new_accounts');
const d = (x) => daily.find((r) => r.date === x);
out('near_txns 2026-04-01 -> 2026-04-02', `${(d('2026-04-01').near_txns / 1e6).toFixed(2)}M -> ${(d('2026-04-02').near_txns / 1e6).toFixed(2)}M`, 'daily.csv');
out('active accounts 2026-04-01..03', [d('2026-04-01'), d('2026-04-02'), d('2026-04-03')].map((r) => int(r.active_accounts)).join(', '), 'daily.csv');
out('L1 fees 2026-04-01 -> 2026-04-02', `$${d('2026-04-01').near_fees_usd_nearblocks} -> $${d('2026-04-02').near_fees_usd_nearblocks}`, 'daily.csv');
out('  one-day change: near_txns / L1 fees', `${sgn((d('2026-04-02').near_txns / d('2026-04-01').near_txns - 1) * 100)} / ${sgn((d('2026-04-02').near_fees_usd_nearblocks / d('2026-04-01').near_fees_usd_nearblocks - 1) * 100)}`, 'daily.csv');
const nf = S.near_fees_usd_nearblocks;
out('L1 fees 30-day average, MoM', `${usd(nf.latest_30d_avg)}, ${sgn(nf.mom_pct)}`, 'near_fees_usd_nearblocks');
out('intents_txs 2025-07-05 and 2025-07-23..25', `${int(d('2025-07-05').intents_txs)}; ${['2025-07-23', '2025-07-24', '2025-07-25'].map((x) => int(d(x).intents_txs)).join(', ')}`, 'daily.csv');
out('  2025-07-04 / 2025-07-05 / 2025-07-06', ['2025-07-04', '2025-07-05', '2025-07-06'].map((x) => int(d(x).intents_txs)).join(' / '), 'daily.csv');
out('  2025-07-22 / 2025-07-23; 2025-07-25 / 2025-07-26', `${int(d('2025-07-22').intents_txs)} / ${int(d('2025-07-23').intents_txs)} (${(d('2025-07-23').intents_txs / d('2025-07-22').intents_txs).toFixed(1)}x); ${int(d('2025-07-25').intents_txs)} / ${int(d('2025-07-26').intents_txs)} (${(d('2025-07-25').intents_txs / d('2025-07-26').intents_txs).toFixed(1)}x)`, 'daily.csv');

head('Cross-checks');
const cc = m.near_fees_cross_check, bc = m.blocks_per_day_check;
out('L1 fees Nearblocks vs DefiLlama: total ratio', cc.total_ratio_nearblocks_over_defillama, 'near_fees_cross_check');
out('  daily gap: median absolute / p90 / max; days within 1%', `${cc.median_abs_rel_diff_pct}% / ${cc.p90_abs_rel_diff_pct}% / ${cc.max_abs_rel_diff_pct}%; ${p1(cc.share_of_days_within_1pct)}`, 'near_fees_cross_check');
out('  median of signed daily differences', `${cc.median_rel_diff_pct}%`, 'near_fees_cross_check.median_rel_diff_pct');
out('blocks per day: median abs diff, days over 2%', `${bc.median_abs_diff_pct}%, ${bc.flagged_over_2pct.map((x) => x.date).join(' ')}`, 'blocks_per_day_check');

head('Recent momentum: 30 days to window end vs the 30 days before (MoM)');
for (const k of Object.keys(S)) out(`  ${k}`, sgn(S[k].mom_pct), 'metrics.series.*.mom_pct');
