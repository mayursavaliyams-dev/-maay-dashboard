/**
 * GAMMA-BLAST ENGINE — expiry-day option-BUYING paper auto-trader.
 *
 * The ONLY option-BUYING strategy with a credible rationale in this bot. Plain
 * directional buying has NO edge here (intraday multi-confirm PF 0.94, GAP_BUY
 * ~2% win — theta bleed). The gamma-blast is the specific exception: at/near
 * 0-DTE, ATM gamma is enormous, so a small index move makes the ATM premium
 * explode (+100–300% in minutes) while theta is already spent. We BUY the ATM
 * option of the breakout side only when the live detector fires.
 *
 * Entry  : gamma-blast-detect.js `firing` on an EXPIRY day, inside the afternoon
 *          window, with premium velocity + a directional trigger → BUY ATM of
 *          `side` (CE on up-move, PE on down-move) at its live LTP.
 * Manage : take-profit at +tpPct, stop at -slPct, a give-back TRAIL once the
 *          trade has run +trailAtPct, hard square-off before close, and exit if
 *          the detector's window closes.
 *
 * ⚠️ CANNOT be backtested here — we have no intraday OPTION-premium history, and
 * modelling 0-DTE premiums (BSM) is unreliable (IV/pin risk). So this is a PURE
 * PAPER FORWARD-TEST, off by default (GAMMA_BLAST_ENGINE_ENABLED). Never places a
 * live order. Buying is asymmetric: many small stops, occasional large winners —
 * judge it on net expectancy over many expiries, not win-rate. Forward-test before
 * trusting; wire a live order path only on explicit instruction.
 */
const gammaBlastDetect = require('./gamma-blast-detect.js');
const { roundTripCharges } = require('./charges.js');

// ── MIGRATION C1b (2026-07-09) ─────────────────────────────────────────────────
// This module previously hardcoded a LOT map of NIFTY 75 / BANKNIFTY 35 / SENSEX 20 and
// fell back to 75 for unknown instruments. Those values are WRONG: the broker's contract
// master (Upstox GET /v2/option/contract) reports NIFTY 65, BANKNIFTY 30, SENSEX 20.
// P&L here is `units = qty × lot`, so realized ₹P&L was OVERSTATED by +15.4% (NIFTY) and
// +16.7% (BANKNIFTY). The formula was always right; only the constant was wrong.
//
// Lot size now comes from the single source of truth. No hardcoded lot, no silent
// fallback: an unknown instrument yields null and the engine refuses to open.
//
// Legacy preservation: historical trades embed the lot they were opened with and are never
// rewritten. Positions opened before this migration close on their stored lot as
// calcVersion 1; new positions use the registry → calcVersion 2.
const instrumentRegistry = require('./instrument-registry.js');
const safeWrite = require('./safe-write.js');   // C3-04: atomic, fail-closed ledger writes
const lotOf = (inst) => instrumentRegistry.lotSize(inst);   // null when unknown — never guess
const LOT_SOURCE_REGISTRY = 'instrument-registry';
const LOT_SOURCE_LEGACY_OPEN = 'legacy-open-position';

const hhmm = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + b; };

class GammaBlastEngine {
  constructor(cfg = {}) {
    this.enabled = String(cfg.enabled ?? process.env.GAMMA_BLAST_ENGINE_ENABLED ?? 'false').toLowerCase() === 'true';
    this.tpPct        = parseFloat(cfg.tpPct ?? process.env.GB_ENGINE_TP_PCT ?? 60);          // take profit at +60%
    this.slPct        = parseFloat(cfg.slPct ?? process.env.GB_ENGINE_SL_PCT ?? 35);          // stop at -35%
    this.trailAtPct   = parseFloat(cfg.trailAtPct ?? process.env.GB_ENGINE_TRAIL_AT ?? 50);   // arm trail after +50%
    this.trailGiveback= parseFloat(cfg.trailGiveback ?? process.env.GB_ENGINE_TRAIL_GB ?? 35);// exit if peak gain gives back this many %-points
    this.qty          = parseInt(cfg.qty ?? process.env.GB_ENGINE_QTY ?? 1);                  // lots
    this.squareOffMins= hhmm(cfg.squareOff ?? process.env.GB_ENGINE_SQUAREOFF ?? '15:20');    // hard exit before close
    this.maxTradesPerDay = parseInt(cfg.maxTradesPerDay ?? process.env.GB_ENGINE_MAX_TRADES ?? 2); // per instrument

    this._open    = new Map();   // inst -> open position
    this._closed  = [];          // closed trades this session/day
    this._lastDetect = {};       // inst -> last detector snapshot (for status)
    this._tradesToday = {};      // inst -> count today
    this._day = null;
    this._tradesFile = require('path').join(__dirname, 'data', 'gamma-blast-trades.json');
    this._allTrades = this._loadTrades();
    this.onTrade = null;         // (event, data) => void   event: 'open' | 'close'
  }

