'use strict';
/**
 * warehouse-capture.js — Phase 1 data capture. Out-of-process, append-only, additive.
 *
 * WHY: three columns gate everything the platform wants to become, and every day they
 * are not captured is permanently lost history (docs/REPORT-bot-vs-world-best.md §5
 * Phase 1; docs/H19-HISTORICAL-OPTION-DATA-WAREHOUSE.md):
 *
 *   1. INTRADAY OPTION CHAINS  — the raw per-strike record (21 columns incl. delta,
 *      gamma, theta, vega, iv, ivSource, oi, bid/ask, volume). Gates all vol/flow work.
 *   2. OUTCOMES WITH ENTRY GREEKS — the platform has ~50 labelled outcomes and stores
 *      NO entry Greeks beside realized P&L, which is why the probability layer is
 *      blocked. This records the open, the entry Greeks, and the close.
 *   3. DAILY NAV SERIES — no daily NAV series exists anywhere, so Sharpe / drawdown /
 *      any portfolio statistic is currently uncomputable.
 *
 * It touches NO engine and NO server code: it reads the same public HTTP endpoints the
 * dashboards read, and appends to data/warehouse/. Removing it changes nothing else.
 *
 * NO NEW MARKET-SESSION LOGIC. Session logic already exists three times in this repo
 * with divergent open times; a fourth would make the drift worse. Instead each writer
 * is CONTENT-ADDRESSED: a snapshot identical to the previous one is not appended. Out
 * of hours the chain stops changing, so the capture self-gates. That is fewer moving
 * parts and no clock to disagree about.
 *
 * HONESTY: entry Greeks are RECONSTRUCTED from the chain at the moment a position is
 * first observed, not recorded by the engine at its true entry instant. Every row
 * therefore carries `greeksSource:'chain-at-first-sight'` and `entryLagMs` (how stale
 * the reconstruction is versus the book's own `openAt`), so a researcher can filter.
 * Never a fabricated value: unknown stays null.
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_BASE  = process.env.WAREHOUSE_ROOT || __dirname;
const WAREHOUSE = path.join(OUT_BASE, 'data', 'warehouse');
const CHAIN_DIR = path.join(WAREHOUSE, 'L0_raw', 'chain');       // <inst>/<date>.jsonl
const OUTC_DIR  = path.join(WAREHOUSE, 'L1_outcomes');           // <date>.jsonl
const NAV_DIR   = path.join(WAREHOUSE, 'L1_nav');                // <year>.jsonl
const STATE_F   = path.join(WAREHOUSE, '_manifest', 'capture-state.json');

const API = process.env.CAPTURE_API || 'http://localhost:3000';
const INSTRUMENTS = (process.env.CAPTURE_INSTRUMENTS || 'NIFTY,SENSEX,BANKNIFTY').split(',').map(s => s.trim()).filter(Boolean);
const IST_OFFSET_MIN = 330;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const istDate = (ms = Date.now()) => new Date(ms + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);

function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

/* ── tiny state file: last content hash per stream, so we never append a duplicate ── */
function readState() {
  // Through the validated reader, not a raw parse: it recovers from the .bak this
  // module itself writes, and refuses a corrupt file instead of silently returning {}
  // — a silent {} would re-emit OPEN rows for positions already recorded.
  try {
    return require('./safe-write.js').readJsonSync(STATE_F, {
      fallback: {},
      onRecover: (reason, bak) => console.warn(`[capture] state was corrupt (${reason}); recovered from ${bak}`),
    });
  } catch (e) { console.warn(`[capture] state unreadable: ${e.message} — starting a fresh baseline`); return {}; }
}
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_F), { recursive: true });
    require('./safe-write.js').writeJsonSync(STATE_F, s, { pretty: true, backup: true });
  } catch (e) { console.warn(`[capture] state write failed: ${e.message}`); }
}

