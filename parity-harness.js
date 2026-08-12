/* ═══════════════════════════════════════════════════════════════════════════
   parity-harness — Phase 1.3. The instrument that makes strangling safe.

   WHAT IT IS FOR

   Phase 2 moves seven order call sites from the raw connector to the guarded
   one, one at a time. Each move is supposed to be a PURE MOVE: the same orders
   reach the broker, in the same sequence, with the same fields. "Supposed to be"
   is not evidence. This harness produces the evidence, by replaying a recorded
   fixture through both paths and diffing what the broker actually received.

   WHY IT DIFFS SUBMISSIONS AND NOT RETURN VALUES

   A return value tells you what the caller saw. A submission log tells you what
   the market saw. Those differ exactly when it matters — a retry, a coalesced
   duplicate, a silently swallowed failure. The market's view is the one that
   costs money, so it is the one compared.

   THE ACCEPT-LIST IS DELIBERATELY EXPLICIT

   Some differences are expected and correct: a guarded order carries an
   `approval` field a raw order does not. Rather than teaching the harness to
   ignore that field, every accepted difference must be named by the person
   running it, and the report prints the accepted list alongside the diff. An
   unnamed difference always fails. Silent tolerance is how a parity harness
   stops being evidence.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

/* ── the scripted broker ─────────────────────────────────────────────────────
   A deterministic stand-in for a connector. It records every submission before
   deciding how to answer, so a submission is recorded even when the response is
   a failure — which is the case a real ledger most often loses. */
class ScriptedBroker {
  /**
   * @param {object} opts
   *   respond   (submission, n) => { ok } | { httpStatus } | { throws }
   *             Default: every order succeeds.
   *   positions what getPositions() resolves to. Default: [].
   *   failReads if true, read methods reject instead of resolving.
   */
  constructor(opts = {}) {
    this.submissions = [];
    this.reads = [];
    this._respond = opts.respond || (() => ({ ok: true }));
    this._positions = opts.positions ?? [];
    this._failReads = !!opts.failReads;
    this.connected = opts.connected !== false;
  }

  async placeOrder(order = {}) {
    const n = this.submissions.length + 1;
    this.submissions.push(canonicalOrder(order, n));
    const r = this._respond(order, n) || { ok: true };
    if (r.throws) throw r.throws instanceof Error ? r.throws : new Error(String(r.throws));
    if (r.httpStatus && r.httpStatus >= 400) {
      throw Object.assign(new Error(`scripted broker: HTTP ${r.httpStatus}`), { status: r.httpStatus });
    }
    return { orderId: r.orderId || `SCRIPT-${n}`, status: r.status || 'TRANSIT' };
  }

  async modifyOrder(req) { this.submissions.push({ op: 'modify', ...req }); return { ok: true }; }
  async cancelOrder(req) { this.submissions.push({ op: 'cancel', ...req }); return { ok: true }; }

  async getPositions() {
    this.reads.push('getPositions');
    if (this._failReads) throw new Error('scripted broker: read failed');
    return this._positions;
  }
  async getOrders() {
    this.reads.push('getOrders');
    if (this._failReads) throw new Error('scripted broker: read failed');
    return [];
  }
  isMarketOpen() { return true; }
  async connect() { this.connected = true; return true; }
  disconnect() { this.connected = false; }
}

/* Nondeterministic fields are replaced by stable placeholders rather than
   deleted, so their PRESENCE is still compared even though their value cannot
   be. A missing approval and an approval with an unpredictable token are
   different facts and must diff differently. */
