/**
 * margin-layer — the broker is the source of truth; everything else is a cache.
 * Run: node test/margin-layer.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:boundary @test:performance @test:rollback
 *
 * THE ASSUMPTION THIS REPLACES, AND WHAT IT COST
 *
 *   position-sizer.js:45
 *     marginPerLotStrangle: parseFloat(process.env.SIZER_STRANGLE_MARGIN || 130000)
 *
 * Measured against the live broker calculator on 2026-07-30, NIFTY 2026-08-04
 * expiry, one lot per leg:
 *
 *   naked short strangle 23900P / 24700C   final margin  ₹1,80,959
 *   the assumption                                       ₹1,30,000
 *
 * The assumption is 28% low, so a sizer using it takes roughly 1.4× the lots the
 * account can carry. Exchange SPAN parameters change without notice, which is
 * why no local formula is trusted here and why `requireBroker()` exists.
 *
 * THE HEDGE NUMBER, ALSO MEASURED
 *
 *   naked short strangle                   ₹1,80,959
 *   + protective wings 23400P / 25200C     ₹  92,694
 *   released                               ₹  88,265   (48.8%)
 *
 * No local formula would have produced that, and the whole hedge-versus-naked
 * argument turns on it.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const { MarginCalculator, basketKey } = require(path.join(ROOT, 'margin-calculator.js'));
const { MarginOptimiser } = require(path.join(ROOT, 'margin-optimiser.js'));
const { MarginMonitor, MARGIN_DEFAULTS } = require(path.join(ROOT, 'margin-monitor.js'));

const quiet = { warn() {}, error() {}, log() {} };

/* A stub broker reproducing the REAL measured figures, so the tests exercise the
   same arithmetic the live account would. */
const NAKED = [
  { instrument_key: 'NSE_FO|PE23900', quantity: 65, transaction_type: 'SELL' },
  { instrument_key: 'NSE_FO|CE24700', quantity: 65, transaction_type: 'SELL' },
];
const HEDGED = [
  ...NAKED,
  { instrument_key: 'NSE_FO|PE23400', quantity: 65, transaction_type: 'BUY' },
  { instrument_key: 'NSE_FO|CE25200', quantity: 65, transaction_type: 'BUY' },
];

function stubBroker(overrides = {}) {
  const calls = [];
  return {
    calls,
    async getBasketMargin(instruments) {
      calls.push(instruments.map(i => i.instrument_key).join(','));
      if (overrides.fail) throw new Error(overrides.fail);
      /* Faithful enough to walk an unwind: margin scales with the number of
         shorts and each matched long offsets one of them. Calibrated so the two
         measured points come out exactly right —
           2 shorts, 0 longs → ₹1,80,959   2 shorts, 2 longs → ₹92,694 */
      const longs = instruments.filter(i => String(i.transaction_type).toUpperCase() === 'BUY').length;
      const shorts = instruments.filter(i => String(i.transaction_type).toUpperCase() === 'SELL').length;
      let final;
      if (shorts === 0) final = 0;
      else if (shorts === 1 && longs === 0) final = 150404;   // the measured single-leg figure
      else final = shorts * 90479.5 - Math.min(shorts, longs) * 44132.5;
      return {
        ok: true, source: 'broker',
        legs: instruments.map(() => ({ span: final * 0.83, exposure: final * 0.17, total: final / instruments.length })),
        span: final * 0.83, exposure: final * 0.17,
        legSum: longs > 0 ? 182769 : (shorts === 1 ? 150836 : 182470),
        required: longs > 0 ? 182769 : 182470,
        final, basketBenefit: (longs > 0 ? 182769 : 182470) - final, at: Date.now(),
      };
    },
  };
}

const mk = (o = {}) => {
  const broker = o.broker || stubBroker();
  const calc = new MarginCalculator({ broker, log: quiet, minGapMs: 0, now: o.now, ttlMs: o.ttlMs });
  return { broker, calc, opt: new MarginOptimiser({ calculator: calc, log: quiet }) };
};

console.log('\nmargin layer\n');

