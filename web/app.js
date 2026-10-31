// Dashboard for the NEAR signing and settlement layer thesis.
// No framework. Loads data/derived/*.csv|json via fetch and draws inline SVG charts.
(function () {
  'use strict';

  // site/ layout (index.html at the root) versus repo-root layout (served at /web/); try the likelier one first to avoid a 404
  var BASES = /\/web\/(index\.html)?$/.test(location.pathname) ? ['../data/derived/', 'data/derived/'] : ['data/derived/', '../data/derived/'];
  var DAY = 86400000;
  var base = null;

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ms(d) { return Date.parse(d + 'T00:00:00Z'); }
  function addDays(d, n) { return new Date(ms(d) + n * DAY).toISOString().slice(0, 10); }
  function trim(s) { return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  function compact(v, dec) {
    var a = Math.abs(v), d = dec === undefined ? 2 : dec;
    if (a >= 1e9) return trim((v / 1e9).toFixed(d)) + 'B';
    if (a >= 1e6) return trim((v / 1e6).toFixed(d)) + 'M';
    if (a >= 1e3) return trim((v / 1e3).toFixed(a >= 1e5 ? 0 : 1)) + 'k';
    return trim(v.toFixed(a >= 100 ? 0 : d));
  }
  function full(v) { return Math.round(v).toLocaleString('en-US'); }
  function usd(v) { return '$' + compact(v); }
  function usdFull(v) { return '$' + full(v); }
  function pct1(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function sharePct(v) { return (v * 100).toFixed(1) + '%'; }
  function median(a) {
    var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length;
    if (!n) return null;
    return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }

  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    var head = rows.shift();
    return rows.filter(function (r) { return r.length === head.length; }).map(function (r) {
      var o = {};
      head.forEach(function (h, k) {
        var v = r[k];
        o[h] = v === '' ? null : (/^-?\d+(\.\d+)?$/.test(v) && h !== 'date' && h !== 'account' && h !== 'domain' ? Number(v) : v);
      });
      return o;
    });
  }

  function getText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.text();
    });
  }
  function detectBase() {
    var i = 0;
    function next() {
      if (i >= BASES.length) return Promise.reject(new Error('Could not find data/derived/metrics.json (tried ' + BASES.join(', ') + '). Serve the repository root with a static server, e.g. node scripts/serve.mjs'));
      var b = BASES[i++];
      return fetch(b + 'metrics.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) return next();
        return r.text().then(function (t) { try { JSON.parse(t); base = b; } catch (e) { return next(); } });
      }, next);
    }
    return next();
  }

  // ---------------------------------------------------------------- charts
  var charts = [];
  var lastW = 0;

  function niceStep(max) {
    var raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), m = [1, 2, 2.5, 5, 10], k;
    for (k = 0; k < m.length; k++) if (raw <= m[k] * p) return m[k] * p;
    return 10 * p;
  }

  function lowerBound(pts, x) {
    var lo = 0, hi = pts.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (pts[mid][0] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function nearest(pts, x) {
    if (!pts.length) return null;
    var i = lowerBound(pts, x), a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i)];
    return Math.abs(a[0] - x) <= Math.abs(b[0] - x) ? a : b;
  }

  function draw(el, cfg) {
    var W = Math.max(280, Math.floor(el.clientWidth - 8));
    var H = cfg.h || (W < 520 ? 210 : 250);
    var yFmt = cfg.yFmt || compact;
    var tipFmt = cfg.tipFmt || full;
    var series = cfg.series.filter(function (s) { return s.pts.length; });
    var xmin = Infinity, xmax = -Infinity, ymax = 0, s, k;
    series.forEach(function (s) {
      s.pts.forEach(function (p) { if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0]; if (p[1] > ymax) ymax = p[1]; });
    });
    if (cfg.x) { xmin = cfg.x[0]; xmax = cfg.x[1]; }
    (cfg.refs || []).forEach(function (r) { if (r.y > ymax) ymax = r.y; });
    if (!isFinite(xmin) || ymax <= 0) { el.innerHTML = '<p class="fine" style="padding:8px">No data.</p>'; return; }
    if (cfg.ymax) ymax = Math.max(ymax, cfg.ymax);
    var step = niceStep(ymax * 1.02), top = Math.ceil(ymax * 1.02 / step) * step;
    var ml = 8 + Math.max.apply(null, [0, top].concat([step, step * 2, step * 3]).map(function (v) { return yFmt(v).length; })) * 6.3;
    var mr = 10, mt = 10, mb = 22, pw = W - ml - mr, ph = H - mt - mb;
    function X(x) { return ml + (xmax === xmin ? pw / 2 : (x - xmin) / (xmax - xmin) * pw); }
    function Y(y) { return mt + ph - y / top * ph; }

    var o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.title || '') + '">'];
    for (var v = 0; v <= top + step / 1000; v += step) {
      o.push('<line class="gl" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>');
      o.push('<text x="' + (ml - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + esc(yFmt(v)) + '</text>');
    }
    o.push('<line class="ax" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (mt + ph) + '" y2="' + (mt + ph) + '"/>');
    // x ticks: first of month, step chosen by width
    var spanMonths = (xmax - xmin) / (DAY * 30.4), want = Math.max(2, Math.floor(pw / 78)), stepM = [1, 2, 3, 6, 12].filter(function (m) { return spanMonths / m <= want; })[0] || 12;
    var d0 = new Date(xmin), y0 = d0.getUTCFullYear(), m0 = d0.getUTCMonth() + (d0.getUTCDate() > 1 ? 1 : 0), last = -1e9;
    for (k = 0; k < 400; k++) {
      var t = Date.UTC(y0, m0 + k, 1);
      if (t > xmax) break;
      if (new Date(t).getUTCMonth() % stepM !== 0 && stepM > 1) continue;
      var x = X(t);
      if (x - last < 56 || x < ml + 14 || x > W - mr - 14) continue;
      last = x;
      o.push('<line class="ax" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (mt + ph) + '" y2="' + (mt + ph + 4) + '"/>');
      o.push('<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + new Date(t).toISOString().slice(0, 7) + '</text>');
    }
    (cfg.refs || []).forEach(function (r) {
      o.push('<line class="ref" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(r.y).toFixed(1) + '" y2="' + Y(r.y).toFixed(1) + '"/>');
      o.push('<text class="reft" x="' + (ml + 4) + '" y="' + (Y(r.y) - 4).toFixed(1) + '">' + esc(r.label) + '</text>');
    });
    series.forEach(function (s) {
      var d = s.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('');
      o.push('<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.w || 1.8) + '" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + (s.op ? ' opacity="' + s.op + '"' : '') + '/>');
      if (s.dots) s.pts.forEach(function (p) { o.push('<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.4" fill="' + s.color + '"/>'); });
    });
    o.push('<line class="cur" id="cur" x1="0" x2="0" y1="' + mt + '" y2="' + (mt + ph) + '" style="display:none"/>');
    o.push('<rect x="' + ml + '" y="' + mt + '" width="' + pw + '" height="' + ph + '" fill="transparent" id="hit"/>');
    o.push('</svg>');
    var legend = series.filter(function (s) { return s.label; }).map(function (s) {
      return '<span><i class="' + (s.w && s.w < 1.2 ? 'thin ' : '') + (s.dash ? 'dash' : '') + '" style="border-color:' + s.color + (s.op ? ';opacity:' + s.op : '') + '"></i>' + esc(s.label) + '</span>';
    }).join('');
    el.innerHTML = o.join('') + '<div class="legend">' + legend + '</div><div class="tip"></div>';

    var svg = el.querySelector('svg'), cur = svg.querySelector('#cur'), hit = svg.querySelector('#hit'), tip = el.querySelector('.tip');
    function move(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      var xv = xmin + Math.max(0, Math.min(1, (px - ml) / pw)) * (xmax - xmin);
      var tol = cfg.tol || 2.6 * DAY, lines = [], best = null;
      series.forEach(function (s) {
        var p = nearest(s.pts, xv);
        if (p && Math.abs(p[0] - xv) <= tol) {
          lines.push('<span style="color:' + s.color + '">&#9632;</span> ' + esc(s.label || 'value') + ': ' + esc((s.tipFmt || tipFmt)(p[1])));
          if (!best || Math.abs(p[0] - xv) < Math.abs(best - xv)) best = p[0];
        }
      });
      if (!lines.length) { tip.style.display = 'none'; cur.style.display = 'none'; return; }
      var cx = X(best);
      cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.style.display = '';
      tip.innerHTML = '<b>' + new Date(best).toISOString().slice(0, 10) + '</b><br>' + lines.join('<br>');
      tip.style.display = 'block';
      var scale = r.width / W, tx = cx * scale;
      var wr = el.getBoundingClientRect(), off = r.left - wr.left;
      tip.style.top = '8px';
      tip.style.left = (tx + off + (tx > r.width * 0.6 ? -tip.offsetWidth - 10 : 10)) + 'px';
    }
    function leave() { tip.style.display = 'none'; cur.style.display = 'none'; }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  // grouped bars: cfg = {title, cats:[label], groups:[{label,color,vals:[n|null]}], yFmt}
  function drawGroups(el, cfg) {
    var W = Math.max(280, Math.floor(el.clientWidth - 8)), H = W < 520 ? 230 : 270, yFmt = cfg.yFmt || compact;
    var ymax = 0;
    cfg.groups.forEach(function (g) { g.vals.forEach(function (v) { if (v > ymax) ymax = v; }); });
    var step = niceStep(ymax * 1.02), top = Math.ceil(ymax * 1.02 / step) * step;
    var ml = 8 + yFmt(top).length * 6.3, mr = 8, mt = 10, mb = 44, pw = W - ml - mr, ph = H - mt - mb, n = cfg.cats.length;
    var slot = pw / n, gw = Math.max(1.5, slot * 0.8 / cfg.groups.length);
    function Y(y) { return mt + ph - y / top * ph; }
    var o = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.title) + '">'];
    for (var v = 0; v <= top + step / 1000; v += step) {
      o.push('<line class="gl" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text x="' + (ml - 5) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + esc(yFmt(v)) + '</text>');
    }
    var every = Math.ceil(n / Math.max(2, Math.floor(pw / 46)));
    cfg.cats.forEach(function (c, i) {
      var x0 = ml + i * slot + slot * 0.1;
      cfg.groups.forEach(function (g, k) {
        var val = g.vals[i];
        if (val === null || val === undefined) return;
        o.push('<rect x="' + (x0 + k * gw).toFixed(1) + '" y="' + Y(val).toFixed(1) + '" width="' + (gw - 0.6).toFixed(1) + '" height="' + Math.max(0, mt + ph - Y(val)).toFixed(1) + '" fill="' + g.color + '"><title>' + esc(c + ' ' + g.label + ': ' + usdFull(val)) + '</title></rect>');
      });
      if (i % every === 0) o.push('<text transform="translate(' + (ml + i * slot + slot / 2).toFixed(1) + ' ' + (H - 6) + ') rotate(-40)" text-anchor="end">' + esc(c) + '</text>');
    });
    o.push('<line class="ax" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + (mt + ph) + '" y2="' + (mt + ph) + '"/></svg>');
    el.innerHTML = o.join('') + '<div class="legend">' + cfg.groups.map(function (g) { return '<span><i style="border-color:' + g.color + '"></i>' + esc(g.label) + '</span>'; }).join('') + '</div>';
  }

  function addChart(id, cfg, fn) {
    var el = $(id);
    charts.push([el, cfg, fn || draw]);
    (fn || draw)(el, cfg);
  }
  function redrawAll() {
    var w = document.body.clientWidth;
    if (w === lastW) return;
    lastW = w;
    charts.forEach(function (c) { c[2](c[0], c[1]); });
  }

  function pts(rows, key) {
    var out = [];
    rows.forEach(function (r) { if (r[key] !== null && r[key] !== undefined) out.push([ms(r.date), r[key]]); });
    return out;
  }

  // ---------------------------------------------------------------- bars
  function bars(id, items, cls) {
    $(id).innerHTML = items.map(function (it) {
      return '<div class="bar"><div class="n">' + esc(it.name) + (it.tag ? '<span class="tag">' + esc(it.tag) + '</span>' : '') + '</div><div class="p">' + esc(it.label) + '</div><div class="t"><b class="' + (it.cls || cls || '') + '" style="width:' + Math.max(0.5, it.share * 100).toFixed(1) + '%"></b></div></div>';
    }).join('');
  }

  // ---------------------------------------------------------------- caller classes
  function callerClass(a) {
    if (a === 'fast-auth.near') return 'native';
    if (a === 'omni.bridge.near' || /\.bridge\.near$/.test(a) || a.indexOf('connector') >= 0) return 'bridge';
    return 'other';
  }
  var CLASS_TAG = { native: 'NEAR-native fast-auth', bridge: 'bridge / connector', other: '' };
  var CLASS_CLS = { native: 'b3', bridge: 'b2', other: '' };

  // ---------------------------------------------------------------- main
  function stamp(id, text) { var e = $(id); if (e) e.textContent = 'data as of ' + text; }

  function tileHtml(label, s, f) {
    var yoy = s.yoy_pct, mom = s.mom_pct, vp = s.latest_vs_peak_pct;
    function d(l, v, extra) {
      if (v === null || v === undefined) return '<div class="d"><span class="l">' + l + '</span> <span class="na">n/a</span></div>';
      return '<div class="d"><span class="l">' + l + '</span> <span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + (v >= 0 ? '&#9650; ' : '&#9660; ') + esc(pct1(v)) + '</span>' + (extra ? ' <span class="l">' + esc(extra) + '</span>' : '') + '</div>';
    }
    return '<div class="tile"><div class="k">' + esc(label) + ' (30-day avg)</div><div class="v">' + esc(f(s.latest_30d_avg)) + '</div>' +
      d('YoY', yoy, 'base ' + f(s.avg_30d_ending_364d_earlier)) + d('MoM', mom) + d('vs peak', vp, s.peak_30d_avg_date) +
      '<div class="fine">30 days to ' + esc(s.window_end) + '</div></div>';
  }

  function run() {
    return detectBase().then(function () {
      var files = ['daily.csv', 'rolling30.csv', 'sample_daily.csv', 'sample_callers.csv', 'sample_domains.csv', 'monthly.csv'];
      return Promise.all([
        getText(base + 'metrics.json').then(JSON.parse),
        fetch('signals.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : { signals: [] }; }).catch(function () { return { signals: [] }; })
      ].concat(files.map(function (f) { return getText(base + f).then(parseCsv); })));
    }).then(function (r) {
      render({ m: r[0], sig: r[1], daily: r[2], roll: r[3], sd: r[4], callers: r[5], domains: r[6], monthly: r[7] });
    });
  }

  function render(D) {
    var m = D.m, S = m.series, end = m.window.end, sm = m.sample;
    var X0 = ms(D.daily[0].date), X1 = ms(D.daily[D.daily.length - 1].date);
    var C = { c1: 'var(--c1)', c2: 'var(--c2)', c3: 'var(--c3)', c4: 'var(--c4)', faint: 'var(--faint)' };

    $('asof').textContent = 'Data as of ' + end + ' (last complete UTC day). Sampled-hour data as of ' + sm.last_day + '. Raw files fetched ' +
      Object.keys(m.raw_provenance).map(function (k) { return m.raw_provenance[k].fetched_at.slice(0, 10); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + '.';
    ['signing', 'settlement', 'classic'].forEach(function (k) { stamp('stamp-' + k, end); });
    stamp('stamp-who', sm.last_day + ' (sample)');
    stamp('stamp-signals', end);
    $('prov').textContent = 'Page built from data/derived (window ' + m.window.start + ' to ' + end + '); each metric in metrics.json lists its raw sources and method.';

    // a. tiles
    $('tiles').innerHTML = [
      tileHtml('v1.signer txs/day', S.signer_txs, full),
      tileHtml('Intents volume USD/day', S.intents_volume_usd, usd),
      tileHtml('NEAR L1 fees USD/day', S.near_fees_usd_nearblocks, usdFull),
      tileHtml('NEAR daily active accounts', S.active_accounts, full)
    ].join('');

    // b. signing
    var sp = S.signer_txs;
    addChart('ch-signer', {
      title: 'Daily v1.signer transactions', x: [X0, X1],
      series: [
        { label: 'daily', pts: pts(D.daily, 'signer_txs'), color: C.faint, w: 1 },
        { label: '30-day average', pts: pts(D.roll, 'signer_txs_30d'), color: C.c1, w: 2.2 }
      ],
      refs: [{ y: sp.peak_30d_avg, label: 'peak 30-day avg ' + full(sp.peak_30d_avg) + ' (' + sp.peak_30d_avg_date + ')' }]
    });
    var mix = sm.primary_v1_signer_method_mix;
    var respondS = mix.respond ? mix.respond.share : null, signS = mix.sign ? mix.sign.share : null;
    var zeros = D.daily.filter(function (r) { return r.signer_txs === 0; }).map(function (r) { return r.date; });
    $('signer-note').innerHTML = 'Not all of this is user-driven signing. In the sampled hours, <b>' + (respondS !== null ? sharePct(respondS) : 'n/a') + '</b> of decoded transactions are MPC node <code>respond</code> calls and <b>' + (signS !== null ? sharePct(signS) : 'n/a') + '</b> are <code>sign</code> requests, so user-driven signing is roughly half of the series (one hour per sampled day, see "Who signs"). ' +
      (zeros.length ? 'Days with exactly 0 transactions in the daily series: ' + esc(zeros.join(', ')) + ' (not investigated; could be real or a provider gap).' : '');
    addChart('ch-shares', {
      title: 'Sign and respond share of sampled hour', x: [ms(D.sd[0].date), ms(D.sd[D.sd.length - 1].date)], ymax: 0.6, yFmt: function (v) { return Math.round(v * 100) + '%'; }, tipFmt: sharePct,
      series: [
        { label: 'sign share', pts: pts(D.sd, 'sign_share'), color: C.c1, w: 1.8, dots: true },
        { label: 'respond share', pts: pts(D.sd, 'respond_share'), color: C.c2, w: 1.8, dots: true }
      ]
    });

    // c. settlement
    var fromVol = ms('2024-12-10');
    addChart('ch-vol', {
      title: 'Intents daily volume USD', x: [X0, X1], yFmt: usd, tipFmt: usdFull,
      series: [
        { label: 'daily', pts: pts(D.daily, 'intents_volume_usd'), color: C.faint, w: 1 },
        { label: '30-day average', pts: pts(D.roll, 'intents_volume_usd_30d'), color: C.c2, w: 2.2 }
      ]
    });
    addChart('ch-ifees', {
      title: 'Intents daily fees USD', x: [X0, X1], yFmt: usd, tipFmt: usdFull,
      series: [
        { label: 'daily', pts: pts(D.daily, 'intents_fees_usd'), color: C.faint, w: 1 },
        { label: '30-day average', pts: pts(D.roll, 'intents_fees_usd_30d'), color: C.c2, w: 2.2 }
      ]
    });
    two('ch-rev', 'Intents revenue captured by NEAR, USD per day', 'intents_revenue_usd', C.c3, usd, usdFull);
    addChart('ch-itx', {
      title: 'Daily intents.near transactions', x: [X0, X1],
      series: [
        { label: 'daily', pts: pts(D.daily, 'intents_txs'), color: C.faint, w: 1 },
        { label: '30-day average', pts: pts(D.roll, 'intents_txs_30d'), color: C.c4, w: 2.2 }
      ]
    });
    void fromVol;

    // d. classic
    function two(id, title, key, color, yFmt, tipF) {
      addChart(id, {
        title: title, x: [X0, X1], yFmt: yFmt, tipFmt: tipF,
        series: [
          { label: 'daily', pts: pts(D.daily, key), color: C.faint, w: 1 },
          { label: '30-day average', pts: pts(D.roll, key + '_30d'), color: color, w: 2.2 }
        ]
      });
    }
    two('ch-txns', 'NEAR transactions per day', 'near_txns', C.c1, compact, full);
    two('ch-active', 'Daily active accounts', 'active_accounts', C.c1, compact, full);
    two('ch-new', 'New accounts per day', 'new_accounts', C.c1, compact, full);
    addChart('ch-fees', {
      title: 'NEAR L1 fees USD per day, two sources', x: [X0, X1], yFmt: usd, tipFmt: usdFull,
      series: [
        { label: 'Nearblocks daily', pts: pts(D.daily, 'near_fees_usd_nearblocks'), color: C.faint, w: 1 },
        { label: 'Nearblocks 30d avg', pts: pts(D.roll, 'near_fees_usd_nearblocks_30d'), color: C.c1, w: 2.2 },
        { label: 'DefiLlama 30d avg', pts: pts(D.roll, 'near_fees_usd_defillama_30d'), color: C.c2, w: 1.6, dash: '5 3' }
      ]
    });
    var cc = m.near_fees_cross_check;
    if (cc && cc.median_rel_diff_pct !== null) $('fee-agree').textContent = Math.abs(cc.median_rel_diff_pct) + '% (' + cc.days_compared + ' days; p90 of daily gaps ' + cc.p90_abs_rel_diff_pct + '%, max ' + cc.max_abs_rel_diff_pct + '%)';
    var aa = S.active_accounts, firstRoll = D.roll[0];
    var last30 = D.daily.slice(-30).slice().sort(function (a, b) { return b.near_fees_usd_nearblocks - a.near_fees_usd_nearblocks; }).slice(0, 3);
    var med30 = median(D.daily.slice(-30).map(function (r) { return r.near_fees_usd_nearblocks; }));
    $('classic-note').innerHTML = 'Counter-evidence in numbers: the 30-day average of daily active accounts was ' + full(firstRoll.active_accounts_30d) + ' on ' + firstRoll.date + ' and is ' + full(aa.latest_30d_avg) + ' on ' + end + ' (' + pct1(aa.latest_vs_peak_pct) + ' versus its peak). NEAR transactions per day: ' + compact(S.near_txns.avg_30d_ending_364d_earlier) + ' a year earlier, ' + compact(S.near_txns.latest_30d_avg) + ' now (' + pct1(S.near_txns.yoy_pct) + ' YoY). ' +
      'The L1 fee 30-day average (' + usdFull(S.near_fees_usd_nearblocks.latest_30d_avg) + '/day, ' + pct1(S.near_fees_usd_nearblocks.mom_pct) + ' MoM) is lifted by a few spike days (' + last30.map(function (r) { return r.date + ' ' + usdFull(r.near_fees_usd_nearblocks); }).join(', ') + '); the median day of the last 30 is ' + usdFull(med30) + '. Read the MoM tile with that in mind. Data oddity: NEAR transactions and L1 fees both fall about 75% in one step between 2026-04-01 and 2026-04-02 (transactions 3.76M to 1.06M, fees $2,332 to $884) while active accounts do not move, which looks like a protocol or counting change rather than a collapse in users; the cause was not investigated, so year-over-year transaction and fee comparisons across that date are weaker evidence.';

    // e. who signs
    $('sample-caveat').innerHTML = 'Sampling caveat: one fixed UTC hour (' + esc(sm.window_utc) + '), every second day, last 90 complete days (' + sm.sampled_days + ' days, ' + esc(sm.first_day) + ' to ' + esc(sm.last_day) + ', ' + full(sm.total_decoded_txs) + ' decoded transactions). Shares describe that hour only and single large callers can bias them. Distinct callers are lower bounds per hour; do not scale them to a day.';
    var mixItems = Object.keys(mix).slice(0, 8).map(function (k) { return { name: k, share: mix[k].share, label: sharePct(mix[k].share) + ' (' + full(mix[k].count) + ')' }; });
    bars('bars-method', mixItems);

    var dom = {}, domTot = 0;
    D.domains.forEach(function (r) { dom[r.domain] = (dom[r.domain] || 0) + r.sign_calls; domTot += r.sign_calls; });
    bars('bars-domain', Object.keys(dom).sort(function (a, b) { return dom[b] - dom[a]; }).map(function (k) {
      return { name: /^\d+$/.test(k) ? 'domain_id ' + k : k, share: dom[k] / domTot, label: sharePct(dom[k] / domTot) + ' (' + full(dom[k]) + ')' };
    }), 'b2');

    var cal = {}, calTot = 0;
    D.callers.forEach(function (r) { if (r.role === 'sign_caller_predecessor') { cal[r.account] = (cal[r.account] || 0) + r.count; calTot += r.count; } });
    var names = Object.keys(cal).sort(function (a, b) { return cal[b] - cal[a] || (a < b ? -1 : 1); });
    bars('bars-callers', names.slice(0, 12).map(function (a) {
      var c = callerClass(a);
      return { name: a, tag: CLASS_TAG[c], cls: CLASS_CLS[c], share: cal[a] / calTot, label: sharePct(cal[a] / calTot) + ' (' + full(cal[a]) + ')' };
    }));
    $('bars-callers').insertAdjacentHTML('beforeend', '<div class="fine">' + names.length + ' distinct sign callers across the sample; top 12 shown. Green = fast-auth.near, orange = bridge or connector contracts (omni.bridge.near, *.bridge.near, *connector*), blue = other.</div>');
    addChart('ch-callers', {
      title: 'Distinct sign callers per sampled hour', x: [ms(D.sd[0].date), ms(D.sd[D.sd.length - 1].date)], yFmt: function (v) { return String(Math.round(v * 10) / 10); }, tipFmt: function (v) { return String(v); },
      series: [{ label: 'distinct sign callers in the sampled hour', pts: pts(D.sd, 'distinct_sign_callers'), color: C.c3, w: 1.8, dots: true }]
    });

    // value capture
    var mo = D.monthly.filter(function (r) { return r.month >= '2025-05'; });
    var ir = S.intents_revenue_usd, nf = S.near_fees_usd_nearblocks;
    addChart('ch-capture', {
      title: 'Intents revenue to NEAR versus NEAR L1 fees per month',
      cats: mo.map(function (r) { return r.month; }),
      groups: [
        { label: 'Intents revenue captured by NEAR', color: C.c3, vals: mo.map(function (r) { return r.intents_revenue_usd; }) },
        { label: 'NEAR L1 fees (Nearblocks)', color: C.c1, vals: mo.map(function (r) { return r.near_fees_usd_nearblocks; }) }
      ], yFmt: usd
    }, drawGroups);
    stamp('stamp-capture', end);
    $('capture-note').innerHTML = '30-day averages to ' + esc(end) + ': Intents revenue to NEAR <b>' + usdFull(ir.latest_30d_avg) + '/day</b> (' + pct1(ir.mom_pct) + ' MoM, ' + pct1(ir.latest_vs_peak_pct) + ' versus peak ' + usdFull(ir.peak_30d_avg) + ' on ' + esc(ir.peak_30d_avg_date) + ') versus L1 fees <b>' + usdFull(nf.latest_30d_avg) + '/day</b>, a ratio of ' + (ir.latest_30d_avg / nf.latest_30d_avg).toFixed(1) + 'x. Revenue is near zero until 2025-11 and is lumpy month to month; the last month in the chart (' + esc(mo[mo.length - 1].month) + ') covers ' + mo[mo.length - 1].days + ' days. Revenue is DefiLlama net revenue (the amount swept to NEAR revenue wallets), a different definition from L1 transaction fees.';

    // f. signals
    var cutoff = ms(addDays(sm.last_day, -29));
    var sdWin = D.sd.filter(function (r) { return ms(r.date) >= cutoff; });
    var calWin = D.callers.filter(function (r) { return r.role === 'sign_caller_predecessor' && ms(r.date) >= cutoff; });
    var cls = { native: 0, bridge: 0, other: 0 }, tot = 0;
    calWin.forEach(function (r) { cls[callerClass(r.account)] += r.count; tot += r.count; });
    var allCls = { native: 0, bridge: 0, other: 0 };
    names.forEach(function (a) { allCls[callerClass(a)] += cal[a]; });
    var med2 = median(sdWin.map(function (r) { return r.distinct_sign_callers; }));
    var cur = {
      S1: { v: sp.latest_30d_avg / sp.peak_30d_avg, text: sharePct(sp.latest_30d_avg / sp.peak_30d_avg) + ' of peak', detail: full(sp.latest_30d_avg) + ' txs/day now versus peak ' + full(sp.peak_30d_avg) + ' on ' + sp.peak_30d_avg_date + ' (' + pct1(sp.latest_vs_peak_pct) + ')' },
      S2: { v: med2, text: med2 === null ? 'n/a' : String(med2), detail: sdWin.length + ' sampled hours, ' + addDays(sm.last_day, -29) + ' to ' + sm.last_day + '; whole sample median ' + sm.distinct_sign_callers_per_sampled_hour.median + ' (min ' + sm.distinct_sign_callers_per_sampled_hour.min + ', max ' + sm.distinct_sign_callers_per_sampled_hour.max + ')' },
      S3: { v: tot ? cls.bridge / tot : null, text: tot ? sharePct(cls.bridge / tot) + ' bridge / connector' : 'n/a', detail: tot ? 'fast-auth.near ' + sharePct(cls.native / tot) + ', other ' + sharePct(cls.other / tot) + ' (' + full(tot) + ' sign calls in the same 30 days). Whole sample: bridge ' + sharePct(allCls.bridge / calTot) + ', fast-auth ' + sharePct(allCls.native / calTot) : '' },
      S4: { v: S.intents_volume_usd.latest_30d_avg, text: usdFull(S.intents_volume_usd.latest_30d_avg) + '/day', detail: pct1(S.intents_volume_usd.mom_pct) + ' MoM, ' + pct1(S.intents_volume_usd.latest_vs_peak_pct) + ' versus peak ' + usd(S.intents_volume_usd.peak_30d_avg) + ' (' + S.intents_volume_usd.peak_30d_avg_date + ')' },
      S5: { v: S.near_fees_usd_nearblocks.latest_30d_avg, text: usdFull(S.near_fees_usd_nearblocks.latest_30d_avg) + '/day', detail: pct1(S.near_fees_usd_nearblocks.yoy_pct) + ' YoY, ' + pct1(S.near_fees_usd_nearblocks.mom_pct) + ' MoM (spike-driven, see Classic L1 section)' },
      S7: { v: ir.latest_30d_avg, text: usdFull(ir.latest_30d_avg) + '/day', detail: pct1(ir.mom_pct) + ' MoM, ' + pct1(ir.latest_vs_peak_pct) + ' versus peak ' + usd(ir.peak_30d_avg) + ' (' + ir.peak_30d_avg_date + '); ' + (ir.latest_30d_avg / nf.latest_30d_avg).toFixed(1) + 'x L1 fees (S5)' },
      S6: { v: aa.latest_30d_avg, text: full(aa.latest_30d_avg) + '/day', detail: pct1(aa.yoy_pct) + ' YoY, ' + pct1(aa.latest_vs_peak_pct) + ' versus peak ' + full(aa.peak_30d_avg) + ' (' + aa.peak_30d_avg_date + ')' }
    };
    var rows = (D.sig.signals || []).map(function (s) {
      var c = cur[s.id] || { v: null, text: 'n/a', detail: '' };
      var th = s.threshold, status = 'Threshold pending';
      if (th !== null && th !== undefined && c.v !== null && s.supports_if) {
        var ok = s.supports_if === 'above' ? c.v >= th : c.v <= th;
        status = ok ? 'Supports thesis' : 'Does not support thesis';
      }
      var thText = th === null || th === undefined ? '<span class="na">not set</span>' : esc(String(th)) + (s.supports_if ? ' <span class="na">(supports if ' + esc(s.supports_if) + ')</span>' : '');
      return '<tr><td><b>' + esc(s.id) + '</b></td><td>' + esc(s.label) + '<div class="fine">' + esc(s.metric) + '</div></td><td class="num"><b>' + esc(c.text) + '</b></td><td>' + esc(c.detail) + '</td><td>' + thText + '<div class="fine">' + esc(s.note || '') + '</div></td><td>' + esc(status) + '</td></tr>';
    });
    document.querySelector('#sigtable tbody').innerHTML = rows.join('');
    redrawAll();
  }

  run().catch(function (e) {
    $('asof').textContent = 'Data failed to load.';
    $('error').innerHTML = '<div class="err">' + esc(e.message) + '</div>';
    if (window.console) console.error(e);
  });

  var rt = null;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(redrawAll, 120); });
})();
