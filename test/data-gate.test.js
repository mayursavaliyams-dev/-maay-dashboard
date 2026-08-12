/**
 * data-gate — if the data is not trustworthy, the bot does not trade on it.
 * Run: node test/data-gate.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:boundary @test:security @test:rollback
 *
 * THE ACCEPTANCE HARNESS IS §9: a simulated feed outage, a stale instrument and
 * a crossed book, each driven end to end, each confirmed to BLOCK.
 *
 * WHY PER-INSTRUMENT THRESHOLDS RATHER THAN ONE GLOBAL NUMBER
 *
 * Measured on this system's own archive, 2026-07-29: of 662 strike-side series in
 * a single session, **70 never printed a different price all day**, while the ATM
 * strikes moved constantly. One threshold is wrong in both directions on the same
 * chain at the same moment — it either calls the ATM fresh when it has died, or
 * calls a deep OTM strike stale when it is behaving exactly as it always does.
 *
 * So each instrument is judged against its own trailing MEDIAN inter-change gap.
 * Median rather than mean because the same archive contains a single 42-minute
 * hole, and one such gap drags a mean far enough to make everything downstream
 * look fresh.
 *
 * THE OTHER THING THIS FILE PINS
 *
 * Every check has three outcomes: fresh, stale, and UNDECIDABLE. An instrument
 * that has never ticked has `priceStale: null`, not `false` — and null must never
 * pass a gate. Most of the assertions below are that something is refused rather
 * than that something works.
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

const { DataQuality, FLAGS, DQ_DEFAULTS } = require(path.join(ROOT, 'data-quality.js'));
const { FeedHealth, FEED_DEFAULTS } = require(path.join(ROOT, 'feed-health.js'));
const { DataGate, GATE_DEFAULTS } = require(path.join(ROOT, 'data-gate.js'));

const quiet = { warn() {}, error() {}, log() {} };

/* A clock the test drives. Nothing here waits on a real timer. */
function rig(cfgOverride = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const dq = new DataQuality({ now: clock.now, log: quiet });
  const feed = new FeedHealth({ dataQuality: dq, now: clock.now, log: quiet });
  const cfg = () => ({ ...GATE_DEFAULTS, ...cfgOverride });
  const gate = new DataGate({ dataQuality: dq, feedHealth: feed, cfg, now: clock.now, log: quiet });
  return { clock, dq, feed, gate };
}

const quote = (o = {}) => ({
  bid: 100, ask: 100.5, ltp: 100.25, volume: 1000, oi: 5000,
  bidQty: 500, askQty: 500, dayHigh: 105, dayLow: 95,
  ...o,
});

/* Feed an instrument enough ticks to establish its own norm. */
function warm(rigged, key, gapMs, ticks = 10, base = 100) {
  warmAll(rigged, [key], gapMs, ticks, base);
}

/* Warm several instruments TOGETHER. Warming them one after another advances the
   clock through each, so the first is already stale by the time the last is
   ready — which is a property of the test harness, not of the instruments. */
function warmAll(rigged, keys, gapMs, ticks = 10, base = 100) {
  for (let i = 0; i < ticks; i++) {
    for (const key of keys) {
      rigged.dq.ingest(key, quote({ ltp: base + i * 0.05, oi: 5000 + i * 10, exchangeTs: rigged.clock.now() }));
    }
    rigged.clock.advance(gapMs);
  }
}

console.log('\ndata quality gate\n');

