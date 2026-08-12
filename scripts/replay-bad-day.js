#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   replay-bad-day — drive the risk layer through a real crash day.

   USAGE
     node scripts/replay-bad-day.js                 both days
     node scripts/replay-bad-day.js 2025-04-07      one day

   THE DAYS, PICKED FROM 812 REAL DAILY BARS (2023-03-08 → 2026-06-18), NOT INVENTED

     2025-04-07   gap −5.00% at the open, closed −3.24%
     2024-06-04   range 8.16%, closed −5.93%  (election result day)

   WHAT THIS DOES AND DOES NOT SHOW

   It replays the day's PRICE PATH against the risk layer and reports which
   limits would have fired, when, and what they would have stopped. That is a
   real statement about the layer.

   It is NOT a P&L claim. What a position would have lost depends on what was
   held, at what strike, with what greeks — and the option chains for these dates
   were never stored. Every rupee figure below is therefore an EXPLICIT
   assumption, printed as one, and the honest output of this script is the
   sequence of limit breaches, not a saved-money number.

   The alternative — inventing an option book for a day whose chain nobody
   recorded, then reporting the losses it "prevented" — would produce exactly the
   kind of confident, well-formatted, unfalsifiable figure this project exists to
   avoid.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const riskConfig = require(path.join(ROOT, 'risk-config'));
const { KillSwitch } = require(path.join(ROOT, 'kill-switch'));
const { RiskManager } = require(path.join(ROOT, 'risk-manager'));

const DAYS = ['2025-04-07', '2024-06-04'];
const EQUITY = 700000;                       // the strangle engine's configured capital

const quiet = { warn() {}, error() {}, log() {} };

function loadDaily() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'bt-data', 'nifty-daily.json'), 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.candles || raw.data || Object.values(raw)[0]);
  return rows.map(r => Array.isArray(r)
    ? { date: String(r[0]).slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4] }
    : { date: String(r.date || r.d).slice(0, 10), open: r.open ?? r.o, high: r.high ?? r.h, low: r.low ?? r.l, close: r.close ?? r.c })
    .filter(x => Number.isFinite(x.close));
}

function loadIntraday(date) {
  const f = path.join(ROOT, 'bt-data', 'nifty-1min.json');
  if (!fs.existsSync(f)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.candles || raw.data || Object.values(raw)[0]);
    const day = rows
      .map(r => Array.isArray(r) ? { t: String(r[0]), c: r[4] } : { t: String(r.date || r.t), c: r.close ?? r.c })
      .filter(x => x.t.slice(0, 10) === date && Number.isFinite(x.c));
    return day.length ? day : null;
  } catch (_) { return null; }
}

/* The assumption set, printed with the results so no number here can be read as
   a measurement. A short-premium book is short gamma, and its greeks move
   against it as the underlying moves — that is the mechanism the expiry-day
   gamma limits exist for. */
const ASSUMPTION = {
  book: 'short strangle, both legs 1.5% out of the money, 2 lots per leg — the configuration the strangle engine runs',
  otmPct: 1.5,
  lots: 2,
  lotSize: 65,          // NIFTY, from the instrument registry
  deployedPct: 25,      // margin at work, comfortably inside the 35% per-underlying limit
  deltaPerPct: 45,      // net delta added per 1% adverse move
  gammaBase: 3,         // net gamma per ₹1 lakh at the open
  gammaGrowth: 1.9,     // short gamma accelerates as the move grows
};

/* Loss from a computable mechanism, not from a fitted coefficient.

   The first version of this script used `0.9 × (move%)²`, which produced −65% on
   an 8.5% day. The magnitude was not absurd, but the NUMBER WAS INVENTED — and
   the header of this very file warns against exactly that. So the loss is now
   the intrinsic value of the breached leg at the observed price, which anyone
   can check with a calculator:

     breach   = |move| − otmPct, in percent of the previous close
     points   = breach% × prevClose / 100
     loss     = points × lots × lotSize

   It ignores premium received (which reduces the loss) and vol expansion (which
   increases it, usually by more). Both are stated rather than netted, because a
   single "adjusted" figure would hide two assumptions inside one number. */
