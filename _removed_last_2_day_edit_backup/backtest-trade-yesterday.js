/**
 * Replays yesterday's (Apr 30, 2026) NIFTY ORB+VWAP strategy on live Dhan
 * intraday data and prints the would-be trade with current SL/Target/Trail.
 *
 * Mirrors what the live bot WOULD have done if today's ORB-persistence fix
 * had been in place yesterday at 10:02 IST when the server restarted.
 */
require('dotenv').config();
const fetch = require('node-fetch');

const TOKEN  = process.env.DHAN_ACCESS_TOKEN;
const CLIENT = process.env.DHAN_CLIENT_ID;
const BASE   = 'https://api.dhan.co';

const SL_PCT       = Number(process.env.STOP_LOSS_PERCENT     || 5);
const TARGET_PCT   = Number(process.env.TARGET_PERCENT        || 400);
const TRAIL_AFTER  = Number(process.env.TRAIL_AFTER_MULTIPLE  || 2);
const TRAIL_LOCK   = Number(process.env.TRAIL_LOCK_PERCENT    || 90);
const SLIP_PCT     = Number(process.env.SLIPPAGE_PERCENT      || 2);
const STRIKE_OFFSET = 2;          // ATM - 2 (PUT) / ATM + 2 (CALL)
const NIFTY_STRIKE_STEP = 50;
const LOT_SIZE     = 65;
const BROKERAGE    = 30;          // per side

const DATE = process.argv[2] || '2026-04-30';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'access-token':TOKEN, 'client-id':CLIENT },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = {raw:text}; }
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0,200)}`);
  return data;
}

function istTime(unixSec) { return new Date(unixSec * 1000 + 5.5*3600*1000); }
function istHHMM(unixSec) { const d = istTime(unixSec); return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`; }
function istMins(unixSec) { const d = istTime(unixSec); return d.getUTCHours()*60 + d.getUTCMinutes(); }

function vwap(prices, volumes) {
  let pv=0, v=0;
  for (let i=0;i<Math.min(prices.length,volumes.length);i++){ pv+=prices[i]*volumes[i]; v+=volumes[i]; }
  return v ? pv/v : 0;
}

