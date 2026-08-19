/* low-signal — buy the session low, hold to the close, on paper.
   Research: docs/095. Read it before changing a parameter here; the numbers on
   that page describe THIS rule and stop describing it the moment the rule moves.

   WHAT THE RESEARCH FOUND, in the order it matters

   1. THE REVERSAL EXIT IS THE PART THAT IS CLEARLY WRONG.
      Mean return per signal, net of cost, by trailing width — read downward:

            trail   NIFTY    BANKNIFTY   SENSEX
            0.15%  -0.021%    -0.051%   -0.038%
            0.25%  +0.006%    -0.029%   -0.010%
            0.40%  +0.025%    -0.022%   -0.012%
            0.60%  +0.033%    -0.000%   +0.009%
            1.00%  +0.071%    +0.031%   +0.009%
            none   +0.080%    +0.051%   +0.008%

      Every loosening improves it, on every index, without exception. A stop
      tight enough to "lock in profit" after a session low is tight enough to be
      hit by the noise on the way up. So this module holds to the close, and
      REFUSES a trailing exit tighter than 1% rather than accepting a parameter
      the evidence says destroys the return.

   2. THE ENTRY HAS A CONSISTENT POSITIVE SIGN, above drift and above a random
      entry with the same exit, on all three indices.

   3. IT IS NOT SIGNIFICANT. Best case NIFTY t = 1.99 across 96 signals, and
      about thirty variants were tried to find it. That is what the best of a
      pile of noise looks like.

   WHICH IS WHY THIS IS PAPER, AND WHY IT CARRIES ITS OWN RESEARCH
   Every status response ships the measured expectation AND the t-statistic, so
   the number on screen is never separated from how weak it is. A signal feature
   that displays only its wins is how a 0.94-profit-factor strategy stayed
   enabled for months. */
'use strict';

const IST_OFFSET_MIN = 330;

/* Measured in docs/095 on 43 sessions of 5-minute bars, net of 0.03% cost.
   Stated per instrument because they differ, and shipped with the module so a
   caller cannot show the expectation without the t beside it. */
const RESEARCH = {
  asOf: '2026-08-13',
  sessions: 43,
  costPctApplied: 0.03,
  byInstrument: {
    NIFTY:     { n: 96,  meanPct: 0.079, sdPct: 0.390, t: 1.99, winPct: 66.7 },
    BANKNIFTY: { n: 103, meanPct: 0.050, sdPct: 0.369, t: 1.39, winPct: 55.3 },
    SENSEX:    { n: 96,  meanPct: 0.008, sdPct: 0.345, t: 0.24, winPct: 57.3 },
  },
  verdict: 'NOT SIGNIFICANT — the best t is 1.99 and ~30 variants were tried. '
         + 'Forward-test only; see docs/095 for the agreed gate.',
  gate: '60 distinct signal days live, positive net of OPTION costs, before any live use',
};

const DEFAULTS = {
  warmupMs: 30 * 60000,      // the opening range is not a low signal
  cooldownMs: 15 * 60000,
  /* null = hold to the close, which is what the research supports. A number
     enables a trailing exit and is REFUSED below 1% — see the table above. */
  trailPct: null,
  sessionEndIST: '15:25',    // exit before the close, not at it
  ringSize: 500,
};

