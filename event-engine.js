/**
 * EVENT & MACRO ENGINE — Antigravity Pro
 *
 * India VIX (live via Yahoo), FII/DII cash + derivative flows, and the macro event
 * calendar (RBI policy, earnings, economic prints, corporate actions). Produces an
 * Event Risk Score (0-100) for the days ahead.
 *
 * Calendars + FII/DII are store-backed (data/*.json) with ingest methods and
 * provider hooks — populate them via the /api/events ingest endpoint, a cron, or a
 * paid feed. India VIX is fetched live and degrades gracefully.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA, 'events.json');
const FIIDII_FILE = path.join(DATA, 'fii-dii.json');

// risk weight per event type (0-100)
const TYPE_WEIGHT = {
  BUDGET: 95, RBI_POLICY: 90, ELECTION: 85, FED: 80, GDP: 65, CPI: 62, INFLATION: 62,
  IIP: 55, PMI: 50, RESULTS: 50, GLOBAL: 55, CORPORATE_ACTION: 25, DIVIDEND: 20, BONUS: 25, SPLIT: 20, OTHER: 30,
};

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function writeJson(file, obj) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 1)); return true; } catch (_) { return false; } }

class EventEngine {
  constructor() {
    this.events = readJson(EVENTS_FILE, []);             // [{date,type,title,impact?,symbol?}]
    this.fiiDii = readJson(FIIDII_FILE, []);             // [{date, cash:{fii,dii}, fno:{fiiIndexFut,...}}]
    this._vix = { value: 0, change: 0, changePct: 0, at: 0 };
    this._vixHist = null; this._vixHistAt = 0;
  }

  // ── India VIX daily history (for IV Rank/Percentile) — cached ~6h ──
  async getVixHistory(days = 365) {
    if (this._vixHist && this._vixHist.length >= 20 && Date.now() - this._vixHistAt < 6 * 3600e3) return this._vixHist;
    try {
      const mod = require('yahoo-finance2');
      const YF = mod.default || mod;
      const yf = (typeof YF === 'function') ? new YF() : YF;
      try { yf.suppressNotices && yf.suppressNotices(['yahooSurvey', 'ripHistorical']); } catch (_) {}
      const period1 = new Date(Date.now() - days * 86400000);
      const r = await yf.chart(process.env.VIX_SYMBOL || '^INDIAVIX', { period1, interval: '1d' });
      const closes = ((r && r.quotes) || []).map(q => Number(q.close)).filter(v => isFinite(v) && v > 0);
      if (closes.length >= 20) { this._vixHist = closes; this._vixHistAt = Date.now(); }
    } catch (_) {}
    return this._vixHist || [];
  }

  // ── India VIX (Yahoo ^INDIAVIX) ──
  async getVix() {
    if (this._vix.value > 0 && Date.now() - this._vix.at < 30000) return this._vixOut();
    try {
      const mod = require('yahoo-finance2');
      const YF = mod.default || mod;
      const yf = (typeof YF === 'function') ? new YF() : YF;   // newer versions require instantiation
      try { yf.suppressNotices && yf.suppressNotices(['yahooSurvey']); } catch (_) {}
      const sym = process.env.VIX_SYMBOL || '^INDIAVIX';
      const q = await yf.quote(sym);
      const v = Number((q && (q.regularMarketPrice != null ? q.regularMarketPrice : q.price)) || 0);
      if (v > 0) this._vix = { value: +v.toFixed(2), change: +((q.regularMarketChange) || 0).toFixed(2), changePct: +((q.regularMarketChangePercent) || 0).toFixed(2), at: Date.now() };
    } catch (_) {}
    return this._vixOut();
  }
  _vixOut() {
    const v = this._vix.value;
    const regime = !v ? 'UNKNOWN' : v < 12 ? 'LOW' : v < 16 ? 'NORMAL' : v < 22 ? 'ELEVATED' : v < 30 ? 'HIGH' : 'EXTREME';
    return { value: v, change: this._vix.change, changePct: this._vix.changePct, regime, at: this._vix.at || null };
  }

  // ── calendar ──
  _istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  ingestEvents(list, replace = false) {
    const incoming = (Array.isArray(list) ? list : [list]).filter(e => e && e.date && e.title).map(e => ({
      date: String(e.date).slice(0, 10), type: String(e.type || 'OTHER').toUpperCase(), title: String(e.title),
      impact: e.impact ? String(e.impact).toUpperCase() : null, symbol: e.symbol || null,
    }));
    if (replace) this.events = incoming;
    else { const key = e => e.date + '|' + e.type + '|' + e.title; const seen = new Set(this.events.map(key)); for (const e of incoming) if (!seen.has(key(e))) this.events.push(e); }
    this.events.sort((a, b) => a.date.localeCompare(b.date));
    writeJson(EVENTS_FILE, this.events);
    return { count: this.events.length, added: incoming.length };
  }
  upcoming(days = 7) {
    const today = this._istToday();
    const end = new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);
    return this.events.filter(e => e.date >= today && e.date <= end);
  }

  // ── FII/DII ──
  ingestFiiDii(rec) {
    if (!rec || !rec.date) return { error: 'date required' };
    rec.date = String(rec.date).slice(0, 10);
    this.fiiDii = this.fiiDii.filter(x => x.date !== rec.date);
    this.fiiDii.push(rec);
    this.fiiDii.sort((a, b) => b.date.localeCompare(a.date));
    this.fiiDii = this.fiiDii.slice(0, 120);
    writeJson(FIIDII_FILE, this.fiiDii);
    return { count: this.fiiDii.length };
  }
  fiiDiiLatest() {
    const last = this.fiiDii[0] || null;
    if (!last) return { available: false };
    const fiiCash = Number(last.cash?.fii || 0), diiCash = Number(last.cash?.dii || 0);
    // 5-day FII cash trend
    const trend5 = this.fiiDii.slice(0, 5).reduce((s, x) => s + Number(x.cash?.fii || 0), 0);
    const bias = fiiCash + diiCash > 0 ? 'INFLOW' : fiiCash + diiCash < 0 ? 'OUTFLOW' : 'FLAT';
    return { available: true, date: last.date, cash: last.cash || {}, fno: last.fno || {}, netCash: +(fiiCash + diiCash).toFixed(1), fii5dCr: +trend5.toFixed(1), bias };
  }

  // ── Event Risk Score (0-100) for the next `days` — max event weight × proximity, lifted by VIX ──
  async eventRiskScore(days = 5) {
    const up = this.upcoming(days);
    let base = 0; let driver = null;
    const todayMs = Date.now() + 330 * 60000;
    for (const e of up) {
      const w = TYPE_WEIGHT[e.type] || TYPE_WEIGHT.OTHER;
      const dd = Math.max(0, (Date.parse(e.date + 'T00:00:00Z') - todayMs) / 86400000);
      const prox = dd <= 1 ? 1 : dd <= 2 ? 0.85 : dd <= 4 ? 0.65 : 0.45;
      const s = w * prox;
      if (s > base) { base = s; driver = e; }
    }
    const vix = await this.getVix();
    const vixLift = vix.value ? Math.min(20, Math.max(0, (vix.value - 14)) * 1.5) : 0;   // high VIX adds risk
    const score = Math.round(Math.min(100, base + vixLift));
    const level = score >= 75 ? 'HIGH' : score >= 45 ? 'MODERATE' : score >= 20 ? 'LOW' : 'CALM';
    return { score, level, driver, upcoming: up, vix: { value: vix.value, regime: vix.regime }, days };
  }

  status() { return { events: this.events.length, fiiDiiDays: this.fiiDii.length, vix: this._vixOut() }; }
}

module.exports = { EventEngine, TYPE_WEIGHT };
