/* ═══════════════════════════════════════════════════════════════════════════
   kill-switch — trips automatically or by hand, and stays tripped.

   THE ONE PROPERTY THAT MAKES IT A KILL SWITCH

   It is STICKY, and it survives a restart. A switch that clears when the process
   comes back is not a kill switch — it is a pause, and the most likely thing to
   happen after a system trips on a bad day is that someone restarts it. The
   state therefore lives on disk, is read at construction, and can only be
   cleared by an explicit reset that records who did it and why.

   FAIL CLOSED ON ITS OWN STATE FILE

   If the state file exists but cannot be parsed, the switch reads as TRIPPED,
   not as clear. A corrupt file means the last known state is unknown, and
   "unknown" must not resolve to "carry on trading" — this is the same rule the
   existing halt invariant already applies to the equity file.

   FIVE TRIGGERS, EACH INDEPENDENTLY CONFIGURABLE
     · day loss limit reached
     · consecutive losing trades
     · broker API error rate over a trailing window
     · market data staleness
     · a human

   TWO ACTIONS
     · STOP_ENTRIES — no new positions; existing ones keep their exits, because
       a position with a stop is safer than a position being force-closed into
       the same disordered market that tripped the switch
     · FLATTEN — close everything now

   Every trip and every reset is recorded with the observed value, the threshold
   it crossed, and the time.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const { writeJsonSync, readJsonSync } = require('./safe-write');

const STATE = path.join(__dirname, 'data', 'kill-switch.json');

class KillSwitch {
  constructor(deps = {}) {
    this.cfg = deps.cfg || require('./risk-config').get;
    this.log = deps.log || console;
    this.now = deps.now || (() => Date.now());
    this.file = deps.file || STATE;
    this._brokerCalls = [];          // trailing window of true/false (ok/error)
    this._state = this._read();
  }

  _read() {
    const clear = { tripped: false, reason: null, trippedAt: null, action: null, history: [] };
    try {
      /* A MISSING file is a clear switch — nothing has tripped yet.
         A CORRUPT file throws, and safe-write recovers from its own backup first
         if one exists. Only when both are unreadable does this fall through to
         the fail-closed branch below. The distinction matters: "never tripped"
         and "we cannot tell" must not resolve to the same state. */
      const j = readJsonSync(this.file, {
        fallback: clear,
        onRecover: (why, bak) => this.log.warn(`[kill-switch] state was corrupt (${why}); recovered from ${bak}`),
      });
      if (typeof j !== 'object' || j === null) throw new Error('not an object');
      return {
        tripped: !!j.tripped, reason: j.reason || null, trippedAt: j.trippedAt || null,
        action: j.action || null, detail: j.detail || null,
        history: Array.isArray(j.history) ? j.history : [],
      };
    } catch (e) {
      /* Unreadable is TRIPPED. The alternative — treating a corrupt file as
         clear — means the one thing guaranteed to happen after a crash on a bad
         day is that the switch silently resets itself. */
      this.log.error(`[kill-switch] state file unreadable (${e.message}) — reading as TRIPPED, fail closed`);
      return {
        tripped: true, reason: 'STATE_UNREADABLE',
        detail: `kill-switch state could not be parsed: ${e.message}`,
        trippedAt: new Date(this.now()).toISOString(),
        action: 'STOP_ENTRIES', history: [],
      };
    }
  }

  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      /* Atomic. This is the one file in the system that must never be found
         half-written: a torn kill-switch state reads as STATE_UNREADABLE, which
         fails closed and is therefore safe — but it also means a crash during a
         write would leave the switch permanently tripped for the wrong reason,
         and nobody would know which. */
      writeJsonSync(this.file, this._state);
    } catch (e) {
      this.log.error(`[kill-switch] COULD NOT PERSIST state: ${e.message} — a restart may not see this trip`);
    }
  }

  status() {
    return {
      tripped: this._state.tripped, reason: this._state.reason, detail: this._state.detail || null,
      trippedAt: this._state.trippedAt, action: this._state.action,
      brokerErrorRate: this.brokerErrorRate(),
      history: this._state.history.slice(-20),
    };
  }

  /** Blocking is the question every caller actually asks. */
  blocksNewEntries() { return !!this._state.tripped; }
  requiresFlatten() { return !!this._state.tripped && this._state.action === 'FLATTEN'; }

  /**
   * Trip. Idempotent: an already-tripped switch keeps its ORIGINAL reason,
   * because the first cause is the diagnostic one and a later symptom
   * overwriting it destroys the only account of what happened.
   */
  trip({ reason, detail, observed = null, threshold = null, by = 'auto', action = null }) {
    const cfg = this.cfg();
    const entry = {
      at: new Date(this.now()).toISOString(), event: 'TRIP', reason, detail,
      observed, threshold, by, action: action || cfg.RISK_KILL_ACTION,
      supersededBy: this._state.tripped ? null : undefined,
    };
    this._state.history.push(entry);

    if (this._state.tripped) {
      this.log.warn(`[kill-switch] already tripped on ${this._state.reason}; ${reason} recorded but the original reason stands`);
      this._write();
      return { ...this.status(), newlyTripped: false };
    }

    this._state.tripped = true;
    this._state.reason = reason;
    this._state.detail = detail;
    this._state.trippedAt = entry.at;
    this._state.action = entry.action;
    this._write();

    this.log.error(`[kill-switch] TRIPPED — ${reason}: ${detail} ` +
      `(observed ${observed}, threshold ${threshold}) · action ${entry.action} · by ${by}`);
    return { ...this.status(), newlyTripped: true };
  }

  /**
   * Reset. Requires a human and a reason — both recorded.
   * There is deliberately no automatic path back: nothing in this module can
   * clear the switch, and no timer will.
   */
  reset({ by, note }) {
    if (!by || String(by).trim() === '') {
      return { ok: false, error: 'reset requires `by` — a kill switch that anonymous code can clear is not a kill switch' };
    }
    if (!this._state.tripped) return { ok: true, alreadyClear: true, ...this.status() };

    const was = { reason: this._state.reason, trippedAt: this._state.trippedAt };
    this._state.history.push({
      at: new Date(this.now()).toISOString(), event: 'RESET', by,
      note: note || null, clearedReason: was.reason, hadBeenTrippedSince: was.trippedAt,
    });
    this._state.tripped = false;
    this._state.reason = null;
    this._state.detail = null;
    this._state.trippedAt = null;
    this._state.action = null;
    this._write();

    this.log.warn(`[kill-switch] RESET by ${by} — cleared ${was.reason} (tripped since ${was.trippedAt})${note ? ` · ${note}` : ''}`);
    return { ok: true, ...this.status() };
  }

  /* ── automatic triggers ─────────────────────────────────────────────────── */

  noteBrokerCall(ok) {
    const cfg = this.cfg();
    this._brokerCalls.push(!!ok);
    const w = Math.max(1, cfg.RISK_KILL_ERROR_WINDOW);
    if (this._brokerCalls.length > w) this._brokerCalls.splice(0, this._brokerCalls.length - w);
    return this.checkBrokerErrorRate();
  }

  brokerErrorRate() {
    if (!this._brokerCalls.length) return null;   // null, not 0 — no calls is not a clean record
    const bad = this._brokerCalls.filter(x => !x).length;
    return +(bad / this._brokerCalls.length * 100).toFixed(1);
  }

  checkBrokerErrorRate() {
    const cfg = this.cfg();
    const w = Math.max(1, cfg.RISK_KILL_ERROR_WINDOW);
    // Only judged on a full window. A single failed call out of one is a 100%
    // error rate and would trip the switch on the first hiccup of the morning.
    if (this._brokerCalls.length < w) return null;
    const rate = this.brokerErrorRate();
    if (rate > cfg.RISK_KILL_BROKER_ERROR_RATE_PCT) {
      return this.trip({
        reason: 'BROKER_ERROR_RATE',
        detail: `${rate}% of the last ${w} broker calls failed`,
        observed: rate, threshold: cfg.RISK_KILL_BROKER_ERROR_RATE_PCT,
      });
    }
    return null;
  }

  /**
   * Evaluate every automatic trigger against the current state of the world.
   * Returns the trip result, or null.
   *
   * A metric that is MISSING trips the switch under RISK_FAIL_MODE 'BLOCK' —
   * because "we cannot tell whether we are down 3% today" is not a safe state to
   * keep trading in.
   */
  evaluate({ dayPnlPct, consecutiveLosses, dataAgeMs } = {}) {
    const cfg = this.cfg();
    if (this._state.tripped) return null;

    const missing = [];
    if (cfg.RISK_KILL_ON_DAY_LOSS && !Number.isFinite(dayPnlPct)) missing.push('dayPnlPct');
    if (!Number.isFinite(consecutiveLosses)) missing.push('consecutiveLosses');
    if (!Number.isFinite(dataAgeMs)) missing.push('dataAgeMs');
    if (missing.length && cfg.RISK_FAIL_MODE === 'BLOCK') {
      return this.trip({
        reason: 'UNEVALUABLE',
        detail: `cannot evaluate the kill switch: ${missing.join(', ')} unavailable. Fail mode is BLOCK.`,
        observed: missing.join(','), threshold: 'all present',
      });
    }

    if (cfg.RISK_KILL_ON_DAY_LOSS && Number.isFinite(dayPnlPct) && dayPnlPct <= -Math.abs(cfg.RISK_DAY_LOSS_LIMIT_PCT)) {
      return this.trip({
        reason: 'DAY_LOSS_LIMIT',
        detail: `day P&L ${dayPnlPct.toFixed(2)}% has reached the ${cfg.RISK_DAY_LOSS_LIMIT_PCT}% loss limit`,
        observed: dayPnlPct, threshold: -Math.abs(cfg.RISK_DAY_LOSS_LIMIT_PCT),
      });
    }
    if (Number.isFinite(consecutiveLosses) && consecutiveLosses >= cfg.RISK_KILL_CONSECUTIVE_LOSSES) {
      return this.trip({
        reason: 'CONSECUTIVE_LOSSES',
        detail: `${consecutiveLosses} losing trades in a row`,
        observed: consecutiveLosses, threshold: cfg.RISK_KILL_CONSECUTIVE_LOSSES,
      });
    }
    if (Number.isFinite(dataAgeMs) && dataAgeMs > cfg.RISK_KILL_DATA_STALENESS_MS) {
      return this.trip({
        reason: 'DATA_STALE',
        detail: `market data is ${dataAgeMs} ms old — sizing and greeks computed from it would be about a market that no longer exists`,
        observed: dataAgeMs, threshold: cfg.RISK_KILL_DATA_STALENESS_MS,
      });
    }
    return null;
  }
}

module.exports = { KillSwitch, STATE };
