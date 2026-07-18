// ============================================================================
//  hl-verify.js — Data Verification Engine for option High/Low records.
//
//  Owner spec (2026-07-17) reviewed by Board doc REVIEW-BOARD-008: PASS WITH 8
//  CONDITIONS. This module implements the spec WITH those conditions folded in:
//
//   COND-1  ONE OWNER: this engine is the single gate for H/L truth. The live
//           update site and the candle-reconcile task feed INTO it (ingest /
//           confirmByCandle) — nobody else writes a record.
//   COND-2  TWO HONESTY TIERS, never conflated:
//             FEED_VALIDATED      — passed tick checks + next-tick confirmation
//             EXCHANGE_RECONCILED — confirmed against a 1-minute exchange candle
//           A UI badge must state WHICH tier it has. "Verified by Exchange
//           Data" on tick-only evidence is forbidden (the 046 defect).
//   COND-3  Next-tick confirmation has a TIMEOUT; on expiry the candidate is
//           handed to the candle tier (needsCandle) instead of waiting forever
//           on an illiquid strike (WS delivery measured 8–30%, audit 034).
//   COND-4  The "realistic jump" rule NEVER rejects — it only marks SUSPICIOUS.
//           Gamma-blast research hunts 5–50× expiry moves; a guessed threshold
//           would reject the platform's own subject. Confirmation — not a
//           constant — decides truth. jumpLogPct is null (disabled) until an
//           evidence-derived value exists.
//   COND-5  Circuit-band check (spec rule 3) is LOG-ONLY until the exchange
//           price-band document is obtained (CE-6). bandCheck() records, never
//           rejects.
//   COND-6  DECLARED retention: the audit log keeps maxLog entries and logs a
//           TRIM entry when it drops old ones. No silent deletion, ever.
//   COND-7  ABSENT ≠ INVALID: a feed gap is logged as its own GAP entry via
//           noteGap(). Silence must never read as health (audit 034).
//   COND-8  CSV export is a PURE function here; the HTTP surface that serves it
//           must sit behind auth or loopback (wiring approval package).
//
//  Spec rules 1–9 mapping: 1 out-of-order → INVALID · 2 exchTs sanity (finite,
//  not future beyond skewMs) · 3 band = log-only (COND-5) · 4 NaN/null/0/neg →
//  INVALID · 5 duplicate → INVALID · 6 stale → INVALID · 7 source must be
//  declared ('ws'|'rest'); untagged → INVALID (rule kept honest for the mixed
//  pipeline) · 8 sequence used only when present (feed does not parse one
//  today — measured) · 9 jump → SUSPICIOUS only (COND-4).
//
//  Dhan WS note: `ltt` arrives as epoch SECONDS (dhan-ws-feed.js:203). The
//  ADAPTER converts to ms before ingest; this engine speaks ms only.
//
//  UNKNOWN IS NULL, NEVER ZERO. No fabricated defaults anywhere.
// ============================================================================
'use strict';

// Number(null) === 0 — the exact null→0 coercion this codebase has 119 of.
// Guard null/undefined/'' FIRST, or an "unknown" candle becomes a 0–0 candle.
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const LEVEL = { GREEN: 'GREEN', BLUE: 'BLUE', YELLOW: 'YELLOW', RED: 'RED' };
const TIER = { FEED: 'FEED_VALIDATED', EXCH: 'EXCHANGE_RECONCILED' };

class HLVerifier {
  constructor(opts = {}) {
    this.staleMs = opts.staleMs ?? 10_000;          // recvTs - exchTs beyond this = stale
    this.skewMs = opts.skewMs ?? 2_000;             // exchTs ahead of recvTs beyond this = invalid
    this.confirmTimeoutMs = opts.confirmTimeoutMs ?? 15_000;   // COND-3
    // Confirmation geometry: a later tick confirms a candidate ONLY by staying
    // within retracePct of the candidate's price (see _tryConfirm for why
    // "still above the old high" is not enough). Owner-tunable; declared.
    this.retracePct = opts.retracePct ?? 0.5;
    this.jumpLogPct = opts.jumpLogPct ?? null;      // COND-4: disabled until evidence-derived
    this.maxLog = opts.maxLog ?? 5_000;             // COND-6: declared retention
    this.now = opts.now || (() => Date.now());

    this._rec = new Map();      // key -> { high, low, highAt, lowAt, highTier, lowTier }
    this._last = new Map();     // key -> last ACCEPTED tick {price, exchTs, seq}
    this._pending = new Map();  // key -> { kind:'HIGH'|'LOW', price, exchTs, at, needsCandle }
    this._log = [];             // audit entries, capped with a TRIM entry (COND-6)
  }

  record(key) { return this._rec.get(key) || null; }
  pending(key) { return this._pending.get(key) || null; }
  auditLog() { return this._log.slice(); }

