'use strict';
/**
 * THE DASHBOARD RULE (ratified by the owner, 2026-07-09)
 *
 *   The dashboard is a visualization layer. It never computes market logic.
 *   All calculations originate inside engines. It may cache. It may aggregate.
 *   It must never duplicate business logic. The single source of truth stays in engines.
 *
 * WHY THIS TEST EXISTS — a measured, live defect, not a hypothetical
 *
 *   `public/dashboard.html:907` declared its own contract table:
 *       const LOT = { NIFTY:75, SENSEX:20, BANKNIFTY:30 };
 *   The broker-verified registry says NIFTY is **65**. The home page therefore
 *   overstated every open NIFTY condor's P&L by **15.38%**, in both directions:
 *   profits looked bigger and losses looked bigger. `public/strategy.html:246`
 *   carried the same table with NIFTY:75 **and** BANKNIFTY:35 (truth: 30).
 *
 *   It also silently dropped `qty` — the number of lots the sizer actually chose.
 *   A two-lot condor was rendered at one lot's P&L.
 *
 *   The root cause is not the browser. It is that `strangle-engine` never published
 *   `lot`, `qty` or a mark-to-market figure, so the page had nothing to render and
 *   reinvented the arithmetic. That is exactly the duplication this rule forbids:
 *   the fix is to make the engine the source, not to make the browser smarter.
 *
 * RATCHET: `HARDCODED_LOT_PAGES` may only ever go DOWN.
 *
 * TESTING RULE coverage — this CHANGES existing code, so characterization is mandatory:
 *   @test:characterization @test:unit @test:integration @test:regression
 *   @test:performance @test:memory-leak @test:failure @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const registry = require('../instrument-registry.js');

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { n++; assert.strictEqual(a, b, msg); };

// ── 0. the registry is the truth the pages must not contradict ───────────────
eq(registry.lotSize('NIFTY'), 65, 'registry: NIFTY lot is 65 (broker-verified)');
eq(registry.lotSize('BANKNIFTY'), 30, 'registry: BANKNIFTY lot is 30');
eq(registry.lotSize('SENSEX'), 20, 'registry: SENSEX lot is 20');

// ── 1. no page may declare an instrument → lot table ─────────────────────────
// Matches `NIFTY: 75`, `BANKNIFTY:35`, ... i.e. an index name bound to a contract size.
//
// SCAN THE CODE, NOT THE PROSE. The first version of this test flagged the very comments
// that document the removed defect — a comment quoting `{ NIFTY:75 }` is a warning, not a
// violation. Any scanner that reads commentary will eventually punish the honest fix.
const LOT_TABLE = /\b(NIFTY|BANKNIFTY|SENSEX|FINNIFTY|MIDCPNIFTY|BANKEX)\s*:\s*(20|25|30|35|50|60|65|75|120)\b/;
// NOTE the `\r` strip: these files are CRLF, and in JavaScript `.` does not match `\r`,
// so `//.*$` never reaches the end of a CRLF line and silently strips nothing. The stripper
// looked correct and did nothing at all. Self-check assertions below guard against exactly that.
const stripComments = (src) => src
  .replace(/\r/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')          // /* block */
  .replace(/<!--[\s\S]*?-->/g, '')           // <!-- html -->
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');   // // line (not https://)

const pages = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'));
ok(pages.length >= 20, `found ${pages.length} dashboard pages`);

const offenders = [];
for (const p of pages) {
  const lines = stripComments(fs.readFileSync(path.join(PUB, p), 'utf8')).split('\n');
  const hit = lines.findIndex((l) => LOT_TABLE.test(l));
  if (hit >= 0) offenders.push(`${p}:${hit + 1}`);
}
// the stripper must not be a blanket amnesty: prove it still sees real code
ok(LOT_TABLE.test(stripComments('const LOT = { NIFTY: 75 };')),
  'the comment-stripped scan still catches a real lot table');
ok(!LOT_TABLE.test(stripComments('// it used to say { NIFTY: 75 }')),
  'and ignores one quoted inside a comment');
ok(!LOT_TABLE.test(stripComments('  //  let lotSize = { NIFTY:75 };\r\n')),
  'CRLF lines are stripped too — `.` does not match `\\r`, which made the stripper a no-op');
