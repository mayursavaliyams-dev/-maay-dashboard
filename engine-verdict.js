'use strict';
/**
 * engine-verdict.js — the ONE contract every engine must satisfy.
 *
 * AI ARCHITECTURE RULE (ratified by the owner, 2026-07-09):
 *   • No engine may directly recommend or execute trades.
 *   • Every engine returns only an EngineVerdict.
 *   • Only the Meta Decision Engine (future H15) may combine engine outputs.
 *   • NO ENGINE MAY OUTPUT BUY / SELL. Decision belongs to Meta Decision alone.
 *   • No calibrated Meta Decision exists today ⇒ every engine is ADVISORY,
 *     no probabilities may be published, no execution is permitted.
 *     (Paper forward-test execution continues; it is the only sanctioned execution,
 *      and it publishes nothing. It is how `reliability` will eventually be measured.)
 *
 * WHY THIS MODULE EXISTS
 *   The contract lived in five documents and zero JavaScript files. A contract that only
 *   exists in prose drifts across 15 engines. This makes it executable: `build()` refuses
 *   to construct a verdict that violates it, so a violation is a crash in a unit test
 *   rather than a wrong number on a dashboard.
 *
 * THE TWO INVARIANTS THAT MATTER MOST
 *   1. `null ≠ 0`. A missing score is `null`, NEVER 0. Zero is a real, confident,
 *      neutral reading; null means "I do not know". Collapsing them manufactures
 *      confidence from absence — the single most dangerous bug class in this codebase.
 *   2. `reliability: null` ⇒ weight 0 ⇒ VETO-ONLY. An engine that has never been
 *      measured out-of-sample may block a decision. It may never drive one.
 *
 * Pure leaf: no local requires, no I/O, no clock unless injected.
 */

const STATUSES = Object.freeze(['ok', 'abstain', 'error']);

/** Direction verbs an engine must never emit. Checked structurally, not by grep. */
const FORBIDDEN_DECISION_KEYS = Object.freeze([
  'decision', 'action', 'signal', 'recommendation', 'order', 'side', 'trade',
]);
const FORBIDDEN_DECISION_VALUES = Object.freeze([
  'BUY', 'SELL', 'STRONG_BUY', 'STRONG_SELL', 'BUY_CE', 'BUY_PE', 'SELL_CE', 'SELL_PE',
  'LONG', 'SHORT', 'ENTER', 'EXIT',
]);

class VerdictContractError extends Error {
  constructor(msg) { super(msg); this.name = 'VerdictContractError'; }
}

const _isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const _inRange = (v, lo, hi) => _isNum(v) && v >= lo && v <= hi;

/**
 * Build a validated EngineVerdict. Throws VerdictContractError on any violation:
 * fail closed — an engine that cannot express itself within the contract must not
 * emit anything at all.
 *
 * @param {object} v
 * @param {string} v.engine          - stable engine id, e.g. 'pop-seller'
 * @param {string} v.engineVersion   - semver of the engine's logic
 * @param {'ok'|'abstain'|'error'} v.status
 * @param {number|null} v.score      - -1..+1, or null. NEVER 0 to mean "unknown".
 * @param {number|null} v.confidence - 0..1, or null
 * @param {number|null} v.reliability- 0..1 MEASURED OUT-OF-SAMPLE, or null (⇒ veto-only)
 * @param {number|null} [v.sampleSize]
 * @param {number|null} [v.dataQuality] - 0..1
 * @param {number|null} [v.freshnessMs]
 * @param {Array<{fact:string,value:*,source:string}>} [v.evidence]
 * @param {string[]} v.limitations      - what this verdict CANNOT tell you. Never empty when status==='ok'.
 * @param {Array<{input:string,reason:string}>} v.missingEvidence
 * @param {object} v.assumptions        - every unverified constant, named. e.g. { r: 0.065, oi_unit: 'UNVERIFIED' }
 * @param {string|null} [v.abstainReason] - REQUIRED when status !== 'ok'
 * @param {string} [v.computedAt]        - ISO-8601; inject rather than reading the clock
 */