  // ── persistence (MIGRATION C3-04: atomic + fail-closed) ────────────────────
  // gamma-blast is FORWARD-TEST ONLY: this ledger is the entire evidence base for a
  // strategy that cannot be backtested. Losing it loses the experiment.
  _loadTrades() {
    this._ledgerCorrupt = false;
    try {
      const rows = safeWrite.readJsonSync(this._tradesFile, {
        fallback: [],
        onRecover: (reason, bak) => console.warn(`[gamma-blast] trade ledger was corrupt (${reason}); recovered from ${bak}.`),
      });
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      this._ledgerCorrupt = true;
      this._ledgerCorruptReason = e.message;
      console.error(`[gamma-blast] TRADE LEDGER UNRECOVERABLE: ${e.message}`);
      console.error('[gamma-blast] Saving is DISABLED. The file is untouched. This is the forward-test record.');
      return [];
    }
  }
  _saveTrades() {
    if (this._ledgerCorrupt) return;
    try { safeWrite.writeJsonSync(this._tradesFile, this._allTrades.slice(-5000), { backup: true }); this._lastSaveError = null; }
    catch (e) { this._lastSaveError = `trades: ${e.message}`; console.error(`[gamma-blast] trade ledger save failed: ${e.message}`); }
  }

  _ist() { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return { date: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  _resetIfNewDay(date) { if (this._day !== date) { this._day = date; this._tradesToday = {}; this._closed = []; } }

  // Feed the live chain. inst e.g. 'NIFTY'; feed = { spot, atm, interval, expiry, rows:[{strike,ce,pe}] }
  update(inst, feed) {
    if (!this.enabled || !feed || !feed.rows || !feed.rows.length) return;
    inst = String(inst).toUpperCase();
    const { date: istDate, mins: istMins } = this._ist();
    this._resetIfNewDay(istDate);

    const atm = feed.atm;
    const spot = feed.spot ?? atm;
    const rows = feed.rows;
    const atmRow = rows.find(r => Number(r.strike) === atm) || {};
    const atmIV = Number(atmRow.ce?.iv || atmRow.pe?.iv || 0);

    const det = gammaBlastDetect.detect({ inst, rows, spot, atm, expiry: feed.expiry, istDate, istMins, atmIV });
    this._lastDetect[inst] = det;

    const pos = this._open.get(inst);
    if (pos) { this._manage(inst, pos, rows, istMins, det); return; }

    // ── ENTRY ──
    if (!det.firing || !det.side) return;
    if (istMins >= this.squareOffMins) return;
    if ((this._tradesToday[inst] || 0) >= this.maxTradesPerDay) return;

    const sideRow = rows.find(r => Number(r.strike) === det.atmStrike) || atmRow;
    const ltp = det.side === 'CE' ? Number(sideRow.ce?.ltp || 0) : Number(sideRow.pe?.ltp || 0);
    if (!(ltp > 0)) return;

    const lot = lotOf(inst);                    // C1b: registry, never a hardcoded fallback
    if (!lot) return;                           // unknown contract size → refuse, do not guess
    const position = {
      inst, side: det.side, strike: det.atmStrike, entry: +ltp.toFixed(2), last: ltp, peak: ltp,
      qty: this.qty, lot, lotSource: LOT_SOURCE_REGISTRY, calcVersion: 2,
      openMins: istMins, expiry: det.expiry, score: det.score, level: det.level,
    };
    this._open.set(inst, position);
    this._tradesToday[inst] = (this._tradesToday[inst] || 0) + 1;
    if (this.onTrade) try { this.onTrade('open', position); } catch (_) {}
  }

  _manage(inst, pos, rows, istMins, det) {
    const row = rows.find(r => Number(r.strike) === pos.strike) || {};
    const cur = pos.side === 'CE' ? Number(row.ce?.ltp || 0) : Number(row.pe?.ltp || 0);
    if (cur > 0) pos.last = cur;
    const ltp = pos.last || pos.entry;
    if (ltp > pos.peak) pos.peak = ltp;

    const changePct = (ltp - pos.entry) / pos.entry * 100;
    const peakPct   = (pos.peak - pos.entry) / pos.entry * 100;
    let reason = null;
    if (changePct >= this.tpPct) reason = 'TARGET';
    else if (changePct <= -this.slPct) reason = 'STOP_LOSS';
    else if (peakPct >= this.trailAtPct && (peakPct - changePct) >= this.trailGiveback) reason = 'TRAIL';
    else if (istMins >= this.squareOffMins) reason = 'SQUARE_OFF';
    else if (det && det.windowState === 'closed') reason = 'WINDOW_CLOSED';
    if (!reason) return;
    this._close(inst, pos, ltp, reason, istMins);
  }

  /**
   * MIGRATION C1b — classify a closing position as legacy (pre-registry lot) or current.
   * A position opened before the migration persists with its old lot and no calcVersion; we
   * do NOT retroactively re-lot it (that would change the entry basis mid-position). Its pnl
   * IS the legacy value. New positions carry calcVersion 2 and have no legacy counterpart,
   * so pnlLegacy is null rather than an invented counterfactual.
   */
  _closeCalcMeta(pos, pnl) {
    const calcVersion = pos.calcVersion ?? 1;
    const lotSource = pos.lotSource ?? LOT_SOURCE_LEGACY_OPEN;
    return { calcVersion, lotSource, pnlLegacy: calcVersion === 1 ? pnl : null };
  }

  /** MIGRATION C1b — split reported P&L into legacy vs current so reports can label them. */
  _calcBreakdown(all) {
    const sum = a => +a.reduce((s, t) => s + (Number(t.pnl) || 0), 0).toFixed(2);
    const v2 = all.filter(t => t.calcVersion === 2);
    const v1 = all.filter(t => t.calcVersion !== 2);
    return {
      mixed: v1.length > 0 && v2.length > 0,
      legacy: { trades: v1.length, netPnl: sum(v1),
        method: 'v1-legacy: units = qty × hardcoded lot (NIFTY 75 / BANKNIFTY 35) — overstated' },
      current: { trades: v2.length, netPnl: sum(v2),
        method: 'v2: units = qty × instrument-registry lotSize (broker contract master)' },
      note: 'allTime.netPnl is the raw sum across BOTH versions and is therefore mixed while `mixed` is true. Legacy trades are pre-migration-C1b records whose lot was hardcoded 75/35; they are preserved unmodified. Compare like-for-like using calc.current only.',
    };
  }

  _close(inst, pos, exitLtp, reason, istMins) {
    const units = pos.qty * pos.lot;
    const gross = (exitLtp - pos.entry) * units;
    const ch = roundTripCharges(pos.entry, exitLtp, units).total;
    const pnl = +(gross - ch).toFixed(2);
    const { calcVersion, lotSource, pnlLegacy } = this._closeCalcMeta(pos, pnl);   // C1b
    const rec = {
      date: this._day, inst, side: pos.side, strike: pos.strike,
      entry: pos.entry, exit: +Number(exitLtp).toFixed(2), qty: pos.qty, lot: pos.lot,
      reason, pnl, pnlPct: +(((exitLtp - pos.entry) / pos.entry) * 100).toFixed(1),
      charges: +ch.toFixed(2), score: pos.score, level: pos.level,
      openMins: pos.openMins, closeMins: istMins,
      calcVersion, lotSource, pnlLegacy,
    };
    this._open.delete(inst);
    this._closed.push(rec);
    this._allTrades.push(rec);
    this._saveTrades();
    if (this.onTrade) try { this.onTrade('close', rec); } catch (_) {}
  }

  _summary(trades) {
    const n = trades.length;
    const wins = trades.filter(t => t.pnl > 0).length;
    const net = trades.reduce((s, t) => s + t.pnl, 0);
    const grossWin = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const grossLoss = -trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
    return {
      trades: n, wins, winRate: n ? +((wins / n) * 100).toFixed(1) : 0,
      netPnl: +net.toFixed(0), avgPerTrade: n ? +(net / n).toFixed(0) : 0,
      profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? 99 : 0),
    };
  }

  status() {
    const open = [...this._open.values()].map(p => ({
      ...p, changePct: +(((p.last - p.entry) / p.entry) * 100).toFixed(1),
    }));
    return {
      enabled: this.enabled,
      config: { tpPct: this.tpPct, slPct: this.slPct, trailAtPct: this.trailAtPct,
        trailGiveback: this.trailGiveback, qty: this.qty, squareOff: this.squareOffMins, maxTradesPerDay: this.maxTradesPerDay },
      openPositions: open,
      today: this._summary(this._closed),
      allTime: { ...this._summary(this._allTrades), since: this._allTrades[0]?.date || null,
        days: new Set(this._allTrades.map(t => t.date)).size,
        calc: this._calcBreakdown(this._allTrades) },
      lotSource: LOT_SOURCE_REGISTRY,
      lotSizes: Object.fromEntries(instrumentRegistry.instruments().map(i => [i, lotOf(i)])),
      recent: this._allTrades.slice(-15).reverse(),
      detect: this._lastDetect,
      note: 'PAPER expiry-day gamma-blast option BUYER. Asymmetric: many small stops, rare big winners — judge on net over many expiries. Not backtestable here; forward-test only.',
    };
  }
}

module.exports = GammaBlastEngine;