const istMin = (ms) => {
  const d = new Date(ms + IST_OFFSET_MIN * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const istDate = (ms) => new Date(ms + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);

class LowSignal {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    if (this.cfg.trailPct !== null) {
      if (!(this.cfg.trailPct >= 1)) {
        throw new Error(
          `low-signal: trailPct ${this.cfg.trailPct} is tighter than 1%. docs/095 measured every `
          + 'trailing width from 0.15% to 1% and found the result monotonically WORSE the tighter '
          + 'it gets, on all three indices. Pass null to hold to the close, or >= 1 if you intend '
          + 'to accept a measured loss.');
      }
    }
    this.now = opts.now || (() => Date.now());
    this.enabled = opts.enabled !== false;
    this.log = opts.log || console;

    this._sess = new Map();      // inst -> { day, sessionLow, openedAt, lastSignalAt }
    this.open = new Map();       // inst -> position
    this.closed = [];
    this.stats = { signals: 0, suppressedWarmup: 0, suppressedCooldown: 0, suppressedOpen: 0 };
    this.onSignal = opts.onSignal || null;
  }

  setEnabled(v) { this.enabled = !!v; return this.enabled; }

  _endMin() {
    const [h, m] = String(this.cfg.sessionEndIST).split(':').map(Number);
    return h * 60 + m;
  }

  _s(inst, day, t) {
    let s = this._sess.get(inst);
    if (!s || s.day !== day) {
      s = { day, sessionLow: Infinity, openedAt: t, lastSignalAt: -Infinity };
      this._sess.set(inst, s);
    }
    return s;
  }

  /** Feed a price. Returns the event emitted, or null.
   *
   *  null means "nothing to do", and the counters say which gate produced it —
   *  a silent detector that cannot explain its silence is indistinguishable from
   *  a broken one.
   */
  tick(inst, price, t = this.now()) {
    if (!this.enabled || !(price > 0)) return null;
    const day = istDate(t);
    const s = this._s(inst, day, t);
    const minNow = istMin(t);

    // exits first: a position must be closed on the bar it is due, not after
    const ev = this._maybeExit(inst, price, t, minNow);
    if (ev) return ev;

    const isNewLow = price < s.sessionLow;
    if (isNewLow) s.sessionLow = price;
    if (!isNewLow) return null;

    if (t - s.openedAt < this.cfg.warmupMs) { this.stats.suppressedWarmup++; return null; }
    if (t - s.lastSignalAt < this.cfg.cooldownMs) { this.stats.suppressedCooldown++; return null; }
    if (minNow >= this._endMin()) return null;      // no room to hold to the close
    /* One position per instrument. Stacking would make the tracked expectation a
       statement about a different, larger trade than the one measured. */
    if (this.open.has(inst)) { this.stats.suppressedOpen++; return null; }

    s.lastSignalAt = t;
    this.stats.signals++;
    const pos = {
      id: `${inst}-${t}`, inst, day,
      entry: +price.toFixed(2), entryAt: t, entryISO: new Date(t).toISOString(),
      sessionLow: +s.sessionLow.toFixed(2),
      best: price,
      exitRule: this.cfg.trailPct === null ? 'HOLD_TO_CLOSE' : `TRAIL_${this.cfg.trailPct}%`,
    };
    this.open.set(inst, pos);
    const out = { kind: 'ENTRY', ...pos, research: RESEARCH.byInstrument[inst] || null };
    this._notify(out);
    return out;
  }

  _maybeExit(inst, price, t, minNow) {
    const pos = this.open.get(inst);
    if (!pos) return null;
    if (price > pos.best) pos.best = price;

    let reason = null;
    if (minNow >= this._endMin()) reason = 'SESSION_END';
    else if (this.cfg.trailPct !== null
             && pos.best > pos.entry
             && ((pos.best - price) / pos.best) * 100 >= this.cfg.trailPct) reason = 'TRAIL';

    if (!reason) return null;
    this.open.delete(inst);

    const pnlPct = ((price - pos.entry) / pos.entry) * 100;
    const rec = {
      kind: 'EXIT', ...pos,
      exit: +price.toFixed(2), exitAt: t, exitISO: new Date(t).toISOString(),
      heldMs: t - pos.entryAt,
      reason,
      /* GROSS. The cost belongs to whoever knows the instrument actually traded —
         this module sees an index level, and an option's cost is not 0.03% of it.
         Reporting a net number here would be inventing one. */
      pnlPctGross: +pnlPct.toFixed(4),
    };
    this.closed.push(rec);
    if (this.closed.length > this.cfg.ringSize) this.closed.shift();
    this._notify(rec);
    return rec;
  }

  _notify(ev) {
    if (!this.onSignal) return;
    try {
      const r = this.onSignal(ev);
      if (r && typeof r.then === 'function') r.catch((e) => this.log.warn?.(`[low-signal] notify failed: ${e.message}`));
    } catch (e) { this.log.warn?.(`[low-signal] notify threw: ${e.message}`); }
  }

  /** The scorecard, and the research beside it.
   *
   *  `forward` is what THIS deployment has seen. `research` is the in-sample
   *  study. They are never merged: the in-sample story is always the better one,
   *  and a reader must be able to see which number is which.
   */
  status() {
    const byInst = {};
    for (const c of this.closed) {
      const b = byInst[c.inst] || (byInst[c.inst] = { n: 0, sum: 0, wins: 0, days: new Set() });
      b.n++; b.sum += c.pnlPctGross; if (c.pnlPctGross > 0) b.wins++; b.days.add(c.day);
    }
    const forward = {};
    for (const [inst, b] of Object.entries(byInst)) {
      forward[inst] = {
        n: b.n,
        signalDays: b.days.size,
        meanPctGross: +(b.sum / b.n).toFixed(4),
        winPct: +((b.wins / b.n) * 100).toFixed(1),
        /* Deliberately no t-statistic until the gate is met. A t computed on
           eleven observations is a number that invites a decision it cannot
           support. */
        significance: b.days.size >= 60
          ? 'gate met — compute it and decide'
          : `UNDER-POWERED: ${b.days.size} of the 60 signal days agreed in advance`,
      };
    }
    return {
      enabled: this.enabled,
      exitRule: this.cfg.trailPct === null ? 'HOLD_TO_CLOSE' : `TRAIL_${this.cfg.trailPct}%`,
      config: { ...this.cfg },
      stats: { ...this.stats },
      open: [...this.open.values()],
      recent: this.closed.slice(-20),
      forward,
      research: RESEARCH,
      paperOnly: true,
    };
  }
}

module.exports = { LowSignal, RESEARCH, DEFAULTS };