function modelledLossPct(movePct, prevClose) {
  const breachPct = Math.abs(movePct) - ASSUMPTION.otmPct;
  if (breachPct <= 0) return 0;                       // inside the strikes — the position is fine
  const points = breachPct * prevClose / 100;
  const loss = points * ASSUMPTION.lots * ASSUMPTION.lotSize;
  return -(loss / EQUITY * 100);
}

function replay(day, rows) {
  const i = rows.findIndex(r => r.date === day);
  if (i < 1) return { day, error: 'not in the daily history' };
  const prev = rows[i - 1], d = rows[i];

  const gapPct = (d.open - prev.close) / prev.close * 100;
  const closePct = (d.close - prev.close) / prev.close * 100;
  const rangePct = (d.high - d.low) / prev.close * 100;

  const intraday = loadIntraday(day);
  /* Path. Intraday bars if the archive has them; otherwise the four daily
     reference points, which is coarser and is SAID to be coarser rather than
     smoothed into something that looks like a tick stream. */
  const path_ = intraday
    ? intraday.map((b, k) => ({ label: b.t.slice(11, 16), px: b.c, minutesToClose: Math.max(0, intraday.length - k) }))
    : [
        { label: '09:15 open', px: d.open, minutesToClose: 375 },
        { label: 'extreme', px: Math.abs(d.low - prev.close) > Math.abs(d.high - prev.close) ? d.low : d.high, minutesToClose: 200 },
        { label: 'other extreme', px: Math.abs(d.low - prev.close) > Math.abs(d.high - prev.close) ? d.high : d.low, minutesToClose: 120 },
        { label: '15:30 close', px: d.close, minutesToClose: 0 },
      ];

  riskConfig.reload({ by: 'replay', log: quiet });
  const cfg = () => riskConfig.get();
  const ksFile = path.join(require('os').tmpdir(), `replay-ks-${process.pid}-${day}.json`);
  fs.rmSync(ksFile, { force: true });

  let clock = 0;
  const ks = new KillSwitch({ cfg, log: quiet, file: ksFile, now: () => clock });
  const rm = new RiskManager({ cfg, killSwitch: ks, log: quiet, now: () => clock });

  let peak = EQUITY;
  const events = [];
  let firstBlockAt = null, killedAt = null;

  for (const p of path_) {
    clock += 60000;
    const movePct = (p.px - prev.close) / prev.close * 100;
    const adverse = Math.abs(movePct);

    // Modelled portfolio state under the stated assumption.
    const dayPnlPct = modelledLossPct(movePct, prev.close);
    const equity = EQUITY * (1 + dayPnlPct / 100);
    peak = Math.max(peak, equity);
    const gammaPerLakh = ASSUMPTION.gammaBase * Math.pow(ASSUMPTION.gammaGrowth, adverse);

    const state = {
      equity, startOfDayEquity: EQUITY, peakEquityToday: peak,
      dayRealisedPnl: EQUITY * dayPnlPct / 100,
      deployed: EQUITY * ASSUMPTION.deployedPct / 100,
      deployedByUnderlying: { NIFTY: EQUITY * ASSUMPTION.deployedPct / 100 },
      openPositions: 2, lotsByInstrument: { NIFTY: 4 },
      greeks: {
        delta: ASSUMPTION.deltaPerPct * movePct * (equity / 100000),
        gamma: gammaPerLakh * (equity / 100000),
        vega: 400 * (equity / 100000),
        theta: -800 * (equity / 100000),
      },
      totalRisk: 40000, riskByExpiry: { '2025-04-10': 15000 },
      riskByStrike: { 'NIFTY|24300|CE': 6000 },
      isExpiryDay: false, minutesToClose: p.minutesToClose,
      dataAgeMs: 500, consecutiveLosses: 0,
    };

    ks.evaluate({ dayPnlPct, consecutiveLosses: 0, dataAgeMs: 500 });

    const decision = rm.evaluate({
      strategy: 'STRANGLE', instrument: 'NIFTY', strike: 24300, optionType: 'CE',
      side: 'SELL', expiry: '2025-04-10', stopDistance: 25, lotSize: 65, requestedLots: 2,
    }, state);

    const row = {
      at: p.label, px: +p.px.toFixed(2), movePct: +movePct.toFixed(2),
      modelledDayPnlPct: +dayPnlPct.toFixed(2),
      gammaPerLakh: +gammaPerLakh.toFixed(2),
      approved: decision.approved,
      blockedBy: decision.blocks.map(b => b.name),
      killSwitch: ks.status().tripped ? ks.status().reason : null,
    };
    events.push(row);
    if (!decision.approved && firstBlockAt === null) firstBlockAt = p.label;
    if (ks.status().tripped && killedAt === null) killedAt = p.label;
  }

  fs.rmSync(ksFile, { force: true });
  return {
    day, prevClose: prev.close, open: d.open, high: d.high, low: d.low, close: d.close,
    gapPct: +gapPct.toFixed(2), closePct: +closePct.toFixed(2), rangePct: +rangePct.toFixed(2),
    pathSource: intraday ? `${intraday.length} one-minute bars` : 'four daily reference points (no intraday bars archived for this date)',
    firstBlockAt, killedAt, events,
  };
}