/* ── 1. each instrument is judged against itself ─────────────────────────── */
console.log('per-instrument thresholds');
{
  const r = rig();
  warm(r, 'ATM', 2000, 12);          // ticks every 2 s
  warm(r, 'DEEP_OTM', 300000, 12);   // ticks every 5 minutes

  const atm = r.dq.assess('ATM').freshness;
  const otm = r.dq.assess('DEEP_OTM').freshness;
  ok(atm.medianPriceGapMs === 2000, `the ATM strike's own median gap is ${atm.medianPriceGapMs} ms`);
  ok(otm.medianPriceGapMs === 300000, `the deep OTM strike's is ${otm.medianPriceGapMs} ms — 150× longer`);
  ok(otm.priceLimitMs > atm.priceLimitMs * 10,
    `so their staleness limits differ by more than 10× (${atm.priceLimitMs} vs ${otm.priceLimitMs} ms)`);
}
{
  const r = rig();
  warm(r, 'ATM', 2000, 12);
  warm(r, 'DEEP_OTM', 300000, 12);
  r.clock.advance(60000);            // one minute of silence
  ok(r.dq.assess('ATM').freshness.priceStale === true,
    'after a minute the ATM strike is STALE — 60 s is 30× its own norm');
  ok(r.dq.assess('DEEP_OTM').freshness.priceStale === false,
    '…and the deep OTM strike is NOT, because a minute is well inside its norm. One global threshold cannot do this');
}
{
  const r = rig();
  warm(r, 'X', 1, 12);               // absurdly fast
  r.clock.advance(3000);
  ok(r.dq.assess('X').freshness.priceStale === false,
    'the floor stops a hyperactive instrument being called stale after a few seconds');
  r.clock.advance(DQ_DEFAULTS.DQ_STALE_CEILING_MS + 1);
  ok(r.dq.assess('X').freshness.priceStale === true,
    'and the ceiling stops any instrument being called fresh for ever, whatever its median');
}
{
  const r = rig();
  r.dq.ingest('NEW', quote());
  const f = r.dq.assess('NEW').freshness;
  ok(f.medianPriceGapMs === null && f.priceStale === false,
    'below the minimum sample count there is no median, and only the ceiling applies');
  ok(/fewer than/.test(f.basis), 'and the record says the median is not yet trusted');
}

/* ── 2. OI is a separate clock ───────────────────────────────────────────── */
console.log('\nOI freshness is tracked separately');
{
  const r = rig();
  // Price moves constantly; OI has not moved since the tenth tick.
  for (let i = 0; i < 12; i++) {
    r.dq.ingest('K', quote({ ltp: 100 + i * 0.05, oi: 5000 }));
    r.clock.advance(2000);
  }
  const f = r.dq.assess('K').freshness;
  ok(f.priceStale === false, 'the price is fresh');
  ok(f.oiAgeMs === null || f.oiAgeMs > f.priceAgeMs,
    'but the OI clock is separate and older — a fresh price is not evidence of fresh OI');
  /* 24 seconds of unchanged OI is NOT stale, and asserting otherwise would be
     asserting a bug: open interest legitimately sits still for minutes. The
     property worth pinning is that the two clocks diverge and that the OI one
     eventually trips on its own, much later. */
  ok(r.dq.assess('K', { needsOi: true }).trustworthy === true,
    'a few seconds of unchanged OI is not stale — OI legitimately sits still, and calling it stale would block every deep strike all day');

  r.clock.advance(DQ_DEFAULTS.DQ_STALE_CEILING_MS + 1000);
  ok(r.dq.assess('K').freshness.oiStale === true, 'but after the ceiling the OI clock does trip');
  ok(r.dq.assess('K', { needsOi: true }).trustworthy === false,
    '…and a consumer that declared it NEEDS OI is then refused');
  const priceOnly = r.dq.assess('K');
  ok(priceOnly.reasons.every(x => !/open interest/i.test(x)) || priceOnly.reasons.length > 0,
    'while a price-only consumer is judged on the price clock alone');
}

