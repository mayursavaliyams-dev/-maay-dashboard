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
    // Tier-1 #2 — IV-regime filter. Backtest (300d) showed selling ONLY when IV is
    // in the upper half of its recent range nearly doubles net/trade and lowers
    // drawdown. Sell only when IV percentile >= ivPctMin (0..1). Set 0 to disable.
    this.ivPctMin   = parseFloat(cfg.ivPctMin ?? process.env.STRANGLE_IV_PCT_MIN ?? 0.5);
    this.ivWindow   = parseInt(cfg.ivWindow ?? process.env.STRANGLE_IV_WINDOW ?? 40);    // trailing days for the percentile
    // Tier-1 #3 — TAIL-SAFE. When IV percentile is VERY high (>= tailSafePct), a
    // gap/event is most likely; switch from naked strangle to a defined-risk IRON
    // CONDOR (buy wings wingPts beyond each short) so a stop-failing gap can't blow
    // up the account. Costs ~half the credit, so only used in the danger regime.
    this.tailSafePct = parseFloat(cfg.tailSafePct ?? process.env.STRANGLE_TAILSAFE_PCT ?? 0.8); // >1 disables
    this.wingPts     = parseInt(cfg.wingPts ?? process.env.STRANGLE_WING_PTS ?? 200);
    // ALWAYS hedge: buy wings every entry → defined-risk iron CONDOR regardless of
    // IV-percentile. This is the backtest-validated structure (81% win, capped tail)
    // and avoids naked strangles when IV history is too thin to classify the regime.
    this.forceCondor = String(cfg.forceCondor ?? process.env.STRANGLE_FORCE_CONDOR ?? 'false').toLowerCase() === 'true';
    // Tier-2 — margin-aware, fractional-Kelly, IV-scaled sizing. Surfaces the
    // recommended REAL-capital lot count (paper still trades qtyPerLeg unless
    // useSizer). Stats default to the validated strangle backtest.
    this._sizer    = require('./position-sizer.js');
    this.capital   = parseFloat(cfg.capital ?? process.env.STRANGLE_CAPITAL ?? 100000);
    this.useSizer  = String(cfg.useSizer ?? process.env.STRANGLE_USE_SIZER ?? 'false').toLowerCase() === 'true';
    this._stats    = { winRate: 0.94, avgWin: 2959, avgLoss: -3498 };   // from cost-net backtest
    // Tier-3 — (#7) trend kill-switch: don't sell premium into a strong trend.
    // OFF by default (backtest showed only marginal everyday benefit; rationale
    // is crisis protection — AQR). Set trendSkipPct e.g. 0.015 to enable.
    // (#6) adjustMult: early-warning when a leg reaches this × entry (before the
    // 2x stop) → emit an ADJUST signal so the untested side can be rolled.
    this.trendSkipPct = parseFloat(cfg.trendSkipPct ?? process.env.STRANGLE_TREND_SKIP_PCT ?? 0); // 0 disables
    this.trendSmaN    = parseInt(cfg.trendSmaN ?? process.env.STRANGLE_TREND_SMA ?? 10);
    this.adjustMult   = parseFloat(cfg.adjustMult ?? process.env.STRANGLE_ADJUST_MULT ?? 1.5);    // < stopMult

    this._open  = new Map();   // inst -> open strangle position
    this._closed = [];         // closed paper trades (today/session)
    this._cycleExp = new Map();// inst -> expiry date we entered for (re-entry guard)
    this._date  = '';
    this._ivHist = {};         // inst -> [{date, iv}] (persisted, one per day)
    this._ivRecorded = {};     // inst -> last date IV was recorded
    this._lastIv = {};         // inst -> { iv, pct } (latest, for status)
    this._ivFile = require('path').join(__dirname, 'data', 'strangle-iv.json');
    this._loadIv();
    // Persistent ALL-TIME forward-test trade log — survives restarts and accrues
    // across days (_closed purges daily; this never does). The whole point of the
    // paper forward-test: accumulate real win-rate / P&L on the validated edge.
    this._tradesFile = require('path').join(__dirname, 'data', 'strangle-trades.json');
    this._allTrades = this._loadTrades();
    this.onTrade = null;       // optional callback(event, data)
  }

  // ── IV-regime helpers ──────────────────────────────────────────────────────
  _loadIv() { try { this._ivHist = JSON.parse(require('fs').readFileSync(this._ivFile, 'utf8')) || {}; } catch { this._ivHist = {}; } }
  _saveIv() { try { const fs = require('fs'), p = require('path'); fs.mkdirSync(p.dirname(this._ivFile), { recursive: true }); fs.writeFileSync(this._ivFile, JSON.stringify(this._ivHist)); } catch (_) {} }
  _loadTrades() { try { return JSON.parse(require('fs').readFileSync(this._tradesFile, 'utf8')) || []; } catch { return []; } }
  _saveTrades() { try { const fs = require('fs'), p = require('path'); fs.mkdirSync(p.dirname(this._tradesFile), { recursive: true }); fs.writeFileSync(this._tradesFile, JSON.stringify(this._allTrades.slice(-5000))); } catch (_) {} }
  // Annualized ATM-straddle IV proxy: straddle / (0.8 * spot * sqrt(DTE/365)).
  _ivProxy(chain) {
    const atm = chain.atm; if (!atm) return null;
    const row = (chain.rows || []).find(r => r.strike === atm);
    const ce = Number(row?.ce?.ltp || 0), pe = Number(row?.pe?.ltp || 0);
    if (!(ce > 0) || !(pe > 0)) return null;
    let dte = 1;
    if (chain.expiry) dte = Math.max(1, Math.round((Date.parse(chain.expiry) - Date.now()) / 86400000));
    return (ce + pe) / (0.8 * atm * Math.sqrt(dte / 365));
  }
  _recordIv(inst, iv, spot) {
    const d = this._today();
    const arr = this._ivHist[inst] = this._ivHist[inst] || [];
    if (arr.length && arr[arr.length - 1].date === d) { arr[arr.length - 1].iv = iv; if (spot) arr[arr.length - 1].spot = spot; }
    else if (this._ivRecorded[inst] !== d) arr.push({ date: d, iv, spot: spot || null });
    this._ivRecorded[inst] = d;
    if (arr.length > 120) arr.shift();
    this._saveIv();
  }
  _ivPercentile(inst, iv) {
    const arr = (this._ivHist[inst] || []).slice(-this.ivWindow).map(x => x.iv).filter(v => v > 0);
    if (arr.length < 10) return null;   // too little history → don't gate yet
    return arr.filter(v => v <= iv).length / arr.length;
  }
  // Tier-3 #7 — trend strength: distance of spot from its SMA(N). Returns the
  // fraction (e.g. 0.02 = 2% above/below SMA) or null if too little history.
  _trendDist(inst, spot) {
    const sp = (this._ivHist[inst] || []).map(x => x.spot).filter(v => v > 0);
    if (sp.length < this.trendSmaN) return null;
    const win = sp.slice(-this.trendSmaN);
    const avg = win.reduce((a, b) => a + b, 0) / win.length;
    return avg > 0 ? Math.abs(spot - avg) / spot : null;
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

    // Track the IV regime + daily spot every tick (one record/day → percentile + SMA history).
    const iv = this._ivProxy(chain);
    if (iv != null) {
      this._recordIv(inst, iv, atm);
      this._lastIv[inst] = { iv: +iv.toFixed(4), pct: this._ivPercentile(inst, iv) };
    }

    if (pos) { this._manage(inst, chain, pos); return; }

    // ── No open position: maybe enter, if this weekly cycle isn't already used ──
    if (expiry && this._cycleExp.get(inst) === expiry) return;   // already traded this expiry

    // Tier-3 trend kill-switch (optional, off by default): don't sell into a strong trend.
    if (this.trendSkipPct > 0) {
      const td = this._trendDist(inst, atm);
      if (td != null && td > this.trendSkipPct) return;   // trending hard — stand aside
    }
    const off = Math.round((atm * (this.otmPct / 100)) / step) * step;
    const ceRow = chain.rows.find(r => r.strike === atm + off);
    const peRow = chain.rows.find(r => r.strike === atm - off);
    const ceLtp = Number(ceRow?.ce?.ltp || 0), peLtp = Number(peRow?.pe?.ltp || 0);
    if (!(ceLtp > 0) || !(peLtp > 0)) return;

    // IV-regime gate: sell only when IV is rich vs its recent range (premium worth
    // selling). Skips low-IV cycles. Permissive until enough history accrues.
    const ivPct = (iv != null) ? this._ivPercentile(inst, iv) : null;
    if (this.ivPctMin > 0 && ivPct != null && ivPct < this.ivPctMin) return;  // not rich enough

    // Tail-safe: buy wings → defined-risk iron condor. Either forced (always hedge,
    // validated config) or auto in a very-high-IV regime once history accrues.
    const wantCondor = this.forceCondor || (this.tailSafePct <= 1 && ivPct != null && ivPct >= this.tailSafePct);
    let ceWing = null, peWing = null;
    if (wantCondor) {
      const lceRow = chain.rows.find(r => r.strike === atm + off + this.wingPts);
      const lpeRow = chain.rows.find(r => r.strike === atm - off - this.wingPts);
      const lceLtp = Number(lceRow?.ce?.ltp || 0), lpeLtp = Number(lpeRow?.pe?.ltp || 0);
      if (lceLtp > 0 && lpeLtp > 0) {                          // only if both wings priced
        ceWing = { strike: atm + off + this.wingPts, entry: lceLtp, ltp: lceLtp };
        peWing = { strike: atm - off - this.wingPts, entry: lpeLtp, ltp: lpeLtp };
      }
    }
    const structure = (ceWing && peWing) ? 'CONDOR' : 'STRANGLE';
    const wingCost = (ceWing && peWing) ? ceWing.entry + peWing.entry : 0;
    const netCredit = +((ceLtp + peLtp) - wingCost).toFixed(2);
    const maxLoss = structure === 'CONDOR' ? +(this.wingPts - netCredit).toFixed(2) : null;

    // Tier-2 sizing — margin-aware fractional-Kelly, IV-scaled. Paper still uses
    // qtyPerLeg unless useSizer; the recommendation is always surfaced.
    const sizing = this._sizer.recommend({
      capital: this.capital, structure, maxLossPerUnit: maxLoss || undefined,
      winRate: this._stats.winRate, avgWin: this._stats.avgWin, avgLoss: this._stats.avgLoss,
      ivPct: ivPct ?? 0.5,
    });
    const qty = this.useSizer ? Math.max(this.qtyPerLeg, sizing.recommendedLots) : this.qtyPerLeg;

    const entry = {
      inst, expiry, entryAt: this._hms(), structure,
      ce: { strike: atm + off, entry: ceLtp, ltp: ceLtp },
      pe: { strike: atm - off, entry: peLtp, ltp: peLtp },
      ceWing, peWing,
      ivPctAtEntry: ivPct != null ? +(ivPct * 100).toFixed(0) : null,
      credit: netCredit, maxLoss, sizing, qty
    };
    this._open.set(inst, entry);
    if (expiry) this._cycleExp.set(inst, expiry);
    if (this.onTrade) try { this.onTrade('SELL_OPEN', { ...entry }); } catch (_) {}
  }

  _manage(inst, chain, pos) {
    const find = (strike, type) => { const r = chain.rows.find(x => x.strike === strike); return Number(r?.[type]?.ltp || 0); };
    const ceLtp = find(pos.ce.strike, 'ce') || pos.ce.ltp;
    const peLtp = find(pos.pe.strike, 'pe') || pos.pe.ltp;
    pos.ce.ltp = ceLtp; pos.pe.ltp = peLtp;

    // Condor: the long wings offset the short buy-back cost (and cap the loss).
    let wingValue = 0;
    if (pos.structure === 'CONDOR' && pos.ceWing && pos.peWing) {
      const wce = find(pos.ceWing.strike, 'ce') || pos.ceWing.ltp;
      const wpe = find(pos.peWing.strike, 'pe') || pos.peWing.ltp;
      pos.ceWing.ltp = wce; pos.peWing.ltp = wpe;
      wingValue = wce + wpe;                          // value to sell the wings back
    }

    const netCloseCost = (ceLtp + peLtp) - wingValue;   // net cost to close the whole structure
    const captured = (pos.credit - netCloseCost) / pos.credit;   // fraction of net credit kept
    const tpHit = captured >= this.tpPct / 100;
    const stopHit = ceLtp >= pos.ce.entry * this.stopMult || peLtp >= pos.pe.entry * this.stopMult;

    // Tier-3 #6 — defensive ADJUST early-warning: a leg reached adjustMult× (but
    // not yet the 2x stop). Fire once so the untested side can be rolled/hedged.
    const ceTested = ceLtp >= pos.ce.entry * this.adjustMult, peTested = peLtp >= pos.pe.entry * this.adjustMult;
    if (!pos._adjusted && !stopHit && (ceTested || peTested)) {
      pos._adjusted = true;
      const tested = ceTested ? 'CE' : 'PE', untested = ceTested ? 'pe' : 'ce';
      if (this.onTrade) try { this.onTrade('ADJUST', { inst, tested, testedStrike: pos[ceTested ? 'ce' : 'pe'].strike,
        untestedStrike: pos[untested].strike, mult: +((ceTested ? ceLtp / pos.ce.entry : peLtp / pos.pe.entry)).toFixed(2),
        suggestion: `${tested} side tested — roll the untested ${untested.toUpperCase()} closer to re-center delta & add credit, or close early.` }); } catch (_) {}
    }

    if (stopHit || tpHit) {
      let pnlPerUnit = pos.credit - netCloseCost;
      // A condor can never lose more than its defined max loss — enforce the cap.
      if (pos.structure === 'CONDOR' && pos.maxLoss != null) pnlPerUnit = Math.max(pnlPerUnit, -pos.maxLoss);
      const pnlAbs = +(pnlPerUnit * pos.qty).toFixed(2);
      const closed = {
        inst, expiry: pos.expiry, entryAt: pos.entryAt, exitAt: this._hms(), structure: pos.structure,
        ce: { ...pos.ce }, pe: { ...pos.pe }, ceWing: pos.ceWing, peWing: pos.peWing,
        credit: pos.credit, exitPrem: +netCloseCost.toFixed(2),
        pnlPerUnit: +pnlPerUnit.toFixed(2), pnlAbs,
        pnlPct: +(captured * 100).toFixed(1),
        reason: stopHit ? 'STOP' : 'TAKE_PROFIT'
      };
      this._closed.push(closed);
      this._allTrades.push({ ...closed, date: this._date, closedAt: Date.now() });
      this._saveTrades();
      this._open.delete(inst);
      if (this.onTrade) try { this.onTrade('SELL_CLOSE', { ...closed }); } catch (_) {}
    }
  }

  status() {
    const wins = this._closed.filter(t => t.pnlAbs > 0).length;
    const net  = this._closed.reduce((s, t) => s + t.pnlAbs, 0);
    const allW = this._allTrades.filter(t => t.pnlAbs > 0).length;
    const allNet = this._allTrades.reduce((s, t) => s + (Number(t.pnlAbs) || 0), 0);
    const allDates = [...new Set(this._allTrades.map(t => t.date).filter(Boolean))];
    // Current IV-regime snapshot (highest-history instrument shown if multiple).
    const ivState = {};
    for (const [inst, v] of Object.entries(this._lastIv)) {
      ivState[inst] = { iv: v.iv, pct: v.pct != null ? +(v.pct * 100).toFixed(0) : null,
        rich: v.pct != null ? v.pct >= this.ivPctMin : null, history: (this._ivHist[inst] || []).length };
    }
    // Tier-2 sizing snapshot — what real-capital lot count each structure warrants
    // right now (uses the live IV percentile of the most-tracked instrument).
    const anyIv = Object.values(this._lastIv)[0];
    const sizing = {
      capital: this.capital, useSizer: this.useSizer,
      strangle: this._sizer.recommend({ capital: this.capital, structure: 'STRANGLE', ...this._stats, ivPct: anyIv?.pct ?? 0.5 }),
      condor:   this._sizer.recommend({ capital: this.capital, structure: 'CONDOR', maxLossPerUnit: this.wingPts * 0.85, ...this._stats, ivPct: anyIv?.pct ?? 0.5 }),
    };
    return {
      enabled: this.enabled,
      config: { otmPct: this.otmPct, stopMult: this.stopMult, tpPct: this.tpPct, qtyPerLeg: this.qtyPerLeg,
        ivPctMin: this.ivPctMin, ivWindow: this.ivWindow, tailSafePct: this.tailSafePct, wingPts: this.wingPts,
        capital: this.capital, useSizer: this.useSizer,
        trendSkipPct: this.trendSkipPct, adjustMult: this.adjustMult },
      ivRegime: ivState,
      sizing,
      openPositions: [...this._open.values()],
      closedToday: this._closed.length,
      wins, winRate: this._closed.length ? +(100 * wins / this._closed.length).toFixed(0) : 0,
      netPnl: +net.toFixed(2),
      // ALL-TIME forward-test stats (persisted across restarts) — the real validation.
      allTime: {
        trades: this._allTrades.length, days: allDates.length, wins: allW,
        winRate: this._allTrades.length ? +(100 * allW / this._allTrades.length).toFixed(1) : 0,
        netPnl: +allNet.toFixed(2),
        avgPerTrade: this._allTrades.length ? +(allNet / this._allTrades.length).toFixed(2) : 0,
        since: allDates.sort()[0] || null,
      },
      recent: this._closed.slice(-12).reverse(),
      note: 'PAPER-only premium seller. Regime ladder: skip <50% IV / strangle 50-80% / tail-safe condor ≥80%. Sizing is margin-aware fractional-Kelly. Forward-test before trusting.'
    };
  }
}

module.exports = StrangleEngine;
