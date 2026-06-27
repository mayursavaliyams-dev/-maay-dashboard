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

const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };
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

  _loadTrades() { try { return JSON.parse(require('fs').readFileSync(this._tradesFile, 'utf8')) || []; } catch { return []; } }
  _saveTrades() { try { const fs = require('fs'), p = require('path'); fs.mkdirSync(p.dirname(this._tradesFile), { recursive: true }); fs.writeFileSync(this._tradesFile, JSON.stringify(this._allTrades.slice(-5000))); } catch (_) {} }

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

    const lot = LOT[inst] || 75;
    const position = {
      inst, side: det.side, strike: det.atmStrike, entry: +ltp.toFixed(2), last: ltp, peak: ltp,
      qty: this.qty, lot, openMins: istMins, expiry: det.expiry, score: det.score, level: det.level,
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

  _close(inst, pos, exitLtp, reason, istMins) {
    const units = pos.qty * pos.lot;
    const gross = (exitLtp - pos.entry) * units;
    const ch = roundTripCharges(pos.entry, exitLtp, units).total;
    const pnl = +(gross - ch).toFixed(2);
    const rec = {
      date: this._day, inst, side: pos.side, strike: pos.strike,
      entry: pos.entry, exit: +Number(exitLtp).toFixed(2), qty: pos.qty, lot: pos.lot,
      reason, pnl, pnlPct: +(((exitLtp - pos.entry) / pos.entry) * 100).toFixed(1),
      charges: +ch.toFixed(2), score: pos.score, level: pos.level,
      openMins: pos.openMins, closeMins: istMins,
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
        days: new Set(this._allTrades.map(t => t.date)).size },
      recent: this._allTrades.slice(-15).reverse(),
      detect: this._lastDetect,
      note: 'PAPER expiry-day gamma-blast option BUYER. Asymmetric: many small stops, rare big winners — judge on net over many expiries. Not backtestable here; forward-test only.',
    };
  }
}

module.exports = GammaBlastEngine;