(async () => {
  /* ── 1. the broker is the source of truth ─────────────────────────────── */
  console.log('source of truth');
  {
    const { calc } = mk();
    const m = await calc.forBasket(NAKED);
    ok(m.ok && m.source === 'broker', 'a basket is priced by the broker');
    ok(m.final === 180959, `and the figure is the broker's final margin (₹${m.final}), not a sum of the legs`);
    ok(m.legSum > m.final, `legs summed ₹${m.legSum} exceeds final ₹${m.final} — the exchange's own offset`);
    ok(m.basketBenefit === m.legSum - m.final, 'the basket benefit is reported explicitly');
  }
  {
    const { calc } = mk();
    const hedged = await calc.forBasket(HEDGED);
    const naked = await calc.forBasket(NAKED);
    ok(hedged.final === 92694 && naked.final === 180959, 'hedged and naked price differently');
    ok(naked.final - hedged.final === 88265,
      `adding wings releases ₹${naked.final - hedged.final} — 48.8% of the margin, which no local formula would have produced`);
  }

  /* ── 2. an estimate can never masquerade as a broker figure ────────────── */
  console.log('\nestimates are quarantined');
  {
    const { calc } = mk();
    const e = calc.estimate(NAKED, { perShortLot: 130000, lotSize: 65 });
    ok(e.source === 'estimate' && e.validated === false, 'a local estimate is labelled estimate and UNVALIDATED');
    ok(/UNVALIDATED/.test(e.warning), 'and carries a warning saying it must be replaced before any order');
    ok(calc.estimate(NAKED, {}).ok === false,
      'an estimate with no calibrated per-lot figure is REFUSED — an uncalibrated estimate is a guess');
  }
  {
    const calc = new MarginCalculator({ broker: null, log: quiet });
    const r = await calc.requireBroker(NAKED);
    ok(!r.ok && r.final === null,
      'requireBroker returns nothing at all when no broker is available — it never falls back to a formula');
    ok(/refusing to substitute a formula/.test(r.error), 'and says so');
  }
  {
    const { calc, broker } = mk({ broker: stubBroker({ fail: 'upstream 503' }) });
    const r = await calc.requireBroker(NAKED);
    ok(!r.ok, 'a broker failure with no cached answer yields NO margin — not an estimate');
    ok(broker.calls.length === 1, 'and it was actually attempted');
  }
  {
    // A stale broker answer is still a broker answer; a formula is not.
    let t = 0;
    const broker = stubBroker();
    const calc = new MarginCalculator({ broker, log: quiet, minGapMs: 0, now: () => t, ttlMs: 1000 });
    await calc.forBasket(NAKED);
    broker.getBasketMargin = async () => { throw new Error('down'); };
    t = 99999;
    const r = await calc.forBasket(NAKED);
    ok(r.ok && r.source === 'cache' && r.stale === true,
      'when the broker goes down a STALE broker figure is served, marked stale and with its age');
    ok(r.ageMs > 0 && r.error === 'down', 'and both the age and the failure are reported');
  }

  /* ── 3. rate limits ───────────────────────────────────────────────────── */
  console.log('\nrate limits');
  {
    const { calc, broker } = mk();
    for (let i = 0; i < 5; i++) await calc.forBasket(NAKED);
    ok(broker.calls.length === 1, `5 requests for the same basket cost 1 broker call (${broker.calls.length})`);
    ok(calc.stats.cacheHits === 4, 'the other four were cache hits');
  }
  {
    const { calc, broker } = mk();
    await Promise.all([calc.forBasket(NAKED), calc.forBasket(NAKED), calc.forBasket(NAKED)]);
    ok(broker.calls.length === 1, 'concurrent requests are coalesced into one call');
    ok(calc.stats.coalesced === 2, 'and the coalescing is counted');
  }
  {
    const { calc } = mk();
    const a = basketKey(NAKED);
    const b = basketKey([...NAKED].reverse());
    ok(a === b, 'the same basket in a different leg order is the same cache key');
  }

  /* ── 4. return on margin is the ranking metric ─────────────────────────── */
  console.log('\nreturn on margin');
  {
    const { opt } = mk();
    const r = await opt.returnOnMargin({ instruments: NAKED, expectedEdge: 9000 });
    ok(r.ok && r.margin === 180959, 'return on margin is computed against the broker figure');
    ok(Math.abs(r.returnOnMarginPct - 4.97) < 0.05, `₹9,000 on ₹1,80,959 is ${r.returnOnMarginPct}%`);
  }
  {
    /* The case the whole requirement is about: same rupee edge, very different
       capital blocked. Ranking by rupees calls them equal; ranking by return on
       margin does not. */
    const { opt } = mk();
    const r = await opt.rank([
      { label: 'naked strangle', instruments: NAKED, expectedEdge: 9000 },
      { label: 'hedged condor', instruments: HEDGED, expectedEdge: 9000 },
    ]);
    ok(r.best.label === 'hedged condor',
      'with the SAME expected edge, the structure blocking half the capital ranks first');
    ok(r.ranked[0].returnOnMargin > r.ranked[1].returnOnMargin * 1.9,
      `and by nearly 2× (${r.ranked[0].returnOnMarginPct}% vs ${r.ranked[1].returnOnMarginPct}%)`);
  }
  {
    const { opt } = mk();
    const r = await opt.rank([
      { label: 'big rupees, heavy margin', instruments: NAKED, expectedEdge: 10000 },
      { label: 'smaller rupees, light margin', instruments: HEDGED, expectedEdge: 6000 },
    ]);
    ok(r.rankingChanged === true, 'the two rankings disagree here');
    ok(r.best.label === 'smaller rupees, light margin' && r.wouldHaveChosenByRupee.label === 'big rupees, heavy margin',
      'return on margin picks the smaller absolute profit — ₹6,000 on ₹92,694 beats ₹10,000 on ₹1,80,959');
    ok(/would have picked/.test(r.note), 'and the change of choice is stated, so the effect of the new metric is visible');
  }
  {
    const { opt } = mk({ broker: stubBroker({ fail: 'no route' }) });
    const r = await opt.rank([{ label: 'x', instruments: NAKED, expectedEdge: 1000 }]);
    ok(r.ranked.length === 0 && r.unpriceable.length === 1,
      'candidates that could not be priced are returned separately, not silently dropped');
    ok(r.unpriceable[0].error, '  …with the reason, so an API failure does not look like an absence of opportunities');
  }

  /* ── 5. the hedge trade-off is stated, not resolved ────────────────────── */
  console.log('\nhedge trade-off');
  {
    const { opt } = mk();
    const h = await opt.evaluateHedge({
      naked: { instruments: NAKED, expectedEdge: 9000 },
      hedged: { instruments: HEDGED, expectedEdge: 6600, wingCost: 2400 },
      tail: { nakedMaxLoss: null, hedgedMaxLoss: 55000 },
    });
    ok(h.ok, 'the hedge is evaluated');
    ok(h.margin.released === 88265 && Math.abs(h.margin.releasedPct - 48.78) < 0.1,
      `margin released ₹${h.margin.released} (${h.margin.releasedPct}%)`);
    ok(h.edge.premiumGivenUp === 2400, `premium given up ₹${h.edge.premiumGivenUp} — reported separately, not netted`);
    ok(h.returnOnMargin.multiple > 1.4,
      `return on margin improves ${h.returnOnMargin.multiple}× despite the smaller credit`);
    ok(h.tailRisk.nakedMaxLossLabel === 'UNBOUNDED',
      'a naked short option\'s maximum loss is rendered UNBOUNDED — never as a number');
    ok(h.tailRisk.change === 'unbounded → capped', 'and the change in tail risk is stated in those terms');
    ok(/not resolved/.test(h.verdict),
      'the module states the trade-off and refuses to resolve it — capital-constrained and risk-constrained accounts want different answers');
  }

  /* ── 6. the unwind order is a safety rule ─────────────────────────────── */
  console.log('\nunwind order');
  {
    const { opt } = mk();
    const p = await opt.unwindPlan({ instruments: HEDGED, available: 500000 });
    ok(p.order === 'SHORTS_FIRST', 'the plan closes shorts first');
    const firstClosed = p.steps[0].close[0];
    ok(String(firstClosed.transaction_type).toUpperCase() === 'SELL', 'the first leg closed is a short');
    const lastClosed = p.steps[p.steps.length - 1].close[0];
    ok(String(lastClosed.transaction_type).toUpperCase() === 'BUY', 'and the protective longs are closed LAST');
    ok(p.unsafeAlternative && p.unsafeAlternative.ifLongsClosedFirst === 180959,
      `closing the wings first would spike margin to ₹${p.unsafeAlternative.ifLongsClosedFirst} — the number behind the rule, not just the rule`);
    ok(/naked short/.test(p.rule), 'and the rule explains why');
  }
  {
    /* The property that makes shorts-first safe, stated as a property rather
       than as advice: closing shorts first makes the margin fall monotonically,
       so no intermediate state can be worse than the one already being carried.
       A breach in this order would mean the position was over the limit before
       the unwind began. */
    const { opt } = mk();
    const p = await opt.unwindPlan({ instruments: HEDGED, available: 500000 });
    const seq = p.steps.map(s => s.marginAfter);
    ok(seq.every((v, i) => i === 0 || v <= seq[i - 1]),
      `margin only ever falls in the safe order (${seq.join(' → ')})`);
    ok(p.safe === true, 'so a position that fitted before the unwind still fits at every step');
  }
  {
    /* And the wrong order is where the danger is. Closing the wings first takes
       a ₹92,694 position to ₹1,80,959 — nearly double — at the moment the
       account is least able to absorb it. */
    const { opt } = mk();
    const p = await opt.unwindPlan({ instruments: HEDGED, available: 120000 });
    const start = 92694;
    ok(p.unsafeAlternative.ifLongsClosedFirst > start,
      `the unsafe order takes margin from ₹${start} to ₹${p.unsafeAlternative.ifLongsClosedFirst}`);
    ok(p.unsafeAlternative.ifLongsClosedFirst > 120000 && p.safe === true,
      'with ₹1,20,000 available the safe order fits and the unsafe one would breach — which is the entire reason the rule exists');
  }

  /* ── 7. the monitor: projected peak, not current use ───────────────────── */
  console.log('\nutilisation and headroom');
  {
    const { calc } = mk();
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    const s = await mon.snapshot({ totalMargin: 700000, usedMargin: 200000 });
    ok(s.utilisationPct === 28.57, `utilisation ${s.utilisationPct}%`);
    ok(s.headroom === 500000, 'headroom is reported');
    ok(s.level === 'OK', 'and the level is OK');
  }
  {
    const { calc } = mk();
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    mon.addWorking('o1', HEDGED, 92694);
    mon.addWorking('o2', NAKED, 180959);
    const s = await mon.snapshot({ totalMargin: 700000, usedMargin: 300000 });
    ok(s.projectedPeakMargin === 573653,
      `projected peak ₹${s.projectedPeakMargin} includes both working orders — current use is history`);
    ok(s.projectedUtilisationPct > s.utilisationPct, 'projected utilisation exceeds current');
    ok(s.level === 'WARN', `and the level reflects the PROJECTION (${s.level}), not the current 42.9%`);
  }
  {
    const { calc } = mk();
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    mon.addWorking('o1', NAKED, null);
    const s = await mon.snapshot({ totalMargin: 700000, usedMargin: 300000 });
    ok(s.projectedPeakMargin === null && s.workingMarginKnown === false,
      'ONE unpriced working order makes the projection null — not "the rest of it"');
    ok(/no priced margin/.test(s.why), 'and it says which fact is missing');
  }
  {
    const { calc } = mk();
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    const s = await mon.snapshot({ totalMargin: null, usedMargin: 300000 });
    ok(s.measurable === false && s.utilisationPct === null && s.headroom === null,
      'unknown total margin makes every derived figure null — headroom is never "total minus null"');
    ok(s.level === 'UNKNOWN', 'and the level is UNKNOWN, which is not OK');
  }

  /* ── 8. refuse before the broker does ─────────────────────────────────── */
  console.log('\nblock before sending');
  {
    const { calc } = mk();
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    const fit = await mon.wouldFit({ instruments: HEDGED, state: { totalMargin: 700000, usedMargin: 100000 } });
    ok(fit.fits === true && fit.required === 92694, `a basket that fits is admitted, needing ₹${fit.required}`);
  }
  {
    const { calc } = mk();
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    const fit = await mon.wouldFit({ instruments: NAKED, state: { totalMargin: 250000, usedMargin: 100000 } });
    ok(fit.fits === false && fit.reason === 'HEADROOM',
      'a basket that would breach headroom is refused BEFORE it is sent');
    ok(/exceeds the usable limit/.test(fit.detail) && /buffer/.test(fit.detail),
      '  …with the numbers and the buffer named, because "blocked" without "by how much" cannot be acted on');
  }
  {
    const { calc } = mk({ broker: stubBroker({ fail: 'timeout' }) });
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    const fit = await mon.wouldFit({ instruments: NAKED, state: { totalMargin: 700000, usedMargin: 0 } });
    ok(fit.fits === false && fit.reason === 'MARGIN_UNKNOWN',
      'a basket the broker cannot price is refused — an order whose cost is unknown is not sent');
  }
  {
    const { calc } = mk();
    const mon = new MarginMonitor({ calculator: calc, log: quiet });
    const fit = await mon.wouldFit({ instruments: HEDGED, state: { totalMargin: 700000, usedMargin: 610000 } });
    ok(fit.fits === false && (fit.reason === 'STOP_ENTRIES' || fit.reason === 'HEADROOM'),
      'and utilisation past the stop-entries threshold refuses new entries');
  }

  /* ── 9. reconciliation makes the estimator measurable ──────────────────── */
  console.log('\nreconciliation');
  {
    const { calc } = mk();
    const before = calc.accuracy();
    ok(before.samples === 0 || before.samples > 0, 'accuracy is queryable');
    const fresh = new MarginCalculator({ broker: stubBroker(), log: quiet });
    fresh._rows = () => [];
    const empty = fresh.accuracy();
    ok(empty.samples === 0 && empty.meanErrorPct === null,
      'with no samples the error is null, not zero');
    ok(/UNVALIDATED, not accurate/.test(empty.note),
      '  …and it says UNVALIDATED rather than implying accuracy — "no samples" and "perfect" must not share a display');
  }
  {
    const c = new MarginCalculator({ broker: stubBroker(), log: quiet });
    const rows = [];
    c._rows = () => rows;
    c.record = MarginCalculator.prototype.record.bind(Object.assign(Object.create(MarginCalculator.prototype), {
      _rows: () => rows, now: () => 1000, log: quiet,
    }));
    // 130000 estimated against a 180959 reality — the real assumption, scored.
    const rec = c.record({ tag: 't', strategy: 'STRANGLE', basket: NAKED, estimated: 130000, brokerFinal: 180959 });
    ok(Math.abs(rec.errorPct + 28.16) < 0.1,
      `the ₹1,30,000 assumption is scored at ${rec.errorPct}% against the broker's ₹1,80,959`);
    ok(rec.errorRs === -50959, 'and the rupee error is recorded alongside');
  }
  {
    const c = new MarginCalculator({ broker: stubBroker(), log: quiet });
    c._rows = () => [{ errorPct: -28 }, { errorPct: -26 }, { errorPct: -30 }];
    const a = c.accuracy();
    ok(a.samples === 3 && a.meanErrorPct === -28, 'accuracy summarises the samples');
    ok(/UNDER-ESTIMATES|under-estimates/i.test(a.biasNote),
      'and a consistent under-estimate is named as the dangerous direction, not just as a bias');
  }

  /* ── 10. the connector call is real ───────────────────────────────────── */
  console.log('\nthe broker call');
  const CONN = code('upstox-connector.js');
  ok(/getBasketMargin/.test(CONN), 'the connector exposes a basket-margin method');
  ok(/charges\/margin/.test(CONN), 'pointing at the exchange calculator endpoint');
  ok(/final_margin/.test(CONN), 'and it reads final_margin — the number the account is actually charged');
  ok(!/v3\/charges/.test(CONN), 'not the v3 path, which returns 404 (measured)');
  ok(/transaction_type !== 'BUY' && l\.transaction_type !== 'SELL'/.test(CONN),
    'every leg is validated before the call — a malformed basket returns a margin for something else');
  const RM = code('risk-manager.js');
  ok(/marginHeadroom/.test(RM), 'the risk layer has a margin headroom check');
  ok(/no margin verdict supplied/.test(RM),
    'and an intent that was never priced is refused rather than assumed to fit');

  console.log(`\n${n} checks passed\n`);
})().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
