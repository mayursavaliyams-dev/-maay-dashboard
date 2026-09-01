#!/usr/bin/env node
/* bt-expiry-buy-vs-sell.js — on expiry day, is it better to buy the option or sell it?
 *
 * Real NSE UDiFF bhavcopy only. Nothing here is synthetic, interpolated or modelled:
 * every premium is a price that actually printed.
 *
 * THE TRADE
 *   Enter at the expiry-day OPEN, exit at the expiry-day CLOSE, on contracts that
 *   settle that same day. Both sides of the same contract are run, so BUY and SELL
 *   are exact mirrors before costs. That is the point — gross, this comparison is
 *   arithmetically empty. Everything that separates the two sides is costs, win-rate
 *   asymmetry, and the shape of the tail.
 *
 * TWO WAYS THIS BACKTEST COULD LIE, BOTH CLOSED
 *
 *   1. Look-ahead in strike selection. Choosing "ATM" from the expiry-day underlying
 *      means picking strikes with knowledge of where the day ended. Strikes here are
 *      chosen from the PREVIOUS session's closing underlying, which is all a trader
 *      could have known at the open.
 *
 *   2. Costs applied to the wrong leg. STT falls on the SELL side only. For a long,
 *      the sell is the exit; for a short, the sell is the ENTRY — and on a winning
 *      short the entry premium is the larger number, so getting this backwards
 *      quietly understates seller costs exactly when the seller is winning.
 *      roundTripCharges takes (buyPrice, sellPrice); the short call swaps them.
 *
 * WHAT IT DOES NOT MODEL, and therefore does not claim
 *   - Slippage. Fills are assumed at the printed open and close.
 *   - Margin. The seller's return on capital is not comparable to the buyer's here.
 *   - Intraday path. A short that would have been stopped out mid-day is carried.
 *     This flatters selling, and the max-loss column is where that shows up.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { roundTripCharges } = require('./charges');

const BHAV = path.join(__dirname, 'bt-data', 'bhav');
const STEP = 50;                       // NIFTY strike interval
const OFFSETS = [-2, -1, 0, 1, 2];     // strikes either side of ATM, in steps

/* Column positions in the NSE UDiFF bhavcopy. Named once so a shifted column is a
 * loud failure here rather than a silent one 200 lines down. */
const C = { date: 0, type: 4, symbol: 7, expiry: 9, strike: 11, right: 12,
            open: 14, high: 15, low: 16, close: 17, undr: 20, settle: 21,
            oi: 22, vol: 24, lot: 28 };

function loadExpiryData() {
  const files = fs.readdirSync(BHAV).filter(f => f.endsWith('.csv')).sort();
  const byDate = new Map();     // date -> { underlying, settling: [rows] }

  for (const f of files) {
    const txt = fs.readFileSync(path.join(BHAV, f), 'utf8');
    let date = null, underlying = null;
    const settling = [];
    for (const line of txt.split(/\r?\n/)) {
      if (!line) continue;
      const c = line.split(',');
      if (c[C.type] !== 'IDO' || c[C.symbol] !== 'NIFTY') continue;
      date = c[C.date];
      const u = Number(c[C.undr]);
      if (Number.isFinite(u) && u > 0) underlying = u;
      if (c[C.expiry] === c[C.date]) settling.push(c);
    }
    if (date) byDate.set(date, { underlying, settling });
  }
  return byDate;
}

function run(byDate = loadExpiryData()) {
  const dates = [...byDate.keys()].sort();
  const trades = [];
  let skippedNoPrev = 0, skippedNoQuote = 0;

  for (let i = 1; i < dates.length; i++) {
    const d = dates[i];
    const day = byDate.get(d);
    if (!day.settling.length) continue;              // not an expiry day

    /* The only underlying a trader had at the open. Using today's would be the
     * look-ahead that makes every strike selection look prescient. */
    const prevUnderlying = byDate.get(dates[i - 1])?.underlying;
    if (!Number.isFinite(prevUnderlying)) { skippedNoPrev++; continue; }
    const atm = Math.round(prevUnderlying / STEP) * STEP;

    for (const off of OFFSETS) {
      const strike = atm + off * STEP;
      for (const right of ['CE', 'PE']) {
        const row = day.settling.find(c =>
          Number(c[C.strike]) === strike && c[C.right] === right);
        if (!row) { skippedNoQuote++; continue; }

        const entry = Number(row[C.open]);
        const exit = Number(row[C.close]);
        const lot = Number(row[C.lot]);
        const vol = Number(row[C.vol]);
        /* A contract that never traded has an "open" that is a carried reference
         * price, not a fill. Counting it as a trade invents liquidity. */
        if (!(entry > 0) || !Number.isFinite(exit) || !(lot > 0) || !(vol > 0)) {
          skippedNoQuote++; continue;
        }

        const qty = lot;
        const grossLong = (exit - entry) * qty;
        // Long: bought at entry, sold at exit.
        const costLong = roundTripCharges(entry, exit, qty).total;
        // Short: SOLD at entry, bought back at exit — the arguments swap, so STT
        // lands on the entry premium where it belongs.
        const costShort = roundTripCharges(exit, entry, qty).total;

        trades.push({
          date: d, strike, right, off, entry, exit, lot, vol,
          buyNet: grossLong - costLong,
          sellNet: -grossLong - costShort,
          costLong, costShort,
        });
      }
    }
  }
  return { trades, skippedNoPrev, skippedNoQuote, expiries: new Set(trades.map(t => t.date)).size };
}

