/* hl-alerts — tell me when the day high or day low is touched.

   THE PROBLEM THAT SHAPES THIS
     `_updateHL` sets a new extreme on EVERY tick that extends it. In a trending
     move that is dozens of times a minute, each one technically a new high. A
     notifier wired straight to that flag sends a hundred messages in an hour,
     and the hundred-and-first is ignored along with everything else that day.

     So the question is not "did the extreme move" — it is "is this worth
     interrupting someone for". Three gates, and each one exists because without
     it the feed is noise:

       1. A MINIMUM MOVE beyond the last level we alerted on. A high beaten by
          one tick is the same high.
       2. A COOLDOWN per instrument per side. A trend is one event, not forty.
       3. A WARM-UP. The first ticks after the daily reset set both extremes
          trivially, because the range is a single price. Nothing there is a
          break of anything.

   RETESTS
     A new extreme is one kind of touch. Coming BACK to an established extreme
     after moving away is the other, and for anyone trading a range it is the
     more interesting of the two. Both are emitted, tagged, and gated
     independently — a retest does not consume the new-extreme cooldown.

   WHAT IT DOES NOT DO
     It does not decide anything and it touches no order path. It records events
     and hands them to whoever is listening. If the delivery fails, the event is
     still in the ring buffer and still visible on the page; a notifier whose
     only record is the message it failed to send has no record. */
'use strict';

const DEFAULTS = {
  /* Fraction of the day's range that a new extreme must clear to count as a
     fresh one. 0.001 = 0.1% of range — on a 200-point NIFTY day that is 0.2
     points, enough to ignore a single tick without ignoring a real push. */
  minMoveFraction: 0.001,
  cooldownMs: 60_000,
  /* The range must be at least this fraction of price before ANY alert fires.
     Immediately after the daily reset the range is zero and every tick is both a
     new high and a new low. */
  warmupRangeFraction: 0.0005,
  /* How close to an established extreme counts as a retest, as a fraction of
     the day's range.

     MEASURED against a realistic day: 0.0015 gives 0.3 points on a 200-point
     NIFTY range. NIFTY does not move in 0.3-point steps, so that band would
     essentially never be entered and the retest alert would have looked
     implemented while never firing — the worst kind of feature. 1% of range is
     2 points on that day, which is what "back at the high" means to anyone
     watching it. */
  retestFraction: 0.01,
  /* How far price must travel away from an extreme before returning to it can
     be called a retest. Without this, sitting at the high emits a retest every
     tick.

     MUST EXCEED retestFraction, and the constructor refuses otherwise: if the
     departure band were the narrower of the two, a price could be "departed" and
     "at the high" at the same moment, and the retest would fire on every tick
     inside the gap. That is the noise the whole module exists to prevent, and it
     would arrive through a config value rather than through a bug. */
  retestDepartureFraction: 0.03,
  ringSize: 200,
};

