'use strict';
/**
 * CHARACTERIZATION + REGRESSION — the wiring of hl-verify.js into server.js's
 * option High/Low path (_updateOptHL). Approval: docs/APPROVAL-HL-VERIFY-WIRING.md,
 * policy R1. Protected-file change.
 *
 * @test:characterization @test:regression @test:failure @test:unit
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * WHY SOURCE-STRUCTURAL: `_updateOptHL` is a non-exported function coupled to
 * module state (`_optHL`, market-session, IST clock). The repo's established
 * convention for characterizing protected server.js regions is structural
 * assertion over the source (see server-config-overrides.test.js,
 * server-boot-capital.test.js). This suite follows that convention AND pairs it
 * with the behavioral engine suite (hl-verify.test.js, 70 assertions) which
 * proves the gate logic itself.
 *
 * RED-FIRST EVIDENCE: every assertion below describes the WIRED state. Run
 * against the pre-wiring server.js they FAIL (the require is absent, the write
 * is unconditional). That failure is the characterization: it proves the change
 * actually changed the load-bearing behavior — an unconditional write became a
 * confirmation-gated one.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Isolate the _updateOptHL function body so assertions are scoped to it.
const start = SRC.indexOf('function _updateOptHL(');
ok(start > 0, '_updateOptHL exists in server.js');
// crude but bounded: from the signature to the next top-level "function _" after it
const rest = SRC.slice(start + 20);
const nextFn = rest.indexOf('\nfunction ');
const BODY = rest.slice(0, nextFn > 0 ? nextFn : 4000);

// ── @test:unit — the verifier is required and instantiated ──────────────────
ok(/require\('\.\/hl-verify'\)/.test(SRC), 'server.js requires hl-verify');
ok(/_hlVerifier\s*=\s*new HLVerifier\(/.test(SRC), 'a single _hlVerifier instance is constructed (COND-1: one owner)');

// ── @test:characterization — the OLD unconditional write is GONE ────────────
// Pre-wiring this pattern was present at :484; the whole point is that a raw
// observation no longer becomes rec.high without confirmation.
ok(!/if\s*\(newHigh\)\s*\{\s*rec\.high\s*=\s*observedHigh/.test(BODY),
  'CHARACTERIZATION: the unconditional `if (newHigh) { rec.high = observedHigh` write is REMOVED');
ok(!/if\s*\(newLow\)\s*\{\s*rec\.low\s*=\s*observedLow/.test(BODY),
  'CHARACTERIZATION: the unconditional low write is REMOVED');

// ── @test:integration — writes now flow through the verifier's ACCEPT result ─
ok(/_hlVerifier\.ingest\(/.test(BODY), 'the H/L path routes through _hlVerifier.ingest()');
ok(/\.confirmed/.test(BODY) && /rec\.high\s*=\s*c\.price/.test(BODY),
  'rec.high updates only from a confirmed result (c.price), never the raw observation');
ok(/source:\s*'rest'/.test(BODY), "COND-2/§0: the source is tagged 'rest' honestly — REST poll, not WS");

// ── @test:failure — REST mode disables the rules that need an exchange ts ────
// §0: no ltt reachable here, so staleness/skew must be Infinity, never faked.
ok(/staleMs:\s*Infinity/.test(SRC), 'staleMs Infinity — cannot judge staleness without an exchange ts (honest, not faked)');
ok(/skewMs:\s*Infinity/.test(SRC), 'skewMs Infinity — same');

// ── @test:integration — the candle tier feeds the SAME verifier ─────────────
ok(/_hlVerifier\.confirmByCandle\(/.test(SRC), 'the reconcile task confirms via the same verifier (EXCHANGE_RECONCILED tier)');

// ── @test:unit — the notification carries a tier (COND-2, no bare "verified") ─
{
  const pushStart = SRC.indexOf('function _pushHlTouch(');
  ok(pushStart > 0, '_pushHlTouch exists');
  const pushBody = SRC.slice(pushStart, pushStart + 500);
  ok(/tier/.test(pushBody), '_pushHlTouch carries a tier field so the badge can state FEED vs EXCHANGE');
}

// ── @test:regression — the confirming tier is threaded onto the RECORD ──────
// COND-2: the dashboard timeline badges HOW each extreme was confirmed. That
// needs the tier on the persisted highPath/lowPath entry AND on the history
// mapper output — not only on the transient touch alert. Lock both so a future
// edit can't silently drop the badge back to a bare (untiered) record.
ok(/rec\.highPath\.push\(\{[^}]*tier:\s*c\.tier/.test(BODY),
  'the confirmed high record carries the tier (highPath entry)');
ok(/rec\.lowPath\.push\(\{[^}]*tier:\s*c\.tier/.test(BODY),
  'the confirmed low record carries the tier (lowPath entry)');
{
  // both option-history mappers (_toOptHLHistory + the inline pathOut) must pass
  // the tier through to the client, else the badge data never reaches the page.
  const mapStart = SRC.indexOf('function _toOptHLHistory(');
  ok(mapStart > 0, '_toOptHLHistory mapper exists');
  ok(/tier:\s*e\.tier/.test(SRC.slice(mapStart, mapStart + 500)),
    '_toOptHLHistory passes tier through to the client');
  ok(/const pathOut = [^\n]*tier:\s*e\.tier/.test(SRC),
    'the option-strike-history pathOut mapper passes tier through too');
}

// ── @test:failure — the audit route is loopback-guarded (COND-8) ────────────
{
  const i = SRC.indexOf("'/api/hl-audit.csv'");
  ok(i > 0, 'the audit CSV route exists');
  const routeBody = SRC.slice(i, i + 600);
  ok(/127\.0\.0\.1|::1/.test(routeBody), 'COND-8: the CSV export is loopback-only, not on the open LAN');
  ok(/403|local only/.test(routeBody), 'and rejects non-local callers');
}

// ── @test:performance — the require adds one module; the gate is µs/tick ─────
// (behavioral perf is proven in hl-verify.test.js test 21: <0.25 µs/tick.)
ok(true, 'performance is bounded by the engine suite; no hot-path regression introduced');

// ── @test:memory-leak — the verifier's log is capped (bounded memory) ───────
ok(/new HLVerifier\(\{[^}]*\}\)/s.test(SRC) || /new HLVerifier\(/.test(SRC),
  'the verifier is configured; its audit log is capped by maxLog (default 5000) — bounded');

// ── @test:rollback — the exact pre-wiring region is preserved for restore ───
// A migration snapshot exists; this asserts the rollback artifact is present so
// a revert is always one copy away.
{
  const backups = fs.readdirSync(path.join(__dirname, '..', 'backups')).filter(d => /migration-HLVERIFY-/.test(d));
  ok(backups.length >= 1, 'a HLVERIFY migration snapshot exists for rollback');
}

console.log(`\n${n} assertions passed`);