/* ── reporting ──────────────────────────────────────────────────────────────── */

function stats(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const wins = vals.filter(v => v > 0);
  const losses = vals.filter(v => v < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  return {
    n: vals.length,
    total: sum,
    mean: sum / vals.length,
    median: s[Math.floor(s.length / 2)],
    winPct: wins.length / vals.length * 100,
    maxWin: s[s.length - 1],
    maxLoss: s[0],
    p05: s[Math.floor(s.length * 0.05)],
    p95: s[Math.floor(s.length * 0.95)],
    /* Profit factor is undefined, not infinite and not zero, when a side never
     * lost. Reporting 0 there would read as "worthless" for a perfect record. */
    pf: grossLoss > 0 ? grossWin / grossLoss : null,
  };
}

const money = v => (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-IN');

function line(label, s) {
  if (!s) return `  ${label.padEnd(12)} no trades`;
  return `  ${label.padEnd(12)}${String(s.n).padStart(5)}  ` +
         `${(s.winPct.toFixed(1) + '%').padStart(7)}  ` +
         `${money(s.total).padStart(12)}  ${money(s.mean).padStart(9)}  ` +
         `${money(s.median).padStart(8)}  ${money(s.maxWin).padStart(10)}  ` +
         `${money(s.maxLoss).padStart(11)}  ${(s.pf === null ? 'n/a' : s.pf.toFixed(2)).padStart(6)}`;
}

if (require.main === module) {
  const t0 = Date.now();
  const { trades, skippedNoPrev, skippedNoQuote, expiries } = run();

  console.log(`\nNIFTY expiry-day open → close, real NSE bhavcopy`);
  console.log(`  expiries covered : ${expiries}`);
  console.log(`  trades           : ${trades.length}   (${OFFSETS.length} strikes x CE/PE per expiry)`);
  console.log(`  skipped          : ${skippedNoQuote} untraded/unquoted contracts, ${skippedNoPrev} expiries with no prior session`);
  console.log(`  window           : ${trades[0]?.date} → ${trades[trades.length - 1]?.date}`);

  const header = `  ${'side'.padEnd(12)}${'n'.padStart(5)}  ${'win%'.padStart(7)}  ` +
                 `${'net total'.padStart(12)}  ${'mean'.padStart(9)}  ${'median'.padStart(8)}  ` +
                 `${'max win'.padStart(10)}  ${'max loss'.padStart(11)}  ${'PF'.padStart(6)}`;

  console.log(`\n  ── all strikes ──\n${header}`);
  console.log(line('BUY', stats(trades.map(t => t.buyNet))));
  console.log(line('SELL', stats(trades.map(t => t.sellNet))));

  console.log(`\n  ── by strike distance from ATM (chosen on the prior close) ──\n${header}`);
  for (const off of OFFSETS) {
    const sub = trades.filter(t => t.off === off);
    const tag = off === 0 ? 'ATM' : (off > 0 ? `ATM+${off}` : `ATM${off}`);
    console.log(line(`${tag} BUY`, stats(sub.map(t => t.buyNet))));
    console.log(line(`${tag} SELL`, stats(sub.map(t => t.sellNet))));
  }

  console.log(`\n  ── by side of the chain ──\n${header}`);
  for (const right of ['CE', 'PE']) {
    const sub = trades.filter(t => t.right === right);
    console.log(line(`${right} BUY`, stats(sub.map(t => t.buyNet))));
    console.log(line(`${right} SELL`, stats(sub.map(t => t.sellNet))));
  }

  const cost = trades.reduce((a, t) => a + t.costShort, 0);
  const grossSell = trades.reduce((a, t) => a + t.sellNet + t.costShort, 0);
  console.log(`\n  cost drag on the SELL side: ${money(-cost)} against a gross of ${money(grossSell)}` +
              ` — ${grossSell > 0 ? (cost / grossSell * 100).toFixed(1) + '% of gross eaten by charges' : 'gross was negative before costs'}`);
  console.log(`\n  computed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

module.exports = { run, stats, loadExpiryData, C, OFFSETS, STEP };
