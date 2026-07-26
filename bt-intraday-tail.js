#!/usr/bin/env node
/**
 * bt-intraday-tail.js — the test the 20-year daily backtest cannot do.
 *
 * The daily-resolution 0-DTE sell backtest only sees open credit -> close/settlement.
 * It is BLIND to what happens INTRADAY, where a 2.5x stop actually fires and a real
 * short-vol seller takes the loss. This tool replays the REAL 1-min option premiums we
 * have (data/opt-candles/*.json) and compares, per day:
 *
 *    DAILY model P&L  = credit - premium at close        (what the big backtest counts)
 *    INTRADAY P&L     = if a short leg's 1-min HIGH hits stopMult x entry, exit there
 *
 * The gap between them is the tail the 20-year backtest hides.
 *
 * READ-ONLY: reads data/opt-candles only. No engine, no server, no state, no orders.
 * Run:  node bt-intraday-tail.js
 */
const fs = require("fs");
const path = require("path");

const STOP_MULT = 2.5;                          // match the daily backtest's stopMult
const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };
const DIR = path.join(__dirname, "data", "opt-candles");
const rs = (x) => (x < 0 ? "-" : "+") + "Rs " + Math.abs(Math.round(x)).toLocaleString("en-IN");

function legMap(candles) {                       // [[ts,o,h,l,c],...] -> {ts:{h,c}}, sorted ts
  const m = new Map();
  for (const k of candles) m.set(k[0], { h: k[2], c: k[4] });
  return m;
}

function analyseDay(fp) {
  const day = JSON.parse(fs.readFileSync(fp, "utf8"));
  const ser = day.series || {};
  // group strikes by index: SYMBOL|STRIKE|CE/PE
  const byIdx = {};
  for (const key of Object.keys(ser)) {
    const [sym, strike, opt] = key.split("|");
    if (!LOT[sym]) continue;
    (byIdx[sym] ||= {});
    (byIdx[sym][strike] ||= {})[opt] = ser[key];
  }
  const out = [];
  for (const sym of Object.keys(byIdx)) {
    const strikes = byIdx[sym];
    // ATM = strike whose CE and PE open premiums are closest (put-call parity)
    let atm = null, best = Infinity;
    for (const st of Object.keys(strikes)) {
      const { CE, PE } = strikes[st];
      if (!CE || !PE || !CE.length || !PE.length) continue;
      const ceO = CE[0][1], peO = PE[0][1];
      if (ceO <= 0 || peO <= 0) continue;
      const d = Math.abs(ceO - peO);
      if (d < best) { best = d; atm = st; }
    }
    if (!atm) continue;
    const ce = strikes[atm].CE, pe = strikes[atm].PE;
    const ceEntry = ce[0][1], peEntry = pe[0][1];
    const credit = ceEntry + peEntry;                     // per share
    const ceM = legMap(ce), peM = legMap(pe);
    const times = [...new Set([...ceM.keys(), ...peM.keys()])].sort((a, b) => a - b);

    // walk intraday: first minute a short leg's HIGH >= stopMult x entry
    let stopTs = null, stopSide = null;
    for (const t of times) {
      const c = ceM.get(t), p = peM.get(t);
      if (c && c.h >= ceEntry * STOP_MULT) { stopTs = t; stopSide = "CE"; break; }
      if (p && p.h >= peEntry * STOP_MULT) { stopTs = t; stopSide = "PE"; break; }
    }
    const lastCe = ceM.get(times[times.length - 1]).c;
    const lastPe = peM.get(times[times.length - 1]).c;
    const dailyPL = (ceEntry - lastCe) + (peEntry - lastPe);   // per share, close exit

    let intraPL, note;
    if (stopTs) {
      // triggering leg fills at the stop level; the other leg exits at its price then
      const ceExit = stopSide === "CE" ? ceEntry * STOP_MULT : (ceM.get(stopTs) || { c: lastCe }).c;
      const peExit = stopSide === "PE" ? peEntry * STOP_MULT : (peM.get(stopTs) || { c: lastPe }).c;
      intraPL = (ceEntry - ceExit) + (peEntry - peExit);
      const hh = new Date(stopTs).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
      note = `STOPPED ${stopSide} @${hh}`;
    } else {
      intraPL = dailyPL;
      note = "no stop";
    }
    const lot = LOT[sym];
    out.push({ sym, atm, credit, dailyPL, intraPL, note,
               dailyRs: dailyPL * lot, intraRs: intraPL * lot, gapRs: (intraPL - dailyPL) * lot });
  }
  return { date: day.date, rows: out };
}

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
  : [];
if (!files.length) { console.error("no data/opt-candles/*.json"); process.exit(1); }

console.log("=".repeat(96));
console.log(` INTRADAY 0-DTE TAIL TEST — ATM short straddle, ${STOP_MULT}x stop | real 1-min premiums | ${files.length} days`);
console.log("=".repeat(96));
console.log(` ${"Date".padEnd(11)}${"Idx".padEnd(10)}${"ATM".padStart(7)}${"Credit".padStart(9)}` +
            `${"DailyModel".padStart(13)}${"Intraday".padStart(13)}${"Gap(tail)".padStart(13)}  Note`);

const agg = {};
for (const f of files) {
  const r = analyseDay(path.join(DIR, f));
  for (const row of r.rows) {
    console.log(` ${r.date.padEnd(11)}${row.sym.padEnd(10)}${row.atm.padStart(7)}` +
      `${Math.round(row.credit).toString().padStart(9)}${rs(row.dailyRs).padStart(13)}` +
      `${rs(row.intraRs).padStart(13)}${rs(row.gapRs).padStart(13)}  ${row.note}`);
    (agg[row.sym] ||= { daily: 0, intra: 0, stops: 0, n: 0 });
    agg[row.sym].daily += row.dailyRs; agg[row.sym].intra += row.intraRs;
    agg[row.sym].n++; if (row.note.startsWith("STOP")) agg[row.sym].stops++;
  }
}

console.log("-".repeat(96));
console.log(" TOTALS (what the daily model claims vs what intraday stops actually give):");
for (const sym of Object.keys(agg)) {
  const a = agg[sym];
  console.log(`   ${sym.padEnd(10)} days ${a.n}  stops ${a.stops}  |  DAILY ${rs(a.daily).padStart(13)}` +
    `   INTRADAY ${rs(a.intra).padStart(13)}   tail cost ${rs(a.intra - a.daily).padStart(13)}`);
}
console.log("-".repeat(96));
console.log(" Only ~9 real 1-min option days exist, so this is a DEMONSTRATION, not a full backtest.");
console.log(" But it shows directly: the daily model never sees the intraday stop. Every rupee of");
console.log(" 'tail cost' above is loss the 20-year backtest structurally cannot count.");
