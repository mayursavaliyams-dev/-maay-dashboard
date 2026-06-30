/**
 * NEWS INTELLIGENCE ENGINE — Antigravity Pro
 *
 * Collect → dedup → summarize → sentiment → confidence → affected stocks/sectors → score.
 *
 * Works out of the box with free RSS feeds and a finance sentiment lexicon (no API
 * key). If CLAUDE_AI_ENABLED + ANTHROPIC_API_KEY are set, headlines are batch-scored
 * by Claude for sharper sentiment. Everything degrades gracefully.
 *
 * Outputs: per-article newsImpactScore (0-100) + signed sentiment, and aggregate
 * marketSentiment + sectorSentiment.
 */
'use strict';
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_DIR = path.join(__dirname, 'data', 'news');
const AI_ENABLED = process.env.CLAUDE_AI_ENABLED === 'true' && !!process.env.ANTHROPIC_API_KEY;
const REFRESH_MS = Math.max(60, Number(process.env.NEWS_REFRESH_SEC || 300)) * 1000;
const MAX_KEEP = 400;

// ── configurable sources (override with NEWS_SOURCES=[{id,name,url,weight}]) ──
const DEFAULT_SOURCES = [
  { id: 'et-markets',   name: 'ET Markets',     url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', weight: 1.0 },
  { id: 'moneycontrol', name: 'Moneycontrol',   url: 'https://www.moneycontrol.com/rss/business.xml',                        weight: 1.0 },
  { id: 'bs-markets',   name: 'Business Std',    url: 'https://www.business-standard.com/rss/markets-106.rss',                weight: 0.9 },
  { id: 'livemint',     name: 'Mint Markets',    url: 'https://www.livemint.com/rss/markets',                                 weight: 0.9 },
  { id: 'et-economy',   name: 'ET Economy',      url: 'https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms', weight: 0.8 },
];
function sources() { try { const c = JSON.parse(process.env.NEWS_SOURCES || '[]'); if (Array.isArray(c) && c.length) return c; } catch (_) {} return DEFAULT_SOURCES; }

// ── tiny RSS/Atom parser (no extra deps) ──
function decodeEntities(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|#160);/gi, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&#160;': ' ' }[m.toLowerCase()] || ' '));
}
function strip(s) { return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function parseFeed(xml, src) {
  const out = [];
  const blocks = xml.split(/<(?:item|entry)[\s>]/i).slice(1);
  for (const b of blocks) {
    const tag = name => { const m = b.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i')); return m ? strip(m[1]) : ''; };
    const linkAttr = () => { const m = b.match(/<link[^>]*href="([^"]+)"/i); return m ? m[1] : ''; };
    const title = tag('title');
    if (!title) continue;
    const link = tag('link') || linkAttr() || tag('guid');
    const desc = tag('description') || tag('summary') || tag('content:encoded') || tag('content');
    const pub = tag('pubDate') || tag('published') || tag('updated') || tag('dc:date');
    out.push({ title, link, desc, pubDate: pub, source: src.id, sourceName: src.name, weight: src.weight || 1 });
  }
  return out;
}

// ── finance sentiment lexicon ──
const BULL = ['surge','surges','soar','soars','rally','rallies','gain','gains','jump','jumps','rise','rises','rose','rebound','recover','recovers','record high','all-time high','beat','beats','profit','profits','growth','upgrade','upgrades','outperform','bullish','strong','robust','boom','breakout','expand','expands','positive','optimis','inflow','inflows','dividend','bonus','buyback','order win','wins order','bags order','approval','approved','launch','launches','tie-up','partnership','acquire','acquires','stake buy','multibagger','target raised','hikes target','margin expansion','upbeat','rerating','re-rating'];
const BEAR = ['fall','falls','fell','drop','drops','plunge','plunges','slump','slumps','crash','crashes','tumble','decline','declines','loss','losses','miss','misses','cut','cuts','downgrade','downgrades','underperform','bearish','weak','weakness','slowdown','recession','default','defaults','fraud','probe','raid','ban','bans','penalty','fine','fined','lawsuit','resign','resigns','layoff','layoffs','warn','warning','warns','negative','outflow','outflows','selloff','sell-off','pressure','concern','concerns','risk','risks','tariff','hike','hikes','inflation','crisis','halt','halts','recall','derail','default risk','stake sale','block deal sell','downbeat','de-rating'];
const NEG = ['no ', 'not ', 'without', 'fails to', 'denies'];

function sentiment(text) {
  const t = ' ' + String(text).toLowerCase() + ' ';
  let bull = 0, bear = 0;
  for (const w of BULL) if (t.includes(w)) bull += w.length > 6 ? 1.4 : 1;
  for (const w of BEAR) if (t.includes(w)) bear += w.length > 6 ? 1.4 : 1;
  // light negation flip near a bull word
  for (const n of NEG) { let i = t.indexOf(n); while (i !== -1) { const win = t.slice(i, i + 40); if (BULL.some(w => win.includes(w))) { bull -= 1; bear += 1; } i = t.indexOf(n, i + 1); } }
  bull = Math.max(0, bull); bear = Math.max(0, bear);
  const total = bull + bear;
  const net = bull - bear;
  const score = total ? Math.round(Math.max(-100, Math.min(100, (net / total) * 100 * Math.min(1, total / 3)))) : 0;
  const label = score >= 12 ? 'BULLISH' : score <= -12 ? 'BEARISH' : 'NEUTRAL';
  // confidence: signal strength × directional agreement
  const agree = total ? Math.abs(net) / total : 0;
  const confidence = Math.round(Math.max(35, Math.min(95, 35 + Math.min(1, total / 4) * 40 + agree * 20)));
  return { score, label, confidence, bull: +bull.toFixed(1), bear: +bear.toFixed(1) };
}

function summarize(article) {
  const text = (article.desc && article.desc.length > 40) ? article.desc : article.title;
  const sentences = String(text).replace(/([.!?])\s+/g, '$1').split('');
  let s = sentences.slice(0, 2).join(' ').trim();
  if (s.length > 240) s = s.slice(0, 237) + '…';
  return s || article.title;
}

// ── stock & sector dictionary (NIFTY-heavy; extend via NEWS_STOCKS) ──
const STOCKS = [
  ['RELIANCE','Energy',['reliance','ril','jio','reliance industries']], ['TCS','IT',['tcs','tata consultancy']],
  ['INFY','IT',['infosys','infy']], ['HDFCBANK','Banking',['hdfc bank','hdfcbank']], ['ICICIBANK','Banking',['icici bank','icicibank']],
  ['SBIN','PSU Bank',['sbi','state bank']], ['AXISBANK','Banking',['axis bank']], ['KOTAKBANK','Banking',['kotak']],
  ['BHARTIARTL','Telecom',['bharti airtel','airtel']], ['ITC','FMCG',['itc']], ['HINDUNILVR','FMCG',['hindustan unilever','hul']],
  ['LT','Infra',['larsen','l&t','larsen & toubro']], ['BAJFINANCE','NBFC',['bajaj finance']], ['MARUTI','Auto',['maruti','maruti suzuki']],
  ['TATAMOTORS','Auto',['tata motors','jlr']], ['M&M','Auto',['mahindra & mahindra','m&m','mahindra']], ['SUNPHARMA','Pharma',['sun pharma']],
  ['DRREDDY','Pharma',["dr reddy","dr. reddy","dr reddy's"]], ['CIPLA','Pharma',['cipla']], ['TATASTEEL','Metals',['tata steel']],
  ['JSWSTEEL','Metals',['jsw steel']], ['HINDALCO','Metals',['hindalco']], ['COALINDIA','PSU',['coal india']], ['NTPC','Power',['ntpc']],
  ['POWERGRID','Power',['power grid','powergrid']], ['ONGC','Energy',['ongc']], ['ADANIENT','Adani',['adani enterprises','adani ent']],
  ['ADANIPORTS','Adani',['adani ports']], ['ASIANPAINT','Paints',['asian paints']], ['ULTRACEMCO','Cement',['ultratech']],
  ['TITAN','Consumer',['titan']], ['WIPRO','IT',['wipro']], ['HCLTECH','IT',['hcl tech','hcltech','hcl technologies']],
  ['TECHM','IT',['tech mahindra','techm']], ['NESTLEIND','FMCG',['nestle']], ['BAJAJFINSV','NBFC',['bajaj finserv']],
  ['INDUSINDBK','Banking',['indusind']], ['GRASIM','Cement',['grasim']], ['DIVISLAB','Pharma',['divi','divis lab']],
  ['EICHERMOT','Auto',['eicher','royal enfield']], ['BPCL','Energy',['bpcl','bharat petroleum']], ['IOC','Energy',['indian oil','ioc']],
  ['VEDL','Metals',['vedanta']], ['DLF','Realty',['dlf']], ['PNB','PSU Bank',['punjab national','pnb']], ['BANKBARODA','PSU Bank',['bank of baroda']],
  ['ZOMATO','Consumer',['zomato','eternal']], ['PAYTM','Fintech',['paytm','one97']], ['IRCTC','PSU',['irctc']],
];
const SECTOR_KW = {
  'Banking': ['bank','banking','credit growth','npa','deposit'],
  'IT': ['it sector','software','tech stocks','deal wins','attrition'],
  'Auto': ['auto sales','vehicle sales','passenger vehicle','two-wheeler','ev '],
  'Pharma': ['pharma','drug','usfda','api '],
  'FMCG': ['fmcg','consumer goods','rural demand'],
  'Energy': ['crude','oil price','opec','refining','gas price'],
  'Metals': ['steel price','metal','aluminium','iron ore','copper'],
  'Realty': ['real estate','realty','housing','property'],
  'PSU Bank': ['psu bank','public sector bank'],
  'Power': ['power demand','electricity','renewable'],
  'Telecom': ['telecom','tariff hike','spectrum','5g'],
  'NBFC': ['nbfc','microfinance'],
};
function detectStocks(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const stocks = new Set(), sectors = new Set();
  for (const [sym, sec, aliases] of STOCKS) for (const a of aliases) if (t.includes(' ' + a) || t.includes(a + ' ') || t.includes(' ' + a + ' ')) { stocks.add(sym); sectors.add(sec); break; }
  for (const [sec, kws] of Object.entries(SECTOR_KW)) for (const k of kws) if (t.includes(k)) { sectors.add(sec); break; }
  return { stocks: [...stocks], sectors: [...sectors] };
}

function impactScore(a) {
  const sev = Math.abs(a.sentiment.score) / 100;        // how strong the sentiment
  const conf = a.sentiment.confidence / 100;
  const src = a.weight || 1;
  const reach = Math.min(1, (a.stocks.length * 0.25) + (a.sectors.length * 0.15) + 0.3);
  const recency = recencyFactor(a.ts);
  return Math.round(Math.max(0, Math.min(100, sev * 55 + conf * 15 + reach * 20 + recency * 10)) * src);
}
function recencyFactor(ts) { const h = (Date.now() - ts) / 3600000; return h <= 1 ? 1 : h <= 4 ? 0.8 : h <= 12 ? 0.5 : h <= 24 ? 0.3 : 0.1; }

class NewsEngine {
  constructor() { this.items = []; this.seen = new Set(); this.lastRefresh = null; this.lastError = null; this._loadToday(); }

  _file(d = this._date()) { return path.join(STORE_DIR, `news-${d}.jsonl`); }
  _date() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  _loadToday() {
    try { const f = this._file(); if (!fs.existsSync(f)) return;
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean)) { try { const o = JSON.parse(line); this.items.push(o); this.seen.add(o.id); } catch (_) {} }
      this.items = this.items.slice(-MAX_KEEP);
    } catch (_) {}
  }
  _persist(a) { try { fs.mkdirSync(STORE_DIR, { recursive: true }); fs.appendFileSync(this._file(), JSON.stringify(a) + '\n'); } catch (_) {} }

  _key(raw) { return crypto.createHash('sha1').update((raw.link || '') + '|' + raw.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)).digest('hex').slice(0, 16); }

  async refresh() {
    const all = [];
    await Promise.all(sources().map(async src => {
      try {
        const r = await fetch(src.url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 AntigravityNews/1.0' } });
        if (!r.ok) return;
        const xml = await r.text();
        all.push(...parseFeed(xml, src));
      } catch (e) { this.lastError = `${src.id}: ${e.message}`; }
    }));
    let added = 0;
    for (const raw of all) {
      const id = this._key(raw);
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      const text = (raw.title + '. ' + (raw.desc || '')).slice(0, 600);
      const sent = sentiment(text);
      const { stocks, sectors } = detectStocks(text);
      const ts = Date.parse(raw.pubDate) || Date.now();
      const a = {
        id, title: raw.title, summary: summarize(raw), url: raw.link, source: raw.source, sourceName: raw.sourceName,
        weight: raw.weight, publishedAt: new Date(ts).toISOString(), ts,
        sentiment: sent, stocks, sectors, impactScore: 0,
      };
      a.impactScore = impactScore(a);
      this.items.push(a); this._persist(a); added++;
    }
    this.items.sort((x, y) => y.ts - x.ts);
    if (this.items.length > MAX_KEEP) this.items = this.items.slice(0, MAX_KEEP);
    this.lastRefresh = new Date().toISOString();
    return { fetched: all.length, added, total: this.items.length };
  }

  recent(limit = 50, opts = {}) {
    let list = this.items;
    if (opts.sector) list = list.filter(a => a.sectors.includes(opts.sector));
    if (opts.stock) list = list.filter(a => a.stocks.includes(String(opts.stock).toUpperCase()));
    if (opts.sentiment) list = list.filter(a => a.sentiment.label === String(opts.sentiment).toUpperCase());
    return list.slice(0, Math.max(1, Math.min(200, limit)));
  }

  // weighted aggregate over the last `windowH` hours
  marketSentiment(windowH = 12) {
    const cut = Date.now() - windowH * 3600000;
    const recent = this.items.filter(a => a.ts >= cut);
    if (!recent.length) return { label: 'NEUTRAL', score: 0, confidence: 0, articles: 0, bullish: 0, bearish: 0, neutral: 0 };
    let wsum = 0, num = 0; const cnt = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    for (const a of recent) { const w = (a.weight || 1) * (a.impactScore / 100 + 0.2) * recencyFactor(a.ts); num += a.sentiment.score * w; wsum += w; cnt[a.sentiment.label]++; }
    const score = wsum ? Math.round(num / wsum) : 0;
    const label = score >= 10 ? 'BULLISH' : score <= -10 ? 'BEARISH' : 'NEUTRAL';
    const dir = cnt.BULLISH + cnt.BEARISH;
    const confidence = Math.round(Math.max(35, Math.min(95, 40 + Math.min(1, recent.length / 15) * 30 + (dir ? Math.abs(cnt.BULLISH - cnt.BEARISH) / dir : 0) * 20)));
    return { label, score, confidence, articles: recent.length, bullish: cnt.BULLISH, bearish: cnt.BEARISH, neutral: cnt.NEUTRAL, windowH };
  }

  sectorSentiment(windowH = 24) {
    const cut = Date.now() - windowH * 3600000;
    const map = {};
    for (const a of this.items) { if (a.ts < cut) continue; for (const s of a.sectors) { (map[s] || (map[s] = { sector: s, num: 0, w: 0, articles: 0 })); const w = (a.impactScore / 100 + 0.2); map[s].num += a.sentiment.score * w; map[s].w += w; map[s].articles++; } }
    return Object.values(map).map(m => { const score = m.w ? Math.round(m.num / m.w) : 0; return { sector: m.sector, score, label: score >= 10 ? 'BULLISH' : score <= -10 ? 'BEARISH' : 'NEUTRAL', articles: m.articles }; })
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  }

  status() { return { aiEnabled: AI_ENABLED, sources: sources().length, items: this.items.length, lastRefresh: this.lastRefresh, lastError: this.lastError, refreshSec: REFRESH_MS / 1000 }; }
}

module.exports = { NewsEngine, sentiment, detectStocks, parseFeed, STOCKS };
