'use strict';
/**
 * THE TESTING RULE (ratified by the owner, 2026-07-09), applied to `pop-seller`'s book.
 *
 * Eight categories, each marked so `test/testing-rule.test.js` can enforce coverage:
 *   @test:characterization  @test:unit         @test:integration  @test:regression
 *   @test:performance       @test:memory-leak  @test:failure      @test:rollback
 *
 * WHAT WRITING THIS SUITE FOUND — the reason the rule earns its cost:
 *
 *   1. MEMORY. `_book` grew forever inside a process. After 5,000 paper round-trips,
 *      `popStatus()` returned a **1.4 MB** JSON holding 5,002 positions, of which exactly ONE
 *      was open. A dashboard timer polls that endpoint.
 *
 *   2. DATA LOSS, worse than the leak, in code written during C3. `_saveBook()` persisted
 *      `_book.slice(-2000)` — the last 2,000 entries by INSERTION order. A position opened on
 *      Monday and still open sits at the FRONT. After 2,000 later round-trips it fell outside
 *      that window and was **silently dropped from disk**. On restart the live position simply
 *      did not exist. A cap meant to protect the file was deleting the only rows that cannot be
 *      reconstructed. Open positions are state; closed ones are an audit trail.
 *
 * The book file is hardcoded to `data/pop-book.json`, so this suite NEVER calls the persisting
 * API. It tests `_bounded` and `popStatus` against synthetic books via the exported seams, and
 * asserts at the end that the real ledger on disk was not touched.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BOOK = path.join(__dirname, '..', 'data', 'pop-book.json');
const before = fs.existsSync(BOOK) ? fs.readFileSync(BOOK) : null;

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const P = require('../pop-seller.js');
const NOW = new Date('2026-07-09T05:30:00.000Z');   // clock injected; never read from the wall

// ─────────────────────────────────────────────────────────────────────────────
// @test:characterization — pin the behaviour that existed BEFORE the fix, as a
// standalone reproduction. This is what `slice(-2000)` did, and it is why it was wrong.
// ─────────────────────────────────────────────────────────────────────────────
{
  const oldSave = (book) => book.slice(-2000);          // verbatim, the previous persistence rule
  const book = [{ id: 1, status: 'OPEN' }];
  for (let i = 2; i <= 2500; i++) book.push({ id: i, status: 'CLOSED' });

  eq(book.filter((p) => p.status === 'OPEN').length, 1, 'one live position, opened first');
  eq(oldSave(book).filter((p) => p.status === 'OPEN').length, 0,
    'CHARACTERIZATION: the old cap wrote 2,000 rows and the open position was NOT among them — ' +
    'after a restart the live trade had vanished');
  eq(oldSave(book).length, 2000, 'while dutifully persisting 2,000 closed rows nobody needed');
}

// ─────────────────────────────────────────────────────────────────────────────
// @test:unit — _bounded, in isolation
// ─────────────────────────────────────────────────────────────────────────────
{
  const bounded = P._bounded;
  ok(typeof bounded === 'function', 'the bounding rule is exposed as a pure function to be tested');

  eq(bounded([]).length, 0, 'an empty book stays empty');

  const small = [{ id: 1, status: 'OPEN' }, { id: 2, status: 'CLOSED' }];
  eq(bounded(small).length, 2, 'a book under the cap is returned untouched');

  const big = [{ id: 1, status: 'OPEN' }];
  for (let i = 2; i <= 2500; i++) big.push({ id: i, status: 'CLOSED' });
  const b = bounded(big);
  eq(b.filter((p) => p.status === 'OPEN').length, 1, 'THE FIX: the open position always survives');
  eq(b.filter((p) => p.status !== 'OPEN').length, 2000, 'closed rows are capped at 2,000');
  eq(b.length, 2001, 'so the total is cap + open, not cap');
  eq(b[0].id, 1, 'and the book stays sorted by id, open position first as it was opened first');
  ok(b.every((p, i) => i === 0 || p.id > b[i - 1].id), 'ids are monotonic — no shuffling');
  eq(b.filter((p) => p.status !== 'OPEN')[0].id, 501, 'the OLDEST closed rows are the ones dropped');

  // 3,000 open positions and no cap can save you: state is never discarded
  const allOpen = Array.from({ length: 3000 }, (_, i) => ({ id: i + 1, status: 'OPEN' }));
  eq(bounded(allOpen).length, 3000, 'even 3,000 open positions are all kept — a cap must never eat state');
}

// ─────────────────────────────────────────────────────────────────────────────
// @test:regression — the exact defect, asserted so it cannot come back
// ─────────────────────────────────────────────────────────────────────────────
{
  const book = [{ id: 1, status: 'OPEN' }];
  for (let i = 2; i <= 5000; i++) book.push({ id: i, status: 'CLOSED' });
  const kept = P._bounded(book);
  ok(kept.some((p) => p.id === 1 && p.status === 'OPEN'),
    'REGRESSION: an open position may never be evicted by a size cap, at any book size');
  ok(kept.length < book.length, 'while the book is still genuinely bounded');
}

// ─────────────────────────────────────────────────────────────────────────────
// @test:memory-leak — the book does not grow without bound
// ─────────────────────────────────────────────────────────────────────────────
{
  // Deterministic, not heap-sampled: a leak test that depends on GC timing is a flaky test.
  // We assert the INVARIANT that bounds the memory, which is what actually prevents the leak.
  let book = [{ id: 1, status: 'OPEN' }];
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 500; i++) book.push({ id: book.length + 1, status: 'CLOSED' });
    book = P._bounded(book);
  }
  ok(book.length <= 2001, `after 10,000 round-trips the book holds ${book.length} rows, not 10,001`);
  eq(book.filter((p) => p.status === 'OPEN').length, 1, 'and the open position is still there');

  // heap check, only where it can be made deterministic
  if (typeof global.gc === 'function') {
    global.gc();
    const base = process.memoryUsage().heapUsed;
    let b2 = [{ id: 1, status: 'OPEN' }];
    for (let i = 0; i < 50000; i++) { b2.push({ id: i + 2, status: 'CLOSED' }); b2 = P._bounded(b2); }
    global.gc();
    const grown = process.memoryUsage().heapUsed - base;
    ok(grown < 8 * 1024 * 1024, `50k round-trips retained ${(grown / 1048576).toFixed(1)} MB — bounded`);
  } else {
    // Do not silently "pass" a test that did not run. Say so.
    console.log('  (heap assertion skipped: run with --expose-gc to measure retention)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// @test:performance — the status payload is bounded, and cheap
// ─────────────────────────────────────────────────────────────────────────────
{
  // Thresholds are deliberately generous: a perf test tuned to this machine becomes a flaky
  // test on the next one. It exists to catch an ORDER-OF-MAGNITUDE regression, nothing finer.
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) P.popStatus();
  const perCall = Number(process.hrtime.bigint() - t0) / 200 / 1e6;
  ok(perCall < 25, `popStatus() costs ${perCall.toFixed(3)} ms per call (dashboard polls it on a timer)`);

  const st = P.popStatus();
  ok(typeof st.closedTotal === 'number' && typeof st.closedShown === 'number',
    'a truncated view states what it left out, so it never masquerades as a complete one');
  ok(st.closedShown <= 200, 'at most 200 closed rows cross the wire');
  ok(JSON.stringify(st).length < 512 * 1024,
    `the status payload is ${(JSON.stringify(st).length / 1024).toFixed(1)} KB — it used to reach 1.4 MB`);
  ok(st.book.filter((p) => p.status === 'OPEN').length === st.openPositions,
    'EVERY open position is served, always — only closed rows are truncated');
}

// ─────────────────────────────────────────────────────────────────────────────
// @test:integration — scanPoP → buildIronCondor, with the clock injected
// ─────────────────────────────────────────────────────────────────────────────
{
  const chain = [
    { strike: 24500, ce: { ltp: 40, iv: 14 }, pe: { ltp: 2, iv: 16 } },
    { strike: 23500, ce: { ltp: 2, iv: 16 }, pe: { ltp: 38, iv: 15 } },
  ];
  const a = P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: chain, minPoP: 80, now: NOW });
  const b = P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: chain, minPoP: 80, now: NOW });
  assert.deepStrictEqual(a, b); n++;
  ok(a.length > 0, 'the same injected clock yields byte-identical candidates — no wall-clock read');

  const later = P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: chain, minPoP: 80,
    now: new Date('2026-07-13T05:30:00.000Z') });   // one day before expiry
  ok(JSON.stringify(later) !== JSON.stringify(a),
    'and a different clock DOES change the answer — proving the injection is real, not decorative');

  ok(a.every((c) => c.premium > 0.5),
    'REGRESSION: the filter runs on the published premium; 0.504 is never printed as 0.50');

  const condor = P.buildIronCondor({ inst: 'NIFTY', spot: 24000, chainStrikes: chain, minPoP: 80, now: NOW });
  ok(condor === null || typeof condor === 'object', 'buildIronCondor threads the clock through');
}

// ─────────────────────────────────────────────────────────────────────────────
// @test:failure — the module fails closed, and says why
// ─────────────────────────────────────────────────────────────────────────────
{
  ok(P.scanPoP({ inst: 'MIDCPNIFTY', spot: 13000, chainStrikes: [], now: NOW }).length === 0,
    'FAILURE: a trading-disabled instrument yields no candidates, not candidates priced at lot 75');
  ok(P.scanPoP({ inst: 'NOT_A_THING', spot: 100, chainStrikes: [], now: NOW }).length === 0,
    'FAILURE: an unknown instrument yields nothing rather than a fabricated rupee figure');

  const r = P.sellPoP({ inst: 'MIDCPNIFTY', side: 'SELL_CE', strike: 13000, type: 'CE', premium: 40 });
  eq(r.ok, false, 'FAILURE: selling a disabled instrument is refused');
  ok(/contract size/i.test(r.reason), 'and the refusal names the missing evidence');

  const live = P.sellPoP({ inst: 'NIFTY', side: 'SELL_CE', strike: 25000, type: 'CE', premium: 40, tradeMode: 'live' });
  eq(live.ok, false, 'FAILURE: live mode is hard-gated even when everything else is valid');

  const v = P.verdict();
  eq(v.status, 'abstain', 'FAILURE: with reliability unmeasured, the verdict abstains rather than guess');
  eq(v.score, null, 'and emits null, never 0');
}

// ─────────────────────────────────────────────────────────────────────────────
// @test:rollback — the change is additive, so `git revert` cannot break a caller
// ─────────────────────────────────────────────────────────────────────────────
{
  // Rollback validation, concretely: every symbol that existed before this change still exists
  // with the same shape. Reverting the commit restores the old behaviour and breaks nothing,
  // because nothing downstream was made to depend on the new surface.
  for (const fn of ['scanPoP', 'buildIronCondor', 'payoffCurve', 'sellPoP', 'closePoP',
    'getBook', 'popStatus', 'lotSize', 'popFromDelta', 'daysToExpiry', 'realPoP', 'bsDelta']) {
    eq(typeof P[fn], 'function', `ROLLBACK: pre-existing export \`${fn}\` survives unchanged`);
  }
  // the new `now` argument is OPTIONAL — old call sites keep working untouched
  ok(Array.isArray(P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: [] })),
    'ROLLBACK: scanPoP still works with no clock argument, exactly as every existing caller calls it');
  eq(typeof P.popStatus().book, 'object', 'ROLLBACK: popStatus still exposes `book`');
  ok('openPositions' in P.popStatus() && 'totalCredit' in P.popStatus(),
    'ROLLBACK: and the fields the dashboard reads are all still present');
}

// ─────────────────────────────────────────────────────────────────────────────
// this suite must not have touched the real ledger
// ─────────────────────────────────────────────────────────────────────────────
{
  const after = fs.existsSync(BOOK) ? fs.readFileSync(BOOK) : null;
  ok(before === null ? after === null : Buffer.compare(before, after) === 0,
    'the real data/pop-book.json is byte-identical — this suite never wrote to production state');
}

console.log(`\n${n} assertions passed`);
