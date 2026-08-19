/* TEST CATEGORIES — unit · failure · regression
   @test:unit @test:failure @test:regression

   No integration / performance / memory-leak / rollback tests.
   These markers are what this file ACTUALLY contains. */

/* H/L TOUCH ALERTS.

   The whole design problem is SUPPRESSION, so that is what most of this file
   asserts. `_updateHL` sets a new extreme on every tick that extends it — in a
   trending move, dozens a minute. A notifier wired straight to that flag sends a
   hundred messages an hour and the hundred-and-first is ignored along with
   everything else that day.

   Three gates, one section each: minimum move, cooldown, warm-up. A test suite
   for this feature that only checked "does it fire" would pass on the version
   nobody could use.
*/
'use strict';

const assert = require('assert');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { HLAlerts } = require('../hl-alerts');

/* A day record shaped like the one _updateHL maintains. */
const day = (high, low, date = '2026-08-12') => ({ date, high, low, highAt: 0, lowAt: 0 });

function make(opts = {}) {
  let clock = 1_000_000;
  const a = new HLAlerts({ now: () => clock, ...opts });
  return { a, tick: (ms) => { clock += ms; }, at: () => clock };
}

console.log('\n§1 — it fires on a real new extreme');

t('a new high emits, with both extremes in the message', () => {
  const { a } = make();
  const ev = a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });
  assert.ok(ev, 'nothing emitted');
  assert.strictEqual(ev.kind, 'NEW_HIGH');
  assert.strictEqual(ev.price, 24600);
  assert.strictEqual(ev.dayHigh, 24600);
  assert.strictEqual(ev.dayLow, 24400);
  assert.match(ev.message, /24600\.00/);
  assert.match(ev.message, /H 24600\.00 \/ L 24400\.00/,
    'the message must carry both levels — "new high" without the number is not actionable');
  assert.strictEqual(ev.positionPct, 100, 'a new high sits at 100% of the range');
});

t('a new low emits too', () => {
  const { a } = make();
  const ev = a.tick('NIFTY', 24400, day(24600, 24400), { newLow: true });
  assert.strictEqual(ev.kind, 'NEW_LOW');
  assert.strictEqual(ev.positionPct, 0);
});

console.log('\n§2 — THE POINT: a trend is one event, not forty');

t('COOLDOWN — a run of new highs emits once', () => {
  const { a, tick } = make({ cooldownMs: 60_000 });
  let emitted = 0;
  // forty ticks, each a genuine new high, ten seconds apart
  for (let i = 0; i < 40; i++) {
    const px = 24600 + i * 5;
    if (a.tick('NIFTY', px, day(px, 24400), { newHigh: true })) emitted++;
    tick(10_000);
  }
  assert.ok(emitted <= 7, `${emitted} alerts from one 400-second trend — the cooldown is not holding`);
  assert.ok(emitted >= 5, `${emitted} alerts; a 400s move at a 60s cooldown should still report progress`);
  assert.ok(a.stats.suppressedCooldown > 25, `only ${a.stats.suppressedCooldown} suppressed`);
});

t('MINIMUM MOVE — a high beaten by one tick is the same high', () => {
  const { a, tick } = make({ cooldownMs: 0 });
  a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });
  tick(120_000);
  const ev = a.tick('NIFTY', 24600.05, day(24600.05, 24400), { newHigh: true });
  assert.strictEqual(ev, null, 'a 0.05 extension emitted a fresh alert');
  assert.strictEqual(a.stats.suppressedSmall, 1);
});

t('and a real push through DOES emit, cooldown permitting', () => {
  const { a, tick } = make({ cooldownMs: 0 });
  a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });
  tick(120_000);
  const ev = a.tick('NIFTY', 24650, day(24650, 24400), { newHigh: true });
  assert.ok(ev, 'a 50-point push was suppressed as noise');
});

t('WARM-UP — the first ticks after the daily reset say nothing', () => {
  /* Immediately after the reset the range is a single price, so every tick is
     both a new high and a new low. Nothing there is a break of anything. */
  const { a } = make();
  const ev = a.tick('NIFTY', 24500.5, day(24500.5, 24500), { newHigh: true });
  assert.strictEqual(ev, null, 'alerted on a range of half a point');
  assert.strictEqual(a.stats.suppressedWarmup, 1);
});

t('a null return is explained by the counters, not left as a mystery', () => {
  const { a } = make();
  a.tick('NIFTY', 24500.5, day(24500.5, 24500), { newHigh: true });
  const s = a.status();
  assert.strictEqual(s.stats.emitted, 0);
  assert.strictEqual(s.stats.suppressedWarmup, 1,
    'a silent feed must be explainable — which gate stopped it is the first question asked');
});

console.log('\n§3 — retests are a separate event with a separate gate');

