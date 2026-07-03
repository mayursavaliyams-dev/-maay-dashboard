/**
 * AI AGENTS ENGINE — Antigravity Pro · 5-agent pipeline
 *
 *   1. 📰 NEWS SCOUT     — watches the news feed for DEAL-class events
 *                          (M&A / order wins / results / regulatory / capital).
 *   2. 🎯 IMPACT ANALYST — per event: which stocks are hit, direction, and a
 *                          probability WITH its parameters disclosed (sentiment,
 *                          confidence, recency, event-type weight, source count)
 *                          + spillover peers + index (NIFTY/SENSEX) bias.
 *   3. 🧠 SIGNAL AGENT   — fuses the 11-factor master-signal verdict with the
 *                          news-impact index bias → per-index direction + prob.
 *   4. 🛡️ RISK MANAGER   — GO/NO-GO gate: market hours, probability floor, VIX
 *                          regime, event risk, trade caps, daily-loss stop.
 *   5. ⚡ EXECUTOR       — PAPER auto-trader: on GO, buys the ATM option of the
 *                          signal side at live LTP; books profit at +tp%, cuts
 *                          at -sl%, trails after a run-up, hard square-off.
 *
 * HONEST BY DESIGN: 100% paper (never places a live order). Impact probability
 * is a disclosed-parameter heuristic, not a promise. Directional option BUYING
 * backtested weak here (PF 0.94) — so the risk gate keeps the bar high
 * (probability floor + caps) and every trade is charged real round-trip costs.
 *
 * Pure where it matters: event detection / impact math / signal fusion / risk
 * gate are all pure functions (unit-testable). Only tick() touches live deps.
 */
'use strict';
const { roundTripCharges } = require('./charges.js');

const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };
const hhmm = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + b; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => +(+v).toFixed(d);

// ── event-type lexicon: what counts as a "deal" and how hard it usually hits ──
const EVENT_TYPES = [
  { type: 'M&A / STAKE',   w: 1.00, kws: ['acquire', 'acquisition', 'merger', 'stake buy', 'stake sale', 'takeover', 'buyout', 'demerger', 'delisting'] },
  { type: 'ORDER / DEAL',  w: 0.90, kws: ['order win', 'wins order', 'bags order', 'bags contract', 'contract worth', 'deal worth', 'deal win', 'mega deal', 'mou ', 'tie-up', 'partnership', 'joint venture', 'wins bid'] },
  { type: 'REGULATORY',    w: 0.85, kws: ['approval', 'approved', 'usfda', 'license', 'licence', 'patent', 'ban', 'penalty', 'probe', 'raid', 'show cause', 'gst notice'] },
  { type: 'CAPITAL',       w: 0.75, kws: ['buyback', 'dividend', 'bonus issue', 'stock split', 'fund raise', 'fundraise', 'qip', 'rights issue', 'block deal', 'ipo', 'preferential'] },
  { type: 'RESULTS',       w: 0.70, kws: ['q1 results', 'q2 results', 'q3 results', 'q4 results', 'quarterly results', 'net profit', 'revenue up', 'revenue fell', 'guidance', 'margin expansion', 'profit jumps', 'profit falls', 'loss widens'] },
];