const rows = loadDaily();
const want = process.argv[2] ? [process.argv[2]] : DAYS;

console.log('\nRISK LAYER — replay of real crash days');
console.log(`Daily history: ${rows.length} bars, ${rows[0].date} → ${rows[rows.length - 1].date}`);
console.log(`Equity assumed: ₹${EQUITY.toLocaleString('en-IN')}\n`);
console.log('ASSUMPTIONS (this is a limit-breach report, NOT a P&L claim):');
console.log(`  book:  ${ASSUMPTION.book}`);
console.log(`  loss:  intrinsic value of the breached leg = (|move| − ${ASSUMPTION.otmPct}%) × prevClose × ${ASSUMPTION.lots} lots × ${ASSUMPTION.lotSize}`);
console.log(`         — checkable with a calculator. Premium received (reduces it) and vol expansion`);
console.log(`         (increases it, usually by more) are BOTH excluded rather than netted into one figure.`);
console.log(`  greeks are MODELLED from the price path — the option chains for these dates were never`);
console.log(`  stored, so no measured book exists for them.\n`);

for (const day of want) {
  const r = replay(day, rows);
  if (r.error) { console.log(`${day}: ${r.error}\n`); continue; }

  console.log('═'.repeat(78));
  console.log(`${r.day}   prev close ${r.prevClose}  ·  open ${r.open}  ·  low ${r.low}  ·  high ${r.high}  ·  close ${r.close}`);
  console.log(`  gap ${r.gapPct}%   close ${r.closePct}%   range ${r.rangePct}%`);
  console.log(`  path: ${r.pathSource}`);
  console.log('─'.repeat(78));
  console.log('  when            price     move   mod.P&L   γ/lakh   new entries   blocked by');
  for (const e of r.events.slice(0, 12)) {
    console.log(`  ${String(e.at).padEnd(14)} ${String(e.px).padStart(9)} ${String(e.movePct + '%').padStart(7)} ` +
      `${String(e.modelledDayPnlPct + '%').padStart(9)} ${String(e.gammaPerLakh).padStart(8)}   ` +
      `${(e.approved ? 'ALLOWED' : 'BLOCKED').padEnd(13)} ${e.blockedBy.join(', ') || '—'}`);
  }
  if (r.events.length > 12) console.log(`  … ${r.events.length - 12} more steps`);
  console.log('─'.repeat(78));
  console.log(`  first block:    ${r.firstBlockAt || 'never'}`);
  console.log(`  kill switch:    ${r.killedAt ? `TRIPPED at ${r.killedAt}` : 'not tripped'}`);
  const limits = [...new Set(r.events.flatMap(e => e.blockedBy))];
  console.log(`  limits that fired: ${limits.length ? limits.join(', ') : 'none'}`);
  console.log('');
}

console.log('WHAT THIS DOES NOT SAY');
console.log('  It does not say how much money was saved. That depends on the positions actually');
console.log('  held and their greeks, and the option chains for these dates were never stored.');
console.log('  The finding is WHICH limits fire and WHEN — not a rupee figure.\n');
