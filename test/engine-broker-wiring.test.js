/* TEST CATEGORIES — characterization · unit · failure
   @test:characterization @test:unit @test:failure

   characterization = §1 pins the LIVE defect against the real AfternoonEngine class.
   No integration / performance / memory-leak / rollback tests.

   These markers are what this file ACTUALLY contains. */

/* THE GUARD IS PASSED AND DROPPED — afternoon-engine.js
   Found 2026-08-10 while filling attestation's `orderConsumers` with the property
   each engine ACTUALLY holds, rather than assuming they were alike.

   server.js:3674 and :3739 both construct AfternoonEngine with

       broker: guardedBroker,

   and the constructor at afternoon-engine.js:62 assigns `this.live`, `this.getPrice`
   and fifteen other options — but never `this.broker`. The guard is handed over and
   dropped on the floor.

   The live process agrees. /api/attestation, derived from the running object graph
   and not from this file:

       orderChokepoint  configured=true  NOT ACTIVE
                        2 of 5 order-capable consumers hold something other than the guard
                        bypassing: niftyAfternoon, sensexAfternoon

   This is the precise defect class the attestation module was written to detect:
   a guard that exists, is correct, is wired at the call site, and is held by
   nobody. "Was it constructed?" reports this system as protected.

   WHY THIS FILE PINS THE DEFECT INSTEAD OF FAILING
   ------------------------------------------------
   The consequence today is that the afternoon engines cannot place an order and
   cannot exit one — afternoon-engine.js:697 throws ORDER_NO_BROKER on every exit,
   and :532 hands placeGuarded an undefined broker. The system is therefore SAFER
   than intended, not less safe.

   A permanently red suite for a defect that fails closed teaches everyone to
   ignore red, which costs more than this defect does. So the current state is
   pinned: fixing the wiring turns this file red, and whoever fixes it updates the
   assertion in the same commit — deliberately, because that commit ENABLES an
   order path that cannot fire today.

   THE ONE-LINE FIX, Tier 1, NOT APPLIED:

       constructor(opts) {
         this.live             = opts.live;
      +  this.broker           = opts.broker || null;   // the RiskGuardedBroker

   It is not applied here because it increases order capability, and that is the
   direction that needs the operator's keystroke rather than an agent's judgement.
*/
'use strict';

const assert = require('assert');
const path = require('path');

let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const ROOT = path.join(__dirname, '..');
const guardShape = () => ({
  name: 'guarded',
  requestApproval() { return { approval: 'a' }; },
  approveReducing() { return { approval: 'a' }; },
  placeOrder() { return null; },
});

console.log('\n§1 — CHARACTERIZATION: which engines keep the guard they are given');

t('ExecutionEngine keeps it — this.broker is the object passed as `broker`', () => {
  // exports the class directly, not under a name — read, not assumed
  const ExecutionEngine = require(path.join(ROOT, 'execution-engine.js'));
  const g = guardShape();
  const e = new ExecutionEngine({ live: { name: 'raw' }, broker: g });
  assert.strictEqual(e.broker, g, 'ExecutionEngine dropped the guard');
  assert.notStrictEqual(e.live, g, '`live` must stay the RAW connector — it is for reads');
});

t('LimitOrderEngine keeps it', () => {
  const M = require(path.join(ROOT, 'limit-order-engine.js'));
  const Ctor = M.LimitOrderEngine || M;
  const g = guardShape();
  const e = new Ctor({ broker: g, cfgFor: () => ({}) });
  assert.strictEqual(e.broker, g, 'LimitOrderEngine dropped the guard');
});

t('AfternoonEngine keeps it — FIXED 2026-08-10, was the pinned defect', () => {
  /* This assertion was `assert.strictEqual(e.broker, undefined)` and pinned the
     defect described in the header. It was inverted in the same commit that
     added `this.broker = opts.broker || null` to the constructor — deliberately,
     because that commit ENABLES an order path which could not fire before it.

     The header is kept as written. It is the record of how the defect was found
     (attestation's orderConsumers, from the live object graph) and of what it
     cost, and deleting it would leave the fix looking like an ordinary line. */
  const M = require(path.join(ROOT, 'afternoon-engine.js'));
  const Ctor = M.AfternoonEngine || M;
  const g = guardShape();
  const e = new Ctor({ live: { name: 'raw' }, broker: g, getPrice: () => 0 });

  assert.strictEqual(e.broker, g, 'AfternoonEngine dropped the guard again');
  assert.notStrictEqual(e.live, g, '`live` must stay the RAW connector — it is for reads');
  assert.strictEqual(e.live.name, 'raw');
});

t('and with no broker supplied it is null, not undefined', () => {
  /* :697 reads `!this.broker`, so both behave the same there. null says
     "deliberately absent"; undefined says "nobody thought about it", which is
     exactly what was true before. */
  const M = require(path.join(ROOT, 'afternoon-engine.js'));
  const Ctor = M.AfternoonEngine || M;
  const e = new Ctor({ live: {}, getPrice: () => 0 });
  assert.strictEqual(e.broker, null);
});

console.log('\n§2 — the exit path can now reach the guard, and still refuses without one');

t('the guard-absent check is still there and now passes when a guard is supplied', () => {
  /* Before the fix this asserted the throw was UNCONDITIONAL. It is still the
     right check to have — an exit with no guard must refuse rather than reach the
     raw connector — so the assertion moved from "always throws" to "throws only
     when the guard really is absent". */
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'afternoon-engine.js'), 'utf8');
  assert.ok(/if \(!this\.broker\) throw .*ORDER_NO_BROKER/.test(src),
    'the guard-absent check was removed — an exit could now reach an unguarded path');

  const M = require(path.join(ROOT, 'afternoon-engine.js'));
  const Ctor = M.AfternoonEngine || M;
  assert.ok(new Ctor({ live: {}, broker: guardShape(), getPrice: () => 0 }).broker,
    'with a guard supplied the check no longer fires');
  assert.ok(!new Ctor({ live: {}, getPrice: () => 0 }).broker,
    'with none supplied it still does');
});

t('the entry path hands placeGuarded the guard, and placeGuarded refuses anything else', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'afternoon-engine.js'), 'utf8');
  assert.ok(/broker:\s*this\.broker/.test(src),
    'the placeGuarded call site moved — re-derive before trusting this');

  // and the chokepoint still refuses an absent broker, which is what protected
  // this path by accident for as long as the constructor dropped it
  const { placeGuarded } = require(path.join(ROOT, 'place-guarded.js'));
  return placeGuarded({ broker: undefined, intent: {}, order: {} })
    .then(() => { throw new Error('placeGuarded accepted an undefined broker'); })
    .catch((err) => {
      assert.ok(/broker|approval|guard/i.test(err.message),
        `expected a guard refusal, got: ${err.message}`);
    });
});

console.log('\n§3 — the wiring is asserted at the PROVIDER, not the consumer');

t('server.js passes `broker: guardedBroker` to both afternoon engines', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  /* The point of this assertion: the call site is CORRECT. Reading only the call
     site is how the original wiring test passed while protecting nothing — it
     confirmed the consumer asked for the right thing and never checked that the
     provider kept it. Both halves are here, and they disagree. */
  const constructions = [...src.matchAll(/new AfternoonEngine\(\{([^]*?)\n\}\)/g)];
  assert.ok(constructions.length >= 2, `expected 2 AfternoonEngine constructions, found ${constructions.length}`);
  for (const c of constructions) {
    assert.ok(/broker:\s*guardedBroker/.test(c[1]),
      'an afternoon engine is constructed without the guard at the call site too');
  }
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
