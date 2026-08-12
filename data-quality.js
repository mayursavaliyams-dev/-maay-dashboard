/* ═══════════════════════════════════════════════════════════════════════════
   data-quality — is this instrument's data trustworthy right now?

   THE CENTRAL IDEA: EACH INSTRUMENT IS JUDGED AGAINST ITSELF

   A single global staleness threshold is wrong in both directions on the same
   chain. Measured on this system's own archive, 2026-07-29: of 662 strike-side
   series in one session, **70 never printed a different price all day**. A deep
   OTM strike that ticks four times an hour is not stale at three minutes; an ATM
   strike that normally ticks every two seconds is very stale at thirty.

   So each instrument carries its own trailing median inter-tick gap, and
   staleness is measured in MULTIPLES of that median. The median rather than the
   mean because one 42-minute hole — the largest gap in that same archive — would
   drag a mean far enough to make everything look fresh afterwards.

   OI IS TRACKED SEPARATELY, AND THIS IS NOT A DETAIL

   Open interest updates far more slowly than price and, on this feed, is
   effectively a snapshot rather than a stream. Treating a fresh price as
   evidence of fresh OI is how a strategy ends up reading last hour's positioning
   as current. The two clocks are kept apart and a consumer must ask for the one
   it means.

   FLAGS, NEVER SILENT CORRECTIONS

   Every check below produces a FLAG. Nothing here repairs a value, clamps it
   into range, or forward-fills it. A corrected value is indistinguishable from a
   good one at the point of use, which is exactly where the decision is made.

   NULL IS NOT ZERO, ANYWHERE
   A missing bid is null. A missing OI is null. `ageMs` for an instrument that has
   never ticked is null, not 0 — and null fails every freshness comparison, which
   is the correct direction.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r2 = (v, d = 2) => v === null || v === undefined ? null : +Number(v).toFixed(d);

/* Flag taxonomy. Each is a distinct failure with a distinct response, and they
   are never collapsed into a single "bad data" boolean — "the book is crossed"
   and "we have not heard from this instrument in ten minutes" call for different
   things. */
const FLAGS = {
  CROSSED_BOOK: 'bid is at or above ask — the book is crossed or locked',
  OUT_OF_DAY_RANGE: 'last price is outside the day high/low the same snapshot reports',
  OUT_OF_BAND: 'last price is outside the exchange price band',
  VOLUME_REGRESSION: 'cumulative volume moved backwards',
  OI_REGRESSION: 'open interest moved backwards by more than the tolerance',
  TIMESTAMP_REGRESSION: 'this snapshot is older than the previous one',
  CLOCK_SKEW: 'exchange timestamp and receive time disagree implausibly',
  DEPTH_MISSING: 'no depth on an instrument that normally shows depth',
  STALE_PRICE: 'no price change for far longer than this instrument\'s own norm',
  STALE_OI: 'open interest has not moved for far longer than its own norm',
  NEVER_SEEN: 'no snapshot has ever been received for this instrument',
};

const DEFAULTS = {
  DQ_STALE_MEDIAN_MULTIPLE: 6,       // stale at 6× this instrument's own median gap
  DQ_STALE_FLOOR_MS: 15000,          // ...but never call it stale sooner than this
  DQ_STALE_CEILING_MS: 900000,       // ...and always stale past this, whatever the median
  DQ_OI_STALE_MEDIAN_MULTIPLE: 4,
  DQ_OI_STALE_FLOOR_MS: 120000,      // OI legitimately moves slowly
  DQ_MEDIAN_WINDOW: 40,              // gaps kept per instrument
  DQ_MIN_GAPS_FOR_MEDIAN: 5,         // below this the median is not trusted
  DQ_CLOCK_SKEW_MS: 30000,
  DQ_OI_REGRESSION_TOLERANCE: 0,     // contracts; exchanges do revise, hence configurable
  DQ_DEPTH_EXPECTED_AFTER: 5,        // snapshots with depth before absence is a flag
};

/* Median of a small array, computed fresh. The window is 40 items, so sorting
   per query costs nothing and avoids an incremental structure that can drift out
   of sync with the data it summarises. */
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

class InstrumentQuality {
  constructor(key, cfg) {
    this.key = key;
    this.cfg = cfg;
    this.priceGaps = [];
    this.oiGaps = [];
    this.lastPriceAt = null;      // when the PRICE last CHANGED, not when a snapshot arrived
    this.lastOiAt = null;
    this.lastSnapshotAt = null;
    this.last = null;             // previous snapshot, for regression checks
    this.snapshots = 0;
    this.withDepth = 0;
    this.flagCounts = {};
  }

