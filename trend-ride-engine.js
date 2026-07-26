/**
 * TREND-RIDE ENGINE — "premium ~15 → 100-pt trend ride" paper forward-test.
 *
 * WHY THIS EXISTS (evidence, not vibes — see docs/STRATEGY-PREM15-RIDE-POC.md):
 *   The user's idea: after the index makes a >=triggerPts directional move out of
 *   a coiled range, buy the trend-side option whose premium is ~15 and ride it.
 *   • The raw idea with a TRAILING exit is a net LOSER (1816 real events, PF 0.84).
 *   • The FIX that survives OUT-OF-SAMPLE (train 70% / test 30%) is an ASYMMETRIC
 *     FIXED BRACKET on the UNDERLYING: big target, tight stop. Held OOS on both
 *     indices (NIFTY tgt+60/stop-30 → test PF 1.34; BANKNIFTY 150/+130/-80 → 1.14).
 *   • BUT those are GROSS INDEX POINTS. A ~15-premium leg captures only ~0.4-0.5×
 *     and pays theta + spread, so the OPTION net after costs is UNKNOWN.
 *
 * So this engine forward-tests the honest open question: does the validated
 * underlying bracket edge survive once expressed as a real option leg with real
 * premium behaviour and charges?
 *
 *   Entry  : index moved >= triggerPts in `lookbackMin` out of a coiled range →
 *            BUY the trend-side (CE up / PE down) strike whose live premium is in
 *            [entryLo, entryHi] (~15), closest to 15.
 *   Manage : exit is driven by the UNDERLYING bracket (the validated signal):
 *            +targetPts → TARGET, -stopPts → STOP, plus daily square-off. P&L is
 *            RECORDED on the actual option premium (entry ltp → exit ltp) — that
 *            is the forward-test evidence.
 *
 * ⚠️ PAPER FORWARD-TEST ONLY. Off by default (TREND_RIDE_ENABLED). Never places a
 * live order. Directional buying is asymmetric (low win-rate, reward:risk edge) —
 * judge on net expectancy over MANY days, never win-rate. Wire a live path only on
 * explicit instruction.
 */
const { roundTripCharges } = require('./charges.js');
const instrumentRegistry = require('./instrument-registry.js');
const safeWrite = require('./safe-write.js');
const lotOf = (inst) => instrumentRegistry.lotSize(inst);   // null when unknown — never guess
const LOT_SOURCE_REGISTRY = 'instrument-registry';

const hhmm = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + b; };
const N = (v, d) => (v != null && v !== '' ? parseFloat(v) : d);

// Per-instrument validated defaults (docs/STRATEGY-PREM15-RIDE-POC.md §10, OOS survivors).
const DEFAULTS = {
  NIFTY:     { trigger: 100, preRange: 60,  target: 60,  stop: 30 },
  BANKNIFTY: { trigger: 150, preRange: 120, target: 130, stop: 80 },
  SENSEX:    { trigger: 150, preRange: 120, target: 130, stop: 80 },   // BANKNIFTY-like scale; unproven, forward-test
};

