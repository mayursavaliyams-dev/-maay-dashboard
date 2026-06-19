/**
 * BOUNCE ENGINE — buy-on-bounce / sell-on-target paper auto-trader.
 *
 * Logic (validated on live tick data — bounce 5% / target 30% / SL 15% was the
 * ONLY profitable config; trailing-exit variants all lost money):
 *   - Watch each ATM-area CE/PE premium. Track its running session LOW.
 *   - When price bounces >= BOUNCE% off that low → paper BUY (reversal confirmed,
 *     avoids the falling-knife of buying every new low).
 *   - Exit on +TARGET% (take profit) or -SL% (stop) from entry.
 *
 * PAPER ONLY by design. One position per strike-key at a time. Caller feeds it
 * the live chain each tick via update(inst, chain). Records closed trades for P&L.
 *
 * ⚠️ Validated on a SINGLE day of data — treat as experimental until multi-day
 * walk-forward confirms it. Off by default (BOUNCE_ENGINE_ENABLED).
 */
class BounceEngine {
  constructor(cfg = {}) {
    this.enabled  = String(cfg.enabled ?? process.env.BOUNCE_ENGINE_ENABLED ?? 'false').toLowerCase() === 'true';
    this.bouncePct = parseFloat(cfg.bouncePct ?? process.env.BOUNCE_PCT ?? 5);   // % bounce off low to buy
    this.targetPct = parseFloat(cfg.targetPct ?? process.env.BOUNCE_TARGET_PCT ?? 30);
    this.slPct     = parseFloat(cfg.slPct ?? process.env.BOUNCE_SL_PCT ?? 15);
    this.maxStrikes = parseInt(cfg.maxStrikes ?? process.env.BOUNCE_MAX_STRIKES ?? 5); // ATM ± N to watch
    this.lotSize    = parseInt(cfg.lotSize ?? 1);
    this.qtyPerLeg  = parseInt(cfg.qtyPerLeg ?? process.env.BOUNCE_QTY ?? 1);

    this._state = new Map();   // key "strike_TYPE" -> { runLow, lowSeen, pos }
    this._open  = new Map();   // key -> open position
    this._closed = [];         // closed paper trades (today)
    this._date  = '';
    this.onTrade = null;       // optional callback(event, data)
  }

  _today() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); }
  _resetIfNewDay() {
    const d = this._today();
    if (d !== this._date) { this._date = d; this._state.clear(); this._open.clear(); this._closed = []; }
  }
  _hms() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 19); }

  // Feed the live chain. inst e.g. 'NIFTY'; chain = { atm, interval, rows:[{strike,ce,pe}] }
  update(inst, chain) {
    if (!this.enabled || !chain || !chain.rows) return;
    this._resetIfNewDay();
    const atm = chain.atm, step = chain.interval || 50;
    for (const row of chain.rows) {
      if (Math.abs((row.strike - atm) / step) > this.maxStrikes) continue; // only ATM±N
      for (const type of ['ce', 'pe']) {
        const leg = row[type]; if (!leg) continue;
        const ltp = Number(leg.ltp || 0); if (!(ltp > 0)) continue;
        this._tick(inst, row.strike, type.toUpperCase(), ltp);
      }
    }
  }

  _tick(inst, strike, type, ltp) {
    const key = `${inst}_${strike}_${type}`;
    let st = this._state.get(key);
    if (!st) { st = { runLow: ltp, lowSeen: true, pos: null }; this._state.set(key, st); return; }

    if (!st.pos) {
      if (ltp < st.runLow) { st.runLow = ltp; }
      // BUY when bounced >= bouncePct off the running low
      if (st.runLow > 0 && (ltp - st.runLow) / st.runLow >= this.bouncePct / 100) {
        st.pos = { inst, strike, type, entry: ltp, entryAt: this._hms(), peak: ltp, qty: this.qtyPerLeg };
        this._open.set(key, st.pos);
        if (this.onTrade) try { this.onTrade('BUY', { ...st.pos, key }); } catch (_) {}
      }
    } else {
      const pos = st.pos;
      if (ltp > pos.peak) pos.peak = ltp;
      const tgtHit = (ltp - pos.entry) / pos.entry >= this.targetPct / 100;
      const slHit  = (pos.entry - ltp) / pos.entry >= this.slPct / 100;
      if (tgtHit || slHit) {
        const pnlPct = ((ltp - pos.entry) / pos.entry) * 100;
        const closed = { ...pos, exit: ltp, exitAt: this._hms(), pnlPct: +pnlPct.toFixed(1),
                         pnlAbs: +((ltp - pos.entry) * pos.qty).toFixed(2), reason: slHit ? 'SL' : 'TARGET' };
        this._closed.push(closed);
        this._open.delete(key);
        st.pos = null; st.runLow = ltp; // reset, look for next bounce
        if (this.onTrade) try { this.onTrade('SELL', { ...closed, key }); } catch (_) {}
      }
    }
  }

  status() {
    const wins = this._closed.filter(t => t.pnlPct > 0).length;
    const net = this._closed.reduce((s, t) => s + t.pnlPct, 0);
    return {
      enabled: this.enabled,
      config: { bouncePct: this.bouncePct, targetPct: this.targetPct, slPct: this.slPct, maxStrikes: this.maxStrikes },
      openPositions: [...this._open.values()],
      closedToday: this._closed.length,
      wins, winRate: this._closed.length ? +(100 * wins / this._closed.length).toFixed(0) : 0,
      netPnlPct: +net.toFixed(1),
      recent: this._closed.slice(-12).reverse(),
    };
  }
}

module.exports = BounceEngine;