  _logEntry(e) {
    this._log.push({ at: this.now(), ...e });
    if (this._log.length > this.maxLog) {
      const dropped = this._log.length - this.maxLog;
      this._log = this._log.slice(-this.maxLog);
      // COND-6: trimming is itself an audited event — never a silent delete.
      this._log.push({ at: this.now(), key: '*', status: 'TRIM', reason: `audit log trimmed ${dropped} oldest entries (maxLog ${this.maxLog})` });
    }
  }

  /** COND-7 — a feed gap is recorded as ABSENT, distinct from any rejection. */
  noteGap(key, sinceMs, source) {
    this._logEntry({ key, status: 'GAP', level: null, reason: `no ticks for ${sinceMs}ms`, source: source || null });
  }

  /**
   * The single gate (COND-1). tick = { price, exchTs(ms), recvTs(ms), seq?, source }
   * Returns { status:'ACCEPT'|'PENDING'|'INVALID'|'CONFIRM', kind, level, tier, reasons[] }.
   */
  ingest(key, tick) {
    const t = tick || {};
    const price = num(t.price);
    const exchTs = num(t.exchTs);
    const recvTs = num(t.recvTs) ?? this.now();
    const reasons = [];

    // ── rule 4: structural validity — NaN/null/0/negative ──────────────────
    if (price === null || price <= 0) reasons.push('price NaN/null/zero/negative');
    // ── rule 7: source must be declared (mixed WS/REST pipeline — honest form)
    if (t.source !== 'ws' && t.source !== 'rest') reasons.push('undeclared source');
    // ── rule 2: exchange timestamp sanity ──────────────────────────────────
    if (exchTs === null) reasons.push('missing exchange timestamp');
    else if (exchTs - recvTs > this.skewMs) reasons.push('exchange timestamp in the future');
    // ── rule 6: staleness ──────────────────────────────────────────────────
    if (exchTs !== null && recvTs - exchTs > this.staleMs) reasons.push('stale tick');

    const last = this._last.get(key) || null;
    if (last && exchTs !== null) {
      // ── rule 5: duplicate ────────────────────────────────────────────────
      if (exchTs === last.exchTs && price === last.price && (t.seq == null || t.seq === last.seq)) reasons.push('duplicate tick');
      // ── rule 1: must be newer than the previous accepted tick ────────────
      else if (exchTs < last.exchTs) reasons.push('older than previous tick');
      // ── rule 8: sequence, only when the feed provides one ────────────────
      else if (t.seq != null && last.seq != null && t.seq <= last.seq) reasons.push('sequence not increasing');
    }

    if (reasons.length) {
      this._logEntry({ key, price, exchTs, seq: t.seq ?? null, source: t.source ?? null, status: 'INVALID', level: LEVEL.RED, reason: reasons.join('; ') });
      return { status: 'INVALID', kind: null, level: LEVEL.RED, tier: null, reasons };
    }

    // Tick is VALID. It participates in confirmation before candidacy.
    this._last.set(key, { price, exchTs, seq: t.seq ?? null });

    let confirmed = null;
    const p = this._pending.get(key);
    if (p && exchTs > p.exchTs) confirmed = this._tryConfirm(key, p, price);

    // ── H/L candidacy against the current record ───────────────────────────
    let rec = this._rec.get(key);
    if (!rec) {
      // First valid tick initializes the record — an initialization, not a "new high" event.
      rec = { high: price, low: price, highAt: exchTs, lowAt: exchTs, highTier: TIER.FEED, lowTier: TIER.FEED };
      this._rec.set(key, rec);
      this._logEntry({ key, price, exchTs, seq: t.seq ?? null, source: t.source, status: 'INIT', level: null, reason: 'first valid tick' });
      return { status: 'ACCEPT', kind: 'INIT', level: null, tier: TIER.FEED, reasons: [], confirmed };
    }

    const kind = price > rec.high ? 'HIGH' : price < rec.low ? 'LOW' : null;
    if (!kind) {
      return { status: 'ACCEPT', kind: null, level: null, tier: null, reasons: [], confirmed };
    }

    // ── rule 9 as COND-4: jump marks SUSPICIOUS, never rejects ─────────────
    const base = kind === 'HIGH' ? rec.high : rec.low;
    if (this.jumpLogPct != null && base > 0 && Math.abs(price - base) / base * 100 > this.jumpLogPct) {
      reasons.push(`jump ${(Math.abs(price - base) / base * 100).toFixed(0)}% > ${this.jumpLogPct}% (logged, not rejected)`);
    }

    // Spec: EVERY new extreme waits for confirmation (double verification).
    this._pending.set(key, { kind, price, exchTs, at: recvTs, needsCandle: false });
    this._logEntry({ key, price, exchTs, seq: t.seq ?? null, source: t.source, status: 'PENDING', level: LEVEL.YELLOW, kind, reason: reasons.join('; ') || `candidate new ${kind.toLowerCase()}` });
    return { status: 'PENDING', kind, level: LEVEL.YELLOW, tier: null, reasons, confirmed };
  }

