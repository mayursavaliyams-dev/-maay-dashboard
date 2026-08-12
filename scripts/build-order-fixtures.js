#!/usr/bin/env node
/**
 * build-order-fixtures — Phase 1.2, golden-path replay fixtures.
 *
 * Derives a deterministic sequence of order intents from REAL captured option
 * chains, one fixture per session character. Nothing here is invented: every
 * strike, premium, quote and spot in the output was recorded by this system's
 * own warehouse capture on the stated date.
 *
 * The four characters are not chosen by preference. They were measured across
 * the four captured sessions (2026-07-27..30) and each session was assigned the
 * character it actually exhibits:
 *
 *   quiet     2026-07-29   range 61.8 pts, net +16.7
 *   trending  2026-07-30   range 92.2 pts, net +41.3, cleanest cadence
 *   expiry    2026-07-28   Tuesday — NIFTY expiry weekday per the registry
 *   feed-gap  2026-07-27   a 44.7-minute hole in an otherwise 60-second feed
 *
 * Run: node scripts/build-order-fixtures.js
 * Out: test/fixtures/order-path/<character>.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../instrument-registry.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'warehouse', 'L0_raw', 'chain', 'NIFTY');
const OUT = path.join(ROOT, 'test', 'fixtures', 'order-path');

/* Session → character. Assigned from measurement, recorded here so the mapping
   is auditable rather than folklore. */
const SESSIONS = [
  { date: '2026-07-29', character: 'quiet',    note: 'range 61.8 pts over the captured window' },
  { date: '2026-07-30', character: 'trending', note: 'range 92.2 pts, net +41.3, 5-minute cadence held' },
  { date: '2026-07-28', character: 'expiry',   note: 'Tuesday — NIFTY expiry weekday (registry expiryDow=2)' },
  { date: '2026-07-27', character: 'feed-gap', note: '44.7-minute gap in a 60-second feed' },
];

/* How many intents per fixture. Small enough that a parity diff is readable by a
   human, large enough that an ordering bug shows up. */
const INTENTS_PER_SESSION = 12;

function readSnapshots(date) {
  const file = path.join(SRC, `${date}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (typeof o.spot !== 'number' || !Array.isArray(o.strikes)) continue;
    out.push(o);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** The side of the chain at `strike`, or null. Never a zero-filled stand-in. */
function sideAt(snap, strike, type) {
  const row = snap.strikes.find(s => Number(s.k) === Number(strike));
  if (!row) return null;
  const side = type === 'CE' ? row.ce : row.pe;
  if (!side || typeof side.ltp !== 'number') return null;
  return side;
}

function build(session) {
  const snaps = readSnapshots(session.date);
  if (!snaps || snaps.length === 0) return null;

  const lot = registry.lotSize('NIFTY');
  const intents = [];

  /* Sample evenly across the captured window rather than taking the first N —
     the first N would all come from the same few minutes and would exercise one
     market state repeatedly. */
  const stride = Math.max(1, Math.floor(snaps.length / INTENTS_PER_SESSION));

  for (let i = 0, seq = 0; i < snaps.length && intents.length < INTENTS_PER_SESSION; i += stride) {
    const snap = snaps[i];
    const type = intents.length % 2 === 0 ? 'CE' : 'PE';
    const side = sideAt(snap, snap.atm, type);

    /* A missing side is recorded as a SKIPPED intent, not dropped and not
       zero-filled. The feed-gap fixture exists precisely to carry holes, and a
       fixture that quietly repaired them would test the wrong thing. */
    if (!side) {
      intents.push({
        seq: ++seq, at: snap.at, skipped: true,
        reason: `no ${type} side for strike ${snap.atm} in this snapshot`,
        instrument: 'NIFTY', strike: snap.atm, optionType: type,
      });
      continue;
    }

    intents.push({
      seq: ++seq,
      at: snap.at,
      instrument: 'NIFTY',
      strike: snap.atm,
      optionType: type,
      side: 'SELL',                      // the platform's edge is selling; buys are the exception
      lots: 1,
      quantity: lot,
      // Recorded market state at the moment of the intent — used by the parity
      // harness to assert that the two paths saw identical inputs.
      market: {
        spot: snap.spot,
        ltp: side.ltp,
        bid: side.bid ?? null,
        ask: side.ask ?? null,
        iv: side.ivSource === 'feed' ? side.iv : null,   // bsm-derived IV is not a feed observation
        ivSource: side.ivSource ?? null,
        oi: side.oi ?? null,
      },
    });
  }

  return {
    _generatedBy: 'scripts/build-order-fixtures.js',
    _source: `data/warehouse/L0_raw/chain/NIFTY/${session.date}.jsonl`,
    /* Corrected 2026-07-31 by a claim audit. This field previously read
       "Every value below was captured live. Nothing is synthetic" — which was
       false, and the worst kind of false: a provenance claim embedded in the
       artefact it describes, where a later reader would have no reason to
       doubt it. The market observations ARE captured. The order shape around
       them is constructed. Both facts are now stated. */
    _captured: 'at, instrument, strike (= captured ATM), and every field under `market` — recorded live on the stated date',
    _constructed: 'seq, side (SELL — the platform sells), lots (1), quantity (= registry lot size), and the CE/PE alternation. These describe a hypothetical order placed against real market state; they were not observed.',
    session: session.date,
    character: session.character,
    characterEvidence: session.note,
    lotSize: lot,
    snapshotCount: snaps.length,
    windowIST: [snaps[0].at, snaps[snaps.length - 1].at],
    intents,
  };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let written = 0;
  for (const s of SESSIONS) {
    const fixture = build(s);
    if (!fixture) { console.error(`  ✗ ${s.character}: no capture for ${s.date}`); continue; }
    const file = path.join(OUT, `${s.character}.json`);
    fs.writeFileSync(file, JSON.stringify(fixture, null, 1));
    const skipped = fixture.intents.filter(i => i.skipped).length;
    console.log(`  ✓ ${s.character.padEnd(9)} ${s.date}  ${fixture.intents.length} intents` +
                `${skipped ? ` (${skipped} skipped — holes preserved)` : ''}`);
    written++;
  }
  if (!written) { console.error('no fixtures written'); process.exit(1); }
  console.log(`\n${written}/${SESSIONS.length} fixtures written to test/fixtures/order-path/`);
}

if (require.main === module) main();
module.exports = { build, SESSIONS };