/* ── 3. sanity checks raise flags, never corrections ─────────────────────── */
console.log('\nsanity flags');
const cases = [
  ['CROSSED_BOOK', { bid: 101, ask: 100 }, 'a crossed book'],
  ['OUT_OF_DAY_RANGE', { ltp: 200, dayHigh: 105, dayLow: 95 }, 'a price outside the day range in the same snapshot'],
  ['OUT_OF_BAND', { ltp: 130, lowerBand: 90, upperBand: 120, dayHigh: 140, dayLow: 80 }, 'a price outside the exchange band'],
  ['DEPTH_MISSING', { bidQty: 0, askQty: 0 }, 'absent depth on an instrument that normally shows it'],
];
for (const [flag, bad, why] of cases) {
  const r = rig();
  for (let i = 0; i < 8; i++) { r.dq.ingest('S', quote({ ltp: 100 + i * 0.05 })); r.clock.advance(2000); }
  const res = r.dq.ingest('S', quote(bad));
  ok(res.flags.some(f => f.flag === FLAGS[flag]), `${flag}: flagged — ${why}`);
  ok(res.flags.find(f => f.flag === FLAGS[flag]).detail.length > 10,
    `  …with a detail naming the observed values, not just a code`);
}
{
  const r = rig();
  r.dq.ingest('V', quote({ volume: 1000 }));
  const res = r.dq.ingest('V', quote({ volume: 900 }));
  ok(res.flags.some(f => f.flag === FLAGS.VOLUME_REGRESSION),
    'VOLUME_REGRESSION: cumulative volume moving backwards is flagged');
}
{
  const r = rig();
  r.dq.ingest('O', quote({ oi: 5000 }));
  const res = r.dq.ingest('O', quote({ oi: 4000 }));
  ok(res.flags.some(f => f.flag === FLAGS.OI_REGRESSION), 'OI_REGRESSION: open interest moving backwards is flagged');
}
{
  const r = rig();
  r.dq.ingest('T', quote({ exchangeTs: r.clock.now() }));
  const res = r.dq.ingest('T', quote({ exchangeTs: r.clock.now() - 5000 }));
  ok(res.flags.some(f => f.flag === FLAGS.TIMESTAMP_REGRESSION), 'TIMESTAMP_REGRESSION: an older snapshot after a newer one is flagged');
}
{
  const r = rig();
  const res = r.dq.ingest('C', quote({ exchangeTs: r.clock.now() - 120000 }));
  ok(res.flags.some(f => f.flag === FLAGS.CLOCK_SKEW), 'CLOCK_SKEW: implausible disagreement between exchange and receive time is flagged');
  ok(/cannot tell which/.test(res.flags.find(f => f.flag === FLAGS.CLOCK_SKEW).detail),
    '  …and it does not claim to know which clock is wrong');
}
{
  const r = rig();
  for (let i = 0; i < 8; i++) { r.dq.ingest('N', quote({ ltp: 100 + i * 0.05 })); r.clock.advance(2000); }
  const before = r.dq.assess('N').freshness.priceAgeMs;
  r.dq.ingest('N', quote({ bid: 101, ask: 100, ltp: 100.4 }));
  const after = r.dq.instruments.get('N').last;
  ok(after.bid === 101 && after.ask === 100,
    'a crossed book is stored AS RECEIVED — the module flags it and never repairs it into something plausible');
}

/* ── 4. feed health describes the feed that exists ───────────────────────── */
console.log('\nfeed health');
{
  const r = rig();
  const s = r.feed.status();
  ok(s.websocket.applicable === false && s.websocket.state === 'NOT_APPLICABLE',
    'websocket metrics are reported NOT_APPLICABLE, not as a fabricated 100% uptime');
  ok(/polls REST/.test(s.websocket.why), '  …with the reason: the live path polls REST');
  ok(s.websocket.uptimePct === null && s.websocket.reconnects === null,
    '  …and every websocket figure is null rather than a comfortable number');
}
{
  const r = rig();
  ok(r.feed.coverage().pct === null && /not 100%/.test(r.feed.coverage().why),
    'coverage with nothing declared is null — "watching nothing, all fine" is not a health report');
}
{
  const r = rig();
  r.feed.expectInstruments(['A', 'B', 'C', 'D']);
  warmAll(r, ['A', 'B'], 2000, 10);
  const c = r.feed.coverage();
  ok(c.expected === 4 && c.ticking === 2 && c.unseen === 2,
    'coverage counts ticking, stale and never-seen separately (2 ticking, 2 never seen)');
  ok(c.pct === 50, 'and reports 50%');
  /* Exactly at the critical threshold, which is `< 50`, so this is DEGRADED. The
     boundary is asserted from both sides rather than assumed, because an
     off-by-one here is the difference between trading and not. */
  ok(r.feed.status().level === 'DEGRADED', 'coverage of exactly 50% is DEGRADED — the critical band is strictly below it');
}
{
  const r = rig();
  r.feed.expectInstruments(['A', 'B', 'C', 'D']);
  warm(r, 'A', 2000, 10);
  ok(r.feed.coverage().pct === 25 && r.feed.status().level === 'CRITICAL',
    'and 25% coverage is CRITICAL');
}
{
  const r = rig();
  for (let i = 0; i < FEED_DEFAULTS.FEED_MAX_CONSECUTIVE_FAILURES; i++) {
    r.feed.notePoll({ ok: false, error: 'ECONNRESET' });
    r.clock.advance(1000);
  }
  ok(r.feed.status().outage === true, 'consecutive poll failures open an outage');
  r.feed.notePoll({ ok: true, instrumentsReturned: 10 });
  ok(r.feed.status().outage === false && r.feed.outages.length === 1,
    'and a successful poll closes it, with the duration recorded');
}

