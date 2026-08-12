/* ═══════════════════════════════════════════════════════════════════════════
   margin-optimiser — rank by return on margin, and price the hedge trade-off
   instead of asserting it.

   THE RANKING CHANGE

   Two trades with the same expected profit are not equal if one blocks three
   times the capital. Ranking by rupee edge answers "which trade makes the most"
   and ignores what it costs to hold; ranking by return on margin answers "which
   trade makes the most per rupee the account cannot use for anything else",
   which is the question a capital-constrained book actually faces.

       returnOnMargin = expectedEdge / marginBlocked

   MEASURED, NOT ASSERTED — the numbers that motivate this file

   NIFTY 2026-08-04, one lot per leg, from the broker's own calculator:

       naked short strangle 23900P / 24700C   final margin  ₹1,80,959
       + protective wings 23400P / 25200C     final margin  ₹   92,694
                                              released      ₹   88,265  (48.8%)

   So the hedge roughly HALVES the margin. It also costs the premium of two long
   options, and it changes the tail. This module reports all three and refuses to
   collapse them into a single recommendation, because which one matters depends
   on whether the account is capital-constrained or risk-constrained, and that is
   not a decision an optimiser should make silently.

   THE UNWIND ORDER IS A SAFETY RULE, NOT A PREFERENCE

   The margin benefit exists only while BOTH legs are open. Close the long wing
   first and the position instantly becomes a naked short — margin spikes to the
   unhedged figure, at the worst possible moment, and the broker may square you
   off. `unwindPlan()` enforces shorts-first and states the margin at each step.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r2 = (v, d = 2) => v === null || v === undefined ? null : +Number(v).toFixed(d);
const pct = (v, d = 2) => v === null ? null : +(Number(v) * 100).toFixed(d);

class MarginOptimiser {
  constructor(deps = {}) {
    this.calc = deps.calculator || null;
    this.log = deps.log || console;
    this.now = deps.now || (() => Date.now());
  }

  /**
   * Return on margin for one candidate.
   *
   * `expectedEdge` is whatever the strategy believes it makes — a credit, an
   * expected value, a modelled profit. It is NOT computed here, because this
   * module has no business inventing an edge; it only divides one by a margin.
   *
   * A margin that did not come from the broker yields `ok: false`. Return on
   * margin computed against a guess is a ratio with a guess in the denominator.
   */
  async returnOnMargin({ instruments, expectedEdge, strategy = null, label = null }) {
    const edge = num(expectedEdge);
    if (edge === null) return { ok: false, error: 'expectedEdge is not a number' };

    const m = await this.calc.requireBroker(instruments);
    if (!m.ok || !(num(m.final) > 0)) {
      return {
        ok: false, label, strategy,
        error: m.error || 'no broker margin — refusing to compute a ratio on an estimate',
        marginSource: m.source || null,
      };
    }
    return {
      ok: true, label, strategy,
      expectedEdge: r2(edge),
      margin: r2(m.final),
      marginSource: m.source,
      span: r2(m.span), exposure: r2(m.exposure),
      basketBenefit: r2(m.basketBenefit),
      returnOnMargin: r2(edge / m.final, 5),
      returnOnMarginPct: pct(edge / m.final),
    };
  }

  /**
   * Rank candidates by return on margin.
   *
   * Candidates whose margin could not be obtained are NOT dropped — they are
   * returned in `unpriceable` with the reason. Silently ranking only what could
   * be priced would make an API failure look like an absence of opportunities.
   */
  async rank(candidates) {
    const priced = [], unpriceable = [];
    for (const c of candidates) {
      const r = await this.returnOnMargin(c);
      if (r.ok) priced.push({ ...r, candidate: c }); else unpriceable.push({ ...r, candidate: c });
    }
    priced.sort((a, b) => b.returnOnMargin - a.returnOnMargin);

    /* The comparison worth printing: what the old ranking would have chosen.
       If the two disagree, the difference IS the value of this change, and if
       they agree the change cost nothing. Either way it should be visible. */
    const byRupee = [...priced].sort((a, b) => b.expectedEdge - a.expectedEdge);
    const rankingChanged = priced.length > 1 && priced[0].label !== byRupee[0].label;

    return {
      ok: true,
      ranked: priced,
      unpriceable,
      best: priced[0] || null,
      wouldHaveChosenByRupee: byRupee[0] || null,
      rankingChanged,
      note: rankingChanged
        ? `Ranking by return on margin picks "${priced[0].label}" where ranking by rupee edge would have picked "${byRupee[0].label}".`
        : 'Both rankings agree on the top candidate.',
    };
  }

  /**
   * Price a hedge instead of assuming one.
   *
   * Reports, side by side and unaggregated:
   *   · margin released   — the broker's figure for both structures
   *   · premium given up  — what the protective legs cost
   *   · return on margin  — before and after
   *   · tail risk         — before and after
   *
   * @param naked    { instruments, expectedEdge }
   * @param hedged   { instruments, expectedEdge, wingCost }
   * @param tail     { nakedMaxLoss, hedgedMaxLoss }  — nakedMaxLoss may be null,
   *                 and null means UNBOUNDED, which is the honest value for a
   *                 naked short option and must never be rendered as a number.
   */
  async evaluateHedge({ naked, hedged, tail = {}, strategy = null }) {
    const a = await this.returnOnMargin({ ...naked, strategy, label: 'naked' });
    const b = await this.returnOnMargin({ ...hedged, strategy, label: 'hedged' });
    if (!a.ok || !b.ok) {
      return { ok: false, error: (a.error || b.error), naked: a, hedged: b };
    }

    const released = a.margin - b.margin;
    const premiumGivenUp = num(hedged.wingCost) ?? r2(a.expectedEdge - b.expectedEdge);
    const romChange = b.returnOnMargin - a.returnOnMargin;

    const nakedTail = num(tail.nakedMaxLoss);
    const hedgedTail = num(tail.hedgedMaxLoss);

    return {
      ok: true, strategy,
      margin: {
        naked: a.margin, hedged: b.margin,
        released: r2(released),
        releasedPct: a.margin > 0 ? pct(released / a.margin) : null,
        source: a.marginSource,
      },
      edge: {
        naked: a.expectedEdge, hedged: b.expectedEdge,
        premiumGivenUp: r2(premiumGivenUp),
        premiumGivenUpPct: a.expectedEdge > 0 ? pct(premiumGivenUp / a.expectedEdge) : null,
      },
      returnOnMargin: {
        naked: a.returnOnMarginPct, hedged: b.returnOnMarginPct,
        change: r2(pct(romChange)),
        multiple: a.returnOnMargin > 0 ? r2(b.returnOnMargin / a.returnOnMargin) : null,
      },
      tailRisk: {
        nakedMaxLoss: nakedTail,
        // UNBOUNDED is a value, not a missing one. A naked short call has no
        // maximum loss, and printing a number there — any number — is the single
        // most dangerous thing this module could do.
        nakedMaxLossLabel: nakedTail === null ? 'UNBOUNDED' : `₹${nakedTail}`,
        hedgedMaxLoss: hedgedTail,
        hedgedMaxLossLabel: hedgedTail === null ? 'unknown' : `₹${hedgedTail}`,
        change: (nakedTail === null && hedgedTail !== null)
          ? 'unbounded → capped'
          : (nakedTail !== null && hedgedTail !== null ? r2(hedgedTail - nakedTail) : 'unknown'),
      },
      /* Deliberately NOT a recommendation. Whether releasing ₹88,265 of margin is
         worth giving up part of the credit depends on whether the account is
         short of capital or short of risk appetite, and this module knows
         neither. It states the trade-off; the decision is elsewhere. */
      verdict: 'trade-off stated, not resolved — see returnOnMargin and tailRisk together',
    };
  }

  /**
   * The order in which a hedged structure may be closed.
   *
   * The exchange grants the margin benefit only while both legs are open. Close
   * the protective long first and what remains is a naked short: the margin
   * jumps back to the unhedged figure immediately, and if headroom is thin the
   * broker squares the position off at whatever price is available.
   *
   * @returns steps in a safe order, with the margin after each, and a refusal if
   *          any intermediate state would exceed the available margin.
   */
  async unwindPlan({ instruments, available = null }) {
    const shorts = instruments.filter(i => String(i.transaction_type || i.side).toUpperCase() === 'SELL');
    const longs = instruments.filter(i => String(i.transaction_type || i.side).toUpperCase() === 'BUY');

    if (!shorts.length || !longs.length) {
      return { ok: true, steps: [{ close: instruments, why: 'no hedge pair — any order is safe' }], safe: true };
    }

    const steps = [];
    let remaining = [...instruments];
    const avail = num(available);

    /* Shorts first, always. Each step is priced by the broker, so the plan is
       not an argument about what ought to happen — it is the actual number the
       account would be charged at each intermediate state. */
    for (const s of shorts) {
      remaining = remaining.filter(x => x !== s);
      const m = remaining.length ? await this.calc.requireBroker(remaining) : { ok: true, final: 0, source: 'trivial' };
      steps.push({
        close: [s], remainingLegs: remaining.length,
        marginAfter: m.ok ? r2(m.final) : null,
        marginSource: m.source || null,
        breach: (avail !== null && m.ok && m.final > avail) ? true : false,
      });
    }
    for (const l of longs) {
      remaining = remaining.filter(x => x !== l);
      const m = remaining.length ? await this.calc.requireBroker(remaining) : { ok: true, final: 0, source: 'trivial' };
      steps.push({
        close: [l], remainingLegs: remaining.length,
        marginAfter: m.ok ? r2(m.final) : null,
        marginSource: m.source || null,
        breach: (avail !== null && m.ok && m.final > avail) ? true : false,
      });
    }

    const peak = Math.max(...steps.map(s => s.marginAfter ?? 0));
    return {
      ok: true,
      order: 'SHORTS_FIRST',
      steps,
      peakIntermediateMargin: r2(peak),
      safe: !steps.some(s => s.breach),
      rule: 'Protective longs are closed LAST. Closing a wing first converts the position to a naked short and the margin reverts to the unhedged figure immediately.',
      unsafeAlternative: await this._unsafePeek(instruments),
    };
  }

  /* What the wrong order would cost, priced rather than asserted. It is worth
     showing once: "closing the wing first spikes margin" is a claim, and the
     number behind it is an argument. */
  async _unsafePeek(instruments) {
    const longs = instruments.filter(i => String(i.transaction_type || i.side).toUpperCase() === 'BUY');
    if (!longs.length) return null;
    const withoutWings = instruments.filter(i => !longs.includes(i));
    const m = await this.calc.requireBroker(withoutWings);
    return m.ok
      ? { ifLongsClosedFirst: r2(m.final), note: 'this is the margin the account would be charged the instant the wings are gone' }
      : { ifLongsClosedFirst: null, note: 'could not price the unhedged remainder' };
  }
}

module.exports = { MarginOptimiser };