(async () => {
  console.log(`\n═══  NIFTY ORB+VWAP REPLAY — ${DATE}  ═══`);
  console.log(`Config: SL=${SL_PCT}%  Target=${TARGET_PCT}%  Trail=${TRAIL_AFTER}× lock ${TRAIL_LOCK}%  Slip=${SLIP_PCT}%`);

  // 1. NIFTY spot 1-min candles
  const spotR = await post('/v2/charts/intraday', {
    securityId:'13', exchangeSegment:'IDX_I', instrument:'INDEX',
    interval:'1', fromDate:DATE, toDate:DATE
  });
  if (!spotR.close?.length) { console.log('No spot data — market holiday or pre-market.'); return; }
  const candles = spotR.close.map((c, i) => ({
    t:spotR.timestamp[i], o:spotR.open[i], h:spotR.high[i], l:spotR.low[i], c, v:spotR.volume[i]
  }));
  console.log(`Loaded ${candles.length} 1-min NIFTY candles (${istHHMM(candles[0].t)}–${istHHMM(candles[candles.length-1].t)} IST)`);

  // 2. Compute ORB (9:15–9:30) and run signal scan
  let orbHigh=null, orbLow=null;
  const prices=[], volumes=[];
  let signal=null;

  for (const c of candles) {
    const m = istMins(c.t);
    if (m < 9*60+15) continue;
    prices.push(c.c); volumes.push(c.v||1);
    if (m <= 9*60+30) {
      if (orbHigh===null||c.h>orbHigh) orbHigh=c.h;
      if (orbLow ===null||c.l<orbLow ) orbLow =c.l;
      continue;
    }
    if (signal) continue;
    if (orbHigh===null||orbLow===null) continue;
    if ((orbHigh-orbLow)/orbLow < 0.003) continue;
    if (m < 9*60+31 || m > 10*60+30) continue;
    const v = vwap(prices, volumes);
    const bull = c.c > orbHigh && c.c > v;
    const bear = c.c < orbLow  && c.c < v;
    if (bull || bear) {
      signal = { side: bull?'CALL':'PUT', entry:c, vwap:v };
    }
  }

  console.log(`\nORB:   high=${orbHigh}  low=${orbLow}  range=${(orbHigh-orbLow).toFixed(2)} (${((orbHigh-orbLow)/orbLow*100).toFixed(2)}%)`);
  if (!signal) { console.log('\nNo ORB break with VWAP confirmation in 9:31–10:30.'); return; }

  const e = signal.entry;
  console.log(`\nSIGNAL: ${signal.side}  @ ${istHHMM(e.t)} IST  spot=${e.c}  vwap=${signal.vwap.toFixed(2)}`);

  // 3. Resolve expiry
  const atm = Math.round(e.c / NIFTY_STRIKE_STEP) * NIFTY_STRIKE_STEP;
  await sleep(400);
  const expR = await post('/v2/optionchain/expirylist', { UnderlyingScrip:13, UnderlyingSeg:'IDX_I' });
  const expiry = (expR.data || []).find(d => d >= DATE) || expR.data[0];
  console.log(`ATM: ${atm}  Expiry: ${expiry}`);
  await sleep(400);
  const chainR = await post('/v2/optionchain', {
    UnderlyingScrip:13, UnderlyingSeg:'IDX_I', Expiry:expiry
  });
  const oc = chainR.data?.oc || {};

  // 4. Walk OTM from offset 1..20 until we find a strike whose entry-minute open ≤ MAX_PREMIUM
  const MAX_PREM = Number(process.env.NIFTY_MAX_PREMIUM || 0) || null;
  const MIN_PREM = Number(process.env.NIFTY_MIN_PREMIUM || 0) || null;
  let strike=null, leg=null, optCandles=null, entryIdx=-1, entryRaw=null, chosenOff=null;
  for (let off=1; off<=20; off++) {
    const tryStrike = signal.side==='CALL' ? atm + off*NIFTY_STRIKE_STEP : atm - off*NIFTY_STRIKE_STEP;
    const sk = Object.keys(oc).find(k => Math.abs(Number(k) - tryStrike) < 0.5);
    const tryLeg = signal.side==='CALL' ? oc[sk]?.ce : oc[sk]?.pe;
    if (!tryLeg?.security_id) continue;
    await sleep(350);
    let optR;
    try {
      optR = await post('/v2/charts/intraday', {
        securityId: String(tryLeg.security_id),
        exchangeSegment: 'NSE_FNO', instrument: 'OPTIDX',
        interval: '1', fromDate: DATE, toDate: DATE,
      });
    } catch(_) { continue; }
    if (!optR.close?.length) continue;
    const tryCandles = optR.close.map((c, i) => ({
      t:optR.timestamp[i], o:optR.open[i], h:optR.high[i], l:optR.low[i], c, v:optR.volume[i]
    }));
    const idx = tryCandles.findIndex(o => o.t >= e.t);
    if (idx < 0) continue;
    const raw = tryCandles[idx].o;
    if (MAX_PREM && raw > MAX_PREM) { console.log(`  off=${off}  strike=${tryStrike}  ₹${raw.toFixed(2)} > cap ₹${MAX_PREM} — walk further`); continue; }
    if (MIN_PREM && raw < MIN_PREM) { console.log(`  off=${off}  strike=${tryStrike}  ₹${raw.toFixed(2)} < min ₹${MIN_PREM} — too cheap`); break; }
    strike=tryStrike; leg=tryLeg; optCandles=tryCandles; entryIdx=idx; entryRaw=raw; chosenOff=off;
    console.log(`  off=${off}  strike=${tryStrike}  ₹${raw.toFixed(2)} ✓ FITS — pick this`);
    break;
  }
  if (strike === null) { console.log(`\n⛔ SKIP — no strike fits cap ₹${MAX_PREM} from offset 1..20`); return; }
  console.log(`\nPicked: ${strike} ${signal.side==='CALL'?'CE':'PE'}  off=${chosenOff}  secId=${leg.security_id}`);
  const entryCandle = optCandles[entryIdx];
  const entryFill = entryRaw * (1 + SLIP_PCT/100);
  console.log(`\nEntry: ${istHHMM(entryCandle.t)} IST  raw=${entryRaw.toFixed(2)}  filled=${entryFill.toFixed(2)} (slip ${SLIP_PCT}%)`);
  // 5. Simulate exits — Stop / Target / Trail / EOD
  const slPrice  = entryFill * (1 - SL_PCT/100);
  const tgtPrice = entryFill * (1 + TARGET_PCT/100);
  const trailArm = entryFill * (1 + (TRAIL_AFTER-1) * 100/100);  // = entry * TRAIL_AFTER
  let trailing = false;
  let peak = entryFill;
  let exit = null;

  for (let i=entryIdx; i<optCandles.length; i++) {
    const c = optCandles[i];
    if (c.h > peak) peak = c.h;
    if (!trailing && c.h >= entryFill * TRAIL_AFTER) trailing = true;

    // Target hit (high touched target intra-bar)
    if (c.h >= tgtPrice) {
      exit = { reason:'TARGET', price: tgtPrice * (1 - SLIP_PCT/100), candle: c };
      break;
    }
    // Trail stop (locked TRAIL_LOCK% of peak gain after activation)
    if (trailing) {
      const trailStopPrice = entryFill + (peak - entryFill) * (TRAIL_LOCK/100);
      if (c.l <= trailStopPrice) {
        exit = { reason:'TRAIL_STOP', price: trailStopPrice * (1 - SLIP_PCT/100), candle: c };
        break;
      }
    }
    // Stop loss
    if (c.l <= slPrice) {
      exit = { reason:'STOP_LOSS', price: slPrice * (1 - SLIP_PCT/100), candle: c };
      break;
    }
    // EOD
    if (istMins(c.t) >= 15*60+15) {
      exit = { reason:'EOD_CLOSE', price: c.c * (1 - SLIP_PCT/100), candle: c };
      break;
    }
  }

  if (!exit) {
    const last = optCandles[optCandles.length-1];
    exit = { reason:'EOD_CLOSE', price: last.c * (1 - SLIP_PCT/100), candle: last };
  }

  const grossPnL = (exit.price - entryFill) * LOT_SIZE;
  const netPnL   = grossPnL - 2 * BROKERAGE;
  const mult     = exit.price / entryFill;
  const pct      = (mult - 1) * 100;

  console.log(`\nExit:  ${istHHMM(exit.candle.t)} IST  price=${exit.price.toFixed(2)}  reason=${exit.reason}`);
  console.log(`\n┌─ RESULT ────────────────────────────────────────┐`);
  console.log(`│ ${signal.side}  Strike ${strike}  Lot ${LOT_SIZE}              │`);
  console.log(`│ Entry: ₹${entryFill.toFixed(2)}   Exit: ₹${exit.price.toFixed(2)}   ${mult.toFixed(2)}×        │`);
  console.log(`│ P&L:  ${pct>=0?'+':''}${pct.toFixed(1)}%   gross ₹${grossPnL.toFixed(0)}   net ₹${netPnL.toFixed(0)} │`);
  console.log(`└─────────────────────────────────────────────────┘`);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
