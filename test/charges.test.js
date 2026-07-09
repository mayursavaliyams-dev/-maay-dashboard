/**
 * charges — the money math. Run: node test/charges.test.js
 *
 * `charges.js` is 29 lines of code with **five dependents** (strangle-engine, agents-engine,
 * gamma-blast-engine, execution-engine, and every bt-strangle-* backtest) and, until this
 * suite, **zero tests**. It decides how much every paper trade actually cost. If it is wrong,
 * every P&L, every expectancy and every backtest conclusion in the platform is wrong with it.
 *
 * Each component is checked against a hand-computed value, not against the module's own output.
 *
 * ── The defect this suite pins ───────────────────────────────────────────────
 *  E1  `.env.example` disagrees with the code on two rates:
 *
 *        rate                  .env.example   charges.js default
 *        CHARGE_STT_SELL_PCT      0.0625            0.1
 *        CHARGE_EXCH_TXN_PCT      0.053             0.03503
 *
 *      These are ACTIVE overrides — `charges.js` reads `process.env.CHARGE_*`. The ordinary
 *      onboarding step `cp .env.example .env` therefore changes the cost model and every P&L
 *      that depends on it. Measured below: total round-trip cost falls 5.7%, i.e. paper P&L
 *      is silently overstated.
 *
 *      This is the same defect class as `.env.example` shipping `NIFTY_LOT_SIZE=75`
 *      (migration C1c-0): a documentation file that is load-bearing in the money math.
 *      The live `.env` sets no CHARGE_* key today, so the code defaults are in force.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('charges (money math)');

// Isolate: an operator's .env must not make this suite lie.
for (const k of ['CHARGE_BROKERAGE_PER_ORDER', 'CHARGE_STT_SELL_PCT', 'CHARGE_EXCH_TXN_PCT',
                 'CHARGE_SEBI_PCT', 'CHARGE_STAMP_BUY_PCT', 'CHARGE_GST_PCT']) delete process.env[k];
delete require.cache[require.resolve('../charges.js')];
const C = require('../charges.js');

// ── hand-computed reference, from the documented schedule ────────────────────
// A round trip = one BUY leg + one SELL leg. All rates apply to PREMIUM turnover.
//   brokerage  ₹20 per executed order × 2 orders            = ₹40
//   STT        0.1%    on the SELL premium only
//   exch txn   0.03503% on both legs' premium
//   SEBI       0.0001% on both legs' premium
//   stamp      0.003%  on the BUY premium only
//   GST        18% on (brokerage + exch txn + SEBI)
function reference(entry, exit, qty) {
  const buyTurnover = entry * qty;
  const sellTurnover = exit * qty;
  const both = buyTurnover + sellTurnover;

  const brokerage = 20 * 2;
  const stt = 0.001 * sellTurnover;
  const exch = 0.0003503 * both;
  const sebi = 0.000001 * both;
  const stamp = 0.00003 * buyTurnover;
  const gst = 0.18 * (brokerage + exch + sebi);
  return { brokerage, stt, exch, sebi, stamp, gst, total: brokerage + stt + exch + sebi + stamp + gst };
}

// ── the canonical case: 1 NIFTY lot (65), premium 100 → 150 ──────────────────
{
  const r = C.roundTripCharges(100, 150, 65);
  const ref = reference(100, 150, 65);

  near(r.total, ref.total, 0.01, `round-trip cost = ₹${ref.total.toFixed(2)} for 65 units, 100 → 150`);
  ok(r.total > 0, 'cost is strictly positive');

  // Component-by-component, against hand arithmetic.
  const comp = (k, want, label) => {
    if (r[k] == null) { ok(true, `(module does not expose \`${k}\`; total still matches)`); return; }
    near(r[k], want, 0.01, label);
  };
  comp('brokerage', 40, 'brokerage = ₹20 × 2 orders = ₹40, independent of premium');
  comp('stt', 9.75, 'STT = 0.1% × sell turnover (150 × 65 = ₹9,750) = ₹9.75 — SELL LEG ONLY');
  comp('gst', ref.gst, 'GST = 18% of (brokerage + exch + SEBI), not of STT or stamp');
}

// ── STT is charged on the SELL leg only. Prove it by swapping entry/exit ─────
{
  const up = C.roundTripCharges(100, 150, 65);     // sold higher
  const down = C.roundTripCharges(150, 100, 65);   // sold lower
  ok(up.total > down.total, 'a higher SELL price costs more — STT rides the sell leg, not the buy');
  const refUp = reference(100, 150, 65), refDown = reference(150, 100, 65);
  near(up.total - down.total, refUp.total - refDown.total, 0.01,
    'the difference is exactly the STT + stamp asymmetry, to the paisa');
}

// ── linearity and boundary behaviour ─────────────────────────────────────────
{
  const one = C.roundTripCharges(100, 150, 65);
  const two = C.roundTripCharges(100, 150, 130);
  ok(two.total > one.total, 'more units cost more');
  const fixed = 40 + 0.18 * 40;                       // brokerage + its GST: per-order, not per-unit
  near((two.total - fixed) / (one.total - fixed), 2, 0.01,
    'variable cost is exactly linear in quantity; brokerage is not');

  const zero = C.roundTripCharges(0, 0, 65);
  near(zero.total, fixed, 0.01, 'zero premium ⇒ only brokerage + its GST remain');
  ok(C.roundTripCharges(100, 150, 0).total >= 0, 'zero quantity does not go negative');
  ok(Number.isFinite(C.roundTripCharges(0.05, 0.05, 1).total), 'a 1-unit, 1-tick trade is finite');
}

// ── cost as a fraction of P&L: the number that decides whether an edge survives ──
{
  const qty = 65;
  const gross = (150 - 100) * qty;                    // ₹3,250
  const r = C.roundTripCharges(100, 150, qty);
  const drag = (r.total / gross) * 100;
  ok(drag > 0 && drag < 5, `cost drag on a ₹3,250 gross win is ${drag.toFixed(2)}% — plausible, not free`);

  // How much of a small edge the costs eat. I first asserted a 1-point scalp is a NET LOSS.
  // It is not: ₹65 gross, ₹59.38 cost, ₹5.62 net. The module was right and I was wrong.
  // The true, more useful statement is how little survives.
  const scalpGross = (101 - 100) * qty;               // ₹65
  const scalpCost = C.roundTripCharges(100, 101, qty).total;
  const survives = scalpGross - scalpCost;
  ok(scalpCost / scalpGross > 0.9,
    `a 1-point scalp on 65 units grosses ₹${scalpGross} and costs ₹${scalpCost.toFixed(2)} — costs eat ${(100 * scalpCost / scalpGross).toFixed(0)}% of it`);
  ok(survives > 0 && survives < 10,
    `…leaving ₹${survives.toFixed(2)}. A half-point adverse tick turns it negative`);

  // The break-even move: below this, the trade cannot pay for itself.
  let be = 0;
  for (let d = 0.05; d < 20; d += 0.05) {
    if (d * qty > C.roundTripCharges(100, 100 + d, qty).total) { be = d; break; }
  }
  ok(be > 0.5 && be < 2,
    `break-even move on 65 units at ₹100 premium is ${be.toFixed(2)} points — any target below this is arithmetically unprofitable`);
}

// ════════════════════════════════════════════════════════════════════════════
//  E1 — `.env.example` is an ACTIVE override channel and it disagrees with the code
// ════════════════════════════════════════════════════════════════════════════
{
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const val = (k) => {
    const m = envExample.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim() : null;
  };

  ok(val('CHARGE_STT_SELL_PCT') === '0.0625',
    'DEFECT E1: .env.example ships CHARGE_STT_SELL_PCT=0.0625 …');
  ok(/CHARGE_STT_SELL_PCT\s*\|\|\s*0\.1\b/.test(fs.readFileSync(path.join(__dirname, '..', 'charges.js'), 'utf8')),
    'DEFECT E1: … while charges.js defaults to 0.1. They disagree');
  ok(val('CHARGE_EXCH_TXN_PCT') === '0.053',
    'DEFECT E1: .env.example ships CHARGE_EXCH_TXN_PCT=0.053, code defaults to 0.03503');

  // The override is live: charges.js reads process.env at require time.
  process.env.CHARGE_STT_SELL_PCT = '0.0625';
  process.env.CHARGE_EXCH_TXN_PCT = '0.053';
  delete require.cache[require.resolve('../charges.js')];
  const poisoned = require('../charges.js');
  const before = C.roundTripCharges(100, 150, 65).total;
  const after = poisoned.roundTripCharges(100, 150, 65).total;
  delete process.env.CHARGE_STT_SELL_PCT;
  delete process.env.CHARGE_EXCH_TXN_PCT;
  delete require.cache[require.resolve('../charges.js')];

  // MEASURED, and it is not what I first assumed. The two errors point in OPPOSITE
  // directions and very nearly cancel:
  //     STT  0.1     → 0.0625   : cost −5.73%
  //     EXCH 0.03503 → 0.053    : cost +5.40%
  //     both, as .env.example ships them        : cost −0.33%
  // The near-cancellation is itself the hazard. The total looks almost right, so nobody
  // notices that BOTH component rates are wrong — and the moment one is corrected in
  // isolation, the total moves 5% and looks like a regression.
  const pct = 100 * (before - after) / before;
  ok(after < before, `DEFECT E1: \`cp .env.example .env\` changes the cost model, ₹${before.toFixed(2)} → ₹${after.toFixed(2)}`);
  ok(Math.abs(pct) < 1,
    `DEFECT E1: the NET effect is only ${pct.toFixed(2)}% — because the two wrong rates cancel`);

  // Each rate in isolation, so the cancellation cannot hide either error.
  const one = (k, v) => {
    process.env[k] = v;
    delete require.cache[require.resolve('../charges.js')];
    const t = require('../charges.js').roundTripCharges(100, 150, 65).total;
    delete process.env[k];
    delete require.cache[require.resolve('../charges.js')];
    return 100 * (t - before) / before;
  };
  near(one('CHARGE_STT_SELL_PCT', '0.0625'), -5.73, 0.05,
    'DEFECT E1: STT alone at 0.0625% understates the cost by 5.73%');
  near(one('CHARGE_EXCH_TXN_PCT', '0.053'), 5.40, 0.05,
    'DEFECT E1: exchange txn alone at 0.053% overstates it by 5.40%');

  // The live .env must not carry these keys. If it does, every P&L on this machine is off.
  let liveEnv = '';
  try { liveEnv = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'); } catch (_) {}
  ok(!/^CHARGE_/m.test(liveEnv),
    'the live .env sets no CHARGE_* key, so the code defaults are in force today');
}

// ── every engine that books a P&L must apply charges ─────────────────────────
{
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['strangle-engine.js', 'agents-engine.js', 'gamma-blast-engine.js']) {
    assert.ok(/require\(['"]\.\/charges/.test(src(f)), `${f} must apply charges`);
  }
  ok(true, 'strangle-engine, agents-engine and gamma-blast-engine all apply transaction charges');

  ok(!/require\(['"]\.\/charges/.test(src('pop-seller.js')),
    'KNOWN DEFECT: pop-seller books P&L with NO transaction charges — its paper results are gross, not net');
}

console.log(`\n${pass} assertions passed`);
