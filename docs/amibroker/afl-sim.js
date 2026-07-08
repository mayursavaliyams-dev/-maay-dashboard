#!/usr/bin/env node
/**
 * afl-sim.js — a "software AmiBroker" signal feeder.
 *
 * Does exactly what antigravity-bridge.afl does, but in Node so it can run WITHOUT the
 * AmiBroker desktop app: it polls the bot's LIVE index prices, computes an EMA-9/21 cross
 * per instrument, and POSTs CALL/PUT signals to the same endpoint the AFL uses
 * (/api/amibroker/push-signal). One send per instrument per new cross (deduped).
 *
 * Use it to (a) verify the pipeline live, or (b) drive the AmiBroker signal panel when you
 * don't have AmiBroker set up. 100% paper — signals are logged, not auto-traded.
 *
 *   node docs/amibroker/afl-sim.js               # every-15s loop, real EMA cross
 *   node docs/amibroker/afl-sim.js --burst 6     # send 6 demo signals fast, then exit
 */
'use strict';
const BOT = process.env.BOT_HOST || '127.0.0.1:3000';
const INSTS = [{ n: 'NIFTY', step: 50 }, { n: 'SENSEX', step: 100 }, { n: 'BANKNIFTY', step: 100 }];
const EMA = (arr, p) => { const k = 2 / (p + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; };
const buf = {}, lastSig = {};
const argBurst = (() => { const i = process.argv.indexOf('--burst'); return i > -1 ? (parseInt(process.argv[i + 1], 10) || 6) : 0; })();

async function get(path) { const r = await fetch(`http://${BOT}${path}`, { cache: 'no-store' }); return r.json(); }
async function push(sig, inst, conf, strike, price) {
  const url = `http://${BOT}/api/amibroker/push-signal?signal=${sig}&instrument=${inst}&confidence=${conf}&strike=${strike}&price=${price}&strategy=AFL_SIM`;
  const r = await fetch(url); const t = await r.text();
  console.log(`  → ${inst} ${sig} ${strike} @${price} conf${conf}  ·  ${t.trim()}`);
}

async function priceOf(inst) {
  try { const j = await get('/api/' + inst.toLowerCase()); return parseFloat(j.price) || 0; } catch (_) { return 0; }
}

async function tick(force) {
  for (const { n, step } of INSTS) {
    const px = await priceOf(n);
    if (!(px > 0)) continue;
    const b = (buf[n] = buf[n] || []); b.push(px); if (b.length > 60) b.shift();
    let sig = 'WAIT', conf = 62;
    if (b.length >= 21) { const e9 = EMA(b.slice(-21), 9), e21 = EMA(b.slice(-21), 21); if (e9 > e21) { sig = 'CALL'; conf = 72; } else if (e9 < e21) { sig = 'PUT'; conf = 72; } }
    if (force) { sig = Math.random() > 0.5 ? 'CALL' : 'PUT'; conf = 66 + Math.floor(Math.random() * 20); }   // demo burst
    if (sig === 'WAIT') continue;
    if (!force && lastSig[n] === sig) continue;                 // dedupe: only on a change
    lastSig[n] = sig;
    const strike = Math.round(px / step) * step;
    await push(sig, n, conf, strike, px.toFixed(2));
  }
}

(async () => {
  console.log(`afl-sim → bot ${BOT} · ${argBurst ? 'burst ' + argBurst : 'live EMA-cross loop (15s)'}\n`);
  if (argBurst) { for (let i = 0; i < argBurst; i++) { await tick(true); await new Promise(r => setTimeout(r, 800)); } console.log('\nburst done — check /ami-heatmap.html and /api/amibroker/status'); return; }
  await tick(false); setInterval(() => tick(false).catch(e => console.error(e.message)), 15000);
})();
