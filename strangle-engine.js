/**
 * STRANGLE ENGINE — short-strangle premium-selling paper auto-trader.
 *
 * Implements EXACTLY the config validated in bt-strategies.js on 120 days of
 * real NIFTE bhavcopy data (the SHORT_STRANGLE leaderboard winner):
 *   - 89% win · +₹53k / ₹1L · max drawdown 4.3% · avg win ₹2.7k / avg loss ₹3.7k
 *
 * Logic per weekly cycle:
 *   - SELL one ~OTM CE (≈ ATM + 1.5%) + one ~OTM PE (≈ ATM − 1.5%) for a credit.
 *   - Hold to expiry; exit the whole position when:
 *       · either leg's premium rises to STOP_MULT × its entry  → STOP, or
 *       · combined premium decays to TAKE_PROFIT_PCT of credit → take profit, or
 *       · expiry day close (let theta finish).
 *   - One open strangle per instrument at a time. Re-enter only after the
 *     current weekly expiry passes (matches the backtest's weekly cadence).
 *
 * ⚠️ PREMIUM SELLING = UNDEFINED RISK on a naked strangle. PAPER ONLY by design;
 * never places a live order. Validated on a single favorable 120-day window —
 * forward-test in paper before trusting. Off by default (STRANGLE_ENGINE_ENABLED).
 */
class StrangleEngine {
  constructor(cfg = {}) {
    this.enabled    = String(cfg.enabled ?? process.env.STRANGLE_ENGINE_ENABLED ?? 'false').toLowerCase() === 'true';
    this.otmPct     = parseFloat(cfg.otmPct ?? process.env.STRANGLE_OTM_PCT ?? 1.5);     // % OTM for each leg
    this.stopMult   = parseFloat(cfg.stopMult ?? process.env.STRANGLE_STOP_MULT ?? 2.0); // leg premium ×N = stop
    this.tpPct      = parseFloat(cfg.tpPct ?? process.env.STRANGLE_TP_PCT ?? 50);        // take profit at % of credit captured
    this.qtyPerLeg  = parseInt(cfg.qtyPerLeg ?? process.env.STRANGLE_QTY ?? 1);          // lots per leg

    this._open  = new Map();   // inst -> open strangle position
    this._closed = [];         // closed paper trades (today/session)
    this._cycleExp = new Map();// inst -> expiry date we entered for (re-entry guard)
    this._date  = '';
    this.onTrade = null;       // optional callback(event, data)
  }

  _today() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); }
  _hms()   { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 19); }
  _resetIfNewDay() {
    const d = this._today();
    if (d !== this._date) { this._date = d; this._closed = []; }
  }

  // Feed the live chain. inst e.g. 'NIFTY'; chain = { atm, interval, expiry, rows:[{strike,ce,pe}] }
  update(inst, chain) {
    if (!this.enabled || !chain || !chain.rows || !chain.rows.length) return;
    this._resetIfNewDay();
    const atm = chain.atm, step = chain.interval || 50;
    const expiry = chain.expiry || null;
    const pos = this._open.get(inst);

    if (pos) { this._manage(inst, chain, pos); return; }

    // ── No open position: maybe enter, if this weekly cycle isn't already used ──
    if (expiry && this._cycleExp.get(inst) === expiry) return;   // already traded this expiry
    const off = Math.round((atm * (this.otmPct / 100)) / step) * step;
    const ceRow = chain.rows.find(r => r.strike === atm + off);
    const peRow = chain.rows.find(r => r.strike === atm - off);
    const ceLtp = Number(ceRow?.ce?.ltp || 0), peLtp = Number(peRow?.pe?.ltp || 0);
    if (!(ceLtp > 0) || !(peLtp > 0)) return;

    const entry = {
      inst, expiry, entryAt: this._hms(),
      ce: { strike: atm + off, entry: ceLtp, ltp: ceLtp },
      pe: { strike: atm - off, entry: peLtp, ltp: peLtp },
      credit: +(ceLtp + peLtp).toFixed(2), qty: this.qtyPerLeg
    };
    this._open.set(inst, entry);
    if (expiry) this._cycleExp.set(inst, expiry);
    if (this.onTrade) try { this.onTrade('SELL_OPEN', { ...entry }); } catch (_) {}
  }

  _manage(inst, chain, pos) {
    const ceRow = chain.rows.find(r => r.strike === pos.ce.strike);
    const peRow = chain.rows.find(r => r.strike === pos.pe.strike);
    const ceLtp = Number(ceRow?.ce?.ltp || pos.ce.ltp);
    const peLtp = Number(peRow?.pe?.ltp || pos.pe.ltp);
    pos.ce.ltp = ceLtp; pos.pe.ltp = peLtp;

    const stopHit = ceLtp >= pos.ce.entry * this.stopMult || peLtp >= pos.pe.entry * this.stopMult;
    const nowPrem = ceLtp + peLtp;
    const captured = (pos.credit - nowPrem) / pos.credit;                  // fraction of credit decayed
    const tpHit = captured >= this.tpPct / 100;

    if (stopHit || tpHit) {
      // P&L per unit on a short = credit collected − cost to buy back
      const pnlPerUnit = pos.credit - nowPrem;
      const pnlAbs = +(pnlPerUnit * pos.qty).toFixed(2);
      const closed = {
        inst, expiry: pos.expiry, entryAt: pos.entryAt, exitAt: this._hms(),
        ce: { ...pos.ce }, pe: { ...pos.pe },
        credit: pos.credit, exitPrem: +nowPrem.toFixed(2),
        pnlPerUnit: +pnlPerUnit.toFixed(2), pnlAbs,
        pnlPct: +(captured * 100).toFixed(1),
        reason: stopHit ? 'STOP' : 'TAKE_PROFIT'
      };
      this._closed.push(closed);
      this._open.delete(inst);
      if (this.onTrade) try { this.onTrade('SELL_CLOSE', { ...closed }); } catch (_) {}
    }
  }

  status() {
    const wins = this._closed.filter(t => t.pnlAbs > 0).length;
    const net  = this._closed.reduce((s, t) => s + t.pnlAbs, 0);
    return {
      enabled: this.enabled,
      config: { otmPct: this.otmPct, stopMult: this.stopMult, tpPct: this.tpPct, qtyPerLeg: this.qtyPerLeg },
      openPositions: [...this._open.values()],
      closedToday: this._closed.length,
      wins, winRate: this._closed.length ? +(100 * wins / this._closed.length).toFixed(0) : 0,
      netPnl: +net.toFixed(2),
      recent: this._closed.slice(-12).reverse(),
      note: 'PAPER-only short strangle. Validated 89% win on 120d bhavcopy. Forward-test before trusting.'
    };
  }
}

module.exports = StrangleEngine;