ok(LOT_TABLE.test(stripComments('  let lotSize = { NIFTY:75 };\r\n')),
  'and a real CRLF lot table is still caught');

const HARDCODED_LOT_PAGES = 0;   // ratchet. was 2 (dashboard.html, strategy.html). MAY ONLY GO DOWN.
ok(offenders.length <= HARDCODED_LOT_PAGES,
  `the browser must not carry a lot table — the registry is the single source of truth. ` +
  `Offenders: ${offenders.join(', ') || 'none'}`);

// ── 2. the engine must PUBLISH what the page needs, or the page will invent it ─
{
  const StrangleEngine = require('../strangle-engine.js');
  const Ctor = StrangleEngine.StrangleEngine || StrangleEngine;
  ok(typeof Ctor === 'function' || typeof StrangleEngine.strangleStatus === 'function',
    'strangle-engine is loadable');

  const src = fs.readFileSync(path.join(ROOT, 'strangle-engine.js'), 'utf8');
  ok(/lot:\s*(instrumentRegistry|registry)\.lotSize\(inst\)|lot:\s*lot\b/.test(src),
    'an open position carries `lot`, resolved from the Instrument Registry — not from the browser');
  ok(/unrealized/i.test(src),
    'the engine computes the open mark-to-market itself; the page only renders it');
}

// ── 2a. CHARACTERIZATION — the browser's old arithmetic, reproduced verbatim ─
// This is what dashboard.html:907-913 computed. It is kept as executable evidence: the number
// it produced, and the number the engine produces, differ — and by how much, and why.
{
  const oldBrowserMath = (c) => {
    const LOT = { NIFTY: 75, SENSEX: 20, BANKNIFTY: 30 };          // verbatim
    const lot = LOT[c.inst] || 1;                                   // verbatim: qty never consulted
    const entryNet = ((c.ce?.entry || 0) + (c.pe?.entry || 0)) - ((c.ceWing?.entry || 0) + (c.peWing?.entry || 0));
    const nowNet   = ((c.ce?.ltp   || 0) + (c.pe?.ltp   || 0)) - ((c.ceWing?.ltp   || 0) + (c.peWing?.ltp   || 0));
    return (entryNet - nowNet) * lot;
  };
  const c = {
    inst: 'NIFTY', qty: 2,
    ce: { entry: 100, ltp: 80 }, pe: { entry: 90, ltp: 70 },
    ceWing: { entry: 30, ltp: 25 }, peWing: { entry: 25, ltp: 20 },
  };
  eq(oldBrowserMath(c), 2250, 'CHARACTERIZATION: the old page rendered ₹2,250 for this position');
  eq((135 - 105) * 65 * 2, 3900, 'the truth, at the registry lot and the real qty, is ₹3,900');
  ok(Math.abs(2250 / 3900 - 0.5769) < 0.001, 'the page showed 58% of the real figure');

  // and the two errors pulled in opposite directions, which is why nobody noticed
  eq(oldBrowserMath({ ...c, qty: 1 }), 2250, 'CHARACTERIZATION: qty was ignored entirely — 1 lot and 2 lots rendered the same');
  ok(Math.abs(2250 / 1950 - 1.1538) < 0.001, 'at one lot it OVERSTATED by 15.38% (lot 75 vs 65)');

  // a missing LTP was silently a price of zero — the short leg looked maximally profitable
  const stale = { inst: 'NIFTY', qty: 1, ce: { entry: 100, ltp: null }, pe: { entry: 90, ltp: 70 } };
  eq(oldBrowserMath(stale), (190 - 70) * 75,
    'CHARACTERIZATION: with one leg unpriced the old math billed ₹9,000 of imaginary profit');
}

