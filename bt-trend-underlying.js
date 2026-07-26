/**
 * bt-trend-underlying.js — TRACK-A backtest: directional edge on the UNDERLYING.
 * ============================================================================
 * Tests the trend-ride strategy's DIRECTIONAL premise on real index 1-min data,
 * in REAL INDEX POINTS (no option/BSM modeling). This is the cheap, regime-robust
 * half — it answers "does the trigger→trend→bracket edge survive many years and
 * regimes?" It does NOT test option economics (that needs Track-B; see
 * docs/BACKTEST-DATA-PROCUREMENT.md and bt-trend-ride.js).
 *
 * Same decision logic + params as trend-ride-engine.js (shared DEFAULTS):
 *   trigger (coiled) → 60-min SMA trend filter → efficiency-ratio chop filter →
 *   asymmetric bracket exit (+target / -stop index pts) or EOD square-off.
 *
 * Data (either works):
 *   • bt-data/<inst>-1min.json  (existing: [iso,o,h,l,c,...] rows) — default
 *   • Track-A CSV via --dir=<path>: files with header datetime,open,high,low,close
 *     and one file per instrument named NIFTY*.csv / BANKNIFTY*.csv
 *
 * Usage:
 *   node bt-trend-underlying.js                      # bt-data JSON (198 days)
 *   node bt-trend-underlying.js --dir=./data/hist-index   # purchased 12-yr CSV
 */
const fs = require('fs'), path = require('path');
const { DEFAULTS } = require('./trend-ride-engine.js');   // single source of truth
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const DIR = arg('dir', '');
const LOOKBACK = 15, TREND_MA = 60, ER_WIN = 15, MIN_ER = 0.35;   // = engine defaults
const INSTS = ['NIFTY', 'BANKNIFTY'];

function loadJSON(inst) {
  const f = path.join(__dirname, 'bt-data', inst.toLowerCase() + '-1min.json');
  if (!fs.existsSync(f)) return null;
  const rows = JSON.parse(fs.readFileSync(f));
  const byDay = {};
  for (const r of rows) { const d = r[0].slice(0, 10); (byDay[d] = byDay[d] || []).push({ o: r[1], h: r[2], l: r[3], c: r[4] }); }
  return byDay;
}
function loadCSV(inst) {
  const files = fs.readdirSync(DIR).filter(f => new RegExp('^' + inst, 'i').test(f) && /\.csv$/i.test(f));
  if (!files.length) return null;
  const byDay = {};
  for (const file of files) {
    const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(',').map(s => s.trim().toLowerCase()); const c = n => head.indexOf(n);
    for (let i = 1; i < lines.length; i++) {
      const r = lines[i].split(','); const dt = r[c('datetime')]; if (!dt) continue;
      const d = dt.slice(0, 10);
      (byDay[d] = byDay[d] || []).push({ o: +r[c('open')], h: +r[c('high')], l: +r[c('low')], c: +r[c('close')] });
    }
  }
  return byDay;
}
const load = inst => DIR ? loadCSV(inst) : loadJSON(inst);

