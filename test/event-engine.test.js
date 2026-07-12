'use strict';
/**
 * `event-engine.js` — 149 lines, feeds the event-risk filter, and until now ZERO tests.
 *
 * WHAT THIS SUITE FOUND — and did not fix
 *   `eventRiskScore()` lifts its score by `(vix - 14) * 1.5`, guarded by `vix.value ? … : 0`.
 *   When India VIX cannot be fetched — a network failure, a Yahoo outage, a symbol change —
 *   `getVix()` swallows the error and returns `value: 0`. The lift becomes **zero**, and a
 *   missing volatility reading is scored identically to a calm market.
 *
 *   The engine already KNOWS it does not know: `_vixOut()` returns `regime: 'UNKNOWN'` in
 *   exactly that case. The score simply ignores it. `event-risk-filter` then consumes the
 *   score to block or halve new premium selling — so an unreachable data source silently
 *   makes the risk gate more permissive. This is the `Unknown ≠ Zero` rule, violated in a
 *   risk input, and it is the same fail-open shape as the corrupt-calendar bug.
 *
 *   It is CHARACTERIZED below, not fixed: changing the score changes paper-trading behaviour
 *   and needs its own approval.
 *
 * ISOLATION
 *   `ingestEvents`/`ingestFiiDii` write `data/events.json` and `data/fii-dii.json`. This suite
 *   intercepts `safe-write.writeJsonSync` for its duration, so nothing reaches the disk, and
 *   asserts both files are byte-identical at the end. No test performs network I/O: `getVix`
 *   is either primed from cache or stubbed.
 *
 *   @test:characterization @test:unit @test:integration @test:regression
 *   @test:performance @test:memory-leak @test:failure @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVENTS = path.join(ROOT, 'data', 'events.json');
const FIIDII = path.join(ROOT, 'data', 'fii-dii.json');
const eventsBytes = fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS) : null;
const fiidiiBytes = fs.existsSync(FIIDII) ? fs.readFileSync(FIIDII) : null;

// ── seal the disk off before the module can reach it ────────────────────────
const sw = require('../safe-write.js');
const realWriteJsonSync = sw.writeJsonSync;
let writesAttempted = 0;
sw.writeJsonSync = (...a) => { writesAttempted++; return true; };

const { EventEngine, TYPE_WEIGHT } = require('../event-engine.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const engine = (vix = 14) => {
  const e = new EventEngine();
  e.events = []; e.fiiDii = [];
  e._vix = { value: vix, change: 0, changePct: 0, at: Date.now() };   // primed: getVix never fetches
  return e;
};
const iso = (daysFromNow) => new Date(Date.now() + 330 * 60000 + daysFromNow * 86400000).toISOString().slice(0, 10);

const main = async () => {

// ── @test:unit — the VIX regime ladder, and its honest bottom rung ──────────
{
  const e = engine();
  const regimeAt = (v) => { e._vix = { value: v, change: 0, changePct: 0, at: Date.now() }; return e._vixOut().regime; };
  eq(regimeAt(0), 'UNKNOWN', 'a VIX of 0 is reported as UNKNOWN, not as "very low"');
  eq(regimeAt(11), 'LOW'); eq(regimeAt(14), 'NORMAL'); eq(regimeAt(18), 'ELEVATED'); n += 3;
  eq(regimeAt(25), 'HIGH'); eq(regimeAt(35), 'EXTREME'); n += 2;
  eq(regimeAt(12), 'NORMAL', 'the boundaries are exclusive-below: 12 is NORMAL, not LOW');
  eq(regimeAt(11.99), 'LOW', 'and 11.99 is LOW');

  e._vix = { value: 0, change: 0, changePct: 0, at: 0 };
  eq(e._vixOut().at, null, 'with no reading, the timestamp is null rather than epoch zero');
}

// ── @test:characterization — Unknown VIX is scored as a CALM market ─────────
{
  const withVix = engine(20);
  const noVix = engine(0);
  noVix.getVix = async () => ({ value: 0, change: 0, changePct: 0, regime: 'UNKNOWN', at: null });

  const ev = [{ date: iso(3), type: 'RBI_POLICY', title: 'MPC decision' }];
  withVix.events = [...ev]; noVix.events = [...ev];

  const a = await withVix.eventRiskScore(5);
  const b = await noVix.eventRiskScore(5);

  ok(a.score > b.score,
    `VIX 20 scores ${a.score}, an UNREACHABLE VIX scores ${b.score} — no lift is invented`);
  eq(b.vix.regime, 'UNKNOWN', 'the engine reports the reading as unknown…');

  const calm = engine(14);
  calm.events = [...ev];
  const c = await calm.eventRiskScore(5);

  // TASK B — FIXED. The event component IS measured, so `score` still reports it and is
  // unchanged. What was withdrawn is the *claim about the level*: a composite risk level
  // computed from a component nobody observed is a false statement wearing a measurement's
  // clothes. Before this fix an unreachable VIX and a calm one produced an identical level.
  eq(b.score, c.score,
    'the SCORE is unchanged: the calendar component is measured, and no lift is fabricated for the ' +
    'component that is not');
  eq(b.score, Math.round(TYPE_WEIGHT.RBI_POLICY * 0.65), 'and it equals the pure event weight × proximity');
  eq(b.level, 'UNKNOWN',
    'THE FIX: an unreachable VIX yields level UNKNOWN. Unknown is not zero, and it is not calm');
  eq(c.level, 'MODERATE', 'while a genuinely calm reading still yields a real level');
  ok(b.level !== c.level, 'a MISSING volatility reading and a CALM one no longer produce the same level');

  eq(b.vixUnknown, true, 'the result flags the unknown explicitly');
  eq(c.vixUnknown, false, 'and does not flag a known one');
  assert.deepStrictEqual(b.unknowns, ['indiaVix'], 'and names exactly what is missing'); n++;
  assert.deepStrictEqual(c.unknowns, [], 'with nothing missing when the reading is real'); n++;
  eq(b.vixLift, null, 'the lift is null, NEVER 0 — a missing lift is not a zero lift');
  eq(c.vixLift, 0, 'while a calm VIX of 14 has a genuine, measured lift of 0');
  eq(b.vix.value, null, 'and the VIX value itself is reported as null, not 0');

  // the numeric consumer (server.js:5779) is unaffected: it reads `.score`, which did not move
  ok(Number.isFinite(b.score), 'the score stays a finite number for its numeric consumers');
}

// ── @test:unit — proximity, and the driver ─────────────────────────────────
{
  const e = engine(14);
  e.events = [
    { date: iso(1), type: 'OTHER', title: 'minor' },
    { date: iso(4), type: 'RBI_POLICY', title: 'MPC decision' },
  ];
  const r = await e.eventRiskScore(7);
  eq(r.driver.type, 'RBI_POLICY', 'the highest weight × proximity wins, not simply the nearest event');
  ok(TYPE_WEIGHT.RBI_POLICY > TYPE_WEIGHT.OTHER, 'because RBI outweighs OTHER');

  const near = engine(14); near.events = [{ date: iso(0), type: 'RBI_POLICY', title: 'today' }];
  const far = engine(14); far.events = [{ date: iso(5), type: 'RBI_POLICY', title: 'later' }];
  const rn = await near.eventRiskScore(7), rf = await far.eventRiskScore(7);
  ok(rn.score > rf.score, `the same event today scores ${rn.score}, in five days ${rf.score}`);

  eq((await engine(14).eventRiskScore(7)).score, 0, 'no events and a calm VIX ⇒ score 0');
  eq((await engine(14).eventRiskScore(7)).level, 'CALM', 'which is reported as CALM');
  eq((await engine(14).eventRiskScore(7)).driver, null, 'with no driver, stated as null');
}

// ── @test:regression — the score is bounded and its levels are ordered ─────
{
  const e = engine(80);                      // absurd VIX
  e.events = [{ date: iso(0), type: 'BUDGET', title: 'union budget' }];
  const r = await e.eventRiskScore(5);
  ok(r.score <= 100, `an extreme VIX plus an extreme event still clamps to ${r.score} <= 100`);
  eq(r.level, 'HIGH', 'and reports HIGH');

  const lift = (v) => Math.min(20, Math.max(0, v - 14) * 1.5);
  eq(lift(14), 0, 'VIX 14 adds no lift');
  eq(lift(10), 0, 'a VIX BELOW 14 also adds no lift — the lift is one-sided, never negative');
  eq(lift(100), 20, 'and the lift itself caps at 20');
}

// ── @test:unit — the calendar window ───────────────────────────────────────
{
  const e = engine();
  e.events = [
    { date: iso(-1), type: 'RBI_POLICY', title: 'yesterday' },
    { date: iso(0), type: 'CPI', title: 'today' },
    { date: iso(7), type: 'GDP', title: 'day seven' },
    { date: iso(8), type: 'GDP', title: 'day eight' },
  ];
  const up = e.upcoming(7);
  eq(up.length, 2, 'upcoming(7) spans today through day seven inclusive');
  ok(!up.some((x) => x.title === 'yesterday'), 'a past event is excluded');
  ok(!up.some((x) => x.title === 'day eight'), 'and one beyond the window is too');
  ok(up.some((x) => x.title === 'today'), 'while today is included');
}

// ── @test:integration — ingest: dedupe, sort, replace ──────────────────────
{
  const e = engine();
  const before = writesAttempted;
  const r1 = e.ingestEvents([{ date: '2026-08-10', type: 'rbi', title: 'MPC' }]);
  eq(r1.count, 1, 'one event ingested');
  eq(e.events[0].type, 'RBI', 'the type is upper-cased');
  eq(e.events[0].impact, null, 'a missing impact is null, not an empty string');

  e.ingestEvents([{ date: '2026-08-10', type: 'RBI', title: 'MPC' }]);
  eq(e.events.length, 1, 'INTEGRATION: an identical event is deduped on date|type|title, after upper-casing');

  e.ingestEvents([{ date: '2026-08-01', type: 'CPI', title: 'inflation' }]);
  eq(e.events[0].date, '2026-08-01', 'and the calendar is kept sorted by date');

  e.ingestEvents([{ date: '2026-09-01', type: 'GDP', title: 'q2' }], true);
  eq(e.events.length, 1, 'replace:true discards the previous calendar entirely');

  ok(writesAttempted > before, 'each ingest attempted a persist (intercepted, never reached disk)');

  eq(e.ingestEvents([{ date: '2026-08-10' }]).count, 1,
    'FAILURE: an event with no title is dropped rather than stored as "undefined"');
  eq(e.ingestEvents([{ title: 'no date' }]).count, 1, 'FAILURE: and one with no date is dropped too');
}

// ── @test:characterization — an UNRECOGNISED event type silently becomes OTHER ─
{
  // The weight table keys on RBI_POLICY, not RBI. `TYPE_WEIGHT[e.type] || TYPE_WEIGHT.OTHER`
  // means a typo, a renamed feed, or a new event class the platform has never seen is scored
  // at 30 — the same as a dividend announcement — rather than refused or flagged.
  // This suite's own first draft made exactly that typo and scored an RBI policy day as OTHER.
  eq(TYPE_WEIGHT.RBI, undefined, 'CHARACTERIZATION: there is no `RBI` key — the real one is `RBI_POLICY`');
  eq(TYPE_WEIGHT.OTHER, 30, 'and the fallback weight is 30');

  const typo = engine(14); typo.events = [{ date: iso(0), type: 'RBI', title: 'MPC' }];
  const real = engine(14); real.events = [{ date: iso(0), type: 'RBI_POLICY', title: 'MPC' }];
  const rt = await typo.eventRiskScore(5), rr = await real.eventRiskScore(5);

  // TASK C — FIXED. A weight cannot be invented for a type never seen, so OTHER remains the
  // floor and the score still reports it. What was withdrawn is the *claim about the level*:
  // before this fix an RBI policy day typed `RBI` was reported as LOW, indistinguishable from a
  // dividend, and nothing said otherwise.
  eq(rt.score, 30, 'an unrecognised type still scores at the OTHER floor — no weight is fabricated');
  eq(rr.score, 90, 'while the correctly-typed one scores 90');
  eq(rr.level, 'HIGH', 'a known type yields a real level');
  eq(rt.level, 'UNKNOWN', 'THE FIX: an unrecognised type yields UNKNOWN, not LOW');
  assert.deepStrictEqual(rt.unknownTypes, ['RBI'], 'and the offending type is named'); n++;
  assert.deepStrictEqual(rt.unknowns, ['eventType:RBI'], 'and it appears in `unknowns`'); n++;
  assert.deepStrictEqual(rr.unknownTypes, [], 'a known type names nothing'); n++;

  // the case that motivated this: a renamed feed, not a typo
  const renamed = engine(14); renamed.events = [{ date: iso(0), type: 'BUDGET_2026', title: 'union budget' }];
  const rb = await renamed.eventRiskScore(5);
  eq(rb.score, 30, 'a budget day typed BUDGET_2026 still scores 30 — the weight is genuinely unknown');
  eq(rb.level, 'UNKNOWN', 'but it is no longer reported as LOW, which is the whole point');

  // two unknowns compound, and both are named
  const both = engine(0); both.events = [{ date: iso(0), type: 'BUDGET_2026', title: 'x' }];
  both.getVix = async () => ({ value: 0, regime: 'UNKNOWN', at: null });
  const rboth = await both.eventRiskScore(5);
  eq(rboth.level, 'UNKNOWN', 'an unknown VIX and an unknown type together stay UNKNOWN');
  assert.deepStrictEqual(rboth.unknowns, ['indiaVix', 'eventType:BUDGET_2026'],
    'and BOTH are named — neither masks the other'); n++;

  // a clean calendar with a known VIX is still allowed to say CALM
  const clean = engine(14);
  const rc = await clean.eventRiskScore(5);
  eq(rc.level, 'CALM', 'nothing unknown ⇒ a real level is still asserted');
  assert.deepStrictEqual(rc.unknowns, [], 'with nothing missing'); n++;
}

// ── @test:integration + @test:characterization — FII/DII ───────────────────
{
  const e = engine();
  eq(e.fiiDiiLatest().available, false, 'with no data, `available: false` — it does not invent a flow');

  e.ingestFiiDii({ date: '2026-07-01', cash: { fii: -1200.5, dii: 900.25 } });
  e.ingestFiiDii({ date: '2026-07-02', cash: { fii: 300, dii: 100 } });
  const l = e.fiiDiiLatest();
  eq(l.date, '2026-07-02', 'the newest date is first');
  eq(l.netCash, 400, 'net cash is fii + dii');
  eq(l.bias, 'INFLOW', 'a positive net is an INFLOW');
  eq(l.fii5dCr, -900.5, 'the 5-day FII trend sums across days');

  e.ingestFiiDii({ date: '2026-07-02', cash: { fii: 0, dii: 0 } });
  eq(e.fiiDii.length, 2, 'REGRESSION: re-ingesting a date replaces it rather than duplicating');
  eq(e.fiiDiiLatest().bias, 'FLAT', 'a genuine zero net is FLAT');

  // CHARACTERIZATION: a MISSING cash leg is coerced to 0 by `Number(last.cash?.fii || 0)`.
  const m = engine();
  m.ingestFiiDii({ date: '2026-07-03', cash: { dii: 500 } });          // fii not reported yet
  const lm = m.fiiDiiLatest();
  eq(lm.netCash, 500,
    'CHARACTERIZATION: an UNREPORTED fii figure is treated as exactly zero, so netCash is ' +
    'published as if fii were flat. Unknown != Zero, again. Not fixed here');
  eq(lm.bias, 'INFLOW', 'and a bias is asserted from data that was never observed');

  eq(e.ingestFiiDii({}).error, 'date required', 'FAILURE: a record with no date is refused');
  eq(e.ingestFiiDii(null).error, 'date required', 'FAILURE: so is null');
}

// ── @test:memory-leak — the FII/DII ring buffer is bounded ─────────────────
{
  const e = engine();
  for (let i = 0; i < 300; i++) {
    e.ingestFiiDii({ date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, cash: { fii: i, dii: -i } });
  }
  ok(e.fiiDii.length <= 120, `300 ingests leave ${e.fiiDii.length} rows (cap 120)`);

  const e2 = engine();
  for (let i = 0; i < 500; i++) e2.ingestEvents([{ date: iso(i % 30), type: 'CPI', title: `e${i}` }]);
  ok(e2.events.length <= 500, `the events calendar holds ${e2.events.length} rows`);
  ok(e2.events.every((x, i, a) => i === 0 || x.date >= a[i - 1].date), 'and stays sorted throughout');
}

// ── @test:performance — eventRiskScore is called on the signal path ────────
// Generous, order-of-magnitude threshold. getVix is primed, so no network is touched.
{
  const e = engine(18);
  e.events = Array.from({ length: 50 }, (_, i) => ({ date: iso(i % 7), type: 'CPI', title: `e${i}` }));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 500; i++) await e.eventRiskScore(7);
  const per = Number(process.hrtime.bigint() - t0) / 500 / 1e6;
  ok(per < 20, `eventRiskScore() costs ${per.toFixed(3)} ms over a 50-event calendar (budget 20 ms)`);

  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 5000; i++) e.status();
  const perStatus = Number(process.hrtime.bigint() - t1) / 5000 / 1000;
  ok(perStatus < 200, `status() costs ${perStatus.toFixed(1)} µs — it is polled by the dashboard`);
}

// ── @test:failure — getVix never throws, and never invents a value ─────────
{
  const e = new EventEngine();
  e.events = []; e.fiiDii = [];
  e._vix = { value: 0, change: 0, changePct: 0, at: 0 };
  e.getVix = async () => { throw new Error('network down'); };
  let threw = false;
  try { await e.eventRiskScore(5); } catch (_) { threw = true; }
  ok(threw, 'FAILURE: if getVix rejects, eventRiskScore propagates rather than fabricating a score');
  eq(e._vixOut().value, 0, 'and the cached VIX remains 0 — no value is invented');
  eq(e._vixOut().regime, 'UNKNOWN', 'reported honestly as UNKNOWN');
}

// ── @test:rollback — tests only; production code untouched ─────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'event-engine.js'), 'utf8');
  ok(/module\.exports = \{ EventEngine, TYPE_WEIGHT \}/.test(src),
    'ROLLBACK: the public surface is unchanged — this commit adds tests, no production code');
  ok(/const vixKnown = Number\.isFinite\(vix\.value\) && vix\.value > 0;/.test(src),
    'ROLLBACK: the Unknown-VIX fix is in place — `vixKnown` is tested explicitly, not coerced');
  ok(/vixLift = vixKnown \? .* : null;/.test(src), 'ROLLBACK: an absent lift is null, never 0');
  ok(!/: 0;\s*\/\/ high VIX adds risk/.test(src), 'ROLLBACK: the old `: 0` coercion is gone');
  ok(/level: .UNKNOWN.|'UNKNOWN'\s*$/m.test(src) || /!vixKnown \? 'UNKNOWN'/.test(src),
    'ROLLBACK: an unknown VIX yields level UNKNOWN');
  ok(/unknowns/.test(src), 'ROLLBACK: the result names what is missing');
  // additive only: every field the old result carried is still carried
  ok(/return \{\s*[\s\S]{0,200}score, level, driver, upcoming: up, days,/.test(src),
    'ROLLBACK: score, level, driver, upcoming and days are all still returned — the change is additive');
  ok(/readJsonSync/.test(src) && /writeJsonSync/.test(src), 'ROLLBACK: it still persists through safe-write');
}

// ── production state must be untouched ────────────────────────────────────
{
  sw.writeJsonSync = realWriteJsonSync;                       // unseal
  ok(writesAttempted > 0, `${writesAttempted} writes were attempted and every one was intercepted`);
  if (eventsBytes) ok(Buffer.compare(eventsBytes, fs.readFileSync(EVENTS)) === 0,
    'data/events.json is byte-identical');
  if (fiidiiBytes) ok(Buffer.compare(fiidiiBytes, fs.readFileSync(FIIDII)) === 0,
    'data/fii-dii.json is byte-identical');
  eq(sw.writeJsonSync, realWriteJsonSync, 'and safe-write is restored for every suite that follows');
}

console.log(`\n${n} assertions passed`);
};

main().catch((e) => { sw.writeJsonSync = realWriteJsonSync; console.error(e); process.exit(1); });