  _push(arr, v) {
    arr.push(v);
    if (arr.length > this.cfg.DQ_MEDIAN_WINDOW) arr.splice(0, arr.length - this.cfg.DQ_MEDIAN_WINDOW);
  }

  /**
   * Ingest one snapshot. Returns the flags it raised.
   *
   * @param s { bid, ask, ltp, volume, oi, dayHigh, dayLow, lowerBand, upperBand,
   *           bidQty, askQty, exchangeTs }
   * @param now receive time
   */
  ingest(s, now) {
    const flags = [];
    const raise = (f, detail, observed = null, expected = null) => {
      flags.push({ flag: f, detail, observed, expected });
      this.flagCounts[f] = (this.flagCounts[f] || 0) + 1;
    };

    const prev = this.last;
    const bid = num(s.bid), ask = num(s.ask), ltp = num(s.ltp);
    const vol = num(s.volume), oi = num(s.oi);
    const exTs = num(s.exchangeTs);

    // ── timestamp integrity ────────────────────────────────────────────────
    if (prev && exTs !== null && num(prev.exchangeTs) !== null && exTs < num(prev.exchangeTs)) {
      raise(FLAGS.TIMESTAMP_REGRESSION,
        `exchange timestamp went backwards: ${exTs} after ${prev.exchangeTs}`, exTs, prev.exchangeTs);
    }
    if (exTs !== null) {
      const skew = Math.abs(now - exTs);
      if (skew > this.cfg.DQ_CLOCK_SKEW_MS) {
        raise(FLAGS.CLOCK_SKEW,
          `exchange time and receive time differ by ${skew} ms — one of the two clocks is wrong and we cannot tell which`,
          skew, this.cfg.DQ_CLOCK_SKEW_MS);
      }
    }

    // ── book integrity ─────────────────────────────────────────────────────
    if (bid !== null && ask !== null && bid >= ask) {
      raise(FLAGS.CROSSED_BOOK, `bid ${bid} ≥ ask ${ask}`, bid, ask);
    }

    // ── price plausibility ─────────────────────────────────────────────────
    /* A zero high or low is NOT REPORTED, not a price of zero. Measured on the
       live NIFTY chain 2026-07-30: 19 of 186 strike-sides return 0 for one or
       both, on strikes that have not traded today. Comparing a real LTP against
       a zero "high" would flag every one of them — which is this project's own
       null-is-not-zero rule broken inside the module that enforces it. */
    const dh = num(s.dayHigh), dl = num(s.dayLow);
    const rangeReported = dh !== null && dl !== null && dh > 0 && dl > 0;
    if (ltp !== null && rangeReported && dh >= dl && (ltp > dh || ltp < dl)) {
      raise(FLAGS.OUT_OF_DAY_RANGE,
        `last price ${ltp} is outside the day range ${dl}–${dh} reported in the same snapshot`, ltp, `${dl}–${dh}`);
    }
    const lb = num(s.lowerBand), ub = num(s.upperBand);
    if (ltp !== null && lb !== null && ub !== null && (ltp < lb || ltp > ub)) {
      raise(FLAGS.OUT_OF_BAND, `last price ${ltp} is outside the exchange band ${lb}–${ub}`, ltp, `${lb}–${ub}`);
    }

    // ── monotonic counters ─────────────────────────────────────────────────
    if (prev && vol !== null && num(prev.volume) !== null && vol < num(prev.volume)) {
      raise(FLAGS.VOLUME_REGRESSION,
        `cumulative volume fell from ${prev.volume} to ${vol} — cumulative counters do not decrease within a session`,
        vol, prev.volume);
    }
    if (prev && oi !== null && num(prev.oi) !== null && (num(prev.oi) - oi) > this.cfg.DQ_OI_REGRESSION_TOLERANCE) {
      raise(FLAGS.OI_REGRESSION, `open interest fell from ${prev.oi} to ${oi}`, oi, prev.oi);
    }

    // ── depth ──────────────────────────────────────────────────────────────
    const bq = num(s.bidQty), aq = num(s.askQty);
    const hasDepth = (bq !== null && bq > 0) || (aq !== null && aq > 0);
    if (hasDepth) this.withDepth++;
    else if (this.withDepth >= this.cfg.DQ_DEPTH_EXPECTED_AFTER) {
      raise(FLAGS.DEPTH_MISSING,
        `no quoted size, on an instrument that has shown depth ${this.withDepth} times`, 0, '> 0');
    }

    // ── the two clocks ─────────────────────────────────────────────────────
    /* Freshness is measured from the last CHANGE, not from the last snapshot.
       A poller that re-delivers an identical quote every two seconds would make
       a dead instrument look permanently fresh — which is the exact failure this
       whole module exists to prevent. */
    if (ltp !== null && (!prev || num(prev.ltp) !== ltp)) {
      if (this.lastPriceAt !== null) this._push(this.priceGaps, now - this.lastPriceAt);
      this.lastPriceAt = now;
    }
    if (oi !== null && (!prev || num(prev.oi) !== oi)) {
      if (this.lastOiAt !== null) this._push(this.oiGaps, now - this.lastOiAt);
      this.lastOiAt = now;
    }

    this.last = { ...s, at: now };
    this.lastSnapshotAt = now;
    this.snapshots++;
    return flags;
  }

