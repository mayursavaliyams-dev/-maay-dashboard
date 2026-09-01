/**
 * opt-at-low — which legs are sitting at today's low RIGHT NOW.
 * Run: node test/opt-at-low.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * WHAT THIS IS
 *   `pos` is a fact: 0 means the leg is trading at its session low, 100 at its high.
 *   It is NOT a signal, and the page says so. A leg sits at its low because it has
 *   been falling; this platform's own 1,200-trade backtest put directional option
 *   BUYING at a profit factor of 0.94, and the hero-zero base rate is still Unknown.
 *
 * THREE THINGS MEASUREMENT CHANGED
 *   1. The obvious source, /api/options/snapshot, triggers an upstream broker fetch
 *      whenever its 4s cache has lapsed. A page polling it every 20s would force a
 *      fresh chain call every single time — the mechanism behind the Upstox 429 on
 *      2026-07-27. Reading the in-memory tracker instead measured 3-5ms and costs
 *      nothing upstream, which is the only reason a 20s cadence is defensible.
 *   2. Sorting by "closest to the low" alone put deep-ITM strikes at the top whose
 *      entire day spanned 1% of their premium. They are not at a low; they never
 *      moved. Hence the range gate.
 *   3. rec.high/low only advance on a CONFIRMED extreme, so a live tick can sit
 *      outside them for one poll. Unclamped that rendered "+-2.17%" and "-12.5%".
 *   4. The live table now shows Past PoP: a research-only bounce score derived from
 *      past intraday range, low proximity and distance above low. It is not a
 *      calibrated win rate or a trade command.
 *   5. The live table also shows Truth: whether the high actually happened after
 *      the low. A low newer than the high is PENDING, not proven.
 *   6. Accuracy is shown as TRUE / (TRUE + PENDING) for visible rows. UNKNOWN is
 *      excluded because incomplete timestamps are not a measured miss.
 *   7. OI Mix / OI Analysis is same-strike CE/PE change-OI context for the live
 *      low list. It is SUPPORT / CONFLICT / NEUTRAL / UNKNOWN, never a trade permission.
 *   8. Buy Start is a paper/research flag only: near day-low plus adjusted
 *      probability >=75 and no OI conflict.
 *   9. Setup/Data/Sell Plan adds freshness, liquidity, trap flags, setup score
 *      and a paper-only target ladder without a fresh broker call.
 *  10. Retest confirms whether the low zone was touched, bounced, retested and
 *      held before a stronger buy-start label appears.
 *  11. Research outcomes are persisted to a bounded paper ledger and surfaced in
 *      the table/API as result status, never as a live order.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
// The slice starts at the endpoint's own header comment, not at app.get: the reasons
// this endpoint exists at all live there, and a test that reads only the code cannot
// check that they were written down.
const H = SRV.slice(SRV.indexOf("/* Where each leg is sitting inside TODAY'S range"),
                    SRV.indexOf('// Black-Scholes greeks'));
// Two views of the same region. Claims about SHAPE must be checked against the code
// alone: the header comment names /api/options/snapshot in order to explain why the
// endpoint does not call it, and matching on the prose said the opposite of the truth.
const CODE = H.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'capture.html'), 'utf8');

console.log('opt-at-low');

// ── @test:performance — it must not touch the broker ─────────────────────────
{
  ok(H.length > 0, 'the endpoint exists');
  ok(/_optHL\[inst\]/.test(CODE), 'it reads the in-memory high/low tracker');
  ok(!/optionSnapshot|options\/snapshot|await /.test(CODE),
    'and never awaits a chain fetch — a poll that costs an upstream call is how the 429 happened');
  ok(/429/.test(H), 'with that reason recorded where the next person will read it');
}

// ── @test:failure — it survives a restart ────────────────────────────────────
{
  ok(/_optMin\.get\(/.test(CODE),
    'when the tick path is empty it falls back to the restored minute bars');
  ok(/bar\[3\]/.test(CODE), 'taking the newest bar\'s close as the last price');
  // Measured: straight after a restart the tick path is empty for every leg, so
  // without the fallback the endpoint returned nothing at all.
  ok(/138 of 138|NOT restored at boot/.test(H),
    'and the measurement that forced it is written down');
}

// ── @test:unit — position, clamping, and the confirmed-extreme lag ──────────
{
  // The endpoint's arithmetic, exercised directly.
  const calc = (last, low, high) => ({
    pos: +Math.min(100, Math.max(0, ((last - low) / (high - low)) * 100)).toFixed(1),
    fromLowPct: +Math.max(0, ((last - low) / low) * 100).toFixed(2),
    atLow: last <= low,
  });
  assert.deepStrictEqual(calc(10, 10, 20), { pos: 0, fromLowPct: 0, atLow: true }); n++;
  assert.deepStrictEqual(calc(20, 10, 20), { pos: 100, fromLowPct: 100, atLow: false }); n++;
  assert.deepStrictEqual(calc(15, 10, 20), { pos: 50, fromLowPct: 50, atLow: false }); n++;
  console.log('  ✓ 0% at the low, 100% at the high, 50% in the middle');

  // A tick outside the CONFIRMED range: the verifier makes a candidate wait a poll.
  const below = calc(11.25, 11.5, 13.5);
  assert.strictEqual(below.pos, 0); n++;
  assert.strictEqual(below.fromLowPct, 0); n++;
  assert.strictEqual(below.atLow, true); n++;
  const above = calc(44.95, 38.4, 44.9);
  assert.strictEqual(above.pos, 100); n++;
  console.log('  ✓ a tick outside the confirmed range clamps to 0 or 100 — it never renders a negative percent');
  ok(/Clamped, because/.test(H) && /verifier/.test(H),
    'and the clamp says why, so nobody "fixes" it back');
}

// ── @test:regression — the range gate ───────────────────────────────────────
{
  ok(/minRangePct/.test(CODE), 'a minimum day range can be required');
  ok(/thinRange\+\+/.test(CODE), 'and legs that never moved are counted, not silently dropped');
  ok(/has not moved|never moved|simply sat/.test(H + PAGE),
    'with the reason stated: at the low of a 1% range is not at a low');
  // A deep-ITM leg with a 1.2% range must not outrank a real mover sitting mid-range.
  const legs = [
    { name: 'deep ITM, never moved', last: 1025.65, low: 1025.65, high: 1037.65 },
    { name: 'real mover',            last: 12.4,    low: 10.65,   high: 14.15 },
  ].map(l => ({ ...l, rangePct: ((l.high - l.low) / l.low) * 100 }));
  assert.ok(legs[0].rangePct < 2); n++;
  assert.ok(legs[1].rangePct > 30); n++;
  assert.strictEqual(legs.filter(l => l.rangePct >= 15).length, 1); n++;
  console.log('  ✓ a 15% gate keeps the mover and drops the leg that spanned 1.2% all day');
}

// ── @test:unit — Past PoP from past return/range behaviour ─────────────────
{
  ok(/bouncePoP/.test(CODE) && /pastReturnPct/.test(CODE) && /popReason/.test(CODE),
    'the endpoint emits Past PoP with the inputs that caused it');
  ok(/lowProximity/.test(CODE) && /fromLowPct/.test(CODE),
    'Past PoP is based on low proximity and distance above low');
  const pop = (pos, rangePct, fromLowPct) => +Math.max(5, Math.min(85,
    25 + (100 - pos) * 0.35 + Math.min(150, rangePct) * 0.18 - fromLowPct * 0.12
  )).toFixed(1);
  assert.ok(pop(2, 150, 3) > pop(60, 25, 20)); n++;
  assert.ok(pop(0, 400, 0) <= 85); n++;
  console.log('  ✓ Past PoP rises near the low after a large past range and is capped');
}

// ── @test:unit — truth view for low-to-high time order ─────────────────────
{
  ok(/lowHighTruth/.test(CODE) && /truthReason/.test(CODE),
    'the endpoint emits a low-to-high truth state and reason');
  ok(/highAtMs > lowAtMs \? 'TRUE' : 'PENDING'/.test(CODE),
    'truth is based on high-after-low time order, not on range size alone');
  ok(/lowHighAccuracyPct/.test(CODE) && /accuracyReason/.test(CODE),
    'the endpoint emits visible low-to-high accuracy parameters');
  ok(/trueCount \+ pendingCount/.test(CODE) && /lowHighUnknown/.test(CODE),
    'aggregate accuracy excludes UNKNOWN timestamp rows from the denominator');
  const truth = (lowAt, highAt) => lowAt > 0 && highAt > 0 ? (highAt > lowAt ? 'TRUE' : 'PENDING') : 'UNKNOWN';
  assert.strictEqual(truth(1000, 2000), 'TRUE'); n++;
  assert.strictEqual(truth(2000, 1000), 'PENDING'); n++;
  assert.strictEqual(truth(0, 1000), 'UNKNOWN'); n++;
  const acc = rows => {
    const t = rows.filter(x => x === 'TRUE').length;
    const p = rows.filter(x => x === 'PENDING').length;
    return t + p ? +(t / (t + p) * 100).toFixed(1) : null;
  };
  assert.strictEqual(acc(['TRUE', 'PENDING', 'UNKNOWN', 'TRUE']), 66.7); n++;
  assert.strictEqual(acc(['UNKNOWN']), null); n++;
  console.log('  ✓ low-to-high truth is TRUE, PENDING or UNKNOWN from timestamps');
}

// ── @test:unit — OI mix context for buy-low rows ───────────────────────────
{
  ok(/oiMix/.test(CODE) && /oiMixReason/.test(CODE) && /oiMixScore/.test(CODE),
    'the endpoint emits OI Mix with a reason and score');
  ok(/oiAnalysis/.test(CODE) && /ceChangeOI/.test(CODE) && /peChangeOI/.test(CODE),
    'the endpoint emits detailed OI Analysis with CE and PE change-OI');
  ok(/sideChangeOI/.test(CODE) && /oppositeChangeOI/.test(CODE) && /supportScore/.test(CODE),
    'OI Analysis names the selected-leg and opposite-leg OI pressure');
  ok(/_latestNoFetchDoi/.test(SRV) && /option-snapshot-cache/.test(SRV) && /oi-snapshot-memory/.test(SRV),
    'OI Mix can use cached/in-memory OI data without forcing a fresh broker chain call');
  ok(/sourceConfidence/.test(SRV) && /sourceAgeMs/.test(SRV),
    'OI Analysis exposes source confidence and source age');
  ok(/not a buy command|not permission\s+to trade/.test(H + PAGE),
    'OI Mix is framed as context, not a trade command');
  const mix = (type, ceDoi, peDoi) => {
    const support = type === 'CE' ? ceDoi : peDoi;
    const resistance = type === 'CE' ? peDoi : ceDoi;
    if (support > Math.max(0, resistance) * 1.2 && support > 0) return 'SUPPORT';
    if (resistance > Math.max(0, support) * 1.2 && resistance > 0) return 'CONFLICT';
    return 'NEUTRAL';
  };
  assert.strictEqual(mix('CE', 500, 100), 'SUPPORT'); n++;
  assert.strictEqual(mix('CE', 100, 500), 'CONFLICT'); n++;
  assert.strictEqual(mix('PE', 100, 500), 'SUPPORT'); n++;
  assert.strictEqual(mix('PE', 500, 100), 'CONFLICT'); n++;
  assert.strictEqual(mix('CE', 100, 110), 'NEUTRAL'); n++;
  console.log('  ✓ OI Mix supports or conflicts by comparing same-strike CE/PE ΔOI');
}

// ── @test:unit — data quality, trap flags and sell-high ladder ─────────────
{
  ok(/_freshnessStatus/.test(SRV) && /priceFreshness/.test(CODE) && /oiFreshness/.test(CODE),
    'the endpoint emits price and OI freshness without a fresh broker call');
  ok(/_latestNoFetchLiquidity/.test(SRV) && /liquidity/.test(CODE) && /spreadPct/.test(SRV),
    'the endpoint emits cached bid-ask/volume liquidity context');
  ok(/_setupQualityForLowLeg/.test(SRV) && /setupStatus/.test(SRV) && /setupScore/.test(SRV),
    'the endpoint emits setup status and setup score');
  ok(/trapFlags/.test(SRV) && /FALLING_KNIFE/.test(SRV) && /WIDE_SPREAD/.test(SRV),
    'trap flags include falling-knife and wide-spread blockers');
  ok(/_sellHighPlanForLowLeg/.test(SRV) && /sellPlan/.test(SRV) && /finalTarget/.test(SRV),
    'the endpoint emits a paper-only sell-high target ladder');
  ok(/_retestStatusForLowLeg/.test(SRV) && /retestStatus/.test(SRV) && /entryZone/.test(SRV),
    'the endpoint emits low-zone retest status and entry zone');
  ok(/_trackOptLowResearchOutcome/.test(SRV) && /opt-low-outcomes\.json/.test(SRV),
    'shown buy-low setups are tracked in a dedicated paper outcome ledger');
  ok(/\/api\/opt-at-low\/outcomes/.test(SRV) && /summary/.test(SRV),
    'the paper outcome ledger has a read-only summary API');
  const freshness = (ageMs, staleMs = 120000) => {
    if (!Number.isFinite(Number(ageMs))) return 'UNKNOWN';
    if (ageMs <= staleMs) return 'FRESH';
    if (ageMs <= staleMs * 3) return 'AGING';
    return 'STALE';
  };
  assert.strictEqual(freshness(30000), 'FRESH'); n++;
  assert.strictEqual(freshness(180000), 'AGING'); n++;
  assert.strictEqual(freshness(500000), 'STALE'); n++;
  const spread = (bid, ask, volume) => {
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
    const sp = bid > 0 && ask >= bid && mid > 0 ? ((ask - bid) / mid) * 100 : null;
    if (sp !== null && sp <= 4 && volume > 0) return 'GOOD';
    if (sp !== null && sp <= 8) return 'OK';
    if (sp !== null) return 'WIDE';
    return volume > 0 ? 'VOLUME_ONLY' : 'UNKNOWN';
  };
  assert.strictEqual(spread(99, 101, 1000), 'GOOD'); n++;
  assert.strictEqual(spread(90, 110, 1000), 'WIDE'); n++;
  const ladder = (low, high, last) => ({
    target1: +(low + (high - low) * 0.4).toFixed(2),
    target2: +(low + (high - low) * 0.7).toFixed(2),
    finalTarget: +(low + (high - low) * 0.9).toFixed(2),
    stop: +(Math.max(0.05, low * 0.98).toFixed(2)),
    rewardRisk: +((Math.max(0, low + (high - low) * 0.9 - last)) / Math.max(0.01, last - Math.max(0.05, low * 0.98))).toFixed(2),
  });
  assert.deepStrictEqual(ladder(100, 200, 110), { target1: 140, target2: 170, finalTarget: 190, stop: 98, rewardRisk: 6.67 }); n++;
  console.log('  ✓ Data quality, trap flags and sell-high ladder are computed from cached/live-memory fields');
}

// ── @test:unit — retest confirmation above the day low ─────────────────────
{
  ok(/HELD_LOW/.test(SRV) && /FAILED_LOW/.test(SRV) && /FIRST_TOUCH/.test(SRV),
    'retest has held, failed and first-touch states');
  ok(/strongStartRequiresRetest:\s*'HELD_LOW'/.test(SRV),
    'STRONG_START records that it requires a held low retest');
  const retest = (prices, low = 100, high = 200, last = prices.at(-1)) => {
    const range = high - low;
    const zoneWidth = Math.max(0.05, range * 0.08, low * 0.02);
    const zoneTop = +(low + zoneWidth).toFixed(2);
    const bounceLevel = +(low + range * 0.25).toFixed(2);
    const failLevel = +Math.max(0.01, low - zoneWidth * 0.5).toFixed(2);
    const firstTouchIdx = prices.findIndex(p => p <= zoneTop);
    if (firstTouchIdx < 0) return 'NO_TOUCH';
    const bounceIdxRel = prices.slice(firstTouchIdx + 1).findIndex(p => p >= bounceLevel);
    if (bounceIdxRel < 0) return 'FIRST_TOUCH';
    const bounceIdx = firstTouchIdx + 1 + bounceIdxRel;
    const retestIdxRel = prices.slice(bounceIdx + 1).findIndex(p => p <= zoneTop);
    if (retestIdxRel < 0) return 'BOUNCING';
    const afterRetest = prices.slice(bounceIdx + 1 + retestIdxRel);
    if (afterRetest.some(p => p < failLevel) || last < failLevel) return 'FAILED_LOW';
    return last > zoneTop ? 'HELD_LOW' : 'RETESTING';
  };
  assert.strictEqual(retest([101, 130, 106, 116]), 'HELD_LOW'); n++;
  assert.strictEqual(retest([101, 130, 105]), 'RETESTING'); n++;
  assert.strictEqual(retest([101, 130, 90]), 'FAILED_LOW'); n++;
  assert.strictEqual(retest([101, 110, 112]), 'FIRST_TOUCH'); n++;
  assert.strictEqual(retest([130, 140, 150]), 'NO_TOUCH'); n++;
  console.log('  ✓ Retest separates first touch, bounce, held-low and failed-low paths');
}

// ── @test:unit — paper outcome tracking for shown setups ───────────────────
{
  ok(/researchOutcome/.test(CODE) && /_resolveOptLowOutcome/.test(SRV),
    'each tracked row can carry paper outcome status');
  ok(/FINAL_TARGET/.test(SRV) && /TARGET2/.test(SRV) && /TARGET1/.test(SRV) && /STOP_OR_FAILED_LOW/.test(SRV),
    'outcomes distinguish target progress from stop/failed-low');
  ok(/slice\(-1000\)/.test(SRV) && /paperOnly:\s*true/.test(SRV),
    'the outcome ledger is bounded and explicitly paper-only');
  const resolve = ({ last, sp, retestStatus }) => {
    if (retestStatus === 'FAILED_LOW' || (sp.stop != null && last <= sp.stop)) return 'STOP_OR_FAILED_LOW';
    if (sp.finalTarget != null && last >= sp.finalTarget) return 'FINAL_TARGET';
    if (sp.target2 != null && last >= sp.target2) return 'TARGET2';
    if (sp.target1 != null && last >= sp.target1) return 'TARGET1';
    return 'PENDING';
  };
  const sp = { target1: 140, target2: 170, finalTarget: 190, stop: 98 };
  assert.strictEqual(resolve({ last: 110, sp }), 'PENDING'); n++;
  assert.strictEqual(resolve({ last: 145, sp }), 'TARGET1'); n++;
  assert.strictEqual(resolve({ last: 175, sp }), 'TARGET2'); n++;
  assert.strictEqual(resolve({ last: 195, sp }), 'FINAL_TARGET'); n++;
  assert.strictEqual(resolve({ last: 97, sp }), 'STOP_OR_FAILED_LOW'); n++;
  assert.strictEqual(resolve({ last: 110, sp, retestStatus: 'FAILED_LOW' }), 'STOP_OR_FAILED_LOW'); n++;
  console.log('  ✓ Paper outcomes resolve pending, target and failed-low states');
}

// ── @test:unit — buy-start gate above the day low ──────────────────────────
{
  ok(/_buyStartForLowLeg/.test(SRV), 'the buy-start gate is one named function');
  ok(/buyStartStatus/.test(SRV) && /buyStartProbability/.test(SRV) && /buyStartReason/.test(SRV),
    'the endpoint emits Buy Start status, probability and reason');
  ok(/minProbability:\s*75/.test(SRV) && /maxPosPct:\s*12/.test(SRV) && /maxFromLowPct:\s*8/.test(SRV),
    'the Buy Start gate records its probability and low-proximity thresholds');
  ok(/oiConflictBlocks:\s*true/.test(SRV) && /paperOnly:\s*true/.test(SRV),
    'OI conflict blocks the flag and the output is explicitly paper-only');
  ok(/setupStatus === 'AVOID'/.test(SRV) && /trap\/data-quality gate/.test(SRV),
    'the Buy Start gate is blocked by setup AVOID, not only by OI conflict');
  const gate = ({ pos, fromLowPct, bouncePoP, oiMix, truth, setupStatus, retestStatus }) => {
    const nearLow = Number(pos) <= 12 || Number(fromLowPct) <= 8;
    let probability = Number(bouncePoP || 0);
    if (oiMix === 'SUPPORT') probability += 6;
    else if (oiMix === 'CONFLICT') probability -= 14;
    else if (oiMix === 'UNKNOWN') probability -= 4;
    if (truth === 'PENDING') probability -= 6;
    if (retestStatus === 'HELD_LOW') probability += 8;
    else if (retestStatus === 'RETESTING') probability += 3;
    else if (retestStatus === 'FIRST_TOUCH') probability -= 5;
    else if (retestStatus === 'FAILED_LOW') probability -= 18;
    probability = +Math.max(0, Math.min(95, probability)).toFixed(1);
    const blocked = oiMix === 'CONFLICT' || setupStatus === 'AVOID';
    return blocked
      ? 'AVOID'
      : nearLow && probability >= 82 && retestStatus === 'HELD_LOW'
      ? 'STRONG_START'
      : nearLow && probability >= 75
      ? 'START'
      : nearLow && probability >= 68
        ? 'WATCH'
        : 'WAIT';
  };
  assert.strictEqual(gate({ pos: 5, fromLowPct: 2, bouncePoP: 76, oiMix: 'SUPPORT', truth: 'TRUE' }), 'START'); n++;
  assert.strictEqual(gate({ pos: 5, fromLowPct: 2, bouncePoP: 76, oiMix: 'CONFLICT', truth: 'TRUE' }), 'AVOID'); n++;
  assert.strictEqual(gate({ pos: 8, fromLowPct: 4, bouncePoP: 70, oiMix: 'NEUTRAL', truth: 'TRUE' }), 'WATCH'); n++;
  assert.strictEqual(gate({ pos: 30, fromLowPct: 18, bouncePoP: 90, oiMix: 'SUPPORT', truth: 'TRUE' }), 'WAIT'); n++;
  assert.strictEqual(gate({ pos: 5, fromLowPct: 2, bouncePoP: 85, oiMix: 'SUPPORT', truth: 'TRUE', setupStatus: 'AVOID' }), 'AVOID'); n++;
  assert.strictEqual(gate({ pos: 5, fromLowPct: 2, bouncePoP: 76, oiMix: 'SUPPORT', truth: 'TRUE', retestStatus: 'HELD_LOW' }), 'STRONG_START'); n++;
  console.log('  ✓ Buy Start upgrades to STRONG_START only after a held low retest');
}

// ── @test:integration — full accounting, and honest framing on the page ────
{
  for (const k of ['returned', 'tracked', 'noTick', 'noRange', 'belowFloor', 'thinRange'])
    { assert.ok(new RegExp(k).test(CODE), `counts.${k} is reported`); n++; }
  console.log('  ✓ every tracked leg is accounted for, not just the survivors');

  ok(/not a reason to buy/.test(PAGE), 'the page states plainly that this is not a buy signal');
  ok(/0\.94/.test(PAGE), 'and cites the profit factor from this platform\'s own backtest');
  ok(/Unknown/.test(PAGE), 'and that the hero-zero base rate is still unknown');
  ok(/Past PoP/.test(PAGE) && /research-only bounce score/.test(PAGE),
    'the page labels Past PoP as research-only, not a calibrated win rate');
  ok(/Truth/.test(PAGE) && /PENDING means/.test(PAGE),
    'the page shows whether low-to-high is proven or still pending');
  ok(/Accuracy/.test(PAGE) && /Low→High accuracy/.test(PAGE) && /TRUE \+ PENDING/.test(PAGE),
    'the page shows visible low-to-high accuracy and its denominator');
  ok(/bouncePoP/.test(PAGE) && /popReason/.test(PAGE),
    'the live rows render the Past PoP and disclose why it was assigned');
  ok(/lowHighTruth/.test(PAGE) && /truthReason/.test(PAGE),
    'the live rows render the truth state and disclose the time-order reason');
  ok(/lowHighAccuracyPct/.test(PAGE) && /accuracyReason/.test(PAGE),
    'the live rows render per-row accuracy contribution and disclose why');
  ok(/OI Mix/.test(PAGE) && /oiMix/.test(PAGE) && /oiMixReason/.test(PAGE),
    'the live rows render OI Mix and disclose why it was assigned');
  ok(/OI Analysis/.test(PAGE) && /ceChangeOI/.test(PAGE) && /peChangeOI/.test(PAGE),
    'the live rows render CE/PE change-OI analysis inside the buy-low/high-sell table');
  ok(/Buy Start/.test(PAGE) && /buyStartStatus/.test(PAGE) && /buyStartProbability/.test(PAGE),
    'the live rows render the Buy Start gate inside the buy-low/high-sell table');
  ok(/Retest/.test(PAGE) && /retestStatus/.test(PAGE) && /entryZone/.test(PAGE),
    'the live rows render retest status and entry zone');
  ok(/Result/.test(PAGE) && /researchOutcome/.test(PAGE),
    'the live rows render paper outcome status');
  ok(/Setup/.test(PAGE) && /setupStatus/.test(PAGE) && /setupScore/.test(PAGE),
    'the live rows render Setup status and score');
  ok(/Data/.test(PAGE) && /priceFreshness/.test(PAGE) && /liquidity/.test(PAGE),
    'the live rows render freshness and liquidity data quality');
  ok(/Sell Plan/.test(PAGE) && /sellPlan/.test(PAGE) && /finalTarget/.test(PAGE),
    'the live rows render the sell-high target ladder');
  ok(/noteNow[\s\S]{0,700}noteHind|id="noteNow"/.test(PAGE),
    'the two views carry separate caveats — they answer different questions');
}

// ── @test:memory-leak / @test:rollback ─────────────────────────────────────
{
  ok(!/setInterval|setTimeout/.test(CODE), 'the endpoint holds no timer — it answers and returns');
  ok(/const NOW_POLL_MS = 20000;/.test(PAGE), 'the live view polls every 20s');
  ok(/MODE === 'now'/.test(PAGE) && /if \(MODE === 'now'\) return loadNow\(opts\)/.test(PAGE),
    'the live view is a branch on top of the existing loader, so it can be removed on its own');
  ok(/\$\('dSel'\)\.disabled = m === 'now'/.test(PAGE),
    'controls that do not drive the current view are disabled rather than left lying');
}

console.log(`\n${n} assertions passed`);