class TrendRideEngine {
  constructor(cfg = {}) {
    this.enabled   = String(cfg.enabled ?? process.env.TREND_RIDE_ENABLED ?? 'false').toLowerCase() === 'true';
    this.entryLo   = N(cfg.entryLo ?? process.env.TR_ENTRY_LO, 13);
    this.entryHi   = N(cfg.entryHi ?? process.env.TR_ENTRY_HI, 17);
    this.lookbackMin = N(cfg.lookbackMin ?? process.env.TR_LOOKBACK_MIN, 15);
    this.qty       = parseInt(cfg.qty ?? process.env.TR_QTY ?? 1);
    this.squareOffMins = hhmm(cfg.squareOff ?? process.env.TR_SQUAREOFF ?? '15:15');
    this.maxTradesPerDay = parseInt(cfg.maxTradesPerDay ?? process.env.TR_MAX_TRADES ?? 2);
    // ── REGIME GATES — address the two measured failure modes (docs §11) ──────────
    //   (1) counter-trend fades: NIFTY PUT lost −312 in a rising market. Trade only
    //       WITH the broader trend: SMA(trendMaMin) of spot, CE above / PE below.
    //   (2) chop / sideways: most losers were mean-reversion. Kaufman EFFICIENCY
    //       RATIO over erWindowMin (net move / path length) — high = clean trend,
    //       low = choppy → skip. Both self-contained from the spot buffer, toggleable.
    this.trendFilter = String(cfg.trendFilter ?? process.env.TR_TREND_FILTER ?? 'true').toLowerCase() === 'true';
    // 60-min SMA, NOT 30: a 30-min reference is dragged BELOW/ABOVE itself by the very
    // 15-min impulse we trade, so it green-lights counter-trend fades. 60 min is long
    // enough to stay put — validated: NIFTY PF 1.36→1.59, BANKNIFTY 1.15→1.24 (holds OOS).
    this.trendMaMin  = N(cfg.trendMaMin ?? process.env.TR_TREND_MA_MIN, 60);
    this.chopFilter  = String(cfg.chopFilter ?? process.env.TR_CHOP_FILTER ?? 'true').toLowerCase() === 'true';
    this.erWindowMin = N(cfg.erWindowMin ?? process.env.TR_ER_WIN_MIN, 15);
    this.minER       = N(cfg.minER ?? process.env.TR_MIN_ER, 0.35);   // >= this = trending; below = chop
    this._bufMin = Math.max(this.lookbackMin, this.trendMaMin, this.erWindowMin) + 5;
    // per-instrument knobs (env overrides the validated default per inst, e.g. TR_TARGET_NIFTY)
    this.params = {};
    for (const inst of Object.keys(DEFAULTS)) {
      const d = DEFAULTS[inst];
      this.params[inst] = {
        trigger:  N(process.env[`TR_TRIG_${inst}`],   d.trigger),
        preRange: N(process.env[`TR_PRERANGE_${inst}`], d.preRange),
        target:   N(process.env[`TR_TARGET_${inst}`], d.target),
        stop:     N(process.env[`TR_STOP_${inst}`],   d.stop),
      };
    }

    this._open   = new Map();   // inst -> open position
    this._closed = [];          // closed trades today
    this._spotHist = {};        // inst -> [{t,v}]
    this._tradesToday = {};     // inst -> count today
    this._lastSignal = {};      // inst -> last entry-scan snapshot (for status)
    this._day = null;
    this._tradesFile = require('path').join(__dirname, 'data', 'trend-ride-trades.json');
    this._allTrades = this._loadTrades();
    this.onTrade = null;        // (event, data) => void   event 'open' | 'close'
  }

  // ── persistence (atomic + fail-closed; this ledger is the whole experiment) ──
  _loadTrades() {
    this._ledgerCorrupt = false;
    try {
      const rows = safeWrite.readJsonSync(this._tradesFile, {
        fallback: [],
        onRecover: (reason, bak) => console.warn(`[trend-ride] trade ledger was corrupt (${reason}); recovered from ${bak}.`),
      });
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      this._ledgerCorrupt = true;
      console.error(`[trend-ride] TRADE LEDGER UNRECOVERABLE: ${e.message} — saving DISABLED, file untouched.`);
      return [];
    }
  }
  _saveTrades() {
    if (this._ledgerCorrupt) return;
    try { safeWrite.writeJsonSync(this._tradesFile, this._allTrades.slice(-5000), { backup: true }); }
    catch (e) { console.error(`[trend-ride] trade ledger save failed: ${e.message}`); }
  }