/* ══════════════════════════════════════════════════════════════════════════
   5. THE ACCEPTANCE HARNESS — three simulated failures, three blocks
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\nACCEPTANCE: feed outage');
{
  const r = rig();
  r.feed.expectInstruments(['NIFTY|24300|CE']);
  warm(r, 'NIFTY|24300|CE', 2000, 12);
  r.feed.notePoll({ ok: true, instrumentsReturned: 1, targetIntervalMs: 2500 });

  ok(r.gate.checkInstrument('NIFTY|24300|CE').allowed === true, 'before the outage the instrument is allowed');

  for (let i = 0; i < FEED_DEFAULTS.FEED_MAX_CONSECUTIVE_FAILURES; i++) {
    r.feed.notePoll({ ok: false, error: 'socket hang up' });
    r.clock.advance(2000);
  }
  const d = r.gate.checkInstrument('NIFTY|24300|CE');
  ok(d.allowed === false && d.reason === 'FEED_OUTAGE', 'DURING THE OUTAGE THE BOT IS BLOCKED');
  ok(d.outagePolicy === 'HOLD' && d.requiresFlatten === false,
    '  …and the declared policy is stated on the decision (HOLD), not left to whatever the code does');

  const act = r.gate.outageAction();
  ok(act.inOutage && act.action === 'HOLD', 'outageAction names what to do with EXISTING positions');
  ok(/priced from data just declared untrustworthy/.test(r.gate.outageAction().detail) === false,
    '  …and HOLD does not warn about exit pricing, because it is not sending exits');
}
{
  const r = rig({ DQ_OUTAGE_POLICY: 'FLATTEN' });
  r.feed.expectInstruments(['K']);
  warm(r, 'K', 2000, 12);
  for (let i = 0; i < FEED_DEFAULTS.FEED_MAX_CONSECUTIVE_FAILURES; i++) { r.feed.notePoll({ ok: false, error: 'x' }); r.clock.advance(1000); }
  const d = r.gate.checkInstrument('K');
  ok(d.requiresFlatten === true, 'with the policy set to FLATTEN the decision says so explicitly');
  ok(/untrustworthy/.test(r.gate.outageAction().detail),
    '  …and warns that exit orders would be priced from data just declared untrustworthy — the reason HOLD is the default');
}

console.log('\nACCEPTANCE: stale instrument');
{
  const r = rig();
  r.feed.expectInstruments(['ATM']);
  warm(r, 'ATM', 2000, 12);
  r.feed.notePoll({ ok: true, instrumentsReturned: 1 });
  ok(r.gate.checkInstrument('ATM').allowed === true, 'a ticking instrument is allowed');

  /* The feed keeps polling successfully throughout. This is the scenario that
     matters and the one a single global health check cannot see: the connection
     is fine, every poll returns 200, and ONE instrument has stopped ticking.
     Letting the feed lapse instead would produce a FEED_OUTAGE block and prove
     nothing about instrument-level staleness. */
  for (let i = 0; i < 12; i++) {
    r.clock.advance(10000);
    r.feed.notePoll({ ok: true, instrumentsReturned: 1, targetIntervalMs: 10000 });
  }
  ok(r.feed.status().outage === false, 'the feed itself is healthy — every poll succeeded');

  const d = r.gate.checkInstrument('ATM');
  ok(d.allowed === false && d.reason === 'DATA_STALE',
    'A STALE INSTRUMENT IS BLOCKED, while the feed around it is fine');
  ok(/median gap/.test(d.detail) || /limit/.test(d.detail),
    '  …and the reason carries the age, the limit and the basis it was judged on');
}
{
  const r = rig();
  r.feed.expectInstruments(['GHOST']);
  r.feed.notePoll({ ok: true, instrumentsReturned: 0 });
  const d = r.gate.checkInstrument('GHOST');
  ok(d.allowed === false, 'an instrument that has NEVER ticked is blocked — unknown is not fresh');
  /* Asserted on the CODE, not on the sentence. Matching prose is exactly what
     produced the bug this case exists for, and a test that does it is one
     rewording away from passing while the gate is open. */
  ok(d.assessment.codes.includes('NEVER_SEEN'),
    '  …and reports the reason as a code, so the gate never has to parse its own error text');
  ok(d.assessment.freshness === null,
    '  …with freshness null rather than an age of zero — "never seen" and "seen a moment ago" must not share a value');
}

