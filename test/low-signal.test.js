/* TEST CATEGORIES — unit · failure · regression
   @test:unit @test:failure @test:regression

   No integration / performance / memory-leak / rollback tests.
   These markers are what this file ACTUALLY contains. */

/* BUY THE SESSION LOW — docs/095.

   The research found three things, and this file asserts that the code cannot
   quietly stop honouring any of them:

     1. a tight reversal exit is measurably WORSE — monotonically, across five
        widths and three indices. The module must REFUSE one, not merely default
        away from it.
     2. the entry is small and positive
     3. it is NOT significant, and the feature must say so with its own numbers

   The third is the one a feature like this always loses first. A signal card
   that shows a win rate and not a t-statistic is how a profit-factor-0.94
   strategy stayed switched on for months.
*/
'use strict';

const assert = require('assert');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { LowSignal, RESEARCH } = require('../low-signal');

/* 2026-08-13 is a Thursday. 09:15 IST = 03:45 UTC. */
const T = (h, m) => Date.parse(`2026-08-13T${String(h - 5).padStart(2, '0')}:${String(m + 30 - 60 * (m + 30 >= 60 ? 1 : 0)).padStart(2, '0')}:00Z`)
  + (m + 30 >= 60 ? 3600000 : 0);
/* Simpler and less error-prone: build from an IST epoch directly. */
const IST = (h, m) => Date.parse('2026-08-13T00:00:00Z') + ((h * 60 + m) - 330) * 60000;

function make(opts = {}) {
  let clock = IST(9, 15);
  const s = new LowSignal({ now: () => clock, ...opts });
  return { s, at: (h, m) => { clock = IST(h, m); return clock; } };
}

console.log('\n§1 — THE FINDING THE CODE MUST NOT FORGET: no tight trailing exit');

t('a trailing exit tighter than 1% is REFUSED at construction', () => {
  /* docs/095 §1: every loosening improved the result, on every index, without
     exception. A stop tight enough to lock in profit after a session low is
     tight enough to be hit by the noise on the way up. */
  for (const bad of [0.15, 0.25, 0.4, 0.6, 0.99]) {
    assert.throws(() => new LowSignal({ trailPct: bad }), /tighter than 1%/,
      `trailPct ${bad} was accepted`);
  }
});

t('and the refusal explains WHY, with the measurement', () => {
  try { new LowSignal({ trailPct: 0.25 }); assert.fail('accepted'); }
  catch (e) {
    assert.match(e.message, /monotonically WORSE/);
    assert.match(e.message, /docs\/095/);
  }
});

t('null — hold to the close — is the default and is allowed', () => {
  const s = new LowSignal();
  assert.strictEqual(s.cfg.trailPct, null);
  assert.strictEqual(s.status().exitRule, 'HOLD_TO_CLOSE');
});

t('a deliberate loose trail is allowed, because 1%+ was measured positive', () => {
  assert.doesNotThrow(() => new LowSignal({ trailPct: 1 }));
});

console.log('\n§2 — the entry rule is the one that was tested');

t('the first bar of the session does not signal', () => {
  const { s, at } = make();
  assert.strictEqual(s.tick('NIFTY', 24500, at(9, 15)), null,
    'the opening print is trivially the session low and is not a signal');
  assert.strictEqual(s.stats.suppressedWarmup, 1);
});

t('a new low inside the 30-minute warm-up does not signal', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  assert.strictEqual(s.tick('NIFTY', 24400, at(9, 40)), null);
  assert.ok(s.stats.suppressedWarmup >= 2);
});

t('a new low AFTER the warm-up signals', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  const ev = s.tick('NIFTY', 24400, at(10, 0));
  assert.ok(ev, 'no signal');
  assert.strictEqual(ev.kind, 'ENTRY');
  assert.strictEqual(ev.entry, 24400);
  assert.strictEqual(ev.exitRule, 'HOLD_TO_CLOSE');
});

t('a price that is NOT a new low never signals', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  assert.strictEqual(s.tick('NIFTY', 24450, at(10, 30)), null);
});

t('the cooldown holds a cascade of new lows to one position', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  let extra = 0;
  for (let m = 1; m <= 10; m++) if (s.tick('NIFTY', 24400 - m, at(10, m))) extra++;
  assert.strictEqual(extra, 0, `${extra} extra entries during a falling run`);
});

t('only one position per instrument — stacking would measure a different trade', () => {
  const { s, at } = make({ cooldownMs: 0 });
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  assert.strictEqual(s.tick('NIFTY', 24300, at(11, 0)), null);
  assert.strictEqual(s.stats.suppressedOpen, 1);
  assert.strictEqual(s.open.size, 1);
});

t('instruments are independent', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15)); s.tick('SENSEX', 80500, at(9, 15));
  assert.ok(s.tick('NIFTY', 24400, at(10, 0)));
  assert.ok(s.tick('SENSEX', 80400, at(10, 0)), 'SENSEX was blocked by a NIFTY position');
});