class HLAlerts {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    /* The invariant that keeps a retest a retest. See retestDepartureFraction.
       Refused at construction rather than checked per tick: a misconfiguration
       that only shows up as a flood of alerts during a busy session is a
       misconfiguration nobody diagnoses at the time. */
    if (this.cfg.retestDepartureFraction <= this.cfg.retestFraction) {
      throw new Error(
        `hl-alerts: retestDepartureFraction (${this.cfg.retestDepartureFraction}) must exceed `
        + `retestFraction (${this.cfg.retestFraction}), or price can be "departed" and "at the `
        + 'extreme" simultaneously and the retest fires on every tick');
    }
    this.now = opts.now || (() => Date.now());
    this.enabled = opts.enabled !== false;
    /* inst -> { day, lastHighAlert, lastLowAlert, lastHighAt, lastLowAt,
                 departedHigh, departedLow } */
    this._state = new Map();
    this.events = [];
    this.stats = { emitted: 0, suppressedCooldown: 0, suppressedSmall: 0, suppressedWarmup: 0, delivered: 0, deliveryFailed: 0 };
    this.onEvent = opts.onEvent || null;
    this.log = opts.log || console;
  }

  setEnabled(v) { this.enabled = !!v; return this.enabled; }

  _st(inst, day) {
    let s = this._state.get(inst);
    if (!s || s.day !== day) {
      s = {
        day,
        lastHighAlert: null, lastLowAlert: null,
        lastHighAt: 0, lastLowAt: 0,
        departedHigh: true, departedLow: true,
        lastRetestHighAt: 0, lastRetestLowAt: 0,
      };
      this._state.set(inst, s);
    }
    return s;
  }

  /** Feed one tick.
   *
   *  @param inst   instrument name
   *  @param price  last traded price
   *  @param rec    the day record: { date, high, low, highAt, lowAt }
   *  @param flags  { newHigh, newLow } as _updateHL computed them
   *  @returns the event emitted, or null
   *
   *  Returns null when nothing is worth saying. `null` here means "no event",
   *  not "not checked" — the counters say which gate stopped it, so a silent
   *  feed can be explained rather than guessed at.
   */
  tick(inst, price, rec, flags = {}) {
    if (!this.enabled) return null;
    if (!rec || !rec.date) return null;
    if (!(price > 0) || !(rec.high > 0) || !(rec.low > 0)) return null;

    const s = this._st(inst, rec.date);
    const t = this.now();
    const range = rec.high - rec.low;

    // 3. WARM-UP — a range of nothing cannot be broken.
    if (range < price * this.cfg.warmupRangeFraction) {
      if (flags.newHigh || flags.newLow) this.stats.suppressedWarmup++;
      return null;
    }

    const minMove = Math.max(range * this.cfg.minMoveFraction, 0);
    const retestBand = range * this.cfg.retestFraction;
    const departBand = range * this.cfg.retestDepartureFraction;

    /* Track departure BEFORE deciding on a retest: a tick that is still sitting
       at the high has not departed, and a retest of a level never left is not a
       retest. */
    if (rec.high - price > departBand) s.departedHigh = true;
    if (price - rec.low > departBand) s.departedLow = true;

    let ev = null;

    if (flags.newHigh) {
      const beat = s.lastHighAlert === null ? Infinity : price - s.lastHighAlert;
      if (beat < minMove) this.stats.suppressedSmall++;
      else if (t - s.lastHighAt < this.cfg.cooldownMs) this.stats.suppressedCooldown++;
      else {
        ev = this._emit({ inst, kind: 'NEW_HIGH', price, rec, t, range });
        s.lastHighAlert = price; s.lastHighAt = t; s.departedHigh = false;
      }
    } else if (flags.newLow) {
      const beat = s.lastLowAlert === null ? Infinity : s.lastLowAlert - price;
      if (beat < minMove) this.stats.suppressedSmall++;
      else if (t - s.lastLowAt < this.cfg.cooldownMs) this.stats.suppressedCooldown++;
      else {
        ev = this._emit({ inst, kind: 'NEW_LOW', price, rec, t, range });
        s.lastLowAlert = price; s.lastLowAt = t; s.departedLow = false;
      }
    } else {
      // RETEST — back at a level we established and then left.
      if (s.departedHigh && rec.high - price <= retestBand
          && t - s.lastRetestHighAt >= this.cfg.cooldownMs) {
        ev = this._emit({ inst, kind: 'RETEST_HIGH', price, rec, t, range });
        s.lastRetestHighAt = t; s.departedHigh = false;
      } else if (s.departedLow && price - rec.low <= retestBand
          && t - s.lastRetestLowAt >= this.cfg.cooldownMs) {
        ev = this._emit({ inst, kind: 'RETEST_LOW', price, rec, t, range });
        s.lastRetestLowAt = t; s.departedLow = false;
      }
    }
    return ev;
  }

  _emit({ inst, kind, price, rec, t, range }) {
    const ev = {
      id: `${inst}-${kind}-${t}`,
      at: t,
      atISO: new Date(t).toISOString(),
      inst,
      kind,
      price: +price.toFixed(2),
      dayHigh: +rec.high.toFixed(2),
      dayLow: +rec.low.toFixed(2),
      range: +range.toFixed(2),
      // Where in the day's range this tick sits. 100 = at the high.
      positionPct: range > 0 ? +(((price - rec.low) / range) * 100).toFixed(1) : null,
      title: `${inst} ${kind.replace('_', ' ').toLowerCase()}`,
      message: `${inst} ${price.toFixed(2)} — ${kind === 'NEW_HIGH' ? 'new day high'
        : kind === 'NEW_LOW' ? 'new day low'
        : kind === 'RETEST_HIGH' ? `back at the day high ${rec.high.toFixed(2)}`
        : `back at the day low ${rec.low.toFixed(2)}`}`
        + `  (H ${rec.high.toFixed(2)} / L ${rec.low.toFixed(2)})`,
    };

    this.events.push(ev);
    if (this.events.length > this.cfg.ringSize) this.events.shift();
    this.stats.emitted++;

    /* Delivery is fire-and-forget and its failure is COUNTED. The event is
       already in the ring buffer, so a failed send loses the interruption and
       not the record — a notifier whose only trace is the message it could not
       send has no trace. */
    if (this.onEvent) {
      try {
        const r = this.onEvent(ev);
        if (r && typeof r.then === 'function') {
          r.then(() => { this.stats.delivered++; })
            .catch((e) => { this.stats.deliveryFailed++; this.log.warn?.(`[hl-alerts] delivery failed: ${e.message}`); });
        } else this.stats.delivered++;
      } catch (e) {
        this.stats.deliveryFailed++;
        this.log.warn?.(`[hl-alerts] delivery threw: ${e.message}`);
      }
    }
    return ev;
  }

  /** Events newer than `since` (epoch ms), oldest first. */
  since(sinceMs = 0) {
    return this.events.filter((e) => e.at > Number(sinceMs || 0));
  }

  status() {
    return {
      enabled: this.enabled,
      config: { ...this.cfg },
      stats: { ...this.stats },
      recent: this.events.slice(-20),
      instruments: [...this._state.entries()].map(([inst, s]) => ({
        inst, day: s.day,
        lastHighAlert: s.lastHighAlert, lastLowAlert: s.lastLowAlert,
        atHigh: !s.departedHigh, atLow: !s.departedLow,
      })),
    };
  }
}

module.exports = { HLAlerts, DEFAULTS };