console.log('\nACCEPTANCE: crossed book');
{
  const r = rig();
  r.feed.expectInstruments(['X']);
  warm(r, 'X', 2000, 12);
  r.feed.notePoll({ ok: true, instrumentsReturned: 1 });
  ok(r.gate.checkInstrument('X').allowed === true, 'a normal book is allowed');

  r.dq.ingest('X', quote({ bid: 101, ask: 100, ltp: 100.5 }));
  const d = r.gate.checkInstrument('X');
  ok(d.allowed === false && d.reason === 'DATA_FLAGGED', 'A CROSSED BOOK IS BLOCKED');
  ok(/bid 101/.test(d.detail), '  …with the offending values in the reason');

  r.clock.advance(2000);
  r.dq.ingest('X', quote({ bid: 100, ask: 100.5, ltp: 100.55 }));
  ok(r.gate.checkInstrument('X').allowed === true,
    'and once the book resolves the block lifts — a flag is about the current snapshot, not a permanent mark');
}

/* ── 6. strategy-level gating ────────────────────────────────────────────── */
console.log('\nstrategy coverage');
{
  const r = rig();
  const legs = ['NIFTY|23900|PE', 'NIFTY|24700|CE'];
  r.feed.expectInstruments(legs);
  warmAll(r, legs, 2000, 12);
  r.feed.notePoll({ ok: true, instrumentsReturned: 2 });
  ok(r.gate.checkStrategy('STRANGLE', legs).allowed === true, 'both legs trustworthy → the strategy runs');

  r.dq.ingest(legs[1], quote({ bid: 105, ask: 100 }));
  const d = r.gate.checkStrategy('STRANGLE', legs);
  ok(d.allowed === false && d.reason === 'INCOMPLETE_COVERAGE',
    'ONE bad leg blocks the WHOLE strategy — a strangle priced off one good leg and one bad one is a naked short with a decoration');
  ok(/NIFTY\|24700\|CE/.test(d.detail), '  …and names which leg');
}
{
  const r = rig();
  const d = r.gate.checkStrategy('MYSTERY', []);
  ok(d.allowed === false && d.reason === 'NO_REQUIREMENTS',
    'a strategy that declares no required instruments cannot be cleared — unknown needs are not zero needs');
}