// approx index weights (%) for bias math — heavyweights move the index, tails don't.
// BANKNIFTY is bank-only (HDFC/ICICI dominate ~50%); non-banks carry 0 weight there.
const INDEX_WEIGHT = {
  RELIANCE:  { NIFTY: 9.0, SENSEX: 11.5, BANKNIFTY: 0 }, HDFCBANK: { NIFTY: 11.0, SENSEX: 13.5, BANKNIFTY: 28 },
  ICICIBANK: { NIFTY: 8.0, SENSEX: 9.5, BANKNIFTY: 24 },  INFY: { NIFTY: 5.0, SENSEX: 6.5, BANKNIFTY: 0 },
  TCS: { NIFTY: 4.0, SENSEX: 5.0, BANKNIFTY: 0 },          ITC: { NIFTY: 3.5, SENSEX: 4.0, BANKNIFTY: 0 },
  BHARTIARTL: { NIFTY: 4.0, SENSEX: 4.5, BANKNIFTY: 0 },   LT: { NIFTY: 3.5, SENSEX: 4.0, BANKNIFTY: 0 },
  AXISBANK: { NIFTY: 3.0, SENSEX: 3.5, BANKNIFTY: 9 },     SBIN: { NIFTY: 3.0, SENSEX: 3.5, BANKNIFTY: 10 },
  KOTAKBANK: { NIFTY: 2.5, SENSEX: 3.0, BANKNIFTY: 9 },    HINDUNILVR: { NIFTY: 2.0, SENSEX: 2.5, BANKNIFTY: 0 },
  BAJFINANCE: { NIFTY: 2.0, SENSEX: 2.5, BANKNIFTY: 0 },   M_M: { NIFTY: 2.0, SENSEX: 2.5, BANKNIFTY: 0 },
  MARUTI: { NIFTY: 1.5, SENSEX: 2.0, BANKNIFTY: 0 },       TATAMOTORS: { NIFTY: 1.5, SENSEX: 1.5, BANKNIFTY: 0 },
  TITAN: { NIFTY: 1.5, SENSEX: 1.5, BANKNIFTY: 0 },        SUNPHARMA: { NIFTY: 1.5, SENSEX: 1.5, BANKNIFTY: 0 },
  NTPC: { NIFTY: 1.5, SENSEX: 1.5, BANKNIFTY: 0 },         ULTRACEMCO: { NIFTY: 1.2, SENSEX: 1.5, BANKNIFTY: 0 },
  INDUSINDBK: { NIFTY: 1.0, SENSEX: 0, BANKNIFTY: 6 },     BANKBARODA: { NIFTY: 0.8, SENSEX: 0, BANKNIFTY: 3 },
  PNB: { NIFTY: 0.5, SENSEX: 0, BANKNIFTY: 2 },            FEDERALBNK: { NIFTY: 0.5, SENSEX: 0, BANKNIFTY: 2 },
};
const INSTRUMENTS = ['NIFTY', 'SENSEX', 'BANKNIFTY'];
const idxWeight = (sym, idx) => (INDEX_WEIGHT[sym.replace('&', '_')] || {})[idx] != null ? (INDEX_WEIGHT[sym.replace('&', '_')] || {})[idx] : (idx === 'BANKNIFTY' ? 0 : 0.5);