function run(inst, byDay, days) {
  const p = DEFAULTS[inst]; const out = [];
  for (const day of days) {
    const b = byDay[day]; if (!b || b.length < TREND_MA + 2) continue;
    let pos = null;
    for (let i = TREND_MA; i < b.length; i++) {
      const bar = b[i];
      if (pos) {
        const tgt = pos.dir > 0 ? pos.entry + p.target : pos.entry - p.target;
        const stp = pos.dir > 0 ? pos.entry - p.stop : pos.entry + p.stop;
        const hs = pos.dir > 0 ? bar.l <= stp : bar.h >= stp;
        const ht = pos.dir > 0 ? bar.h >= tgt : bar.l <= tgt;
        const eod = i === b.length - 1;
        if (hs) { out.push({ dir: pos.dir, net: -p.stop, day }); pos = null; }
        else if (ht) { out.push({ dir: pos.dir, net: +p.target, day }); pos = null; }
        else if (eod) { out.push({ dir: pos.dir, net: pos.dir > 0 ? bar.c - pos.entry : pos.entry - bar.c, day }); pos = null; }
        continue;
      }
      const move = bar.c - b[i - LOOKBACK].c;
      if (Math.abs(move) < p.trigger) continue;
      let hi = -1e9, lo = 1e9; for (let k = i - LOOKBACK; k <= i; k++) { hi = Math.max(hi, b[k].h); lo = Math.min(lo, b[k].l); }
      if ((hi - lo) > p.preRange + p.trigger) continue;
      const dir = move > 0 ? 1 : -1;
      // trend filter (SMA60)
      let s = 0; for (let k = i - TREND_MA + 1; k <= i; k++) s += b[k].c; const ma = s / TREND_MA;
      if (dir > 0 ? !(bar.c > ma) : !(bar.c < ma)) continue;
      // chop filter (efficiency ratio)
      const net = Math.abs(bar.c - b[i - ER_WIN].c); let pl = 0; for (let k = i - ER_WIN + 1; k <= i; k++) pl += Math.abs(b[k].c - b[k - 1].c);
      if ((pl > 0 ? net / pl : 0) < MIN_ER) continue;
      pos = { dir, entry: bar.c };
    }
  }
  return out;
}

function st(a) {
  const n = a.length; if (!n) return 'n 0';
  const w = a.filter(x => x.net > 0).length, s = a.reduce((z, x) => z + x.net, 0);
  const g = a.filter(x => x.net > 0).reduce((z, x) => z + x.net, 0), l = -a.filter(x => x.net < 0).reduce((z, x) => z + x.net, 0);
  return `n ${String(n).padStart(4)} · win ${(w / n * 100).toFixed(0)}% · avg ${(s / n >= 0 ? '+' : '') + (s / n).toFixed(1)} · PF ${l ? (g / l).toFixed(2) : '∞'} · tot ${s >= 0 ? '+' : ''}${s.toFixed(0)}`;
}

console.log('══════════════════════════════════════════════════════════════════════════');
console.log(` bt-trend-underlying · TRACK A (index points, no option modeling) · ${DIR || 'bt-data JSON'}`);
console.log('══════════════════════════════════════════════════════════════════════════');
const allTrades = [];
for (const inst of INSTS) {
  const byDay = load(inst); if (!byDay) { console.log(` ${inst}: no data`); continue; }
  const days = Object.keys(byDay).sort();
  const t = run(inst, byDay, days); t.forEach(x => x.inst = inst); allTrades.push(...t);
  const cut = Math.floor(days.length * 0.7);
  console.log(`\n──  ${inst}  (${days.length} days, ${days[0]} → ${days[days.length - 1]})  ──`);
  console.log('  ALL   :', st(t));
  console.log('  CALL  :', st(t.filter(x => x.dir > 0)));
  console.log('  PUT   :', st(t.filter(x => x.dir < 0)));
  console.log('  TRAIN :', st(run(inst, byDay, days.slice(0, cut))));
  console.log('  TEST  :', st(run(inst, byDay, days.slice(cut))), ' ← out-of-sample');
  // per-year regime breakdown — the key robustness view for a real-money decision
  const years = [...new Set(t.map(x => x.day.slice(0, 4)))].sort();
  if (years.length > 1) { console.log('  per-year (regime robustness):'); for (const y of years) console.log(`    ${y} :`, st(t.filter(x => x.day.slice(0, 4) === y))); }
}
console.log('\n──────────────────────────────────────────────────────────────────────────');
console.log(' NOTE: GROSS index points. This proves the DIRECTIONAL edge across regimes.');
console.log(' It does NOT prove option-net (theta+spread) — that is bt-trend-ride.js on');
console.log(' Track-B purchased option data. Buy Track A first; if the edge holds across');
console.log(' years here, Track B is worth buying to settle the real-money question.');
