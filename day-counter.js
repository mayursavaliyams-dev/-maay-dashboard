/* day-counter — a restart is not a new trading day.
   Phase 1C of the backend hardening programme. See docs/086, docs/087.

   THE DEFECT
   ----------
   `tradesToday` and the open-position state live only in memory. pm2 is
   configured with `autorestart: true, max_restarts: 10`.

       ten restarts = ten fresh daily trade budgets

   Nothing about that is visible: the engine reports "0 trades today" and it is
   telling the truth about its memory. The daily cap is intact, correct, and
   applied to a counter that was reset behind it.

   THE KEY DECISION: WHAT RESETS THE COUNT
   ---------------------------------------
   The count is keyed to the **IST calendar date**, and to nothing else.

   Not to the process. Not to a session id. Not to "since the engine started".
   Each of those makes a restart look like a new day, which is the defect. The
   only thing that may reset a daily count is the day changing.

   In particular the count does NOT reset at 09:15. A restart at 09:20 must load
   what was recorded at 09:00, and it does, because both are the same IST date.
   Anything keyed to the market session would treat the open as a boundary and
   hand back a fresh budget every morning restart.

   ON A CORRUPT FILE
   -----------------
   A half-written or unparseable state file yields `loaded: false` and a stated
   reason, and the counter refuses to report a count. It does NOT return zero.
   Zero is a claim that no trades happened, and an unreadable file is not
   evidence of that — it is evidence of nothing. A caller that cannot get a count
   must treat that as "do not trade", which is what fail-closed means here.

   The write is atomic (safe-write), so a torn file is unlikely; this handles the
   case anyway, because "unlikely" and "impossible" differ by exactly one
   incident. */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync } = require('./safe-write');

const IST_OFFSET_MIN = 330;

/** The IST calendar date for a timestamp. This is the reset key. */
function istDateStr(ts = Date.now()) {
  const d = new Date(ts + IST_OFFSET_MIN * 60000);
  return d.toISOString().slice(0, 10);
}

class DayCounter {
  /**
   * @param file  where the state lives
   * @param now   () => epoch ms. Injected so the day boundary is testable
   *              without waiting for midnight.
   */
  constructor({ file, now = Date.now } = {}) {
    if (!file) throw new Error('[day-counter] a file path is required');
    this.file = file;
    this.now = now;
    this.state = null;         // null until load() — never an implicit empty
    this.loaded = false;
    this.loadError = null;
    this.load();
  }

  /** Read the state from disk. Called at construction, so a fresh process
   *  starts from what the previous one recorded rather than from zero. */
  load() {
    this.loadError = null;
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        // Genuinely absent is different from unreadable. A file that has never
        // existed is a real empty state; a file that cannot be read is unknown.
        this.state = { date: istDateStr(this.now()), counts: {} };
        this.loaded = true;
        return this;
      }
      this.state = null;
      this.loaded = false;
      this.loadError = `${e.code || 'ERR'}: ${e.message}`;
      return this;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      this.state = null;
      this.loaded = false;
      this.loadError = `unparseable state file (${e.message}) — refusing to assume zero`;
      return this;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.date !== 'string'
        || !parsed.counts || typeof parsed.counts !== 'object') {
      this.state = null;
      this.loaded = false;
      this.loadError = 'state file has the wrong shape — refusing to assume zero';
      return this;
    }

    this.state = { date: parsed.date, counts: { ...parsed.counts } };
    this.loaded = true;
    return this;
  }

  /** Roll to today if the IST date has changed. The ONLY reset. */
  _roll() {
    if (!this.loaded) return;
    const today = istDateStr(this.now());
    if (this.state.date !== today) {
      this.state = { date: today, counts: {} };
      this._persist();
    }
  }

  _persist() {
    writeFileAtomicSync(this.file, JSON.stringify({
      date: this.state.date,
      counts: this.state.counts,
      updatedAt: new Date(this.now()).toISOString(),
      pid: process.pid,
    }));
  }

  /** How many for this key today?
   *
   *  @returns a non-negative integer, or **null** when the state could not be
   *           read. null is not zero and must not be treated as zero: the
   *           caller's correct response to null is to refuse to trade. */
  count(key) {
    if (!this.loaded) return null;
    this._roll();
    return this.state.counts[key] || 0;
  }

  /** Record one, and persist immediately.
   *
   *  Immediately, not on a timer and not at shutdown: the whole point is to
   *  survive a process that does not get to run its shutdown path. A counter
   *  flushed on exit is a counter that is correct except when it matters. */
  increment(key, by = 1) {
    if (!this.loaded) {
      throw new Error(`[day-counter] cannot record against unreadable state: ${this.loadError}`);
    }
    this._roll();
    this.state.counts[key] = (this.state.counts[key] || 0) + by;
    this._persist();
    return this.state.counts[key];
  }

  /** Everything, for a status endpoint. Reports its own health rather than
   *  presenting an empty object as a healthy empty day. */
  status() {
    if (!this.loaded) {
      return { ok: false, date: null, counts: null, error: this.loadError };
    }
    this._roll();
    return { ok: true, date: this.state.date, counts: { ...this.state.counts }, error: null };
  }
}

module.exports = { DayCounter, istDateStr };