  /** The instrument's own normal inter-change gap, or null if not yet known. */
  medianPriceGap() {
    return this.priceGaps.length >= this.cfg.DQ_MIN_GAPS_FOR_MEDIAN ? median(this.priceGaps) : null;
  }
  medianOiGap() {
    return this.oiGaps.length >= this.cfg.DQ_MIN_GAPS_FOR_MEDIAN ? median(this.oiGaps) : null;
  }

  /**
   * Freshness now.
   *
   * `stale` is true, false, or **null when it cannot be decided** — and a null
   * must be treated as stale by every consumer, which is why `trustworthy()`
   * below never returns true on a null.
   */
  freshness(now) {
    const c = this.cfg;
    if (this.lastPriceAt === null) {
      return {
        priceAgeMs: null, oiAgeMs: null,
        medianPriceGapMs: null, medianOiGapMs: null,
        priceStale: null, oiStale: null,
        // null, not 0. "never ticked" and "ticked a moment ago" must not share
        // a value, and 0 would pass every comparison below.
        why: 'no price change has ever been observed for this instrument',
      };
    }

    const priceAge = now - this.lastPriceAt;
    const oiAge = this.lastOiAt === null ? null : now - this.lastOiAt;
    const mp = this.medianPriceGap();
    const mo = this.medianOiGap();

    /* Threshold from the instrument's own median, floored and ceilinged. The
       floor stops a hyperactive instrument being called stale after 200 ms; the
       ceiling stops a genuinely dormant one being called fresh for ever. */
    const priceLimit = mp === null
      ? c.DQ_STALE_CEILING_MS                                   // no norm yet — only the ceiling applies
      : Math.min(c.DQ_STALE_CEILING_MS, Math.max(c.DQ_STALE_FLOOR_MS, mp * c.DQ_STALE_MEDIAN_MULTIPLE));
    const oiLimit = mo === null
      ? c.DQ_STALE_CEILING_MS
      : Math.min(c.DQ_STALE_CEILING_MS, Math.max(c.DQ_OI_STALE_FLOOR_MS, mo * c.DQ_OI_STALE_MEDIAN_MULTIPLE));

    return {
      priceAgeMs: priceAge,
      oiAgeMs: oiAge,
      medianPriceGapMs: r2(mp, 0),
      medianOiGapMs: r2(mo, 0),
      priceLimitMs: r2(priceLimit, 0),
      oiLimitMs: r2(oiLimit, 0),
      priceStale: priceAge > priceLimit,
      // null when OI has never moved — unknown, and unknown is not fresh.
      oiStale: oiAge === null ? null : oiAge > oiLimit,
      basis: mp === null
        ? `fewer than ${c.DQ_MIN_GAPS_FOR_MEDIAN} observed gaps — judged only against the ${c.DQ_STALE_CEILING_MS} ms ceiling`
        : `${mp} ms median gap × ${c.DQ_STALE_MEDIAN_MULTIPLE}`,
    };
  }
}

class DataQuality {
  constructor(deps = {}) {
    this.cfg = { ...DEFAULTS, ...(deps.cfg || {}) };
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || console;
    this.instruments = new Map();
    this.flagLog = [];
    this.onFlag = deps.onFlag || null;
  }

  _get(key) {
    if (!this.instruments.has(key)) this.instruments.set(key, new InstrumentQuality(key, this.cfg));
    return this.instruments.get(key);
  }