async function jget(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

/* ══════════════════════════════════════════════════════════════════════════════
   1. CHAIN SNAPSHOT  —  every column the feed gives, verbatim, unknown stays null
   ══════════════════════════════════════════════════════════════════════════════ */
const LEG_COLS = ['ltp','oi','changeOI','volume','iv','ivSource','open','high','low','close',
                  'prevClose','bid','ask','bidQty','askQty','delta','gamma','theta','vega','pop'];

function legRow(leg) {
  if (!leg) return null;
  const o = {};
  for (const c of LEG_COLS) {
    o[c] = (c === 'ivSource') ? (leg[c] ?? null) : num(leg[c]);
  }
  return o;
}

/** Build the snapshot object for one instrument. Pure — testable without a socket. */
function buildChainSnapshot(inst, chain, now = Date.now()) {
  if (!chain || !Array.isArray(chain.strikes) || !chain.strikes.length) return null;
  return {
    v: 1, kind: 'chain', inst,
    at: new Date(now).toISOString(), ts: now, tradingDay: istDate(now),
    source: chain.source ?? null,
    spot: num(chain.spotPrice), atm: num(chain.atmStrike),
    pcrOI: num(chain.pcr?.pcrOI), maxPain: num(chain.maxPain?.maxPain),
    strikes: chain.strikes.map(s => ({ k: num(s.strike), ce: legRow(s.ce), pe: legRow(s.pe) })),
  };
}

/* The fingerprint keys on what was OBSERVED, never on what was COMPUTED.
 *
 * Measured 2026-07-26 with the market closed and spot frozen: between two polls 60s
 * apart, 160 cells changed and every one of them was `gamma`, `theta`, `vega` or `iv`.
 * Those are model outputs whose only moving input is time-to-expiry — they drift with
 * the clock forever. Hashing them meant the capture never self-gated and would have
 * written ~66 MB a day of pure clock-drift through every night and weekend.
 *
 * So the key is the observable market only: traded price, book, size, interest. The
 * derived Greeks still ride along in the row that gets written — they just do not get
 * a vote on whether anything happened. */
const OBSERVED_COLS = ['ltp','oi','changeOI','volume','bid','ask','bidQty','askQty',
                       'open','high','low','close','prevClose'];
function chainFingerprint(snap) {
  const pick = leg => leg ? OBSERVED_COLS.map(c => leg[c]) : null;
  return sha(JSON.stringify({
    spot: snap.spot, atm: snap.atm,
    strikes: (snap.strikes || []).map(s => [s.k, pick(s.ce), pick(s.pe)]),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════════
   2. OUTCOMES  —  open (with reconstructed entry Greeks) and close
   ══════════════════════════════════════════════════════════════════════════════ */
const posKey = p => `${p.inst}|${p.strike}|${p.type}|${p.openAt || p.id || ''}`;

/** Which positions appeared and which vanished between two book reads. Pure. */
function diffBook(prev, next) {
  const P = new Map((prev || []).map(p => [posKey(p), p]));
  const N = new Map((next || []).map(p => [posKey(p), p]));
  const opened = [], closed = [];
  for (const [k, v] of N) if (!P.has(k)) opened.push(v);
  for (const [k, v] of P) if (!N.has(k)) closed.push(v);
  return { opened, closed };
}

/** Find a strike's live Greeks in a snapshot. Returns null when absent — never a guess. */
function greeksFrom(snap, strike, type) {
  if (!snap || !Array.isArray(snap.strikes)) return null;
  const row = snap.strikes.find(s => Number(s.k) === Number(strike));
  if (!row) return null;
  return row[String(type).toLowerCase() === 'ce' ? 'ce' : 'pe'] || null;
}

/** Build the OPEN row for a newly-seen position. Pure. */
function openRow(pos, snap, now = Date.now()) {
  const g = greeksFrom(snap, pos.strike, pos.type);
  const openedAtMs = pos.openAt ? Date.parse(pos.openAt) : null;
  return {
    v: 1, kind: 'OPEN', at: new Date(now).toISOString(), ts: now, tradingDay: istDate(now),
    inst: pos.inst ?? null, strike: num(pos.strike), type: pos.type ?? null,
    side: pos.side ?? null, premium: num(pos.premium), lot: num(pos.lot),
    creditCollected: num(pos.creditCollected), popAtEntry: num(pos.pop),
    lotSource: pos.lotSource ?? null, openAt: pos.openAt ?? null, mode: pos.mode ?? null,
    spotAtCapture: snap ? snap.spot : null,
    // The one column the platform has never stored. Reconstructed, and labelled as such.
    entryGreeks: g ? { delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega,
                       iv: g.iv, ivSource: g.ivSource, ltp: g.ltp, oi: g.oi } : null,
    greeksSource: g ? 'chain-at-first-sight' : null,
    entryLagMs: (openedAtMs && Number.isFinite(openedAtMs)) ? (now - openedAtMs) : null,
  };
}

/** Build the CLOSE row for a position that left the book. Pure. */
function closeRow(pos, snap, now = Date.now()) {
  const g = greeksFrom(snap, pos.strike, pos.type);
  return {
    v: 1, kind: 'CLOSE', at: new Date(now).toISOString(), ts: now, tradingDay: istDate(now),
    inst: pos.inst ?? null, strike: num(pos.strike), type: pos.type ?? null,
    side: pos.side ?? null, entryPremium: num(pos.premium), lot: num(pos.lot),
    openAt: pos.openAt ?? null,
    spotAtCapture: snap ? snap.spot : null,
    exitLtp: g ? g.ltp : null,
    exitGreeks: g ? { delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega,
                      iv: g.iv, ivSource: g.ivSource } : null,
    // P&L is NOT computed here. The book reports gross-of-charges numbers and this
    // observer cannot see the fill; a rupee figure invented at this layer would be a
    // fabricated outcome. The join to a realized P&L belongs to a derivation step.
    realizedPnl: null,
    pnlNote: 'not captured at this layer — derive from the engine ledger, net of charges',
    heldMs: pos.openAt ? (now - Date.parse(pos.openAt)) : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   3. DAILY NAV
   ══════════════════════════════════════════════════════════════════════════════ */
function navRow(books, now = Date.now()) {
  const row = { v: 1, kind: 'NAV', at: new Date(now).toISOString(), ts: now,
                tradingDay: istDate(now), books: {}, total: null };
  let total = 0, any = false;
  for (const [name, s] of Object.entries(books || {})) {
    if (!s) { row.books[name] = null; continue; }          // unreachable ⇒ null, not 0
    const equity = num(s.equity);
    row.books[name] = { equity, peakEquity: num(s.peakEquity), consecLosses: num(s.consecLosses),
                        halted: (typeof s.halted === 'boolean') ? s.halted : null };
    if (equity != null) { total += equity; any = true; }
  }
  // A total that silently omits an unreachable book would overstate health. If any
  // book is missing, the total is null and the reason is recorded.
  const missing = Object.entries(row.books).filter(([, v]) => !v || v.equity == null).map(([k]) => k);
  row.total = (any && missing.length === 0) ? +total.toFixed(2) : null;
  row.incomplete = missing.length ? missing : null;
  return row;
}
function navFingerprint(row) {
  return sha(JSON.stringify({ books: row.books, total: row.total }));
}

/* ══════════════════════════════════════════════════════════════════════════════
   ORCHESTRATION
   ══════════════════════════════════════════════════════════════════════════════ */
async function captureOnce(opts = {}) {
  const now = opts.now || Date.now();
  const state = readState();
  const summary = { at: new Date(now).toISOString(), chain: {}, opened: 0, closed: 0, nav: 'skipped', errors: [] };
  const snaps = {};

  // ── 1. chain snapshots (sequential: the server's OptionAnalyzer is a shared
  //       singleton mutated per request — TD-2 — so never fan these out) ──
  for (const inst of INSTRUMENTS) {
    const chain = await jget(`${API}/api/options/chain?instrument=${inst}`);
    const snap = buildChainSnapshot(inst, chain, now);
    if (!snap) { summary.chain[inst] = 'no-data'; continue; }
    snaps[inst] = snap;
    const fp = chainFingerprint(snap);
    if (state[`chain:${inst}`] === fp) { summary.chain[inst] = 'unchanged'; continue; }
    try {
      appendLine(path.join(CHAIN_DIR, inst, `${snap.tradingDay}.jsonl`), snap);
      state[`chain:${inst}`] = fp;
      summary.chain[inst] = `appended(${snap.strikes.length})`;
    } catch (e) { summary.errors.push(`chain ${inst}: ${e.message}`); }
  }

  // ── 2. outcomes: diff the open paper book ──
  const pop = await jget(`${API}/api/pop/status`);
  if (pop && Array.isArray(pop.book)) {
    const prev = Array.isArray(state.book) ? state.book : null;
    if (prev === null) {
      // First run: adopt the current book as the baseline WITHOUT emitting OPEN rows.
      // Those positions were opened before this recorder existed; claiming to have
      // captured their entry Greeks would be a lie about when we looked.
      state.book = pop.book.map(p => ({ inst:p.inst, strike:p.strike, type:p.type, openAt:p.openAt, id:p.id }));
      summary.nav = summary.nav; summary.baseline = pop.book.length;
    } else {
      const { opened, closed } = diffBook(prev, pop.book);
      for (const p of opened) {
        try { appendLine(path.join(OUTC_DIR, `${istDate(now)}.jsonl`), openRow(p, snaps[p.inst], now)); summary.opened++; }
        catch (e) { summary.errors.push(`open: ${e.message}`); }
      }
      for (const p of closed) {
        try { appendLine(path.join(OUTC_DIR, `${istDate(now)}.jsonl`), closeRow(p, snaps[p.inst], now)); summary.closed++; }
        catch (e) { summary.errors.push(`close: ${e.message}`); }
      }
      state.book = pop.book.map(p => ({ inst:p.inst, strike:p.strike, type:p.type, openAt:p.openAt, id:p.id }));
    }
  }

  // ── 3. NAV ──
  const sensex = await jget(`${API}/api/engine/status`);
  const nifty  = await jget(`${API}/api/nifty/engine/status`);
  const shape = s => s ? { equity: (s.halt && s.halt.currentEquity != null) ? s.halt.currentEquity : s.capital,
                           peakEquity: s.halt ? s.halt.peakEquity : null,
                           consecLosses: s.halt ? s.halt.consecLosses : null,
                           halted: s.halt ? s.halt.halted : null } : null;
  const row = navRow({ sensex: shape(sensex), nifty: shape(nifty) }, now);
  const nfp = navFingerprint(row);
  if (state['nav'] !== nfp) {
    try {
      appendLine(path.join(NAV_DIR, `${row.tradingDay.slice(0, 4)}.jsonl`), row);
      state['nav'] = nfp; summary.nav = row.total == null ? 'appended(incomplete)' : `appended(₹${row.total})`;
    } catch (e) { summary.errors.push(`nav: ${e.message}`); }
  } else summary.nav = 'unchanged';

  writeState(state);
  return summary;
}

module.exports = { buildChainSnapshot, chainFingerprint, diffBook, greeksFrom, openRow,
                   closeRow, navRow, navFingerprint, captureOnce, legRow,
                   CHAIN_DIR, OUTC_DIR, NAV_DIR, STATE_F, INSTRUMENTS };

// ── CLI: one shot, or a loop (`--every <sec>`) ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const ix = args.indexOf('--every');
  const every = ix >= 0 ? Math.max(15, parseInt(args[ix + 1] || '60', 10)) : 0;
  const run = async () => {
    const s = await captureOnce();
    const ch = Object.entries(s.chain).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`[capture ${s.at}] ${ch} | opened=${s.opened} closed=${s.closed} nav=${s.nav}` +
                (s.baseline != null ? ` baseline=${s.baseline}` : '') +
                (s.errors.length ? ` errors=${s.errors.length}` : ''));
    s.errors.forEach(e => console.warn('  ! ' + e));
  };
  run();
  if (every) { console.log(`[capture] continuous every ${every}s — Ctrl-C to stop.`); setInterval(run, every * 1000); }
}