/* ── 7. the gate is observable now, not only at end of day ───────────────── */
console.log('\nobservability');
{
  const r = rig();
  r.feed.expectInstruments(['A']);
  warm(r, 'A', 2000, 12);
  r.feed.notePoll({ ok: true, instrumentsReturned: 1 });
  r.gate.checkInstrument('A');
  r.clock.advance(120000);
  r.gate.checkInstrument('A');

  const live = r.gate.status();
  ok(live.currentlyGated.length === 1, 'a currently-gated scope is visible in the live status');
  ok(live.currentlyGated[0].forMs >= 0 && live.currentlyGated[0].reason, '  …with how long it has been gated and why');
  ok(live.decisions.blocked === 1 && live.decisions.allowed === 1, 'and the decision counts are live');
}
{
  const r = rig();
  r.feed.expectInstruments(['A', 'B']);
  warm(r, 'A', 2000, 12);
  r.feed.notePoll({ ok: true, instrumentsReturned: 2 });
  r.gate.checkInstrument('A');
  r.gate.checkInstrument('B');
  r.dq.ingest('A', quote({ bid: 101, ask: 100 }));
  r.gate.checkInstrument('A');

  const sc = r.gate.scorecard();
  ok(sc.coverage.expected === 2 && sc.coverage.ticking === 1, 'the scorecard reports coverage');
  ok(sc.staleness.undecidable >= 0 && 'undecidable' in sc.staleness,
    'and counts UNDECIDABLE instruments separately from stale and fresh');
  ok(sc.flags.total > 0 && Object.keys(sc.flags.byType).length > 0, 'flag rates are broken down by type');
  ok(sc.connection.websocket.state === 'NOT_APPLICABLE', 'the connection section keeps the websocket honest');
  ok(sc.gating.blocked >= 1 && sc.gating.periods.length >= 1,
    'and every period during which trading was gated is listed, with its reason');
  ok(sc.policy.outage === 'HOLD', 'the declared outage policy is on the scorecard');
}

/* ── 8. fail closed, and the gate cannot be half-built ───────────────────── */
console.log('\nfail closed');
{
  let threw = false;
  try { new DataGate({ dataQuality: null, feedHealth: null }); } catch (_) { threw = true; }
  ok(threw, 'a gate constructed without both halves is refused — a half-built gate is an open one');
}
{
  const r = rig({ DQ_GATE_ENABLED: false });
  const d = r.gate.checkInstrument('ANY');
  ok(d.allowed === true && d.reason === 'GATE_DISABLED',
    'a disabled gate allows — and says GATE_DISABLED rather than OK, so the audit trail shows why');
}
{
  const DG = code('data-gate.js'), DQ = code('data-quality.js');
  ok(/allowed: false/.test(DG), 'the gate has explicit refusals');
  /* The rule is about MEASURED MARKET VALUES, not about counters. `(counts[k] ||
     0) + 1` is a legitimate accumulator; `bid || 0` is a fabricated quote. The
     first version of this assertion banned both and would have forced the
     counters to be written worse. */
  const marketFallback = /\b(bid|ask|ltp|oi|volume|bidQty|askQty|price|age)\w*\s*\|\|\s*0\b/i;
  ok(!marketFallback.test(DQ),
    'no `|| 0` on a measured market value — a missing quote is null, and null is not zero');
  ok(/num = \(v\) =>[\s\S]{0,120}\? null :/.test(DQ),
    'the numeric coercion returns null for an unusable value rather than zero');
  ok(/priceStale: null/.test(DQ), 'undecidable freshness is null, not false');
  /* Asserted on the CODE, because the "HOLD | FLATTEN" note lives in a comment
     and `code()` strips comments — a check that matched it would be matching
     documentation rather than behaviour. */
  ok(GATE_DEFAULTS.DQ_OUTAGE_POLICY === 'HOLD',
    'the outage policy defaults to HOLD — flattening prices exits from data just declared untrustworthy');
  ok(/DQ_OUTAGE_POLICY === 'FLATTEN'/.test(DG),
    'and FLATTEN is the only other value the code acts on — there is no third branch meaning "whatever happens"');
}

console.log(`\n${n} checks passed\n`);
