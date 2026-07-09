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
 *
 * ── MIGRATION C1 (2026-07-09): P&L CALCULATION v2 ──────────────────────────
 * DEFECT (v1): closed-trade P&L was `pnlPerUnit × qty`, where `qty` is LOTS. It
 *   omitted the contract multiplier (lotSize) entirely, and applied ZERO transaction
 *   costs — unlike every other engine (gamma-blast-engine.js:116-118,
 *   agents-engine.js:522-525) which compute `units = qty × lot` and subtract
 *   `roundTripCharges(...)`. Strangle ₹P&L was therefore understated ~65×/30×/20×
 *   and reported GROSS, making it non-comparable to the engines sharing the dashboard.
 *
 * FIX (v2): pnl = (pnlPerUnit × qty × lotSize) − charges, where lotSize comes from
 *   instrument-registry.js (broker contract master, not a hardcoded guess) and charges
 *   use the SAME per-leg method as agents-engine._closeCondor.
 *
 * LEGACY PRESERVATION (approved migration Option A):
 *   • Historical records in data/strangle-trades.json are NEVER rewritten.
 *   • Existing records carry no `calcVersion` and are therefore v1 by definition.
 *   • New records carry `calcVersion: 2`, the corrected `pnlAbs`, AND `pnlAbsLegacy`
 *     (exactly what v1 would have produced) plus `gross`, `charges`, `lot`, `units`.
 *   • status().allTime.calc splits legacy vs current so every report can label them.
 *   • Every v2 close appends to data/migrations/C1-strangle-pnl.jsonl.
 *
 * KNOWN LIMITATION (engine-wide, not introduced here): `charges.roundTripCharges` is
 *   modelled for a LONG option (STT on the sell leg, stamp on the buy leg). For a SHORT
 *   structure the open leg is the sell. We deliberately reuse the exact per-leg method
 *   agents-engine already uses so the engines stay comparable; correcting the STT/stamp
 *   side is a separate, engine-wide change.
 */
const { roundTripCharges } = require('./charges.js');
const instrumentRegistry = require('./instrument-registry.js');