// ── PURE: 1. detect deal-class events in news items ──────────────────────────
function detectDealEvents(items, opts = {}) {
  const maxAgeH = opts.maxAgeH || 24;
  const cut = (opts.now || Date.now()) - maxAgeH * 3600000;
  const out = [];
  for (const a of items || []) {
    if (!a || a.ts < cut) continue;
    const t = ' ' + String(a.title + ' ' + (a.summary || '')).toLowerCase() + ' ';
    let hit = null;
    for (const et of EVENT_TYPES) { if (et.kws.some(k => t.includes(k))) { hit = et; break; } }
    if (!hit) continue;
    out.push({
      id: a.id, title: a.title, url: a.url, source: a.sourceName || a.source, ts: a.ts,
      publishedAt: a.publishedAt, eventType: hit.type, eventWeight: hit.w,
      stocks: a.stocks || [], sectors: a.sectors || [],
      sentiment: a.sentiment || { score: 0, label: 'NEUTRAL', confidence: 35 },
      impactScore: a.impactScore || 0, sourceWeight: a.weight || 1,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

// ── PURE: 2. impact probability per event — parameters disclosed ─────────────
function computeImpact(ev, opts = {}) {
  const now = opts.now || Date.now();
  const ageH = Math.max(0, (now - ev.ts) / 3600000);
  const recency = ageH <= 1 ? 1 : ageH <= 4 ? 0.8 : ageH <= 12 ? 0.5 : 0.3;
  const sentStrength = Math.abs(ev.sentiment.score);           // 0..100
  const direction = ev.sentiment.score > 5 ? 'UP' : ev.sentiment.score < -5 ? 'DOWN' : 'FLAT';

  // probability that the named stock reacts in `direction` — heuristic, disclosed
  const params = {
    sentimentStrength: sentStrength,               // |lexicon score| 0-100
    sentimentConfidence: ev.sentiment.confidence,  // lexicon confidence 35-95
    eventTypeWeight: ev.eventWeight,               // M&A 1.0 … results 0.7
    recencyFactor: recency,                        // 1h=1.0 → 24h=0.3
    sourceWeight: ev.sourceWeight,                 // feed reliability 0.8-1.0
    newsImpactScore: ev.impactScore,               // news-engine 0-100
  };
  let prob = 30
    + sentStrength * 0.28                          // strong wording moves stocks
    + (ev.sentiment.confidence - 35) * 0.25        // lexicon agreement
    + ev.eventWeight * 12                          // deal class matters
    + recency * 12                                 // fresh news reacts hardest
    + Math.min(10, ev.impactScore * 0.08);         // engine's own impact score
  prob = Math.round(clamp(prob * ev.sourceWeight, 5, 92));
  if (direction === 'FLAT') prob = Math.min(prob, 40);

  const stocks = (ev.stocks || []).map(sym => ({
    symbol: sym, direction, probability: prob,
    indexWeight: { NIFTY: idxWeight(sym, 'NIFTY'), SENSEX: idxWeight(sym, 'SENSEX'), BANKNIFTY: idxWeight(sym, 'BANKNIFTY') },
  }));

  // index bias: signed pull each affected heavyweight puts on each index (bounded)
  const bias = { NIFTY: 0, SENSEX: 0, BANKNIFTY: 0 };
  const sgn = direction === 'UP' ? 1 : direction === 'DOWN' ? -1 : 0;
  for (const s of stocks) for (const idx of INSTRUMENTS) bias[idx] += sgn * (prob / 100) * s.indexWeight[idx];
  for (const idx of INSTRUMENTS) bias[idx] = round(clamp(bias[idx], -15, 15));

  return { ...ev, direction, probability: prob, params, stockImpacts: stocks, indexBias: bias };
}

// ── PURE: 3. fuse master verdict + aggregated news bias per index ─────────────
function combineSignal(master, newsBias) {
  if (!master || master.decision == null) return { decision: 'HOLD', probability: 50, aligned: false, note: 'master-signal unavailable' };
  const dir = master.decision === 'BUY' ? 1 : master.decision === 'SELL' ? -1 : 0;
  const biasDir = newsBias > 1 ? 1 : newsBias < -1 ? -1 : 0;
  const aligned = dir !== 0 && biasDir !== 0 && dir === biasDir;
  const opposed = dir !== 0 && biasDir !== 0 && dir !== biasDir;
  // news is ONE voice, not a veto: aligned news adds up to +6, opposed trims up to -8
  let probability = Number(master.probability) || 50;
  if (aligned) probability += Math.min(6, Math.abs(newsBias));
  if (opposed) probability -= Math.min(8, Math.abs(newsBias) * 1.4);
  probability = Math.round(clamp(probability, 5, 95));
  return {
    decision: master.decision, direction: master.direction, probability, aligned, opposed,
    masterProbability: master.probability, newsBias: round(newsBias),
    note: aligned ? 'news CONFIRMS master signal' : opposed ? 'news OPPOSES master — trimmed' : 'news neutral/quiet',
  };
}

// ── PURE: 4. risk gate — every check listed, GO only when all pass ───────────
function riskGate(ctx) {
  const checks = [];
  const add = (name, pass, note) => checks.push({ name, pass: !!pass, note });
  add('Market hours', ctx.inMarketHours, ctx.inMarketHours ? 'open' : 'closed');
  add('Signal fired', ctx.decision === 'BUY' || ctx.decision === 'SELL', ctx.decision);
  add(`Probability ≥ ${ctx.minProb}%`, (ctx.probability || 0) >= ctx.minProb, `${ctx.probability}%`);
  add('VIX regime', !ctx.vixExtreme, ctx.vixNote || 'n/a');
  add('Event risk', (ctx.eventRisk || 0) < 70, `score ${ctx.eventRisk ?? 'n/a'}`);
  // buying rich premium is the classic bleed — skip when IVP says options are expensive
  add(`Premium not rich (IVP ≤ ${ctx.ivpMaxBuy ?? 70})`, !(ctx.ivp != null && ctx.ivp > (ctx.ivpMaxBuy ?? 70)),
      ctx.ivp != null ? `IVP ${ctx.ivp}` : 'IVP n/a — allowed');
  add(`Trades today < ${ctx.maxTrades}`, (ctx.tradesToday || 0) < ctx.maxTrades, `${ctx.tradesToday || 0} done`);
  add('No open position', !ctx.hasOpen, ctx.hasOpen ? 'position open' : 'clear');
  add('Daily loss cap', !ctx.dailyLossHit, ctx.dailyLossHit ? 'loss cap hit — stand down' : 'ok');
  add('Square-off window', !ctx.pastSquareOff, ctx.pastSquareOff ? 'too late to enter' : 'ok');
  const go = checks.every(c => c.pass);
  return { go, checks, lots: go ? (ctx.lots || 1) : 0 };
}

// ── PURE: 4b. range gate — the VALIDATED edge: defined-risk premium selling ──
// Fires only when there is NO directional trade (condor wants a quiet market),
// IVP says premium is rich enough to sell, and the event calendar is clean.
function rangeGate(ctx) {
  const checks = [];
  const add = (name, pass, note) => checks.push({ name, pass: !!pass, note });
  add('Market hours', ctx.inMarketHours, ctx.inMarketHours ? 'open' : 'closed');
  add('No directional trade', !ctx.directionalGo && (ctx.decision === 'HOLD' || (ctx.probability || 0) < (ctx.dirMinProb || 65)),
      ctx.directionalGo ? 'directional play has priority' : `${ctx.decision} ${ctx.probability ?? ''}%`);
  add(`IVP ≥ ${ctx.ivpMin}% (sell only rich premium)`, ctx.ivp != null && ctx.ivp >= ctx.ivpMin,
      ctx.ivp != null ? `IVP ${ctx.ivp}` : 'IVP unavailable — no sell');
  add('Event risk < 50', (ctx.eventRisk || 0) < 50, `score ${ctx.eventRisk ?? 'n/a'}`);
  add('VIX < 20 (no panic)', (ctx.vix || 0) > 0 && ctx.vix < 20, ctx.vix ? `VIX ${ctx.vix}` : 'VIX n/a');
  add(`Condors today < ${ctx.maxSell}`, (ctx.sellsToday || 0) < ctx.maxSell, `${ctx.sellsToday || 0} done`);
  add('No open condor', !ctx.hasOpenCondor, ctx.hasOpenCondor ? 'condor open' : 'clear');
  add('Daily loss cap', !ctx.dailyLossHit, ctx.dailyLossHit ? 'loss cap hit — stand down' : 'ok');
  add('Entry window', !ctx.pastLastEntry, ctx.pastLastEntry ? 'too late to enter' : 'ok');
  const go = checks.every(c => c.pass);
  return { go, checks, lots: go ? (ctx.lots || 1) : 0 };
}

// keep only numeric factor scores for the learner (credit assignment on close)
function snapshotFactors(factors) {
  const out = {};
  for (const [k, f] of Object.entries(factors || {})) {
    if (f && f.available !== false && typeof f.score === 'number' && f.kind !== 'risk') out[k] = f.score;
  }
  return out;
}

// ── the engine ────────────────────────────────────────────────────────────────
class AgentsEngine {
  constructor(cfg = {}) {
    this.enabled = String(cfg.enabled ?? process.env.AI_AGENTS_ENABLED ?? 'true').toLowerCase() === 'true';
    this.tpPct = parseFloat(cfg.tpPct ?? process.env.AGENTS_TP_PCT ?? 40);        // book profit +40%
    this.slPct = parseFloat(cfg.slPct ?? process.env.AGENTS_SL_PCT ?? 20);        // cut at -20%
    this.trailAtPct = parseFloat(cfg.trailAtPct ?? process.env.AGENTS_TRAIL_AT ?? 30);
    this.trailGiveback = parseFloat(cfg.trailGiveback ?? process.env.AGENTS_TRAIL_GB ?? 15);
    this.minProb = parseFloat(cfg.minProb ?? process.env.AGENTS_MIN_PROB ?? 65);  // high bar — trade rarely
    this.maxTradesPerDay = parseInt(cfg.maxTradesPerDay ?? process.env.AGENTS_MAX_TRADES ?? 3);
    this.maxDailyLoss = parseFloat(cfg.maxDailyLoss ?? process.env.AGENTS_MAX_DAILY_LOSS ?? 5000); // ₹ paper
    this.squareOffMins = hhmm(cfg.squareOff ?? process.env.AGENTS_SQUAREOFF ?? '15:15');
    this.lastEntryMins = hhmm(cfg.lastEntry ?? process.env.AGENTS_LAST_ENTRY ?? '14:45');
    this.qty = parseInt(cfg.qty ?? process.env.AGENTS_QTY ?? 1);
    // instruments the whole pipeline runs on — NIFTY + SENSEX + BANKNIFTY by default
    this.instruments = (cfg.instruments || (process.env.AGENTS_INSTRUMENTS || 'NIFTY,SENSEX,BANKNIFTY').split(','))
      .map(s => String(s).trim().toUpperCase()).filter(i => LOT[i]);

    // ── the VALIDATED edge: defined-risk premium selling (iron condor) ──
    this.sellEnabled = String(cfg.sellEnabled ?? process.env.AGENTS_SELL_ENABLED ?? 'true').toLowerCase() === 'true';
    this.sellTpPct = parseFloat(cfg.sellTpPct ?? process.env.AGENTS_SELL_TP ?? 50);          // book at 50% of credit captured
    this.sellStopMult = parseFloat(cfg.sellStopMult ?? process.env.AGENTS_SELL_STOP ?? 1.6); // exit if cost-to-close ≥ credit×1.6
    this.shortSteps = parseInt(cfg.shortSteps ?? process.env.AGENTS_SHORT_STEPS ?? 2);       // shorts at ATM ± 2 strikes
    this.wingSteps = parseInt(cfg.wingSteps ?? process.env.AGENTS_WING_STEPS ?? 4);          // wings at ATM ± 4 strikes
    this.ivpMinSell = parseFloat(cfg.ivpMinSell ?? process.env.AGENTS_IVP_MIN_SELL ?? 50);   // sell only rich premium
    this.ivpMaxBuy = parseFloat(cfg.ivpMaxBuy ?? process.env.AGENTS_IVP_MAX_BUY ?? 70);      // don't buy rich premium
    this.maxSellPerDay = parseInt(cfg.maxSellPerDay ?? process.env.AGENTS_MAX_SELL_TRADES ?? 1);

    this._open = new Map();          // inst -> directional paper position
    this._openCondor = new Map();    // inst -> condor paper position (multi-day hold)
    this._day = null;
    this._tradesToday = {};
    this._sellsToday = {};
    this._closedToday = [];
    this._tradesFile = require('path').join(__dirname, 'data', 'ai-agents-trades.json');
    this._openFile = require('path').join(__dirname, 'data', 'ai-agents-open.json');
    this._allTrades = this._loadTrades();
    this._loadOpen();                // condors hold across days → survive restarts
    this.onLearn = null;             // (trade) => void — feeds the confluence learner

    const mk = (key, emoji, name, role) => ({ key, emoji, name, role, state: 'IDLE', lastRun: null, output: null });
    this.agents = {
      news: mk('news', '📰', 'News Scout', 'deal-class events from live feeds'),
      impact: mk('impact', '🎯', 'Impact Analyst', 'affected stocks + probability with parameters'),
      signal: mk('signal', '🧠', 'Signal Agent', '11-factor master verdict × news bias'),
      risk: mk('risk', '🛡️', 'Risk Manager', 'GO/NO-GO gate, sizing, loss caps'),
      executor: mk('executor', '⚡', 'Executor', 'PAPER entries + profit booking'),
      analyst: mk('analyst', '🔎', 'Stock Analyst', 'ask any stock → live market + news verdict'),
    };
    this.agents.analyst.state = 'ON-DEMAND';
  }

  // stamp the on-demand Stock Analyst card after each query (server calls this)
  noteAnalyst(out) {
    if (!out || !out.ok) return;
    this._stamp('analyst', 'ACTIVE', {
      symbol: out.symbol, price: out.quote?.price, changePct: out.quote?.changePct,
      direction: out.verdict?.direction, probability: out.verdict?.probability,
      articles: out.news?.articles ?? 0,
    });
  }

  _loadTrades() { try { return JSON.parse(require('fs').readFileSync(this._tradesFile, 'utf8')) || []; } catch { return []; } }
  _saveTrades() { try { const fs = require('fs'), p = require('path'); fs.mkdirSync(p.dirname(this._tradesFile), { recursive: true }); fs.writeFileSync(this._tradesFile, JSON.stringify(this._allTrades.slice(-5000))); } catch (_) {} }
  _loadOpen() {
    try {
      const o = JSON.parse(require('fs').readFileSync(this._openFile, 'utf8'));
      for (const p of o.condors || []) this._openCondor.set(p.inst, p);
      for (const p of o.directional || []) this._open.set(p.inst, p);
    } catch (_) {}
  }
  _saveOpen() {
    try {
      const fs = require('fs'), p = require('path');
      fs.mkdirSync(p.dirname(this._openFile), { recursive: true });
      fs.writeFileSync(this._openFile, JSON.stringify({ condors: [...this._openCondor.values()], directional: [...this._open.values()] }));
    } catch (_) {}
  }
  _ist() { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return { date: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  _resetIfNewDay(date) { if (this._day !== date) { this._day = date; this._tradesToday = {}; this._sellsToday = {}; this._closedToday = []; } }
  _dailyPnl() { return this._closedToday.reduce((s, t) => s + (t.pnl || 0), 0); }
  _stamp(agent, state, output) { const a = this.agents[agent]; a.state = state; a.lastRun = new Date().toISOString(); a.output = output; }

  /**
   * One pipeline pass. All live data arrives via `deps` (nothing fetched here):
   *   { newsItems, masters:{NIFTY,SENSEX}, chains:{NIFTY:{atm,rows},SENSEX:{...}},
   *     vix:{value,regime}, eventRisk, inMarketHours }
   */
  tick(deps = {}) {
    if (!this.enabled) return { skipped: 'disabled' };
    const { date, mins } = this._ist();
    this._resetIfNewDay(date);

    // 1. NEWS SCOUT
    const events = detectDealEvents(deps.newsItems || [], { maxAgeH: 24 });
    this._stamp('news', events.length ? 'ACTIVE' : 'WATCHING',
      { events: events.length, latest: events[0] ? { title: events[0].title, type: events[0].eventType, at: events[0].publishedAt } : null });

    // 2. IMPACT ANALYST
    const impacts = events.slice(0, 25).map(ev => computeImpact(ev));
    const totalBias = { NIFTY: 0, SENSEX: 0, BANKNIFTY: 0 };
    for (const im of impacts) for (const idx of this.instruments) totalBias[idx] += im.indexBias[idx] || 0;
    for (const idx of this.instruments) totalBias[idx] = round(clamp(totalBias[idx], -20, 20));
    const stockHits = impacts.filter(i => i.stockImpacts.length);
    this._stamp('impact', stockHits.length ? 'ACTIVE' : 'WATCHING',
      { analyzed: impacts.length, withStocks: stockHits.length, indexBias: totalBias,
        top: stockHits.slice(0, 8).map(i => ({ title: i.title, type: i.eventType, direction: i.direction,
          probability: i.probability, stocks: i.stockImpacts.map(s => s.symbol), params: i.params })) });

    // 3. SIGNAL AGENT — fuses master verdict × news bias for every instrument
    const combined = {};
    for (const inst of this.instruments) combined[inst] = combineSignal(deps.masters?.[inst], totalBias[inst]);
    this._stamp('signal', 'ACTIVE', this.instruments.reduce((o, i) => (o[i] = combined[i], o), {}));

    // 4 + 5. RISK GATE → EXECUTOR, per instrument · two plays:
    //   DIR BUY (rare, prob-gated)  +  RANGE CONDOR (the validated selling edge)
    const vixExtreme = (deps.vix?.value || 0) >= 22;
    const ivp = deps.ivp != null && isFinite(deps.ivp) ? round(deps.ivp, 1) : null;
    const gates = {}, sellGates = {}, actions = [];
    for (const inst of this.instruments) {
      const sig = combined[inst];
      const gate = riskGate({
        inMarketHours: !!deps.inMarketHours, decision: sig.decision, probability: sig.probability,
        minProb: this.minProb, vixExtreme, vixNote: deps.vix ? `VIX ${deps.vix.value} ${deps.vix.regime || ''}` : null,
        eventRisk: deps.eventRisk, ivp, ivpMaxBuy: this.ivpMaxBuy,
        maxTrades: this.maxTradesPerDay, tradesToday: this._tradesToday[inst] || 0,
        hasOpen: this._open.has(inst), dailyLossHit: this._dailyPnl() <= -this.maxDailyLoss,
        pastSquareOff: mins >= this.lastEntryMins, lots: this.qty,
      });
      gates[inst] = gate;

      const sellGate = this.sellEnabled ? rangeGate({
        inMarketHours: !!deps.inMarketHours, directionalGo: gate.go, decision: sig.decision,
        probability: sig.probability, dirMinProb: this.minProb, ivp, ivpMin: this.ivpMinSell,
        eventRisk: deps.eventRisk, vix: deps.vix?.value, maxSell: this.maxSellPerDay,
        sellsToday: this._sellsToday[inst] || 0, hasOpenCondor: this._openCondor.has(inst),
        dailyLossHit: this._dailyPnl() <= -this.maxDailyLoss, pastLastEntry: mins >= this.lastEntryMins, lots: this.qty,
      }) : { go: false, checks: [], note: 'sell play disabled' };
      sellGates[inst] = sellGate;

      const chain = deps.chains?.[inst];
      const factors = snapshotFactors(deps.masters?.[inst]?.factors);

      // manage whatever is open first (directional intraday + condor multi-day)
      const pos = this._open.get(inst);
      if (pos && chain) { const act = this._manage(inst, pos, chain, mins); if (act) actions.push(act); }
      const condor = this._openCondor.get(inst);
      if (condor && chain) { const act = this._manageCondor(inst, condor, chain, date, mins); if (act) actions.push(act); }

      // entries — directional play has priority; condor only in quiet markets
      if (gate.go && chain && !this._open.has(inst)) {
        const act = this._enter(inst, sig, chain, mins, factors);
        if (act) actions.push(act);
      } else if (sellGate.go && chain && !this._openCondor.has(inst)) {
        const act = this._enterCondor(inst, chain, date, mins, { ivp, expiry: deps.expiries?.[inst] || null });
        if (act) actions.push(act);
      }
    }
    this._stamp('risk', Object.values(gates).some(g => g.go) || Object.values(sellGates).some(g => g.go) ? 'GO' : 'HOLDING',
      { ...gates, sell: sellGates, ivp });
    this._stamp('executor', (this._open.size + this._openCondor.size) ? 'IN TRADE' : 'STANDBY', {
      open: [...this._open.values()], condors: [...this._openCondor.values()],
      closedToday: this._closedToday, dayPnl: round(this._dailyPnl()),
      tradesToday: this._tradesToday, sellsToday: this._sellsToday, actions,
    });

    return { events: events.length, impacts: impacts.length, combined, gates, sellGates, actions };
  }

  _enter(inst, sig, chain, mins, factors) {
    const side = sig.decision === 'BUY' ? 'CE' : 'PE';
    const row = (chain.rows || []).find(r => Number(r.strike) === Number(chain.atm));
    const ltp = side === 'CE' ? Number(row?.ce?.ltp || 0) : Number(row?.pe?.ltp || 0);
    if (!(ltp > 0)) return null;
    const pos = {
      inst, kind: 'DIR', side, strike: Number(chain.atm), entry: round(ltp), last: ltp, peak: ltp,
      qty: this.qty, lot: LOT[inst] || 75, openMins: mins, openedAt: new Date().toISOString(),
      probability: sig.probability, newsAligned: !!sig.aligned, mode: 'PAPER',
      factors: factors && Object.keys(factors).length ? factors : null,   // for the learner on close
    };
    this._open.set(inst, pos);
    this._tradesToday[inst] = (this._tradesToday[inst] || 0) + 1;
    this._saveOpen();
    return { action: 'OPEN', ...pos };
  }

  _manage(inst, pos, chain, mins) {
    const row = (chain.rows || []).find(r => Number(r.strike) === pos.strike);
    const cur = pos.side === 'CE' ? Number(row?.ce?.ltp || 0) : Number(row?.pe?.ltp || 0);
    if (cur > 0) pos.last = cur;
    const ltp = pos.last || pos.entry;
    if (ltp > pos.peak) pos.peak = ltp;
    const chgPct = (ltp - pos.entry) / pos.entry * 100;
    const peakPct = (pos.peak - pos.entry) / pos.entry * 100;
    let reason = null;
    if (chgPct >= this.tpPct) reason = 'TARGET';
    else if (chgPct <= -this.slPct) reason = 'STOP_LOSS';
    else if (peakPct >= this.trailAtPct && (peakPct - chgPct) >= this.trailGiveback) reason = 'TRAIL';
    else if (mins >= this.squareOffMins) reason = 'SQUARE_OFF';
    if (!reason) return null;
    return this._close(inst, pos, ltp, reason);
  }

  _close(inst, pos, exitLtp, reason) {
    const units = pos.qty * pos.lot;
    const gross = (exitLtp - pos.entry) * units;
    const charges = roundTripCharges(pos.entry, exitLtp, units).total;
    const pnl = round(gross - charges);
    const rec = { ...pos, exit: round(exitLtp), exitAt: new Date().toISOString(), reason, gross: round(gross), charges: round(charges), pnl };
    this._open.delete(inst);
    this._closedToday.push(rec);
    this._allTrades.push(rec);
    this._saveTrades();
    this._saveOpen();
    // teach the confluence learner: which factors were right/wrong on this trade
    if (this.onLearn && pos.factors && pnl !== 0) {
      try { this.onLearn({ inst, decision: pos.side === 'CE' ? 'BUY' : 'SELL', result: pnl > 0 ? 'WIN' : 'LOSS', factors: pos.factors, pnl }); } catch (_) {}
    }
    return { action: 'CLOSE', ...rec };
  }

  // ── the profit engine: defined-risk iron condor (paper) ────────────────────
  _condorLegLtps(chain, legs) {
    const find = k => (chain.rows || []).find(r => Number(r.strike) === k);
    return {
      sce: Number(find(legs.shortCE.strike)?.ce?.ltp || 0),
      spe: Number(find(legs.shortPE.strike)?.pe?.ltp || 0),
      wce: Number(find(legs.wingCE.strike)?.ce?.ltp || 0),
      wpe: Number(find(legs.wingPE.strike)?.pe?.ltp || 0),
    };
  }

  _enterCondor(inst, chain, date, mins, extra = {}) {
    const step = Number(chain.step) || (inst === 'NIFTY' ? 50 : 100);
    const atm = Number(chain.atm);
    if (!atm) return null;
    const legs = {
      shortCE: { strike: atm + this.shortSteps * step, side: 'SELL', type: 'CE' },
      shortPE: { strike: atm - this.shortSteps * step, side: 'SELL', type: 'PE' },
      wingCE:  { strike: atm + this.wingSteps * step, side: 'BUY', type: 'CE' },
      wingPE:  { strike: atm - this.wingSteps * step, side: 'BUY', type: 'PE' },
    };
    const L = this._condorLegLtps(chain, legs);
    if (!(L.sce > 0 && L.spe > 0 && L.wce > 0 && L.wpe > 0)) return null;
    const credit = L.sce + L.spe - L.wce - L.wpe;
    if (!(credit > 0)) return null;
    legs.shortCE.entry = round(L.sce); legs.shortPE.entry = round(L.spe);
    legs.wingCE.entry = round(L.wce); legs.wingPE.entry = round(L.wpe);
    const pos = {
      inst, kind: 'CONDOR', legs, atm, step, credit: round(credit), lastCost: round(credit),
      qty: this.qty, lot: LOT[inst] || 75, openedAt: new Date().toISOString(), openDate: date, openMins: mins,
      expiry: extra.expiry || null, ivpAtEntry: extra.ivp ?? null, mode: 'PAPER',
      maxLossDefined: round((this.wingSteps - this.shortSteps) * step * this.qty * (LOT[inst] || 75) - credit * this.qty * (LOT[inst] || 75)),
    };
    this._openCondor.set(inst, pos);
    this._sellsToday[inst] = (this._sellsToday[inst] || 0) + 1;
    this._saveOpen();
    return { action: 'OPEN', strategy: 'IRON_CONDOR', inst, credit: pos.credit,
      shorts: `${legs.shortPE.strike}PE/${legs.shortCE.strike}CE`, wings: `${legs.wingPE.strike}/${legs.wingCE.strike}`,
      ivp: extra.ivp ?? null };
  }

  _manageCondor(inst, pos, chain, date, mins) {
    const L = this._condorLegLtps(chain, pos.legs);
    // cost to close the structure now (buy back shorts, sell wings)
    if (L.sce > 0 && L.spe > 0) pos.lastCost = round(L.sce + L.spe - L.wce - L.wpe);
    const cost = pos.lastCost;
    const capturedPct = pos.credit > 0 ? (pos.credit - cost) / pos.credit * 100 : 0;
    let reason = null;
    if (capturedPct >= this.sellTpPct) reason = 'TARGET';                                  // theta done its job
    else if (cost >= pos.credit * this.sellStopMult) reason = 'STOP_LOSS';                 // structure went against us
    else if (pos.expiry && date >= pos.expiry && mins >= this.squareOffMins) reason = 'EXPIRY_CLOSE';
    if (!reason) return null;
    return this._closeCondor(inst, pos, cost, reason, L);
  }

  _closeCondor(inst, pos, exitCost, reason, exitLtps = {}) {
    const units = pos.qty * pos.lot;
    const gross = (pos.credit - exitCost) * units;
    // realistic charges: each of the 4 legs pays its own round-trip on entry & exit LTP
    const legExit = { shortCE: exitLtps.sce, shortPE: exitLtps.spe, wingCE: exitLtps.wce, wingPE: exitLtps.wpe };
    let charges = 0;
    try {
      charges = Object.entries(pos.legs).reduce((s, [k, leg]) =>
        s + roundTripCharges(Math.max(0.05, leg.entry), Math.max(0.05, Number(legExit[k]) || leg.entry), units).total, 0);
    } catch (_) { charges = 4 * 65 * pos.qty; }
    const pnl = round(gross - charges);
    const rec = { inst, kind: 'CONDOR', legs: pos.legs, credit: pos.credit, exitCost: round(exitCost),
      qty: pos.qty, lot: pos.lot, openedAt: pos.openedAt, exitAt: new Date().toISOString(),
      ivpAtEntry: pos.ivpAtEntry, reason, gross: round(gross), charges: round(charges), pnl, mode: 'PAPER' };
    this._openCondor.delete(inst);
    this._closedToday.push(rec);
    this._allTrades.push(rec);
    this._saveTrades();
    this._saveOpen();
    return { action: 'CLOSE', strategy: 'IRON_CONDOR', ...rec };
  }

  status() {
    const all = this._allTrades;
    const wins = all.filter(t => t.pnl > 0).length;
    const bucket = kind => {
      const b = all.filter(t => (t.kind || 'DIR') === kind);
      const w = b.filter(t => t.pnl > 0).length;
      return { trades: b.length, winRate: b.length ? round(w / b.length * 100, 1) : null, netPnl: round(b.reduce((s, t) => s + (t.pnl || 0), 0)) };
    };
    return {
      enabled: this.enabled, mode: 'PAPER',
      config: { tpPct: this.tpPct, slPct: this.slPct, trailAtPct: this.trailAtPct, trailGiveback: this.trailGiveback,
        minProb: this.minProb, maxTradesPerDay: this.maxTradesPerDay, maxDailyLoss: this.maxDailyLoss, qty: this.qty,
        sellEnabled: this.sellEnabled, sellTpPct: this.sellTpPct, sellStopMult: this.sellStopMult,
        shortSteps: this.shortSteps, wingSteps: this.wingSteps, ivpMinSell: this.ivpMinSell, ivpMaxBuy: this.ivpMaxBuy,
        maxSellPerDay: this.maxSellPerDay },
      agents: this.agents,
      open: [...this._open.values()], condors: [...this._openCondor.values()],
      closedToday: this._closedToday, dayPnl: round(this._dailyPnl()),
      allTime: { trades: all.length, wins, winRate: all.length ? round(wins / all.length * 100, 1) : null,
        netPnl: round(all.reduce((s, t) => s + (t.pnl || 0), 0)),
        directional: bucket('DIR'), condor: bucket('CONDOR') },
      disclaimer: 'Paper auto-trading. Impact probability is a disclosed-parameter heuristic, not a promise. Directional buying backtested weak — high probability floor + caps applied; the condor play follows the backtested selling edge (81% win, defined risk) with an IVP≥50 filter. Educational, not advice.',
    };
  }
}

module.exports = { AgentsEngine, detectDealEvents, computeImpact, combineSignal, riskGate, rangeGate, snapshotFactors, EVENT_TYPES };