t('coming back to the high after leaving it is a RETEST', () => {
  const { a, tick } = make({ cooldownMs: 1000 });
  a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });   // establish
  tick(2000);
  a.tick('NIFTY', 24500, day(24600, 24400), {});                  // depart
  tick(2000);
  const ev = a.tick('NIFTY', 24599.5, day(24600, 24400), {});     // return
  assert.ok(ev, 'no retest emitted');
  assert.strictEqual(ev.kind, 'RETEST_HIGH');
});

t('sitting AT the high does not emit a retest every tick', () => {
  /* Without a departure requirement, price resting on the high produces one
     retest per tick — the exact noise this feature exists to avoid. */
  const { a, tick } = make({ cooldownMs: 0 });
  a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });
  let n = 0;
  for (let i = 0; i < 20; i++) { tick(1000); if (a.tick('NIFTY', 24599.9, day(24600, 24400), {})) n++; }
  assert.strictEqual(n, 0, `${n} retests emitted while price never left the high`);
});

t('a departure band narrower than the retest band is REFUSED at construction', () => {
  /* If departure were the narrower of the two, price could be "departed" and
     "at the extreme" at the same moment and the retest would fire on every tick
     inside the gap — the exact noise this module exists to prevent, arriving
     through a config value rather than a bug. */
  assert.throws(
    () => new HLAlerts({ retestFraction: 0.02, retestDepartureFraction: 0.01 }),
    /must exceed/);
  assert.throws(
    () => new HLAlerts({ retestFraction: 0.01, retestDepartureFraction: 0.01 }),
    /must exceed/, 'equal is not enough — the bands must not touch');
});

t('a retest does not consume the new-extreme cooldown', () => {
  const { a, tick } = make({ cooldownMs: 60_000 });
  a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });
  tick(1000);
  a.tick('NIFTY', 24500, day(24600, 24400), {});
  tick(1000);
  a.tick('NIFTY', 24599.5, day(24600, 24400), {});                // retest
  tick(70_000);
  const ev = a.tick('NIFTY', 24700, day(24700, 24400), { newHigh: true });
  assert.ok(ev && ev.kind === 'NEW_HIGH', 'the retest ate the new-high cooldown');
});

console.log('\n§4 — the toggle, and delivery that cannot lose the record');

t('disabled means nothing is emitted at all', () => {
  const { a } = make({ enabled: false });
  assert.strictEqual(a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true }), null);
  assert.strictEqual(a.status().stats.emitted, 0);
  a.setEnabled(true);
  assert.ok(a.tick('NIFTY', 24700, day(24700, 24400), { newHigh: true }));
});

t('a delivery that THROWS still leaves the event on the record', () => {
  /* A notifier whose only trace is the message it could not send has no trace. */
  const { a } = make({ onEvent: () => { throw new Error('telegram down'); } });
  const ev = a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });
  assert.ok(ev, 'the event was lost because delivery failed');
  assert.strictEqual(a.status().recent.length, 1);
  assert.strictEqual(a.stats.deliveryFailed, 1);
  assert.strictEqual(a.stats.emitted, 1, 'emitted counts the event, not the send');
});

t('a delivery that REJECTS is counted, not swallowed', () => {
  const { a } = make({ onEvent: () => Promise.reject(new Error('429')), log: { warn() {} } });
  a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true });
  return new Promise((r) => setImmediate(r)).then(() => {
    assert.strictEqual(a.stats.deliveryFailed, 1);
  });
});

t('the ring buffer is bounded', () => {
  const { a, tick } = make({ cooldownMs: 0, ringSize: 5, minMoveFraction: 0 });
  for (let i = 0; i < 20; i++) { const px = 24600 + i * 10; a.tick('NIFTY', px, day(px, 24400), { newHigh: true }); tick(1); }
  assert.ok(a.events.length <= 5, `ring grew to ${a.events.length}`);
});

console.log('\n§5 — a new day starts clean');

t('yesterday\'s alert level does not suppress today\'s first high', () => {
  const { a, tick } = make({ cooldownMs: 60_000 });
  a.tick('NIFTY', 24600, day(24600, 24400, '2026-08-12'), { newHigh: true });
  tick(1000);
  const ev = a.tick('NIFTY', 24000, day(24000, 23800, '2026-08-13'), { newHigh: true });
  assert.ok(ev, 'a new trading day inherited the previous day\'s cooldown and level');
  assert.strictEqual(ev.kind, 'NEW_HIGH');
});

t('instruments do not share a cooldown', () => {
  const { a } = make({ cooldownMs: 60_000 });
  assert.ok(a.tick('NIFTY', 24600, day(24600, 24400), { newHigh: true }));
  assert.ok(a.tick('SENSEX', 80600, day(80600, 80000), { newHigh: true }),
    'SENSEX was silenced by an alert about NIFTY');
});

t('nonsense input is refused rather than emitted', () => {
  const { a } = make();
  assert.strictEqual(a.tick('NIFTY', 0, day(24600, 24400), { newHigh: true }), null);
  assert.strictEqual(a.tick('NIFTY', 24600, null, { newHigh: true }), null);
  assert.strictEqual(a.tick('NIFTY', 24600, { date: null }, { newHigh: true }), null);
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
