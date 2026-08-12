/* ═══════════════════════════════════════════════════════════════════════════
   risk-manager — the pre-trade checks, and sizing from risk rather than capital.

   WHAT IT IS FOR
   Every order intent is evaluated here before anything reaches a broker. It
   returns an APPROVAL — a signed decision carrying the sized quantity and every
   check that produced it. `risk-guard.js` will not pass an order to the broker
   without one, so this is a chokepoint by construction rather than by
   convention. Eight different call sites reach `placeOrder` in this repo today;
   a layer that each of them has to remember to call would be forgotten by at
   least one.

   FAIL CLOSED, AND SPECIFICALLY
   A check that cannot be EVALUATED blocks. Not "passes because we could not
   measure it" — that inverts the whole purpose, because the blind spots become
   the widest hole. Missing equity, absent greeks, an unreadable position book,
   a stale quote: each of these produces a block with the reason
   "could not evaluate", which is a different and more actionable outcome than
   "limit exceeded", and the two are never merged.

   SIZE FROM RISK, NOT FROM CAPITAL
   The distinction is the whole of §2. Sizing from capital asks "how much can I
   afford to buy" and the answer is the same whether the stop is two rupees away
   or forty. Sizing from risk asks "how much do I lose if the stop is hit", fixes
   THAT number, and derives the quantity. Kelly may propose less than the budget;
   it may never propose more.

   NORMALISED GREEK LIMITS
   Limits are per ₹1 lakh of equity, so a limit set at ₹1 lakh still means the
   same thing at ₹7 lakh. Absolute limits would have to be rewritten every time
   the capital changed, and would not be.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const riskConfig = require('./risk-config');

const isNum = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const n = (v) => (isNum(v) ? Number(v) : null);
const r2 = (v, d = 2) => (v === null || v === undefined ? null : +Number(v).toFixed(d));

/* ═══════════════════════════════════════════════════════════════════════════
   Sizing
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lots from a risk budget and a stop distance.
 *
 * riskBudget = equity × RISK_PER_TRADE_RISK_PCT / 100
 * lossPerLot = stopDistance × lotSize
 * lots       = floor(riskBudget / lossPerLot)
 *
 * Everything that can make this wrong returns a REFUSAL rather than a number:
 * an unknown lot size, a zero or missing stop distance, a non-positive equity.
 * A guessed lot produces a rupee figure that is fabricated and wearing a
 * currency symbol, which is the failure this project already refuses elsewhere.
 *
 * @returns {{ok, lots, reason, detail}}
 */