// ── 2b. the engine's mark-to-market, exercised — not merely grepped ──────────
{
  const M = require('../strangle-engine.js');
  const Ctor = M.StrangleEngine || M;
  const dec = Ctor.prototype._decorateOpen;
  const engine = Object.create(Ctor.prototype);
  const mk = (inst, ceLtp, peLtp, qty) => dec.call(engine, {
    inst, qty, structure: 'CONDOR',
    ce: { strike: 25000, entry: 100, ltp: ceLtp }, pe: { strike: 24000, entry: 90, ltp: peLtp },
    ceWing: { strike: 25300, entry: 30, ltp: 25 }, peWing: { strike: 23700, entry: 25, ltp: 20 },
  });

  const one = mk('NIFTY', 80, 70, 1);
  eq(one.lot, 65, 'the engine resolves the lot from the registry (65), not from a page');
  eq(one.entryNet, 135, 'credit at entry = short legs - wings bought');
  eq(one.nowNet, 105, 'cost to close now');
  eq(one.unrealizedPnl, 1950, '(135 - 105) x 65 x 1 lot = ₹1,950');

  // THE BUG, quantified. The page used lot 75 and ignored qty entirely.
  const two = mk('NIFTY', 80, 70, 2);
  eq(two.unrealizedPnl, 3900, 'two lots doubles the P&L — the page dropped qty and showed one lot');
  eq((135 - 105) * 75, 2250, 'the page would have shown ₹2,250 for this position');
  ok(Math.abs(2250 / 1950 - 1.1538) < 0.001, 'at one lot: 15.38% overstated (75/65)');
  ok(Math.abs(2250 / 3900 - 0.577) < 0.001, 'at two lots: it showed 58% of the real figure');

  // FAIL CLOSED, both ways.
  const dis = mk('MIDCPNIFTY', 80, 70, 1);
  eq(dis.lot, null, 'a trading-disabled instrument has no lot on the trading surface');
  eq(dis.unrealizedPnl, null, 'so it has no P&L — null, NEVER 0, and never a guessed lot');
  ok(/no broker-verified contract size/.test(dis.unrealizedPnlReason), 'and it says exactly why');

  const stale = mk('NIFTY', null, 70, 1);
  eq(stale.unrealizedPnl, null, 'a leg with no live LTP yields null, not a windfall');
  ok(/not a price of zero/.test(stale.unrealizedPnlReason),
    'because ltp=0 on a short leg reads as "maximally profitable" — the quiet catastrophe');
  eq(stale.nowNet, null, 'and nowNet is withheld too rather than shown as a partial sum');
}

// ── 3. `lot` is fail-closed: unknown instrument ⇒ null, NEVER a default ───────
{
  // A trading-disabled instrument has no verified contract size. The registry
  // returns null for it. The engine must propagate null, not substitute 75.
  eq(registry.lotSize('MIDCPNIFTY'), null,
    'a trading-disabled instrument yields null from the trading surface (fail-closed)');
  ok(registry.catalog('MIDCPNIFTY').lotSize === 120,
    'its lot IS known in the catalog — reading metadata is not permission to trade');
}

