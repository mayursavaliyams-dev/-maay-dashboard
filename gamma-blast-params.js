/**
 * ============================================================================
 *  GAMMA-BLAST DETECTION PARAMETERS
 * ----------------------------------------------------------------------------
 *  A "gamma blast" = on/near expiry, ATM option gamma is enormous, so a SMALL
 *  index move makes the ATM premium explode (often +100-300%% in minutes) while
 *  the opposite side collapses. It is an EXPIRY-DAY, AFTERNOON phenomenon driven
 *  by: tiny time value + huge gamma + a directional trigger out of a tight range.
 *
 *  This file ONLY defines the parameters/thresholds that identify a blast.
 *  A detector (built next) consumes these; nothing here trades or alerts yet.
 *
 *  Two layers:
 *    A) "BLAST-PRONE"  — the Greek/structural state is loaded (option-analyzer
 *                        already scores this: gamma power, GTR, DTE).
 *    B) "BLAST-ACTIVE" — the live trigger is firing NOW (premium velocity +
 *                        underlying breakout + volume/OI surge).
 *  An ALERT needs BOTH (prone AND active), scored by `weights` ≥ alertThreshold.
 *
 *  Every value is env-overridable (GB_* ) so you can tune without code edits.
 * ============================================================================
 */
const N = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);
const S = (k, d) => (process.env[k] != null && process.env[k] !== '' ? String(process.env[k]) : d);

module.exports = {
  // ── 1. EXPIRY GATE — blasts only fire near 0 DTE (gamma → ∞ at expiry) ──────
  maxDTE:             N('GB_MAX_DTE', 0),        // 0 = expiry day only; 1 = also allow T-1
  requireExpiryDay:   S('GB_EXPIRY_ONLY', 'true') === 'true',

  // ── 2. TIME-OF-DAY WINDOW (IST) — FULL expiry day active ───────────────────
  //     On expiry (engine is 0-DTE only) watch from the open so morning gamma
  //     spikes are caught too; still stop before square-off. (Afternoon is where
  //     blasts cluster — theta/OI unwinding after ~13:00 — but expiry can blast
  //     any time, so the user wants the detector live all day.)
  startHHMM:          S('GB_START', '09:15'),    // full-day on expiry (was 13:15)
  endHHMM:            S('GB_END',   '15:15'),    // stop before 15:25 square-off

  // ── 3. ATM PROXIMITY — spot must sit ON a strike for peak gamma ────────────
  maxSpotToATMPct:    N('GB_ATM_PCT', 0.15),     // |spot−ATM|/spot ≤ 0.15%

  // ── 4. GREEK / STRUCTURAL STATE (from option-analyzer.gammaBlastScore) ─────
  minBlastScore:      N('GB_MIN_SCORE', 55),     // 0–100: 55 HIGH · 75 EXTREME · 90 NUCLEAR
  minGreekRank:       N('GB_MIN_RANK', 60),      // 0–100 greek-power rank
  minGammaThetaRatio: N('GB_MIN_GTR', 0.8),      // GTR: gamma must dominate theta (blast fuel)

  // ── 5. IV CONDITION — cheap gamma blasts hardest (high IV is already priced)
  maxATMIVpct:        N('GB_MAX_IV', 22),        // ATM IV ≤ 22% → bigger % blast

  // ── 6. PREMIUM VELOCITY — the live blast SIGNATURE (tick/1-min based) ───────
  premVelPctPerMin:   N('GB_PREM_VEL', 8),       // ATM-side premium rising ≥ 8% / minute
  premVelWindowMin:   N('GB_PREM_WIN', 3),       // measured over the last N minutes

  // ── 7. UNDERLYING TRIGGER — the move that lights the fuse ───────────────────
  triggerMovePct:     N('GB_TRIG_PCT', 0.12),    // index ≥0.12% directional pop…
  preRangeWindowMin:  N('GB_PRE_WIN', 15),       // …out of a tight prior window
  maxPreRangePct:     N('GB_PRE_RANGE', 0.20),   // pre-blast range ≤0.20% (coiled spring)

  // ── 8. VOLUME / OI CONFIRMATION ────────────────────────────────────────────
  volSpikeMult:       N('GB_VOL_MULT', 2.5),     // ATM option volume ≥2.5× recent avg
  minOIChangePct:     N('GB_OI_PCT', 10),        // ATM OI shift ≥10% (unwinding/positioning)

  // ── 9. SCORING — weighted vote; ALERT when total ≥ alertThreshold (0–100) ──
  weights: {
    dteGate:     N('GB_W_DTE',    20),  // expiry-day + time-window satisfied
    atmProx:     N('GB_W_ATM',    10),  // spot on the strike
    blastScore:  N('GB_W_SCORE',  20),  // greek blast score high
    gtr:         N('GB_W_GTR',    10),  // gamma dominates theta
    ivCheap:     N('GB_W_IV',     10),  // IV cheap
    premVel:     N('GB_W_VEL',    15),  // premium velocity firing (key live signal)
    trigger:     N('GB_W_TRIG',   10),  // underlying breakout from tight range
    volOI:       N('GB_W_VOLOI',   5),  // volume/OI surge confirmation
  },
  alertThreshold:     N('GB_ALERT', 60), // ≥60/100 weighted → GAMMA-BLAST alert

  // ── 10. DIRECTION & SIDE ───────────────────────────────────────────────────
  //     Blast side follows the trigger: up-move → CE blasts, down-move → PE blasts.
  //     We watch the ATM (and ATM±1) of the breakout side only.
  watchStrikesEachSide: N('GB_WATCH_STRIKES', 1), // ATM ± this many strikes

  // Cosmetic: how confident the alert is, by total score.
  levelFor(total) {
    if (total >= 85) return 'NUCLEAR';
    if (total >= 72) return 'EXTREME';
    if (total >= 60) return 'HIGH';
    if (total >= 45) return 'MODERATE';
    return 'LOW';
  },
};