function build(v) {
  if (!v || typeof v !== 'object') throw new VerdictContractError('verdict must be an object');

  // ── the forbidden surface: no engine decides ──────────────────────────────
  for (const k of FORBIDDEN_DECISION_KEYS) {
    if (k in v) {
      throw new VerdictContractError(
        `an engine may not emit a '${k}' field — decision belongs to Meta Decision alone`);
    }
  }
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string' && FORBIDDEN_DECISION_VALUES.includes(val.toUpperCase())) {
      throw new VerdictContractError(
        `field '${k}' carries the direction verb '${val}' — no engine may output BUY/SELL`);
    }
  }

  if (typeof v.engine !== 'string' || !v.engine) throw new VerdictContractError('engine id required');
  if (typeof v.engineVersion !== 'string' || !v.engineVersion) {
    throw new VerdictContractError('engineVersion required — a verdict without a version cannot be audited');
  }
  if (!STATUSES.includes(v.status)) {
    throw new VerdictContractError(`status must be one of ${STATUSES.join('|')}, got ${JSON.stringify(v.status)}`);
  }

  // ── null ≠ 0 ──────────────────────────────────────────────────────────────
  if (v.score !== null && !_inRange(v.score, -1, 1)) {
    throw new VerdictContractError('score must be -1..+1 or null (NaN/Infinity are not null)');
  }
  if (v.status !== 'ok' && v.score !== null) {
    throw new VerdictContractError(
      `status='${v.status}' requires score:null — NEVER 0. Zero is a confident neutral reading; ` +
      'null is the absence of one');
  }
  if (v.status !== 'ok' && v.confidence !== null) {
    throw new VerdictContractError(`status='${v.status}' requires confidence:null`);
  }
  if (v.status !== 'ok' && !v.abstainReason) {
    throw new VerdictContractError(`status='${v.status}' requires abstainReason — silence is not an explanation`);
  }
  if (v.confidence !== null && !_inRange(v.confidence, 0, 1)) {
    throw new VerdictContractError('confidence must be 0..1 or null');
  }

  // ── reliability: the field that decides whether this engine can steer ─────
  if (v.reliability !== null && !_inRange(v.reliability, 0, 1)) {
    throw new VerdictContractError('reliability must be 0..1 (MEASURED out-of-sample) or null');
  }

  if (!Array.isArray(v.limitations)) throw new VerdictContractError('limitations must be an array');
  if (v.status === 'ok' && v.limitations.length === 0) {
    throw new VerdictContractError(
      'an ok verdict must state at least one limitation — every engine in this platform has one');
  }
  if (!Array.isArray(v.missingEvidence)) throw new VerdictContractError('missingEvidence must be an array');
  for (const m of v.missingEvidence) {
    if (!m || typeof m.input !== 'string' || typeof m.reason !== 'string') {
      throw new VerdictContractError('each missingEvidence entry needs {input, reason}');
    }
  }
  if (!v.assumptions || typeof v.assumptions !== 'object' || Array.isArray(v.assumptions)) {
    throw new VerdictContractError('assumptions must be an object — name every unverified constant');
  }
  if (v.sampleSize != null && !(Number.isInteger(v.sampleSize) && v.sampleSize >= 0)) {
    throw new VerdictContractError('sampleSize must be a non-negative integer or null');
  }
  if (v.dataQuality != null && !_inRange(v.dataQuality, 0, 1)) {
    throw new VerdictContractError('dataQuality must be 0..1 or null');
  }

  return Object.freeze({
    engine: v.engine,
    engineVersion: v.engineVersion,
    status: v.status,
    score: v.score,
    confidence: v.confidence,
    reliability: v.reliability,
    sampleSize: v.sampleSize != null ? v.sampleSize : null,
    dataQuality: v.dataQuality != null ? v.dataQuality : null,
    freshnessMs: v.freshnessMs != null ? v.freshnessMs : null,
    evidence: Object.freeze((v.evidence || []).slice()),
    limitations: Object.freeze(v.limitations.slice()),
    missingEvidence: Object.freeze(v.missingEvidence.slice()),
    assumptions: Object.freeze({ ...v.assumptions }),
    abstainReason: v.abstainReason != null ? v.abstainReason : null,
    computedAt: v.computedAt || null,
  });
}

/**
 * The abstain path, made easy so that abstaining is never harder than guessing.
 * If it is easier to emit a number than to abstain, engines will emit a number.
 */
function abstain(engine, engineVersion, reason, extra = {}) {
  return build({
    engine, engineVersion, status: 'abstain',
    score: null, confidence: null,
    reliability: extra.reliability != null ? extra.reliability : null,
    limitations: extra.limitations || [],
    missingEvidence: extra.missingEvidence || [],
    assumptions: extra.assumptions || {},
    abstainReason: reason,
    computedAt: extra.computedAt || null,
  });
}

/**
 * Weight an engine may carry in a future combination.
 * `reliability: null` ⇒ 0 ⇒ the engine may VETO but may never DRIVE.
 * This function exists so that no consumer ever writes `reliability || 0.5`.
 */
function weightOf(verdict) {
  if (!verdict || verdict.status !== 'ok') return 0;
  return verdict.reliability == null ? 0 : verdict.reliability;
}

/** True when the verdict can only block, never steer. */
const isVetoOnly = (verdict) => weightOf(verdict) === 0;

module.exports = {
  build, abstain, weightOf, isVetoOnly,
  VerdictContractError, STATUSES,
  FORBIDDEN_DECISION_KEYS, FORBIDDEN_DECISION_VALUES,
};
