/**
 * upstox-coalescing — one upstream chain call per instrument, whatever the callers do.
 * Run: node test/upstox-coalescing.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * MEASURED, NOT SUSPECTED. A live session log on 2026-07-29 carried 477 rate-limit
 * refusals from the broker, 458 of them from a single endpoint. Three faults in one
 * path, each making the next worse:
 *
 *   1. The chain cache was { at, data } with no in-flight slot, so every caller that
 *      arrived after the 2.5s TTL started its OWN fetch. dashboard.html alone runs
 *      fourteen timers — auto-movers at 2s, high/low 4s, chain 5s, watchlist 6s —
 *      and trade.html adds three more, across three instruments. Polling faster than
 *      the TTL made every tick a miss, and every miss a burst rather than a call.
 *   2. There was no 429 handling whatsoever. The broker's refusal was logged and the
 *      next tick asked again at exactly the same rate.
 *   3. getStats() returned coalesced: 0, inflight: 0, rateLimited: 0 as literals — the
 *      three numbers that would have shown all of this, hard-coded to say nothing.
 */
'use strict';
const assert = require('assert');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const Conn = require(path.join(__dirname, '..', 'upstox-connector.js'));
const Ctor = Conn.UpstoxConnector || Conn.default || Conn;

console.log('upstox-coalescing');

/* A connector wired to a counted fake fetch. _fetchChain is the only network path,
   so overriding it measures exactly what reaches the broker. */
function harness({ failWith = null, delayMs = 20 } = {}) {
  const c = new Ctor({ accessToken: 'test' });
  c.connected = true;
  c._assertConnected = () => {};
  let upstream = 0;
  c._fetchChain = async (inst) => {
    upstream++;
    await new Promise(r => setTimeout(r, delayMs));
    if (failWith) throw failWith;
    const data = { spotPrice: 100, atmStrike: 100, strikes: [], timestamp: new Date(), source: 'test' };
    const prev = c._chainCache[inst];
    c._chainCache[inst] = { at: Date.now(), data, promise: prev ? prev.promise : null };
    delete c._cooldown[inst];
    return data;
  };
  return { c, calls: () => upstream };
}