// ── 4. the page renders, it does not recompute ───────────────────────────────
{
  const dash = fs.readFileSync(path.join(PUB, 'dashboard.html'), 'utf8');
  ok(!/const\s+LOT\s*=\s*\{/.test(dash), 'dashboard.html declares no LOT map');
  ok(!/\(entryNet\s*-\s*nowNet\)\s*\*\s*lot/.test(dash),
    'dashboard.html does not recompute short-spread P&L — the engine did');
  ok(/unrealizedPnl|c\.mtm/.test(dash),
    'dashboard.html renders the engine-computed mark-to-market instead');
}

// ── 4b. the generated browser artefact must not drift from the registry ──────
{
  const gen = require('../scripts/gen-instrument-meta.js');
  const onDisk = fs.readFileSync(gen.OUT, 'utf8');
  eq(onDisk.replace(/\r\n/g, '\n'), gen.render().replace(/\r\n/g, '\n'),
    'public/js/instrument-meta.js is STALE — run `npm run gen:instrument-meta`. ' +
    'A generated copy of the registry that drifts is exactly the bug this replaced');

  // the artefact says what the registry says, and nothing else
  ok(/NIFTY: \{ lot: 65,/.test(onDisk), 'the artefact carries the registry NIFTY lot (65), not 75');
  ok(/BANKNIFTY: \{ lot: 30,/.test(onDisk), 'and BANKNIFTY 30, not 35');
  ok(/MIDCPNIFTY: \{ lot: null,/.test(onDisk),
    'a trading-disabled instrument carries lot:null — the browser must render an em-dash, not a guess');

  const strat = fs.readFileSync(path.join(PUB, 'strategy.html'), 'utf8');
  const stratCode = stripComments(strat);        // scan the code, not the prose describing the fix
  ok(/src="\/js\/instrument-meta\.js"/.test(strat), 'strategy.html loads the generated metadata');
  ok(!/\|\|\s*75/.test(stratCode), "strategy.html's `|| 75` fallback is gone — an unknown lot is null");
  ok(/if \(!L\)/.test(stratCode),
    'and every rupee figure is gated on a known lot: no lot ⇒ no number, not ₹0');
}

// ── 5. what the rule ALLOWS, so the rule stays usable ────────────────────────
{
  const dash = fs.readFileSync(path.join(PUB, 'dashboard.html'), 'utf8');
  ok(/toLocaleString|toFixed/.test(dash), 'formatting is presentation, and stays in the page');
  ok(/sumNet\s*\+=|reduce\(/.test(dash),
    'AGGREGATION over engine-supplied values is explicitly permitted by the rule');
  ok(/Math\.abs\(reNet - stored\)/.test(dash),
    'RECONCILIATION is permitted and encouraged: the page recomputes only to CHECK the engine, ' +
    'and shows ✗ when they disagree. Checking is not duplicating — it never replaces the engine value');
}

// ── 6. performance + memory — _decorateOpen runs on every status poll ────────
// Generous, order-of-magnitude thresholds by design.
{
  const Ctor = (require('../strangle-engine.js').StrangleEngine) || require('../strangle-engine.js');
  const dec = Ctor.prototype._decorateOpen;
  const engine = Object.create(Ctor.prototype);
  const pos = {
    inst: 'NIFTY', qty: 1, structure: 'CONDOR',
    ce: { strike: 25000, entry: 100, ltp: 80 }, pe: { strike: 24000, entry: 90, ltp: 70 },
    ceWing: { strike: 25300, entry: 30, ltp: 25 }, peWing: { strike: 23700, entry: 25, ltp: 20 },
  };
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) dec.call(engine, pos);
  const per = Number(process.hrtime.bigint() - t0) / 20000 / 1000;
  ok(per < 100, `_decorateOpen costs ${per.toFixed(2)} µs — cheaper than the browser round-trip it replaced`);

  // MEMORY: decoration must not mutate or retain the position it was handed.
  const snapshot = JSON.stringify(pos);
  dec.call(engine, pos);
  eq(JSON.stringify(pos), snapshot,
    'MEMORY/PURITY: _decorateOpen returns a NEW object and never mutates the engine\'s live position — ' +
    'a decorator that writes back would corrupt the book on every dashboard poll');
  const out = dec.call(engine, pos);
  ok(out !== pos && out.ce === pos.ce, 'it is a shallow copy: cheap, and no leg is cloned per poll');

  if (typeof global.gc === 'function') {
    global.gc();
    const base = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) dec.call(engine, pos);
    global.gc();
    const grown = process.memoryUsage().heapUsed - base;
    ok(grown < 4 * 1024 * 1024, `100k decorations retained ${(grown / 1048576).toFixed(1)} MB — nothing held`);
  } else {
    console.log('  (heap assertion skipped: run with --expose-gc to measure retention)');
  }
}

// ── 7. rollback validation ───────────────────────────────────────────────────
{
  // Reverting means restoring two HTML blocks and deleting `_decorateOpen`. Assert that the
  // engine's public surface is unchanged, so a revert cannot break server.js or any caller.
  const S = require('../strangle-engine.js');
  const Ctor = S.StrangleEngine || S;
  ok(typeof Ctor.prototype.status === 'function', 'ROLLBACK: status() is still the public surface');
  const src = fs.readFileSync(path.join(ROOT, 'strangle-engine.js'), 'utf8');
  ok(/openPositions:/.test(src), 'ROLLBACK: status() still returns `openPositions` under the same key');

  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  ok(!/_decorateOpen|instrument-meta/.test(server),
    'ROLLBACK: server.js was not touched — the protected file has no dependency on this change');
  ok(fs.existsSync(path.join(ROOT, 'scripts', 'gen-instrument-meta.js')),
    'ROLLBACK: the generated artefact can be rebuilt from the registry at any time');
}

console.log(`\n${n} assertions passed`);
