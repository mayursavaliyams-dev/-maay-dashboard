/* bt-expiry-buy-vs-sell.test.js
 *
 * A backtest cannot be checked by whether its number looks plausible — a number
 * that looks plausible is exactly what a broken backtest produces. So this pins
 * the two decisions that would silently turn the result into fiction:
 *
 *   1. strikes chosen from the PRIOR session, never from the day being traded
 *   2. STT charged on the sell leg, which for a short is the ENTRY
 *
 * Measured 2026-09-01 on the real archive: swapping (1) for the look-ahead version
 * moved the reported SELL profit from Rs 6.58L to Rs 48.67L — a 639% inflation off
 * one line of code. That is the whole reason this file exists.
 */

'use strict';

const assert = require('assert');
const { roundTripCharges } = require('../charges');
const B = require('../bt-expiry-buy-vs-sell.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

/** One bhavcopy row as an array, positioned exactly like the real file. */
function row({ date, expiry, strike, right, open, close, lot = 75, vol = 100, undr = 0 }) {
  const c = new Array(29).fill('');
  c[B.C.date] = date; c[B.C.type] = 'IDO'; c[B.C.symbol] = 'NIFTY';
  c[B.C.expiry] = expiry; c[B.C.strike] = String(strike); c[B.C.right] = right;
  c[B.C.open] = String(open); c[B.C.close] = String(close);
  c[B.C.undr] = String(undr); c[B.C.lot] = String(lot); c[B.C.vol] = String(vol);
  return c;
}

/* Prior close 20000 → ATM 20000. The expiry day closes far away at 20500, so a
 * look-ahead implementation would centre on 20500 instead. Only the 20000 strike
 * is quoted, so the two implementations cannot both find a trade. */
function fixture(extra = []) {
  return new Map([
    ['2026-01-01', { underlying: 20000, settling: [] }],
    ['2026-01-08', {
      underlying: 20500,
      settling: [
        row({ date: '2026-01-08', expiry: '2026-01-08', strike: 20000, right: 'CE',
              open: 100, close: 500, undr: 20500 }),
        row({ date: '2026-01-08', expiry: '2026-01-08', strike: 20000, right: 'PE',
              open: 90, close: 0.05, undr: 20500 }),
        ...extra,
      ],
    }],
  ]);
}

// ── @test:regression — the strike comes from the prior session ────────────────
{
  const { trades } = B.run(fixture());
  eq(trades.length, 2, 'both quoted legs at the prior-close ATM were traded');
  ok(trades.every(t => t.strike === 20000),
     'strikes centre on 20000, the prior close — not 20500, where the day ended');
  ok(!trades.some(t => t.strike === 20500),
     'no trade is taken at a strike that could only be known after the fact');
}

// ── @test:regression — a loss is reported as a loss ──────────────────────────
{
  const { trades } = B.run(fixture());
  const ce = trades.find(t => t.right === 'CE');
  ok(ce.buyNet > 0, 'buying the call that went 100 → 500 made money');
  ok(ce.sellNet < 0, 'and selling it lost money — the mirror is not quietly dropped');
  ok(Math.abs(ce.buyNet + ce.sellNet) > 0,
     'the two sides differ by costs, so they never sum to exactly zero');
  ok(ce.buyNet + ce.sellNet < 0, 'and the difference is a cost, so the pair loses in aggregate');
}

// ── @test:unit — STT lands on the entry for a short ──────────────────────────
{
  const { trades } = B.run(fixture());
  const pe = trades.find(t => t.right === 'PE');   // sold at 90, bought back at 0.05
  const swapped = roundTripCharges(pe.exit, pe.entry, pe.lot).total;
  const naive = roundTripCharges(pe.entry, pe.exit, pe.lot).total;
  eq(pe.costShort, swapped, 'the short is charged with entry as the SELL leg');
  ok(swapped > naive,
     'and that costs more than the naive call — a winning short pays STT on the ' +
     'larger entry premium, so getting it backwards flatters the seller exactly ' +
     'when the seller is winning');
}

// ── @test:unit — an untraded contract is not a trade ─────────────────────────
{
  const withDead = fixture([
    row({ date: '2026-01-08', expiry: '2026-01-08', strike: 20050, right: 'CE',
          open: 40, close: 450, vol: 0 }),
  ]);
  const { trades, skippedNoQuote } = B.run(withDead);
  ok(!trades.some(t => t.strike === 20050),
     'a contract with zero volume has a reference price, not a fill — counting it invents liquidity');
  ok(skippedNoQuote >= 1, 'and the skip is counted rather than hidden');
}

// ── @test:unit — profit factor with no losses is undefined, not zero ─────────
{
  const s = B.stats([100, 200, 300]);
  eq(s.pf, null, 'a side that never lost has an undefined PF — 0 would read as worthless');
  eq(s.winPct, 100, 'while the win rate is a real 100%');
  const t = B.stats([]);
  eq(t, null, 'no trades yields no statistics, not a row of zeros');
}

console.log(`\n${n} assertions passed`);
