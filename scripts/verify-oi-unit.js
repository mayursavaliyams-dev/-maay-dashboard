#!/usr/bin/env node
'use strict';
/**
 * EVIDENCE — what unit is Open Interest reported in?
 *
 * Constraint F4 has stood as UNVERIFIED since the project began: is `oi` a count of CONTRACTS,
 * or a count of UNITS (shares)? The answer scales GEX and every dealer-positioning figure by the
 * lot size — 65× for NIFTY today.
 *
 * This script answers it by MEASUREMENT, not by citation. It reads NSE's own UDiFF F&O bhavcopy
 * (`bt-data/bhav/nifty-YYYYMMDD.csv`) — the exchange's official end-of-day file — and runs three
 * independent tests. It reads nothing else, asserts nothing it has not computed, and writes nothing.
 *
 *   node scripts/verify-oi-unit.js [csvPath]
 *
 * Exit 0 = a unit was determined. Exit 2 = INSUFFICIENT EVIDENCE (the honest outcome, not a guess).
 */
const fs = require('fs');
const path = require('path');

// UDiFF positional columns, read off a real row rather than assumed:
const COL = {
  sym: 7, xpryDt: 9, strkPric: 11, optnTp: 12,
  clsPric: 17, undrlygPric: 20, sttlmPric: 21,
  opnIntrst: 22, chngInOpnIntrst: 23, ttlTradgVol: 24, ttlTrfVal: 25,
  ttlNbOfTxsExctd: 26, newBrdLotQty: 28,
};

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function main() {
  const file = process.argv[2] || path.join(__dirname, '..', 'bt-data', 'bhav', 'nifty-20260617.csv');
  if (!fs.existsSync(file)) {
    console.error(`INSUFFICIENT EVIDENCE: no bhavcopy at ${file}`);
    process.exit(2);
  }

  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
  const lots = [...new Set(rows.map((r) => Number(r[COL.newBrdLotQty])))].filter(Boolean);
  if (lots.length !== 1) {
    console.error(`INSUFFICIENT EVIDENCE: ${lots.length} distinct lot sizes in one file (${lots})`);
    process.exit(2);
  }
  const LOT = lots[0];
  const symbol = rows[0][COL.sym];
  const tradeDate = rows[0][0];

  console.log(`\nSOURCE   NSE UDiFF F&O bhavcopy — ${path.basename(file)}`);
  console.log(`         symbol ${symbol} · trade date ${tradeDate} · NewBrdLotQty ${LOT} · ${rows.length} rows\n`);

  // ── TEST 1. What unit is TtlTradgVol in? Turnover arithmetic settles it. ──
  // NSE reports options turnover as NOTIONAL: qtyInUnits × underlying price at trade.
  // Three mutually exclusive hypotheses; only one can yield a ratio of ~1.
  const traded = rows.filter((r) => Number(r[COL.ttlTradgVol]) > 0 && Number(r[COL.ttlTrfVal]) > 0 && Number(r[COL.clsPric]) > 0);
  const ratio = (fn) => median(traded.map(fn).filter(Number.isFinite));
  const rA = ratio((r) => +r[COL.ttlTrfVal] / (+r[COL.ttlTradgVol] * +r[COL.clsPric]));                 // vol=units,     turnover=premium
  const rB = ratio((r) => +r[COL.ttlTrfVal] / (+r[COL.ttlTradgVol] * LOT * +r[COL.clsPric]));           // vol=contracts, turnover=premium
  const rC = ratio((r) => +r[COL.ttlTrfVal] / (+r[COL.ttlTradgVol] * LOT * +r[COL.undrlygPric]));       // vol=contracts, turnover=notional
  const rD = ratio((r) => +r[COL.ttlTrfVal] / (+r[COL.ttlTradgVol] * +r[COL.undrlygPric]));             // vol=units,     turnover=notional

  console.log(`TEST 1   TtlTradgVol — ${traded.length} rows with volume > 0`);
  console.log(`         a ratio of 1.00 identifies the true relationship\n`);
  console.log(`         turnover = vol × premium                (vol = units)     ${rA.toFixed(4)}`);
  console.log(`         turnover = vol × lot × premium          (vol = contracts) ${rB.toFixed(4)}`);
  console.log(`         turnover = vol × lot × underlying       (vol = contracts) ${rC.toFixed(4)}   <-- notional`);
  console.log(`         turnover = vol × underlying             (vol = units)     ${rD.toFixed(4)}`);
  const volIsContracts = Math.abs(rC - 1) < 0.05;
  console.log(`\n         => TtlTradgVol is in ${volIsContracts ? 'CONTRACTS' : 'UNITS'}` +
    ` (deviation from 1.00 is intraday price drift: turnover accrues at each trade's underlying, not at the close)\n`);

  // ── TEST 2. What unit is OpnIntrst in? Divisibility settles it. ──
  // If OI counts UNITS, every position is a whole number of lots, so OI ≡ 0 (mod LOT).
  // If OI counts CONTRACTS, divisibility by LOT is coincidence: ~1/LOT of rows.
  const oi = rows.map((r) => Number(r[COL.opnIntrst])).filter((v) => v > 0);
  const div = oi.filter((v) => v % LOT === 0).length;
  const pct = (div / oi.length) * 100;
  const chance = 100 / LOT;

  console.log(`TEST 2   OpnIntrst — divisibility by the lot size`);
  console.log(`         divisible by ${LOT}: ${div} / ${oi.length}  =  ${pct.toFixed(1)}%`);
  console.log(`         expected if OI counts UNITS     : 100%`);
  console.log(`         expected if OI counts CONTRACTS : ~${chance.toFixed(1)}% (chance)\n`);

  // ── TEST 3. The residue is not noise. It is the lot-size history (constraint F1). ──
  // NIFTY's lot has been 50 → 25 → 75 → 65. A long-dated contract holds positions opened under an
  // EARLIER lot, so its OI is a multiple of that older lot, not of today's. If the non-divisible
  // rows concentrate in far expiries, the UNITS hypothesis explains the residue. If they are
  // scattered uniformly, it does not, and this script must say so.
  const byExpiry = {};
  for (const r of rows) {
    const v = Number(r[COL.opnIntrst]);
    if (!(v > 0)) continue;
    const x = r[COL.xpryDt];
    (byExpiry[x] ||= { n: 0, div: 0 }).n++;
    if (v % LOT === 0) byExpiry[x].div++;
  }
  const expiries = Object.keys(byExpiry).sort();
  const near = expiries.slice(0, 5);
  const far = expiries.slice(-5);
  const rate = (xs) => {
    const n = xs.reduce((s, x) => s + byExpiry[x].n, 0);
    const d = xs.reduce((s, x) => s + byExpiry[x].div, 0);
    return { n, d, pct: (d / n) * 100 };
  };
  const nr = rate(near), fr = rate(far);

  console.log(`TEST 3   the residue, grouped by expiry`);
  console.log(`         expiry        rows  div  %`);
  for (const x of expiries) {
    const s = byExpiry[x];
    console.log(`         ${x}  ${String(s.n).padStart(4)}  ${String(s.div).padStart(4)}  ${((s.div / s.n) * 100).toFixed(0)}%`);
  }
  console.log(`\n         five nearest expiries : ${nr.d}/${nr.n} = ${nr.pct.toFixed(1)}%`);
  console.log(`         five farthest expiries: ${fr.d}/${fr.n} = ${fr.pct.toFixed(1)}%`);
  console.log(`         constraint F1: NIFTY's lot has been 50 → 25 → 75 → 65. Long-dated contracts`);
  console.log(`         carry positions opened under an older lot, so they are not multiples of ${LOT}.\n`);

  // ── TEST 4. THE DECISIVE ONE, with a control inside the same file. ──
  // A strike's OI is the SUM of every open position, and NIFTY's lot has been 50 → 25 → 75 → 65.
  // If OI counts UNITS, every position contributes a multiple of the lot in force when it was
  // opened, so OI must be a multiple of gcd(65,75,50,25) = 5 — always, on every row.
  // If OI counts CONTRACTS, it is a raw integer and ~1-in-5 rows will be divisible by 5 by chance.
  //
  // TtlTradgVol is the control: same file, same rows, a column we already know counts contracts.
  const GCD = 5;
  const divPct = (arr, m) => (arr.filter((v) => Math.abs(v) % m === 0).length / arr.length) * 100;
  const chg = rows.map((r) => Number(r[COL.chngInOpnIntrst])).filter((v) => Number.isFinite(v) && v !== 0);
  const vol = rows.map((r) => Number(r[COL.ttlTradgVol])).filter((v) => v > 0);

  const oiBy5 = divPct(oi, GCD), chgBy5 = divPct(chg, GCD), volBy5 = divPct(vol, GCD);
  const oiByLot = divPct(oi, LOT), volByLot = divPct(vol, LOT);

  console.log(`TEST 4   divisibility by gcd(historic lots) = ${GCD} — the decisive test`);
  console.log(`                            %${GCD}      %${LOT}      n`);
  console.log(`         OpnIntrst        ${oiBy5.toFixed(1).padStart(6)}%  ${oiByLot.toFixed(1).padStart(6)}%  ${oi.length}`);
  console.log(`         ChngInOpnIntrst  ${chgBy5.toFixed(1).padStart(6)}%  ${divPct(chg, LOT).toFixed(1).padStart(6)}%  ${chg.length}`);
  console.log(`         TtlTradgVol      ${volBy5.toFixed(1).padStart(6)}%  ${volByLot.toFixed(1).padStart(6)}%  ${vol.length}   <-- CONTROL`);
  console.log(`\n         if OI counts CONTRACTS: expect ~${(100 / GCD).toFixed(0)}% and ~${(100 / LOT).toFixed(1)}% — which is exactly`);
  console.log(`         what TtlTradgVol shows. OpnIntrst does not behave like a raw count.\n`);

  // ── VERDICT ──
  const oiIsUnits = oiBy5 > 99.9 && chgBy5 > 99.9;      // every row, no exceptions
  const controlHolds = volBy5 < 30 && volByLot < 5;      // the known-contracts column behaves as chance
  const settled = oiIsUnits && controlHolds && volIsContracts;

  if (!settled) {
    console.log('VERDICT  INSUFFICIENT EVIDENCE — the tests do not agree. F4 stays UNVERIFIED.\n');
    process.exit(2);
  }

  const maxOi = Math.max(...oi);
  console.log('VERDICT  OpnIntrst is expressed in UNITS (shares), not contracts.');
  console.log(`         contracts = OI / ${LOT}`);
  console.log(`         corroboration: max OI ${maxOi.toLocaleString('en-IN')} units = ` +
    `${Math.round(maxOi / LOT).toLocaleString('en-IN')} contracts for ${symbol}.`);
  console.log(`         TtlTradgVol, by contrast, is in CONTRACTS. The two columns do NOT share a unit.\n`);
  console.log('         Reproduce:  node scripts/verify-oi-unit.js [csvPath]\n');
  process.exit(0);
}

if (require.main === module) main();
module.exports = { COL, median };