function canonicalOrder(order, n) {
  const out = { seq: n };
  for (const k of Object.keys(order).sort()) {
    const v = order[k];
    if (k === 'approval') { out.approval = v && v.token ? '<approval:present>' : '<approval:malformed>'; continue; }
    if (k === 'correlationId') { out.correlationId = '<correlationId>'; continue; }
    if (v === undefined) continue;
    out[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}

/* ── replay ──────────────────────────────────────────────────────────────────
   Runs one fixture through a caller-supplied `place`. The harness owns nothing
   about how the order is placed — that is precisely the thing under comparison.

   @param fixture  a fixture object from test/fixtures/order-path/
   @param place    async (intent, broker) => any   — may throw; throws are recorded
   @param broker   the ScriptedBroker both paths submit to
*/
async function replay(fixture, place, broker) {
  const outcomes = [];
  for (const intent of fixture.intents) {
    if (intent.skipped) { outcomes.push({ seq: intent.seq, outcome: 'SKIPPED_IN_FIXTURE', reason: intent.reason }); continue; }
    try {
      await place(intent, broker);
      outcomes.push({ seq: intent.seq, outcome: 'PLACED' });
    } catch (e) {
      // The error CODE is compared, never the message. Messages are prose and
      // change when someone improves the wording; codes are contract.
      outcomes.push({ seq: intent.seq, outcome: 'THREW', code: e.code || null, status: e.status || null });
    }
  }
  return {
    session: fixture.session,
    character: fixture.character,
    intents: fixture.intents.length,
    submissions: broker.submissions,
    outcomes,
  };
}

/* ── diff ────────────────────────────────────────────────────────────────────
   Structural comparison of two runs. Returns every difference as a keyed record
   so it can be accepted individually and by name. */
function diff(runA, runB, opts = {}) {
  const accept = new Set(opts.accept || []);
  const diffs = [];
  const add = (key, detail) => { if (!accept.has(key)) diffs.push({ key, ...detail }); };

  if (runA.submissions.length !== runB.submissions.length) {
    add('count:submissions', {
      what: 'number of broker submissions differs',
      a: runA.submissions.length, b: runB.submissions.length,
    });
  }

  const n = Math.max(runA.submissions.length, runB.submissions.length);
  for (let i = 0; i < n; i++) {
    const a = runA.submissions[i], b = runB.submissions[i];
    if (!a || !b) { add(`submission:${i}:presence`, { what: 'submission present on one side only', a: !!a, b: !!b }); continue; }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const va = JSON.stringify(a[k]), vb = JSON.stringify(b[k]);
      if (va !== vb) add(`field:${k}`, { what: `submission ${i} field '${k}'`, a: a[k], b: b[k] });
    }
  }

  const oN = Math.max(runA.outcomes.length, runB.outcomes.length);
  for (let i = 0; i < oN; i++) {
    const a = runA.outcomes[i], b = runB.outcomes[i];
    const va = JSON.stringify(a), vb = JSON.stringify(b);
    if (va !== vb) add(`outcome:${a?.seq ?? b?.seq}`, { what: 'outcome differs', a, b });
  }

  return {
    identical: diffs.length === 0,
    accepted: [...accept],
    diffs,
  };
}

function report(result, labelA = 'A', labelB = 'B') {
  const lines = [];
  lines.push(result.identical ? '  PARITY: identical' : `  PARITY: ${result.diffs.length} difference(s)`);
  if (result.accepted.length) lines.push(`  accepted in advance: ${result.accepted.join(', ')}`);
  for (const d of result.diffs) {
    lines.push(`    · [${d.key}] ${d.what}`);
    lines.push(`        ${labelA}: ${JSON.stringify(d.a)}`);
    lines.push(`        ${labelB}: ${JSON.stringify(d.b)}`);
  }
  return lines.join('\n');
}

/* ── fixtures ────────────────────────────────────────────────────────────── */
const FIXTURE_DIR = path.join(__dirname, 'test', 'fixtures', 'order-path');

function loadFixture(character) {
  const file = path.join(FIXTURE_DIR, `${character}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`parity-harness: fixture '${character}' not found. Run: node scripts/build-order-fixtures.js`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function allFixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')))
    .sort((a, b) => a.character.localeCompare(b.character));
}

module.exports = { ScriptedBroker, replay, diff, report, loadFixture, allFixtures, canonicalOrder, FIXTURE_DIR };
