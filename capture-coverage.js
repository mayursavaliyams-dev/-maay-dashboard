/* capture-coverage — "were we watching?" must be answerable independently of
   whether anything changed.
   Phase 2B of the backend hardening programme. See docs/086, docs/087.

   THE DEFECT
   ----------
   The capture writes a snapshot only when the data has changed. So a gap in the
   archive has two possible meanings and no way to tell them apart:

       the market did not move        (a fact about the market)
       we were not watching           (a fact about us)

   The first is data. The second is the absence of data. Merging them means every
   backtest silently treats our downtime as a quiet market.

   MEASURED 2026-08-08 over the 19 days in data/opt-candles:

       captured from the 09:15 open :  2 days
       mean minutes missed at open  :  183 per day
       worst                        :  358 (2026-07-27 — the last 16 minutes only)
       2026-08-07 ended at 14:03    :  87 further minutes missing at the close

   None of that is visible in the archive itself. It took a script to find, and
   until it was written the honest answer to "what do we have?" was unknown.

   WHAT THIS RECORDS
   -----------------
   A coverage record per poll, whether or not the payload changed:

       { minute, at, outcome, detail }
       outcome: 'captured' | 'unchanged' | 'error' | 'absent'

   `unchanged` is a POSITIVE observation — we looked and it was the same. It is
   not the same as `absent`, which is us not looking. That distinction is the
   whole module.

   Coverage is stored separately from the payload archive, deliberately: if the
   payload write fails, the record that we tried must survive, or the failure
   erases its own evidence. */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync } = require('./safe-write');

const IST_OFFSET_MIN = 330;
const SESSION_OPEN_MIN = 9 * 60 + 15;      // 09:15 IST
const SESSION_CLOSE_MIN = 15 * 60 + 30;    // 15:30 IST

const OUTCOMES = new Set(['captured', 'unchanged', 'error', 'absent']);