  _ist() { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return { date: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  _resetIfNewDay(date) { if (this._day !== date) { this._day = date; this._tradesToday = {}; this._closed = []; this._spotHist = {}; } }

  // Reduce the 5s tick buffer to ONE close per IST minute over the last `mins` minutes.
  // (Trend SMA + efficiency ratio run on a 1-min basis — matches the backtest and
  //  removes 5s tick-noise that would otherwise depress the efficiency ratio.)
  _minuteCloses(hist, now, mins) {
    const since = now - mins * 60000;
    const perMin = new Map();
    for (const x of hist) { if (x.t < since) continue; perMin.set(Math.floor(x.t / 60000), x.v); }
    return [...perMin.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  }

  // Feed the live chain. feed = { spot, atm, interval, expiry, rows:[{strike,ce,pe}] }
  update(inst, feed) {
    if (!this.enabled || !feed || !feed.rows || !feed.rows.length) return;
    inst = String(inst).toUpperCase();
    const p = this.params[inst];
    if (!p) return;                                    // unknown instrument → skip
    const { date: istDate, mins: istMins } = this._ist();
    this._resetIfNewDay(istDate);

    const spot = Number(feed.spot ?? feed.atm);
    if (!(spot > 0)) return;
    const now = Date.now();
    const hist = this._spotHist[inst] = this._spotHist[inst] || [];
    hist.push({ t: now, v: spot });
    const cut = now - this._bufMin * 60000;
    while (hist.length && hist[0].t < cut) hist.shift();

    const pos = this._open.get(inst);
    if (pos) { this._manage(inst, pos, feed.rows, spot, istMins); return; }

    // ── ENTRY SCAN ──
    const past = hist.find(x => x.t <= now - this.lookbackMin * 60000) || hist[0];
    const move = spot - past.v;
    let lo = Infinity, hi = -Infinity;
    for (const x of hist) { if (x.v < lo) lo = x.v; if (x.v > hi) hi = x.v; }
    const range = hi - lo;
    const coiled = range <= p.preRange + p.trigger;
    const dir = move >= p.trigger ? 1 : move <= -p.trigger ? -1 : 0;

    // ── FILTER 1: trend alignment — trade only WITH the broader trend (SMA of spot) ──
    const maSeries = this._minuteCloses(hist, now, this.trendMaMin);
    const enoughTrend = maSeries.length >= 5;
    const ma = enoughTrend ? maSeries.reduce((a, v) => a + v, 0) / maSeries.length : null;
    const trendOk = !this.trendFilter ? true
                  : !enoughTrend ? false                       // not enough history yet → don't fade blindly
                  : (dir > 0 ? spot > ma : spot < ma);

    // ── FILTER 2: chop / sideways — Kaufman efficiency ratio (net move / path length) ──
    const erSeries = this._minuteCloses(hist, now, this.erWindowMin);
    let er = 0;
    if (erSeries.length >= 5) {
      const net = Math.abs(erSeries[erSeries.length - 1] - erSeries[0]);
      let pathLen = 0; for (let k = 1; k < erSeries.length; k++) pathLen += Math.abs(erSeries[k] - erSeries[k - 1]);
      er = pathLen > 0 ? net / pathLen : 0;
    }
    const chopOk = !this.chopFilter ? true : (erSeries.length >= 5 && er >= this.minER);

    this._lastSignal[inst] = { spot: +spot.toFixed(2), move: +move.toFixed(1), range: +range.toFixed(1),
      trigger: p.trigger, coiled, dir, ma: ma != null ? +ma.toFixed(1) : null, trendOk,
      er: +er.toFixed(2), minER: this.minER, chopOk, tradesToday: this._tradesToday[inst] || 0 };

    if (!dir || !coiled) return;
    if (!trendOk) return;                                      // counter-trend / unknown trend → skip
    if (!chopOk) return;                                       // sideways / choppy regime → skip
    if (istMins >= this.squareOffMins) return;
    if ((this._tradesToday[inst] || 0) >= this.maxTradesPerDay) return;

    // pick the trend-side leg whose premium is ~15 (closest to 15 inside the band)
    const side = dir > 0 ? 'CE' : 'PE';
    let best = null;
    for (const r of feed.rows) {
      const ltp = Number(side === 'CE' ? r.ce?.ltp : r.pe?.ltp);
      if (!(ltp >= this.entryLo && ltp <= this.entryHi)) continue;
      const d = Math.abs(ltp - 15);
      if (!best || d < best.d) best = { strike: Number(r.strike), ltp, d };
    }
    if (!best) return;

    const lot = lotOf(inst);
    if (!lot) return;                                  // unknown contract size → refuse, never guess
    const position = {
      inst, side, strike: best.strike, entry: +best.ltp.toFixed(2), last: best.ltp,
      entrySpot: +spot.toFixed(2), dir, qty: this.qty, lot, lotSource: LOT_SOURCE_REGISTRY, calcVersion: 2,
      target: p.target, stop: p.stop, openMins: istMins, expiry: feed.expiry, entryMove: +move.toFixed(1),
    };
    this._open.set(inst, position);
    this._tradesToday[inst] = (this._tradesToday[inst] || 0) + 1;
    if (this.onTrade) try { this.onTrade('open', position); } catch (e) { console.error(`[trend-ride] onTrade(open) hook failed: ${e.message}`); }
  }

  _manage(inst, pos, rows, spot, istMins) {
    const row = rows.find(r => Number(r.strike) === pos.strike) || {};
    const cur = Number(pos.side === 'CE' ? row.ce?.ltp : row.pe?.ltp);
    if (cur > 0) pos.last = cur;
    // EXIT is driven by the validated UNDERLYING bracket (index points from entry spot)
    const moveInDir = pos.dir > 0 ? (spot - pos.entrySpot) : (pos.entrySpot - spot);
    pos.moveInDir = +moveInDir.toFixed(1);
    let reason = null;
    if (moveInDir >= pos.target) reason = 'TARGET';
    else if (moveInDir <= -pos.stop) reason = 'STOP';
    else if (istMins >= this.squareOffMins) reason = 'SQUARE_OFF';
    if (!reason) return;
    this._close(inst, pos, pos.last || pos.entry, reason, istMins, spot);
  }

  _close(inst, pos, exitLtp, reason, istMins, spot) {
    const units = pos.qty * pos.lot;
    const gross = (exitLtp - pos.entry) * units;       // long option: (exit-entry)×units
    const ch = roundTripCharges(pos.entry, exitLtp, units).total;
    const pnl = +(gross - ch).toFixed(2);
    const rec = {
      date: this._day, inst, side: pos.side, strike: pos.strike,
      entry: pos.entry, exit: +Number(exitLtp).toFixed(2), qty: pos.qty, lot: pos.lot,
      entrySpot: pos.entrySpot, exitSpot: +Number(spot).toFixed(2), spotMove: +((spot - pos.entrySpot)).toFixed(1),
      target: pos.target, stop: pos.stop, reason,
      pnl, pnlPct: +(((exitLtp - pos.entry) / pos.entry) * 100).toFixed(1), charges: +ch.toFixed(2),
      openMins: pos.openMins, closeMins: istMins, calcVersion: 2, lotSource: pos.lotSource,
    };
    this._open.delete(inst);
    this._closed.push(rec);
    this._allTrades.push(rec);
    this._saveTrades();
    if (this.onTrade) try { this.onTrade('close', rec); } catch (e) { console.error(`[trend-ride] onTrade(close) hook failed: ${e.message}`); }
  }

  _summary(trades) {
    const n = trades.length;
    const wins = trades.filter(t => t.pnl > 0).length;
    const net = trades.reduce((s, t) => s + t.pnl, 0);
    const gWin = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const gLoss = -trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
    return {
      trades: n, wins, winRate: n ? +((wins / n) * 100).toFixed(1) : 0,
      netPnl: +net.toFixed(0), avgPerTrade: n ? +(net / n).toFixed(0) : 0,
      profitFactor: gLoss > 0 ? +(gWin / gLoss).toFixed(2) : (gWin > 0 ? 99 : 0),
    };
  }

  status() {
    const open = [...this._open.values()].map(p => ({
      ...p, changePct: +(((p.last - p.entry) / p.entry) * 100).toFixed(1),
    }));
    return {
      enabled: this.enabled,
      config: { entryLo: this.entryLo, entryHi: this.entryHi, lookbackMin: this.lookbackMin,
        qty: this.qty, squareOff: this.squareOffMins, maxTradesPerDay: this.maxTradesPerDay,
        trendFilter: this.trendFilter, trendMaMin: this.trendMaMin,
        chopFilter: this.chopFilter, erWindowMin: this.erWindowMin, minER: this.minER, params: this.params },
      openPositions: open,
      today: this._summary(this._closed),
      allTime: { ...this._summary(this._allTrades), since: this._allTrades[0]?.date || null,
        days: new Set(this._allTrades.map(t => t.date)).size },
      lotSizes: Object.fromEntries(instrumentRegistry.instruments().map(i => [i, lotOf(i)])),
      recent: this._allTrades.slice(-15).reverse(),
      signal: this._lastSignal,
      note: 'PAPER forward-test. Entry: premium ~15 on a >=triggerPts coiled trend move. EXIT driven by the VALIDATED underlying bracket (target/stop in index points); P&L recorded on the real option leg. GROSS underlying edge held OOS; option-net after theta+spread is what this measures. Judge on net over many days, not win-rate.',
    };
  }
}

module.exports = TrendRideEngine;
module.exports.DEFAULTS = DEFAULTS;   // shared with bt-trend-ride.js so backtest == live params