t('no entry so late that it cannot be held to the close', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  assert.strictEqual(s.tick('NIFTY', 24400, at(15, 25)), null);
});

console.log('\n§3 — the exit');

t('the position closes at the session end, not at a reversal', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  // a 1% round trip up and back — a tight trail would have exited here
  assert.strictEqual(s.tick('NIFTY', 24650, at(11, 0)), null, 'exited on the way up');
  assert.strictEqual(s.tick('NIFTY', 24450, at(12, 0)), null, 'exited on a give-back');
  const ex = s.tick('NIFTY', 24550, at(15, 25));
  assert.ok(ex && ex.kind === 'EXIT');
  assert.strictEqual(ex.reason, 'SESSION_END');
  assert.strictEqual(ex.pnlPctGross, +(((24550 - 24400) / 24400) * 100).toFixed(4));
});

t('the P&L is reported GROSS, and says so', () => {
  /* This module sees an index level. The trade would be an option, whose cost is
     not 0.03% of that level. A net number here would be invented. */
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  const ex = s.tick('NIFTY', 24550, at(15, 25));
  assert.ok('pnlPctGross' in ex);
  assert.ok(!('pnlPct' in ex), 'an unqualified pnlPct would be read as net');
});

t('a loose trail, when explicitly chosen, does fire', () => {
  const { s, at } = make({ trailPct: 1 });
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  s.tick('NIFTY', 24800, at(11, 0));             // best
  const ex = s.tick('NIFTY', 24550, at(12, 0));  // -1.0% from best
  assert.ok(ex && ex.reason === 'TRAIL');
});

console.log('\n§4 — the feature carries its own weakness');

t('the research ships with the module, including the t-statistics', () => {
  for (const inst of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    const r = RESEARCH.byInstrument[inst];
    assert.ok(r, `${inst} missing`);
    assert.ok(typeof r.t === 'number', `${inst} has no t-statistic`);
    assert.ok(typeof r.meanPct === 'number' && typeof r.n === 'number');
  }
  assert.ok(RESEARCH.byInstrument.NIFTY.t < 2.2,
    'the NIFTY t was 1.99 — if this is raised, it must be re-measured, not re-typed');
});

t('the verdict says NOT SIGNIFICANT in words, not only in a number', () => {
  assert.match(RESEARCH.verdict, /NOT SIGNIFICANT/);
  assert.match(RESEARCH.verdict, /30 variants|~30/i,
    'the search cost must be stated: one t of 1.99 out of thirty tries is the best of a pile of noise');
});

t('status never presents the expectation without the t beside it', () => {
  const { s } = make();
  const st = s.status();
  assert.ok(st.research && st.research.byInstrument.NIFTY.t !== undefined);
  assert.strictEqual(st.paperOnly, true);
});

t('the forward record is kept SEPARATE from the research', () => {
  /* The in-sample story is always the better one. Merging them would let a
     26-day study lend its numbers to eleven live observations. */
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  s.tick('NIFTY', 24550, at(15, 25));
  const st = s.status();
  assert.ok(st.forward.NIFTY, 'no forward record');
  assert.ok(st.research.byInstrument.NIFTY, 'no research record');
  assert.notStrictEqual(st.forward.NIFTY.n, st.research.byInstrument.NIFTY.n);
});

t('and refuses a significance claim before the agreed gate', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  s.tick('NIFTY', 24550, at(15, 25));
  const f = s.status().forward.NIFTY;
  assert.match(f.significance, /UNDER-POWERED/);
  assert.match(f.significance, /60/, 'the gate number must be stated, and it was agreed in advance');
  assert.ok(!('t' in f), 'a t on one observation invites a decision it cannot support');
});

console.log('\n§5 — the toggle and the day boundary');

t('disabled means nothing at all', () => {
  const { s, at } = make({ enabled: false });
  s.tick('NIFTY', 24500, at(9, 15));
  assert.strictEqual(s.tick('NIFTY', 24400, at(10, 0)), null);
  assert.strictEqual(s.stats.signals, 0);
});

t('a new IST day resets the session low', () => {
  const { s, at } = make();
  s.tick('NIFTY', 24500, at(9, 15));
  s.tick('NIFTY', 24400, at(10, 0));
  s.tick('NIFTY', 24550, at(15, 25));
  // next day, a higher price is still that day's low and must be able to signal
  const nextOpen = Date.parse('2026-08-14T00:00:00Z') + ((9 * 60 + 15) - 330) * 60000;
  s.tick('NIFTY', 24800, nextOpen);
  const ev = s.tick('NIFTY', 24700, nextOpen + 45 * 60000);
  assert.ok(ev, 'yesterday\'s session low leaked into today');
  assert.strictEqual(ev.entry, 24700);
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