function istMinuteOfDay(ts) {
  const d = new Date(ts + IST_OFFSET_MIN * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function istDate(ts) {
  return new Date(ts + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

class CaptureCoverage {
  constructor({ dir, now = Date.now } = {}) {
    if (!dir) throw new Error('[coverage] a directory is required');
    this.dir = dir;
    this.now = now;
    this._day = null;
    this._minutes = null;      // Map<minute, {outcome, at, detail}>
  }

  _file(date) { return path.join(this.dir, `${date}.json`); }

  _load(date) {
    if (this._day === date && this._minutes) return;
    this._day = date;
    this._minutes = new Map();
    this.loadError = null;
    try {
      /* readJsonSync, not JSON.parse(readFileSync(...)): safe-write leaves a
         `.bak` beside every atomic write and readJsonSync recovers from it.
         Parsing inline discards that, and a torn write would erase a day's
         record of whether we were watching — which is the one thing this file
         exists to preserve. */
      const j = require('./safe-write').readJsonSync(this._file(date), { fallback: null });
      if (j === null) { const e = new Error('absent'); e.code = 'ENOENT'; throw e; }
      for (const [m, rec] of Object.entries(j.minutes || {})) this._minutes.set(Number(m), rec);
    } catch (e) {
      /* No prior file for this day, or it is unreadable. Either way we start with
         what we can observe from here, and the minutes we cannot vouch for report
         as `absent` — we cannot show we were watching, and absence of proof is
         recorded as absence.

         But ENOENT and EACCES are not the same event and must not look the same.
         A day that has not started yet is normal; a day whose record exists and
         cannot be read means the coverage report is understating what we have,
         and somebody has to be able to find that out. */
      this.loadError = e.code === 'ENOENT' ? null : `${e.code || 'ERR'}: ${e.message}`;
    }
  }

  /** Record one poll. Call this on EVERY poll, including the ones that changed
   *  nothing and the ones that failed. */
  record(outcome, detail = null, ts = this.now()) {
    if (!OUTCOMES.has(outcome)) throw new Error(`[coverage] unknown outcome ${JSON.stringify(outcome)}`);
    const date = istDate(ts);
    this._load(date);
    const minute = istMinuteOfDay(ts);

    /* Within one minute, the more informative outcome wins: an error followed by
       a successful capture in the same minute means that minute IS covered, and
       a capture followed by an error means it is covered too. Errors are still
       counted in `errors` so they are not lost by this. */
    const rank = { absent: 0, error: 1, unchanged: 2, captured: 3 };
    const prev = this._minutes.get(minute);
    if (!prev || rank[outcome] > rank[prev.outcome]) {
      /* Carry the error tally across the upgrade. Replacing the record wholesale
         erased it, so a minute that failed twice and then succeeded reported a
         clean minute — the successful retry deleted the evidence that retries
         were needed. Coverage and reliability are different questions and the
         answer to one must not overwrite the other. */
      this._minutes.set(minute, {
        outcome,
        at: new Date(ts).toISOString(),
        detail,
        ...(prev && prev.errors ? { errors: prev.errors, lastError: prev.lastError } : {}),
      });
    }
    if (outcome === 'error') {
      const rec = this._minutes.get(minute);
      rec.errors = (rec.errors || 0) + 1;
      rec.lastError = detail;
    }
    this._persist(date);
    return this._minutes.get(minute);
  }

  _persist(date) {
    fs.mkdirSync(this.dir, { recursive: true });
    const minutes = {};
    for (const [m, rec] of this._minutes) minutes[m] = rec;
    writeFileAtomicSync(this._file(date), JSON.stringify({
      date, updatedAt: new Date(this.now()).toISOString(), minutes,
    }));
  }

  /** Were we watching, minute by minute, across the session?
   *
   *  @returns { date, sessionMinutes, observed, missing, coveragePct, gaps[], firstSeen, lastSeen }
   *           `gaps` are contiguous unobserved ranges within the session.
   *
   *  A minute with no record is `missing` — not `unchanged`. The whole point is
   *  that we cannot claim an unobserved minute was quiet.
   */
  report(date = istDate(this.now())) {
    this._load(date);
    const gaps = [];
    let observed = 0;
    let run = null;
    let firstSeen = null;
    let lastSeen = null;

    for (let m = SESSION_OPEN_MIN; m <= SESSION_CLOSE_MIN; m++) {
      const rec = this._minutes.get(m);
      const seen = !!rec && rec.outcome !== 'absent';
      if (seen) {
        observed++;
        if (firstSeen === null) firstSeen = m;
        lastSeen = m;
        if (run) { gaps.push({ from: hhmm(run.from), to: hhmm(m - 1), minutes: m - run.from }); run = null; }
      } else if (!run) {
        run = { from: m };
      }
    }
    if (run) gaps.push({ from: hhmm(run.from), to: hhmm(SESSION_CLOSE_MIN), minutes: SESSION_CLOSE_MIN - run.from + 1 });

    const total = SESSION_CLOSE_MIN - SESSION_OPEN_MIN + 1;
    return {
      date,
      sessionMinutes: total,
      observed,
      missing: total - observed,
      coveragePct: +((observed / total) * 100).toFixed(1),
      firstSeen: firstSeen === null ? null : hhmm(firstSeen),
      lastSeen: lastSeen === null ? null : hhmm(lastSeen),
      gaps,
    };
  }

  /** Can the archive answer "were we watching" for this whole period?
   *
   *  Returns false when ANY day in the range has no coverage file at all — a day
   *  we have no record of is not a day we can call quiet. */
  canAnswer(fromDate, toDate) {
    const days = [];
    for (let d = new Date(`${fromDate}T00:00:00Z`); d <= new Date(`${toDate}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
      const ds = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      days.push({ date: ds, hasRecord: fs.existsSync(this._file(ds)) });
    }
    const without = days.filter((x) => !x.hasRecord).map((x) => x.date);
    return { ok: without.length === 0, tradingDays: days.length, withoutRecord: without };
  }
}

module.exports = { CaptureCoverage, istMinuteOfDay, istDate, SESSION_OPEN_MIN, SESSION_CLOSE_MIN };
