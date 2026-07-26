#!/usr/bin/env node
/**
 * bt-significance.js — statistical honesty check on the sell backtests.
 *
 * The sell backtests report 96–98% win and PF up to 194 over 20+ years. Those are
 * point estimates. This tool asks the questions a reviewer asks before trusting them:
 *   1. Is the yearly-mean 95% CI clear of zero? (bootstrap, 10k resamples)
 *   2. Any negative years? Where do the crisis years (2008 GFC, 2020 COVID) rank?
 *   3. Does the result survive dropping its best year? (tail / one-lucky-year check)
 *
 * READ-ONLY: consumes backtest-tv-sell-results-*.json, writes nothing, touches no
 * engine, no server, no state. Run:  node bt-significance.js
 *
 * Reproducible: fixed RNG seed (mulberry32) so anyone re-running gets identical CIs.
 */
const fs = require("fs");
const path = require("path");

const N_BOOT = 10000;
function mulberry32(a) {                       // tiny seeded PRNG -> reproducible bootstrap
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(12345);

const netOf = (v) => {
  if (v && typeof v === "object") {
    for (const k of ["netRs", "net", "pnl", "rs"]) if (k in v) return v[k];
    return null;
  }
  return typeof v === "number" ? v : null;
};

function bootCI(vals, n = N_BOOT) {
  const k = vals.length, means = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += vals[(rnd() * k) | 0];
    means.push(s / k);
  }
  means.sort((a, b) => a - b);
  const lo = means[(0.025 * n) | 0], hi = means[(0.975 * n) | 0];
  const pNeg = means.filter((m) => m <= 0).length / n;
  return { lo, hi, pNeg };
}

const rs = (x) => (x < 0 ? "-" : "+") + "Rs " + Math.abs(Math.round(x)).toLocaleString("en-IN");
const CRISIS = new Set(["2008", "2020"]);

function analyseFile(fp) {
  const d = JSON.parse(fs.readFileSync(fp, "utf8"));
  console.log("=".repeat(80));
  console.log(` ${d.instrument}  |  ${d.traded}/${d.expiries} expiries traded  |  ${d.dataSource}`);
  console.log("=".repeat(80));
  for (const it of d.results) {
    const yrs = Object.entries(it.byYear)
      .map(([y, v]) => [y, netOf(v)])
      .filter(([, v]) => v != null)
      .sort((a, b) => a[0].localeCompare(b[0]));
    const vals = yrs.map(([, v]) => v);
    const neg = yrs.filter(([, v]) => v < 0);
    const { lo, hi, pNeg } = bootCI(vals);
    const sorted = [...yrs].sort((a, b) => a[1] - b[1]);
    const best = sorted[sorted.length - 1];
    const total = vals.reduce((a, b) => a + b, 0);
    const dropBest = total - best[1];
    const crisisRanks = yrs
      .map(([y, v], _i) => ({ y, v, rank: sorted.findIndex((s) => s[0] === y) + 1 }))
      .filter((o) => CRISIS.has(o.y));

    console.log(`\n  ${it.kind}  | win ${it.winRate}%  PF ${it.pf}  net ${rs(it.netRs)}  worst-trade ${rs(it.worstRs)}`);
    console.log(`    years ${yrs.length} | NEGATIVE years: ${neg.length}` +
      (neg.length ? " -> " + neg.map(([y, v]) => `${y} ${rs(v)}`).join(", ") : " (none)"));
    console.log(`    worst 3 years: ` + sorted.slice(0, 3).map(([y, v]) => `${y} ${rs(v)}`).join(", "));
    if (crisisRanks.length)
      console.log(`    crisis years: ` + crisisRanks.map((o) =>
        `${o.y} ${rs(o.v)} (rank ${o.rank}/${yrs.length}${o.rank > yrs.length / 2 ? " = above median!" : ""})`).join(", "));
    console.log(`    yearly-mean 95% CI: [${rs(lo)} .. ${rs(hi)}]  P(mean<=0)=${(pNeg * 100).toFixed(1)}%  ` +
      (lo > 0 ? "CI EXCLUDES 0 ✓" : "CI INCLUDES 0 ✗"));
    console.log(`    drop best year -> total still ${rs(dropBest)}  (best year = ${(best[1] / total * 100).toFixed(0)}% of total)`);
  }
  console.log();
}

const files = ["nifty", "banknifty", "sensex"]
  .map((i) => path.join(__dirname, `backtest-tv-sell-results-${i}.json`))
  .filter((f) => fs.existsSync(f));

if (!files.length) { console.error("no backtest-tv-sell-results-*.json found"); process.exit(1); }
files.forEach(analyseFile);

console.log("-".repeat(80));
console.log("CAVEAT: yearly aggregates only (no per-trade P&L stored), so this is a coarse test.");
console.log("The deeper issue is the MODEL: 0-DTE selling on DAILY-resolution BS settlement cannot");
console.log("see the intraday gamma/gap tail that actually kills 0-DTE sellers. Zero losing years");
console.log("through 2008 & 2020 for naked short-vol is a RED flag (model blind to tail), not a green");
console.log("one. To see the real tail, re-run the sim on the 1-min data in bt-data/ and data/opt-candles/.");