  /**
   * Confirmation geometry. A later tick confirms the CANDIDATE'S PRICE only by
   * staying within retracePct of it. "Still above the old high" is NOT enough:
   * it proves that SOME new high exists, not that the candidate's price ever
   * traded — an isolated 10× spike followed by a tick just above the old high
   * must reject the spike. That follow-through tick then becomes its own
   * candidate through the normal candidacy path (the test suite's bad-tick
   * case is exactly this shape).
   */
  _tryConfirm(key, p, nextPrice) {
    const retrace = Math.abs(nextPrice - p.price) / p.price;
    if (retrace <= this.retracePct) {
      this._accept(key, p, TIER.FEED, `confirmed by next tick (retrace ${(retrace * 100).toFixed(0)}%)`);
      return { kind: p.kind, price: p.price, tier: TIER.FEED };
    }
    // The next tick collapsed far away from the candidate → the candidate's
    // price is unproven. Reject it; the candle tier can still resurrect a real
    // move, and the current tick may found a fresh candidate of its own.
    this._pending.delete(key);
    this._logEntry({ key, price: p.price, exchTs: p.exchTs, status: 'REJECTED', level: LEVEL.RED, kind: p.kind, reason: `next tick ${nextPrice} retraced ${(retrace * 100).toFixed(0)}% from the candidate — candidate price unproven (bad tick)` });
    return { kind: p.kind, price: p.price, tier: null, rejected: true };
  }

  _accept(key, p, tier, why) {
    const rec = this._rec.get(key);
    const prev = p.kind === 'HIGH' ? rec.high : rec.low;
    if (p.kind === 'HIGH') { rec.high = p.price; rec.highAt = p.exchTs; rec.highTier = tier; }
    else { rec.low = p.price; rec.lowAt = p.exchTs; rec.lowTier = tier; }
    this._pending.delete(key);
    this._logEntry({ key, price: p.price, exchTs: p.exchTs, status: 'ACCEPTED', level: p.kind === 'HIGH' ? LEVEL.GREEN : LEVEL.BLUE, kind: p.kind, tier, reason: why, prevExtreme: prev });
  }

  /** COND-3 — expire waiting candidates to the candle tier instead of starving. */
  sweep() {
    const now = this.now();
    for (const [key, p] of this._pending) {
      if (!p.needsCandle && now - p.at > this.confirmTimeoutMs) {
        p.needsCandle = true;
        this._logEntry({ key, price: p.price, exchTs: p.exchTs, status: 'NEEDS_CANDLE', level: LEVEL.YELLOW, kind: p.kind, reason: `no confirming tick within ${this.confirmTimeoutMs}ms — escalated to candle tier` });
      }
    }
  }

  /** COND-2 — the EXCHANGE_RECONCILED tier: confirm or refute via a 1-minute candle. */
  confirmByCandle(key, candle) {
    const p = this._pending.get(key);
    if (!p) return null;
    const ch = num(candle && candle.high), cl = num(candle && candle.low);
    if (ch === null || cl === null) return null;                    // an unknown candle decides nothing
    const seen = p.kind === 'HIGH' ? ch >= p.price * (1 - 0.001) : cl <= p.price * (1 + 0.001);
    if (seen) {
      this._accept(key, p, TIER.EXCH, 'confirmed by exchange 1-minute candle');
      return { kind: p.kind, price: p.price, tier: TIER.EXCH };
    }
    this._pending.delete(key);
    this._logEntry({ key, price: p.price, exchTs: p.exchTs, status: 'REJECTED', level: LEVEL.RED, kind: p.kind, reason: `exchange candle (${cl}–${ch}) never printed the candidate — bad tick` });
    return { kind: p.kind, price: p.price, tier: null, rejected: true };
  }

  /** COND-5 — spec rule 3, log-only until the exchange band document exists (CE-6). */
  bandCheck(key, price, band) {
    const lo = num(band && band.lower), hi = num(band && band.upper);
    if (lo === null || hi === null) return;                          // unknown band: nothing to log
    if (price < lo || price > hi) this._logEntry({ key, price, status: 'BAND_LOG', level: LEVEL.YELLOW, reason: `outside declared band ${lo}–${hi} (log-only — band source pending CE-6)` });
  }

  /** COND-8 — pure CSV; the HTTP surface that serves this must be auth/loopback-guarded. */
  toCSV() {
    const cols = ['at', 'key', 'kind', 'price', 'status', 'level', 'tier', 'reason', 'seq', 'exchTs', 'source'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(',')]
      .concat(this._log.map((e) => cols.map((c) => esc(e[c])).join(',')))
      .join('\n');
  }
}

module.exports = { HLVerifier, LEVEL, TIER };