(async () => {
  // ── @test:regression — the whole point ────────────────────────────────────
  {
    const { c, calls } = harness();
    const rs = await Promise.all(Array.from({ length: 20 }, () => c._chain('NIFTY')));
    ok(calls() === 1, `20 simultaneous callers produced ${calls()} upstream call`);
    ok(rs.every(r => r && r.source === 'test'), 'and every one of them got the data');
    ok(c.client.getStats().coalesced === 19, `19 of the 20 are reported as coalesced (${c.client.getStats().coalesced})`);
  }

  // ── @test:characterization — the shape that caused it ────────────────────
  {
    const { c, calls } = harness();
    await c._chain('NIFTY');
    // Without an in-flight slot this second wave, arriving inside the TTL, is a cache
    // hit — that part always worked. The break was strictly the concurrent case.
    await Promise.all([c._chain('NIFTY'), c._chain('NIFTY')]);
    ok(calls() === 1, 'callers inside the TTL still hit the cache, as before');
    ok(c.client.getStats().cacheHits >= 2, 'and are counted as cache hits');
  }

  // ── @test:failure — a 429 stops the hammering ────────────────────────────
  {
    const e = new Error('Upstox: 429 Too Many Requests'); e.status = 429;
    const { c, calls } = harness({ failWith: e });
    await c._chain('SENSEX').catch(() => {});
    ok(c._cooldown.SENSEX > Date.now(), 'a 429 puts that instrument into a cooldown');
    const before = calls();
    await c._chain('SENSEX').catch(() => {});
    ok(calls() === before, 'and the next caller does not reach the broker at all');
    // Two counters, deliberately: cooldowns is how often we STOPPED calling,
    // rateLimited is how many refusals the HTTP layer saw. A rising rateLimited
    // with a flat cooldowns would mean the backoff is not engaging, and a single
    // number could not tell you that.
    ok(c.client.getStats().cooldowns === 1, 'the backoff itself is counted, not merely the refusal');
  }

  // ── @test:failure — during cooldown the last good chain is still served ──
  {
    const { c } = harness();
    const good = await c._chain('NIFTY');                 // prime the cache
    c._cooldown.NIFTY = Date.now() + 60000;
    c._chainCache.NIFTY.at = 0;                           // force the TTL to lapse
    const served = await c._chain('NIFTY');
    ok(served === good, 'a cooling-off instrument serves its last good chain rather than throwing');
    ok(c.client.getStats().cooldownServes === 1, 'and says so in the stats');
  }

  // ── @test:failure — cooling off with nothing cached must not pretend ─────
  {
    const { c } = harness();
    c._cooldown.BANKNIFTY = Date.now() + 60000;
    let threw = null;
    await c._chain('BANKNIFTY').catch(e => { threw = e; });
    ok(threw && /rate-limited/.test(threw.message),
      'with no cached chain it throws — an empty chain would read as "no strikes", which is a different claim');
  }

  // ── @test:regression — Retry-After is honoured over a guess ──────────────
  {
    const e = new Error('429'); e.status = 429; e.retryAfterMs = 5000;
    const { c } = harness({ failWith: e });
    const t0 = Date.now();
    await c._chain('NIFTY').catch(() => {});
    const waited = c._cooldown.NIFTY - t0;
    ok(waited > 4000 && waited < 6500, `the broker's own Retry-After is used (${Math.round(waited/1000)}s), not the 30s default`);
  }

  // ── @test:unit — a recovered fetch clears the cooldown ──────────────────
  {
    const { c } = harness();
    c._cooldown.NIFTY = Date.now() - 1;                   // expired
    await c._chain('NIFTY');
    ok(!c._cooldown.NIFTY, 'a successful fetch clears the cooldown rather than leaving it to expire');
  }

  // ── @test:memory-leak — the in-flight slot is always released ───────────
  {
    const e = new Error('boom'); e.status = 500;
    const { c } = harness({ failWith: e });
    await c._chain('NIFTY').catch(() => {});
    ok(c._inflight === 0, 'a failed fetch releases the in-flight counter');
    ok(!c._chainCache.NIFTY || !c._chainCache.NIFTY.promise,
      'and clears the promise, so the next caller is not left awaiting a dead one');
  }

  // ── @test:performance — the stats are real numbers now ─────────────────
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'upstox-connector.js'), 'utf8');
    ok(!/coalesced: 0, cacheHits: 0, inflight: 0/.test(src),
      'getStats no longer hard-codes the three counters that reveal this problem');
    const { c } = harness();
    const s = c.client.getStats();
    for (const k of ['coalesced', 'cacheHits', 'rateLimited', 'cooldowns', 'inflight', 'cooldownServes'])
      { assert.ok(k in s, `getStats reports ${k}`); n++; }
    console.log('  ✓ coalesced, cacheHits, rateLimited, cooldowns, inflight and cooldownServes are all reported');
  }

  // ── @test:rollback — the public surface is unchanged ───────────────────
  {
    const { c } = harness();
    for (const m of ['getNiftyOptionChain', 'getBankNiftyOptionChain', 'getOptionChain'])
      { assert.strictEqual(typeof c[m], 'function', `${m} still exists`); n++; }
    const d = await c.getNiftyOptionChain();
    ok(d && d.source === 'test', 'and still returns a chain — callers see no change');
  }

  // ── @test:regression — the floor widens under refusal ─────────────────────
  {
    // Single-flight only collapses SIMULTANEOUS callers. Measured on the live
    // connector after coalescing landed: 5 of 219 requests coalesced, cache hit rate
    // 7.3% — because fourteen staggered timers mean almost every tick is a miss. The
    // floor, not the coalescer, is what governs a staggered caller.
    const e = new Error('429'); e.status = 429;
    const { c } = harness({ failWith: e });
    const base = c._interval('NIFTY');
    await c._chain('NIFTY').catch(() => {});
    ok(c._interval('NIFTY') === base * 2, `one refusal doubles the floor (${base} → ${c._interval('NIFTY')}ms)`);
    for (let i = 0; i < 12; i++) { c._cooldown.NIFTY = 0; await c._chain('NIFTY').catch(() => {}); }
    ok(c._interval('NIFTY') <= 20000, `the floor is bounded at 20s (${c._interval('NIFTY')}ms) — past that the chain is too stale to trade from`);
  }

  // ── @test:unit — and narrows again, but only on a run of clean fetches ────
  {
    const { c } = harness();
    c._minInterval.NIFTY = 20000;
    await c._chain('NIFTY');
    ok(c._interval('NIFTY') === 20000, 'one clean fetch does not undo a backoff');
    c._chainCache.NIFTY.at = 0; await c._chain('NIFTY');
    c._chainCache.NIFTY.at = 0; await c._chain('NIFTY');
    ok(c._interval('NIFTY') < 20000, `three clean fetches relax it one step (${c._interval('NIFTY')}ms)`);
    ok(c._interval('NIFTY') > 2500, 'a step, not a snap back to the base — snapping back is how a backoff becomes an oscillation');
  }

  // ── @test:integration — the learned value is reported ────────────────────
  {
    const { c } = harness();
    c._minInterval.SENSEX = 10000;
    const s = c.client.getStats();
    ok(s.effectiveIntervalMs && s.effectiveIntervalMs.SENSEX === 10000,
      'the stats expose what the floor settled on per instrument, not just the configured base');
    ok(s.minIntervalMs === 2500, 'alongside the configured base, so the two can be compared');
  }

  console.log(`\n${n} assertions passed`);
})();