// Human-readable calculation-method labels recorded on every trade + report.
const PNL_CALC_V1 = 'v1-legacy: pnlPerUnit × lots (NO lot multiplier, NO charges)';
const PNL_CALC_V2 = 'v2: (pnlPerUnit × lots × lotSize) − per-leg roundTripCharges';
const PNL_CALC_V1_FALLBACK = 'v1-fallback: lot size unknown for instrument — legacy math retained and flagged';

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

    // Forward-test logger: if FORWARD_TEST_DATE_FROM is set, isolates trades
    // from that date onward into a separate shard (data/forward-test/{date}-*.jsonl/json)
    // for independent validation before live approval.
    //
    // MIGRATION C1a (2026-07-09): forward-test-logger.js exports a CLASS. This line
    // previously assigned the constructor itself, so `_ftLogger.status()` threw
    // (TypeError → HTTP 500 on GET /api/strangle/status) and `_ftLogger.logTrade()`
    // threw into a silent catch, meaning no strangle trade was ever written to the
    // forward-test shard. Instantiate it. Constructing is side-effect-free unless
    // FORWARD_TEST_DATE_FROM is set.
    const ForwardTestLogger = require('./forward-test-logger.js');
    this._ftLogger = new ForwardTestLogger();
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

  // ── MIGRATION C1 helpers ───────────────────────────────────────────────────
  /**
   * Round-trip transaction cost for the whole short structure.
   * Each leg pays its own round trip on (entry, exit) premium — the identical method
   * agents-engine._closeCondor uses (agents-engine.js:596-601), so the two engines'
   * ₹ figures remain directly comparable. Floor at 0.05 so a leg that decays to zero
   * still pays brokerage rather than vanishing from the cost model.
   */
  _structureCharges(pos, units) {
    const legs = [pos.ce, pos.pe];
    if (pos.structure === 'CONDOR' && pos.ceWing && pos.peWing) legs.push(pos.ceWing, pos.peWing);
    const total = legs.reduce((s, l) => {
      const entry = Math.max(0.05, Number(l && l.entry) || 0);
      const exit = Math.max(0.05, Number(l && l.ltp) || Number(l && l.entry) || 0);
      return s + roundTripCharges(entry, exit, units).total;
    }, 0);
    return +total.toFixed(2);
  }

  /** Append one immutable line to the C1 migration log. Never throws. */
  _logMigration(rec) {
    try {
      const fs = require('fs'), p = require('path');
      const dir = p.join(__dirname, 'data', 'migrations');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(p.join(dir, 'C1-strangle-pnl.jsonl'), JSON.stringify(rec) + '\n');
    } catch (_) { /* logging must never break a trade close */ }
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
      inst,                                    // C1c-5: the sizer resolves the lot from the registry
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

      // ── MIGRATION C1: P&L v2 ────────────────────────────────────────────────
      const qty = Number(pos.qty) || 1;                       // lots
      // exactly what v1 produced — preserved on every record, never recomputed later
      const pnlAbsLegacy = +(pnlPerUnit * qty).toFixed(2);
      const lot = instrumentRegistry.lotSize(inst);

      let pnlAbs, gross, charges, units, calcVersion, calcMethod;
      if (lot) {
        units = qty * lot;
        gross = +(pnlPerUnit * units).toFixed(2);
        charges = this._structureCharges(pos, units);
        pnlAbs = +(gross - charges).toFixed(2);
        calcVersion = 2; calcMethod = PNL_CALC_V2;
      } else {
        // Unknown instrument → we do NOT guess a lot size. Keep legacy math and say so.
        units = qty; gross = pnlAbsLegacy; charges = 0;
        pnlAbs = pnlAbsLegacy;
        calcVersion = 1; calcMethod = PNL_CALC_V1_FALLBACK;
      }

      const closed = {
        inst, expiry: pos.expiry, entryAt: pos.entryAt, exitAt: this._hms(), structure: pos.structure,
        ce: { ...pos.ce }, pe: { ...pos.pe }, ceWing: pos.ceWing, peWing: pos.peWing,
        credit: pos.credit, exitPrem: +netCloseCost.toFixed(2),
        pnlPerUnit: +pnlPerUnit.toFixed(2), pnlAbs,
        pnlPct: +(captured * 100).toFixed(1),
        reason: stopHit ? 'STOP' : 'TAKE_PROFIT',
        // v2 additive fields (absent on historical v1 records — readers must tolerate)
        qty, lot: lot ?? null, units, gross, charges,
        pnlAbsLegacy, calcVersion, calcMethod,
      };

      this._logMigration({
        ts: new Date().toISOString(), migration: 'C1-strangle-pnl',
        inst, structure: pos.structure, expiry: pos.expiry, reasonForExit: closed.reason,
        legacyPnl: pnlAbsLegacy, newPnl: pnlAbs,
        gross, charges, qty, lot: lot ?? null, units,
        calculationMethod: calcMethod, calcVersion,
        reasonForChange: 'v1 omitted the contract lot multiplier and all transaction costs; v2 applies broker-verified lotSize and per-leg roundTripCharges (see strangle-engine.js header).',
      });

      this._closed.push(closed);
      this._allTrades.push({ ...closed, date: this._date, closedAt: Date.now() });
      this._saveTrades();
      // Log to forward-test shard if enabled
      const tradeWithDate = { ...closed, date: this._date, closedAt: Date.now() };
      try { this._ftLogger.logTrade(tradeWithDate); } catch (_) {}
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
    // ── MIGRATION C1: label every reported figure as legacy or current ──
    // Records written before the migration carry no `calcVersion` → v1 by definition.
    const sumPnl = arr => +arr.reduce((s, t) => s + (Number(t.pnlAbs) || 0), 0).toFixed(2);
    const v2Trades = this._allTrades.filter(t => t.calcVersion === 2);
    const v1Trades = this._allTrades.filter(t => t.calcVersion !== 2);
    const calcBreakdown = {
      mixed: v1Trades.length > 0 && v2Trades.length > 0,
      legacy:  { trades: v1Trades.length, netPnl: sumPnl(v1Trades), method: PNL_CALC_V1 },
      current: { trades: v2Trades.length, netPnl: sumPnl(v2Trades), method: PNL_CALC_V2,
                 grossPnl: +v2Trades.reduce((s, t) => s + (Number(t.gross) || 0), 0).toFixed(2),
                 charges:  +v2Trades.reduce((s, t) => s + (Number(t.charges) || 0), 0).toFixed(2) },
      note: 'allTime.netPnl is the raw sum of pnlAbs across BOTH calculation versions and is therefore mixed while `mixed` is true. Legacy trades are pre-migration-C1 records (no lot multiplier, gross of costs) and are preserved unmodified. Compare like-for-like using calc.current only.',
    };
    // Current IV-regime snapshot (highest-history instrument shown if multiple).
    const ivState = {};
    for (const [inst, v] of Object.entries(this._lastIv)) {
      ivState[inst] = { iv: v.iv, pct: v.pct != null ? +(v.pct * 100).toFixed(0) : null,
        rich: v.pct != null ? v.pct >= this.ivPctMin : null, history: (this._ivHist[inst] || []).length };
    }
    // Tier-2 sizing snapshot — what real-capital lot count each structure warrants
    // right now (uses the live IV percentile of the most-tracked instrument).
    const anyIv = Object.values(this._lastIv)[0];
    // C1c-5: the snapshot must name the instrument it is sizing for. Use the most-tracked
    // one rather than defaulting to a guessed 'NIFTY'. With no tracked instrument yet the
    // condor sizer refuses, and says why, instead of inventing a lot size.
    const anyInst = Object.keys(this._lastIv)[0] || null;
    const sizing = {
      capital: this.capital, useSizer: this.useSizer, inst: anyInst,
      strangle: this._sizer.recommend({ inst: anyInst, capital: this.capital, structure: 'STRANGLE', ...this._stats, ivPct: anyIv?.pct ?? 0.5 }),
      condor:   this._sizer.recommend({ inst: anyInst, capital: this.capital, structure: 'CONDOR', maxLossPerUnit: this.wingPts * 0.85, ...this._stats, ivPct: anyIv?.pct ?? 0.5 }),
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
        calc: calcBreakdown,
      },
      pnlCalcVersion: 2,
      pnlCalcMethod: PNL_CALC_V2,
      recent: this._closed.slice(-12).reverse(),
      forwardTest: this._ftLogger.status(),
      note: 'PAPER-only premium seller. Regime ladder: skip <50% IV / strangle 50-80% / tail-safe condor ≥80%. Sizing is margin-aware fractional-Kelly. Forward-test before trusting. P&L v2 (migration C1) applies the broker-verified lot multiplier and per-leg transaction costs; pre-migration trades are preserved as legacy — see allTime.calc.'
    };
  }
}

module.exports = StrangleEngine;