  /** Feed one snapshot. Returns { key, flags }. */
  ingest(key, snapshot) {
    const now = this.now();
    const iq = this._get(key);
    const flags = iq.ingest(snapshot, now);
    for (const f of flags) {
      const entry = { at: new Date(now).toISOString(), key, ...f };
      this.flagLog.push(entry);
      if (this.flagLog.length > 5000) this.flagLog.splice(0, this.flagLog.length - 5000);
      if (this.onFlag) {
        try { this.onFlag(entry); }
        catch (e) { this.log.error(`[dq] flag listener threw (${e.message}) — the flag still stands`); }
      }
    }
    return { key, flags };
  }

  /**
   * The question every consumer actually asks.
   *
   * @returns {{ trustworthy, reasons[], freshness, flags[] }}
   *          `trustworthy` is only ever true when everything was checkable and
   *          passed. Unknown is not true.
   */
  assess(key, opts = {}) {
    const now = this.now();
    const iq = this.instruments.get(key);
    if (!iq || iq.snapshots === 0) {
      return {
        trustworthy: false,
        // Structured, not prose. The gate switches on `codes`; matching a
        // regular expression against a human sentence is how "has ever been
        // received" quietly failed a /never been received/ test — and the
        // instrument was allowed through.
        codes: ['NEVER_SEEN'],
        reasons: [FLAGS.NEVER_SEEN],
        freshness: null, recentFlags: [],
        detail: `no snapshot has ever been received for ${key} — unknown is not fresh`,
      };
    }

    const fr = iq.freshness(now);
    const reasons = [];
    const codes = [];

    if (fr.priceStale === null) { codes.push('NEVER_SEEN'); reasons.push(FLAGS.NEVER_SEEN); }
    else if (fr.priceStale) {
      codes.push('STALE_PRICE');
      reasons.push(`${FLAGS.STALE_PRICE} — ${fr.priceAgeMs} ms since the last change, limit ${fr.priceLimitMs} ms (${fr.basis})`);
    }

    /* OI staleness only blocks a consumer that says it needs OI. A price-only
       decision is not made worse by an hour-old OI figure, and blocking it would
       stop trading on every deep strike all day for no gain. */
    if (opts.needsOi) {
      if (fr.oiStale === null) { codes.push('STALE_OI'); reasons.push(`${FLAGS.STALE_OI} — open interest has never been observed to move`); }
      else if (fr.oiStale) { codes.push('STALE_OI'); reasons.push(`${FLAGS.STALE_OI} — ${fr.oiAgeMs} ms, limit ${fr.oiLimitMs} ms`); }
    }

    // Flags raised on the most recent snapshot only. An old crossed book that
    // has since resolved should not block for ever.
    const recent = this.flagLog.filter(f => f.key === key && Date.parse(f.at) >= iq.lastSnapshotAt);
    for (const f of recent) { codes.push('FLAGGED'); reasons.push(f.detail); }

    return {
      trustworthy: reasons.length === 0,
      codes,
      reasons,
      freshness: fr,
      recentFlags: recent.map(f => f.flag),
      snapshots: iq.snapshots,
    };
  }

  /** Every instrument's current state, for the live view. */
  snapshotAll() {
    const now = this.now();
    const out = [];
    for (const [key, iq] of this.instruments) {
      const fr = iq.freshness(now);
      out.push({
        key, snapshots: iq.snapshots,
        priceAgeMs: fr.priceAgeMs, medianPriceGapMs: fr.medianPriceGapMs,
        priceStale: fr.priceStale,
        oiAgeMs: fr.oiAgeMs, oiStale: fr.oiStale,
        flagCounts: { ...iq.flagCounts },
      });
    }
    return out;
  }

  stats() {
    const all = this.snapshotAll();
    const byFlag = {};
    for (const f of this.flagLog) byFlag[f.flag] = (byFlag[f.flag] || 0) + 1;
    return {
      instruments: all.length,
      // Counted three ways on purpose: stale, fresh, and undecidable. Folding
      // the third into either of the others is the whole failure mode.
      stale: all.filter(x => x.priceStale === true).length,
      fresh: all.filter(x => x.priceStale === false).length,
      undecidable: all.filter(x => x.priceStale === null).length,
      oiStale: all.filter(x => x.oiStale === true).length,
      totalFlags: this.flagLog.length,
      flagsByType: byFlag,
    };
  }
}

module.exports = { DataQuality, InstrumentQuality, FLAGS, DQ_DEFAULTS: DEFAULTS, median };