function sizeFromRisk({ equity, stopDistance, lotSize, cfg, kelly = null }) {
  const eq = n(equity), stop = n(stopDistance), lot = n(lotSize);

  if (eq === null || eq <= 0) return { ok: false, lots: 0, reason: 'EQUITY_UNKNOWN', detail: 'equity is unknown or non-positive — cannot derive a risk budget' };
  if (lot === null || lot <= 0) return { ok: false, lots: 0, reason: 'LOT_SIZE_UNKNOWN', detail: 'lot size is unknown — refusing to size rather than guessing one' };
  if (stop === null || stop <= 0) {
    return {
      ok: false, lots: 0, reason: 'STOP_UNDEFINED',
      detail: 'the strategy did not define a stop distance. Risk-based sizing is undefined without it, ' +
              'and sizing from capital instead would silently change the risk per trade',
    };
  }

  const budgetPct = cfg.RISK_PER_TRADE_RISK_PCT;
  const hardBudget = eq * budgetPct / 100;
  const lossPerLot = stop * lot;

  let effectivePct = budgetPct;
  let kellyNote = null;

  if (kelly && isNum(kelly.winRate) && isNum(kelly.payoff)) {
    /* Kelly fraction f* = p − (1 − p)/b, scaled by RISK_KELLY_FRACTION and
       capped by RISK_KELLY_MAX_PCT. A negative edge gives a negative f*, which
       means "do not bet" — it must not be read as a small positive size. */
    const p = Number(kelly.winRate), b = Number(kelly.payoff);
    const f = b > 0 ? (p - (1 - p) / b) : -1;
    if (f <= 0) {
      return {
        ok: false, lots: 0, reason: 'KELLY_NEGATIVE_EDGE',
        detail: `Kelly f* = ${f.toFixed(4)} at win rate ${p} and payoff ${b} — the edge is negative, so the correct size is zero`,
      };
    }
    const kellyPct = Math.min(f * cfg.RISK_KELLY_FRACTION * 100, cfg.RISK_KELLY_MAX_PCT);
    /* The hard budget is a CEILING, never a target. Kelly proposing more than it
       does not raise it — that is the entire point of having both numbers. */
    effectivePct = Math.min(kellyPct, budgetPct);
    kellyNote = `Kelly f*=${f.toFixed(4)} → ${cfg.RISK_KELLY_FRACTION}× → ${kellyPct.toFixed(3)}%, ` +
                `capped by the ${budgetPct}% hard budget → ${effectivePct.toFixed(3)}%`;
  }

  const budget = eq * effectivePct / 100;
  const rawLots = budget / lossPerLot;
  const lots = Math.floor(rawLots);

  if (lots < cfg.RISK_MIN_LOTS) {
    return {
      ok: false, lots: 0, reason: 'BELOW_MIN_SIZE',
      detail: `risk budget ₹${r2(budget)} against ₹${r2(lossPerLot)} of loss per lot allows ${rawLots.toFixed(3)} lots — ` +
              `below the minimum of ${cfg.RISK_MIN_LOTS}. Rounding UP would exceed the risk budget, so the trade is refused`,
      budget: r2(budget), lossPerLot: r2(lossPerLot), kellyNote,
    };
  }

  return {
    ok: true, lots, reason: 'SIZED',
    detail: `${lots} lot(s): ₹${r2(budget)} risk budget (${effectivePct.toFixed(3)}% of ₹${r2(eq)}) ÷ ₹${r2(lossPerLot)} loss per lot`,
    budget: r2(budget), lossPerLot: r2(lossPerLot),
    riskIfStopped: r2(lots * lossPerLot),
    hardBudget: r2(hardBudget),
    effectivePct: r2(effectivePct, 3),
    kellyNote,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Pre-trade checks
   ═══════════════════════════════════════════════════════════════════════════ */

class RiskManager {
  constructor(deps = {}) {
    this.cfg = deps.cfg || riskConfig.get;
    this.killSwitch = deps.killSwitch || null;
    this.log = deps.log || console;
    this.now = deps.now || (() => Date.now());
    this.blocks = [];                 // in-memory audit trail
    this.onEvent = deps.onEvent || null;
  }

  _record(entry) {
    const e = { at: new Date(this.now()).toISOString(), ...entry };
    this.blocks.push(e);
    if (this.blocks.length > 5000) this.blocks.splice(0, this.blocks.length - 5000);
    /* A listener must never break the gate — a crash in a notification hook
       cannot be allowed to stop the risk layer from blocking an order. But it is
       reported: a listener that has been throwing silently for a month is a
       month of alerts nobody received. */
    if (this.onEvent) {
      try { this.onEvent(e); }
      catch (err) { this.log.error(`[risk] event listener threw (${err.message}) — the decision stands, the notification did not`); }
    }
    return e;
  }

  /**
   * Evaluate an order intent.
   *
   * @param intent  { strategy, instrument, strike, optionType, side, expiry,
   *                  stopDistance, lotSize, requestedLots?, kelly? }
   * @param state   { equity, startOfDayEquity, peakEquityToday, dayRealisedPnl,
   *                  deployed, deployedByUnderlying, openPositions, lotsByInstrument,
   *                  greeks:{delta,gamma,vega,theta}, riskByExpiry, riskByStrike,
   *                  totalRisk, isExpiryDay, minutesToClose, dataAgeMs,
   *                  consecutiveLosses }
   *
   * @returns {{approved, approval?, checks, blocks, sizing}}
   */
  evaluate(intent, state) {
    const cfg = this.cfg();
    const checks = [];
    const failed = [];
    const failClosed = cfg.RISK_FAIL_MODE !== 'WARN';

    /* Each check reports one of three outcomes, and they are never merged:
         pass          the limit was evaluated and is satisfied
         BLOCKED       the limit was evaluated and is breached
         UNEVALUABLE   the limit could not be evaluated
       The third is the interesting one and it is why `add` takes `measurable`
       separately from `pass`. */
    const add = (name, measurable, pass, detail, observed, threshold) => {
      const status = !measurable ? 'UNEVALUABLE' : (pass ? 'PASS' : 'BLOCKED');
      const c = { name, status, detail, observed, threshold };
      checks.push(c);
      if (status === 'BLOCKED') failed.push(c);
      if (status === 'UNEVALUABLE' && failClosed) failed.push(c);
      return c;
    };

    if (!cfg.RISK_ENABLED) {
      /* Recorded, not silent. A disabled risk layer is a decision someone made
         and it belongs in the audit trail beside the orders it let through. */
      this._record({ event: 'LAYER_DISABLED', strategy: intent.strategy, instrument: intent.instrument });
      return { approved: true, approval: this._approve(intent, intent.requestedLots || 0, checks, 'RISK_ENABLED=false'), checks, blocks: [], sizing: null };
    }

    // ── 0. kill switch ───────────────────────────────────────────────────────
    if (this.killSwitch && this.killSwitch.blocksNewEntries()) {
      const st = this.killSwitch.status();
      add('killSwitch', true, false, `kill switch is TRIPPED on ${st.reason}: ${st.detail}`, st.reason, 'not tripped');
    } else {
      add('killSwitch', true, true, 'kill switch clear', 'clear', 'not tripped');
    }

    const eq = n(state.equity);
    const lakhs = eq === null ? null : eq / 100000;

    // ── 1. capital deployed ─────────────────────────────────────────────────
    {
      const dep = n(state.deployed);
      const measurable = eq !== null && eq > 0 && dep !== null;
      const pct = measurable ? dep / eq * 100 : null;
      add('maxDeployed', measurable, measurable && pct <= cfg.RISK_MAX_DEPLOYED_PCT,
        measurable ? `${pct.toFixed(1)}% of equity deployed (limit ${cfg.RISK_MAX_DEPLOYED_PCT}%)`
                   : 'deployed capital or equity unknown — cannot evaluate',
        r2(pct), cfg.RISK_MAX_DEPLOYED_PCT);
    }
    {
      const byU = state.deployedByUnderlying || {};
      const dep = n(byU[intent.instrument]);
      const measurable = eq !== null && eq > 0 && dep !== null;
      const pct = measurable ? dep / eq * 100 : null;
      add('maxDeployedPerUnderlying', measurable, measurable && pct <= cfg.RISK_MAX_DEPLOYED_PER_UNDERLYING_PCT,
        measurable ? `${intent.instrument}: ${pct.toFixed(1)}% of equity (limit ${cfg.RISK_MAX_DEPLOYED_PER_UNDERLYING_PCT}%)`
                   : `deployed capital for ${intent.instrument} unknown — cannot evaluate`,
        r2(pct), cfg.RISK_MAX_DEPLOYED_PER_UNDERLYING_PCT);
    }

    // ── 2. position and lot counts ──────────────────────────────────────────
    {
      const open = n(state.openPositions);
      add('maxOpenPositions', open !== null, open !== null && open < cfg.RISK_MAX_OPEN_POSITIONS,
        open !== null ? `${open} open (limit ${cfg.RISK_MAX_OPEN_POSITIONS})` : 'open position count unknown — cannot evaluate',
        open, cfg.RISK_MAX_OPEN_POSITIONS);
    }
    {
      const byI = state.lotsByInstrument || {};
      const held = n(byI[intent.instrument]) ?? 0;
      const want = n(intent.requestedLots) ?? 0;
      add('maxLotsPerInstrument', true, held + want <= cfg.RISK_MAX_LOTS_PER_INSTRUMENT,
        `${intent.instrument}: ${held} held + ${want} requested vs limit ${cfg.RISK_MAX_LOTS_PER_INSTRUMENT}`,
        held + want, cfg.RISK_MAX_LOTS_PER_INSTRUMENT);
    }

    // ── 3. portfolio greeks, with a separate expiry-day set ─────────────────
    {
      const expiry = state.isExpiryDay === true;
      const g = state.greeks || null;
      const limits = expiry
        ? { delta: cfg.RISK_EXPIRY_MAX_NET_DELTA_PER_LAKH, gamma: cfg.RISK_EXPIRY_MAX_NET_GAMMA_PER_LAKH,
            vega: cfg.RISK_EXPIRY_MAX_NET_VEGA_PER_LAKH, theta: cfg.RISK_EXPIRY_MAX_NET_THETA_PER_LAKH }
        : { delta: cfg.RISK_MAX_NET_DELTA_PER_LAKH, gamma: cfg.RISK_MAX_NET_GAMMA_PER_LAKH,
            vega: cfg.RISK_MAX_NET_VEGA_PER_LAKH, theta: cfg.RISK_MAX_NET_THETA_PER_LAKH };

      for (const greek of ['delta', 'gamma', 'vega', 'theta']) {
        const raw = g ? n(g[greek]) : null;
        const measurable = raw !== null && lakhs !== null && lakhs > 0;
        const per = measurable ? Math.abs(raw) / lakhs : null;
        add(`net${greek[0].toUpperCase()}${greek.slice(1)}`, measurable,
          measurable && per <= limits[greek],
          measurable
            ? `net ${greek} ${r2(raw)} = ${r2(per)} per ₹1 lakh (limit ${limits[greek]}${expiry ? ', EXPIRY DAY' : ''})`
            : `net ${greek} unavailable or equity unknown — cannot evaluate. Stale greeks are not zero greeks`,
          r2(per), limits[greek]);
      }
    }

    // ── 4. day stop and trailing day stop ───────────────────────────────────
    {
      const sod = n(state.startOfDayEquity);
      const realised = n(state.dayRealisedPnl);
      const measurable = sod !== null && sod > 0 && realised !== null;
      const pct = measurable ? realised / sod * 100 : null;
      add('dayLossLimit', measurable, measurable && pct > -Math.abs(cfg.RISK_DAY_LOSS_LIMIT_PCT),
        measurable ? `day realised P&L ${pct.toFixed(2)}% (stop at −${cfg.RISK_DAY_LOSS_LIMIT_PCT}%)`
                   : 'start-of-day equity or realised P&L unknown — cannot evaluate the day stop',
        r2(pct), -Math.abs(cfg.RISK_DAY_LOSS_LIMIT_PCT));
    }
    {
      const peak = n(state.peakEquityToday);
      const measurable = peak !== null && peak > 0 && eq !== null;
      const dd = measurable ? (peak - eq) / peak * 100 : null;
      add('dayTrailingDrawdown', measurable, measurable && dd <= cfg.RISK_DAY_TRAILING_DD_PCT,
        measurable ? `${dd.toFixed(2)}% below today's peak equity (limit ${cfg.RISK_DAY_TRAILING_DD_PCT}%)`
                   : "today's peak equity unknown — cannot evaluate the trailing stop",
        r2(dd), cfg.RISK_DAY_TRAILING_DD_PCT);
    }

    /* ── 5. concentration ──────────────────────────────────────────────────
       ABSENT IS NOT THE SAME AS UNKNOWN, AND ONLY THE CALLER KNOWS WHICH.

       These two checks ask "how much of my risk already sits in this expiry /
       at this strike?". The answer comes from a map the caller supplies. If the
       intent names a key the map does not contain, that means one of two very
       different things:

         · the map is built from the open book, so absent = nothing held = ZERO
         · the map is partial or failed to build, so absent = we cannot tell

       Until 2026-07-31 both resolved to UNEVALUABLE, which blocks under the
       default fail mode. The consequence, found by the parity harness before
       any call site was wired: the layer approved orders only at strikes and
       expiries ALREADY HELD, and refused every genuinely new position. It had
       never been observed because the guard sat in one of twelve order paths.

       The fix does not guess. The caller declares `riskMapComplete: true` when
       the maps are exhaustive, and only then does an absent key read as zero.
       A caller that omits the flag gets the old fail-closed behaviour, so
       forgetting it blocks orders rather than letting them through. */
    const mapComplete = state.riskMapComplete === true;
    {
      const total = n(state.totalRisk);
      const byE = state.riskByExpiry || {};
      const raw = n(byE[intent.expiry]);
      const mine = raw ?? (mapComplete ? 0 : null);
      const measurable = total !== null && total > 0 && mine !== null;
      const pct = measurable ? mine / total * 100 : null;
      add('concentrationByExpiry', measurable, measurable && pct <= cfg.RISK_MAX_RISK_PER_EXPIRY_PCT,
        measurable ? `${pct.toFixed(1)}% of risk in expiry ${intent.expiry} (limit ${cfg.RISK_MAX_RISK_PER_EXPIRY_PCT}%)`
                   : 'risk by expiry unknown — cannot evaluate concentration (set state.riskMapComplete when the map is exhaustive)',
        r2(pct), cfg.RISK_MAX_RISK_PER_EXPIRY_PCT);
    }
    {
      const total = n(state.totalRisk);
      const byS = state.riskByStrike || {};
      const key = `${intent.instrument}|${intent.strike}|${intent.optionType}`;
      const raw = n(byS[key]) ?? n(byS[intent.strike]);
      const mine = raw ?? (mapComplete ? 0 : null);
      const measurable = total !== null && total > 0 && mine !== null;
      const pct = measurable ? mine / total * 100 : null;
      add('concentrationByStrike', measurable, measurable && pct <= cfg.RISK_MAX_RISK_PER_STRIKE_PCT,
        measurable ? `${pct.toFixed(1)}% of risk at ${key} (limit ${cfg.RISK_MAX_RISK_PER_STRIKE_PCT}%)`
                   : 'risk by strike unknown — cannot evaluate concentration (set state.riskMapComplete when the map is exhaustive)',
        r2(pct), cfg.RISK_MAX_RISK_PER_STRIKE_PCT);
    }

    // ── 6. expiry-day timing ────────────────────────────────────────────────
    if (state.isExpiryDay === true) {
      const mins = n(state.minutesToClose);
      add('expiryNoNewEntry', mins !== null,
        mins !== null && mins > cfg.RISK_EXPIRY_NO_NEW_ENTRY_MIN_BEFORE_CLOSE,
        mins !== null
          ? `${mins} minutes to close on expiry day (no new entries inside ${cfg.RISK_EXPIRY_NO_NEW_ENTRY_MIN_BEFORE_CLOSE})`
          : 'minutes to close unknown on an expiry day — cannot evaluate',
        mins, cfg.RISK_EXPIRY_NO_NEW_ENTRY_MIN_BEFORE_CLOSE);
    } else {
      checks.push({ name: 'expiryNoNewEntry', status: 'PASS', detail: 'not an expiry day', observed: null, threshold: null });
    }

    // ── 7. data freshness ───────────────────────────────────────────────────
    {
      const age = n(state.dataAgeMs);
      add('dataFreshness', age !== null, age !== null && age <= cfg.RISK_KILL_DATA_STALENESS_MS,
        age !== null ? `market data ${age} ms old (limit ${cfg.RISK_KILL_DATA_STALENESS_MS})`
                     : 'data age unknown — cannot assert freshness, so it is not asserted',
        age, cfg.RISK_KILL_DATA_STALENESS_MS);
    }

    // ── 8. margin headroom ──────────────────────────────────────────────────
    /* Synchronous by design. `evaluate()` is called on the order path and must
       stay synchronous, so the margin verdict is computed asynchronously by the
       caller (margin-monitor.wouldFit) and passed in. What this check does is
       make it IMPOSSIBLE to skip: an intent with no `marginVerdict` is
       unevaluable, and unevaluable blocks.

       The point is to refuse before sending. A broker margin rejection arrives
       after the order has gone out, possibly after a partial fill on a multi-leg
       basket — and a half-filled hedge is a naked short. */
    {
      const mv = intent.marginVerdict;
      if (!mv) {
        add('marginHeadroom', false, false,
          'no margin verdict supplied — the basket was never priced against available headroom, so it is refused rather than sent',
          null, 'a broker-sourced margin verdict');
      } else if (mv.fits === true) {
        add('marginHeadroom', true, true,
          `basket needs ₹${mv.required} (${mv.marginSource || 'broker'}); projected utilisation ${mv.projectedUtilisationPct}%`,
          mv.required, mv.projectedPeak);
      } else {
        // A margin that could not be priced is UNEVALUABLE; one that was priced
        // and does not fit is BLOCKED. Different facts, different responses.
        const unpriceable = mv.reason === 'MARGIN_UNKNOWN' || mv.reason === 'UTILISATION_UNKNOWN' || mv.reason === 'PROJECTION_UNKNOWN';
        add('marginHeadroom', !unpriceable, false, mv.detail, mv.required, mv.usableLimit ?? mv.reason);
      }
    }

    // ── sizing, only if everything above passed ─────────────────────────────
    let sizing = null;
    if (!failed.length) {
      sizing = sizeFromRisk({
        equity: state.equity, stopDistance: intent.stopDistance,
        lotSize: intent.lotSize, cfg, kelly: intent.kelly,
      });
      if (!sizing.ok) {
        failed.push({ name: 'sizing', status: 'BLOCKED', detail: sizing.detail, observed: sizing.reason, threshold: null });
        checks.push({ name: 'sizing', status: 'BLOCKED', detail: sizing.detail, observed: sizing.reason, threshold: null });
      } else {
        checks.push({ name: 'sizing', status: 'PASS', detail: sizing.detail, observed: sizing.lots, threshold: null });
        // A size REDUCTION is an event in its own right and is logged as one.
        const want = n(intent.requestedLots);
        if (want !== null && sizing.lots < want) {
          this._record({
            event: 'SIZE_REDUCED', strategy: intent.strategy, instrument: intent.instrument,
            strike: intent.strike, optionType: intent.optionType,
            requestedLots: want, approvedLots: sizing.lots, why: sizing.detail,
          });
        }
      }
    }

    if (failed.length) {
      const e = this._record({
        event: 'BLOCKED', strategy: intent.strategy, instrument: intent.instrument,
        strike: intent.strike, optionType: intent.optionType, side: intent.side,
        failed: failed.map(f => ({ limit: f.name, status: f.status, observed: f.observed, threshold: f.threshold, detail: f.detail })),
      });
      this.log.warn(`[risk] BLOCKED ${intent.strategy || '?'} ${intent.instrument} ${intent.strike ?? ''}${intent.optionType || ''} — ` +
        failed.map(f => `${f.name}(${f.status}): ${f.detail}`).join(' · '));
      return { approved: false, checks, blocks: failed, sizing, event: e };
    }

    return {
      approved: true,
      approval: this._approve(intent, sizing.lots, checks, sizing.detail),
      checks, blocks: [], sizing,
    };
  }

  /* The approval token. `risk-guard` will not send an order without one, and it
     is bound to the exact instrument, strike, side and quantity that was
     approved — so an approval cannot be reused for a different order. */
  _approve(intent, lots, checks, why) {
    return {
      token: `RA-${this.now()}-${Math.abs(hash(`${intent.instrument}${intent.strike}${intent.optionType}${intent.side}${lots}`)) % 1000000}`,
      issuedAt: new Date(this.now()).toISOString(),
      strategy: intent.strategy || null,
      instrument: intent.instrument, strike: intent.strike ?? null,
      optionType: intent.optionType || null, side: intent.side || null,
      lots, why,
      checks: checks.map(c => ({ name: c.name, status: c.status })),
    };
  }

  auditTrail(limit = 200) { return this.blocks.slice(-limit); }
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

module.exports = { RiskManager, sizeFromRisk };
