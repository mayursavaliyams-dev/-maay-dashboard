#!/usr/bin/env node
/**
 * validate-ami-signals — is what AmiBroker is sending actually usable?
 *
 * Run:  npm run ami:validate            (today)
 *       npm run ami:validate -- --all   (every stored day)
 *       npm run ami:validate -- --date 2026-07-09
 *
 * READS THE REAL STORE. It does not construct a signal, does not call the
 * bridge, and does not need the server running. Everything it reports is a
 * property of what is on disk in data/ami-signals/.
 *
 * IT ANSWERS THREE DIFFERENT QUESTIONS AND KEEPS THEM APART
 *
 *   1. PROVENANCE — did this come from AmiBroker, or from a simulator or a
 *      hand-typed test? Reported first, because a green report on simulated
 *      signals tells you nothing about your AFL. This is judged from the fields
 *      the AFL controls, and it is a HEURISTIC: the sender chooses `strategy`,
 *      so a test can claim to be AFL. Where it is uncertain it says so.
 *
 *   2. SHAPE — is each record well-formed against the contract the AFL in
 *      amibroker/ actually posts? Missing, wrong-typed and implausible values
 *      are separate categories, never merged into "invalid".
 *
 *   3. BEHAVIOUR — what did the bridge DO with each one, and does the pattern
 *      look like a working feed or a stuck one?
 *
 * WHAT IT DELIBERATELY DOES NOT ANSWER
 *
 * Whether the signals are any GOOD. That is an outcome question and needs the
 * price after each signal, over enough signals to mean anything. Nothing here
 * measures edge, and a clean report is not evidence of one.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../instrument-registry.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'ami-signals');
const IST = 330 * 60000;

const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const pad = (s, n) => String(s).padEnd(n);

/* ── provenance ────────────────────────────────────────────────────────────
   The AFL in amibroker/Antigravity-Push-Hook.afl posts:
     strategy=my_afl   barId=NumToStr(LastValue(BarIndex()))
   A simulator wrote AFL_SIM. A hand test writes whatever the person typed. */
function provenanceOf(r) {
  const strat = String(r.strategy || '').toLowerCase();
  const barId = String(r.barId ?? '');
  const barNum = Number(barId);

  /* Diagnostics fired by this repository's own tooling are never AFL, whatever
     they look like. `diagnostic_probe` was sent on 2026-07-31 to prove the push
     intake worked; it carried a realistic barId (4187) and therefore PASSED the
     LIKELY_AFL heuristic and made the verdict line read "real AFL pushes are
     present" when the only such record was the probe itself. Excluded by name.
     A validator whose own test contaminates its verdict is the failure this
     file was written to avoid. */
  if (strat === 'diagnostic_probe') return { tier: 'OUR_OWN_PROBE', why: 'fired by scripts/validate-ami-signals diagnostics' };

  if (strat.includes('sim')) return { tier: 'SIMULATOR', why: `strategy="${r.strategy}"` };
  if (strat === 'test' || strat === '' || strat === 'undefined') {
    return { tier: 'TEST_OR_UNKNOWN', why: `strategy="${r.strategy ?? '(missing)'}"` };
  }
  if (!barId) return { tier: 'TEST_OR_UNKNOWN', why: 'barId missing — the AFL always sends one' };

  /* barId is NumToStr(LastValue(BarIndex())) — always a number. A non-numeric
     value ("E1", "abc") cannot have come from a chart.

     CORRECTED 2026-07-31: the first version only checked `barNum < 50`, so a
     non-numeric barId made `Number()` NaN, that comparison false, and the
     record fell through to LIKELY_AFL. Three records arriving as "E1", "E2",
     "E3" were therefore about to be reported as real AFL pushes. The check now
     requires a number first. */
  if (!Number.isFinite(barNum)) {
    return { tier: 'TEST_OR_UNKNOWN', why: `barId="${barId}" is not a number — BarIndex() always is` };
  }
  /* A real chart's last BarIndex() is the number of bars loaded — hundreds to
     tens of thousands. A single digit is a hand-typed value, not a chart. */
  if (barNum > 0 && barNum < 50) {
    return { tier: 'TEST_OR_UNKNOWN', why: `barId=${barId} — too small to be a real chart's BarIndex()` };
  }
  return { tier: 'LIKELY_AFL', why: `strategy="${r.strategy}", barId=${barId}` };
}

/* ── shape ─────────────────────────────────────────────────────────────── */
function checkShape(r) {
  const missing = [], wrong = [], implausible = [];
  const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN));

  for (const f of ['signal', 'instrument', 'strike', 'conf', 'price']) {
    if (r[f] === undefined || r[f] === null || r[f] === '') missing.push(f);
  }

  if (r.signal && !['CALL', 'PUT', 'EXIT'].includes(String(r.signal).toUpperCase())) {
    wrong.push(`signal="${r.signal}" — the AFL sends CALL, PUT or EXIT`);
  }

  const conf = num(r.conf);
  if (conf !== null && Number.isNaN(conf)) wrong.push(`conf="${r.conf}" is not a number`);
  else if (conf !== null && (conf < 0 || conf > 100)) implausible.push(`conf=${conf} outside 0–100`);

  const strike = num(r.strike);
  const price = num(r.price);
  const inst = String(r.instrument || '').toUpperCase();

  if (strike !== null && Number.isNaN(strike)) wrong.push(`strike="${r.strike}" is not a number`);
  else if (strike !== null && inst) {
    let step = null;
    try { step = registry.strikeInterval(inst); } catch (_) { /* unknown instrument */ }
    if (step && strike % step !== 0) {
      implausible.push(`strike ${strike} is not a multiple of ${inst}'s ${step}-point interval`);
    }
  }

  /* A signal whose spot is far from its own strike is either a stale price or
     the wrong instrument. 3% is generous for an index option signal. */
  if (strike !== null && price !== null && !Number.isNaN(strike) && !Number.isNaN(price) && price > 0) {
    const driftPct = Math.abs(strike - price) / price * 100;
    if (driftPct > 3) implausible.push(`strike ${strike} is ${driftPct.toFixed(1)}% away from price ${price}`);
  }

  /* premium/target of 0 is not a defect — the AFL does not send them — but it
     means the signal cannot be sized or targeted from its own contents. */
  const noPremium = num(r.premium) === 0 || r.premium === undefined;
  const noTarget = num(r.target) === 0 || r.target === undefined;

  return { missing, wrong, implausible, noPremium, noTarget };
}

/* ── timing ────────────────────────────────────────────────────────────── */
function marketWindow(r) {
  const t = String(r.time || '');
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return { known: false, inSession: null, note: 'no parseable time' };
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return { known: true, inSession: mins >= 555 && mins <= 930, mins, note: null };  // 09:15–15:30
}

function loadDay(date) {
  const f = path.join(DIR, `ami-signals-${date}.jsonl`);
  if (!fs.existsSync(f)) return null;
  const out = { date, file: path.relative(ROOT, f), rows: [], unparseable: [] };
  const text = fs.readFileSync(f, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try { out.rows.push(JSON.parse(line)); }
    catch (e) { out.unparseable.push({ lineNo: i + 1, preview: line.slice(0, 100) }); }
  });
  return out;
}

function analyse(day) {
  const prov = {}, exec = {}, sig = {};
  const problems = [];
  const seenIds = new Map();
  let inSession = 0, outSession = 0, timeUnknown = 0;
  let firstMins = null, lastMins = null;
  const gaps = [];
  let prevMins = null;

  for (const r of day.rows) {
    const p = provenanceOf(r);
    prov[p.tier] = (prov[p.tier] || 0) + 1;

    const st = (r.execution && r.execution.status) || '(none)';
    exec[st] = (exec[st] || 0) + 1;
    sig[String(r.signal || '?').toUpperCase()] = (sig[String(r.signal || '?').toUpperCase()] || 0) + 1;

    const shape = checkShape(r);
    if (shape.missing.length || shape.wrong.length || shape.implausible.length) {
      problems.push({ id: r.id || '(no id)', time: r.time, ...shape });
    }

    if (r.id) {
      if (seenIds.has(r.id)) seenIds.set(r.id, seenIds.get(r.id) + 1);
      else seenIds.set(r.id, 1);
    }

    const w = marketWindow(r);
    if (!w.known) timeUnknown++;
    else {
      w.inSession ? inSession++ : outSession++;
      if (firstMins === null || w.mins < firstMins) firstMins = w.mins;
      if (lastMins === null || w.mins > lastMins) lastMins = w.mins;
      if (prevMins !== null && w.mins - prevMins > 30) gaps.push(`${fmtMins(prevMins)}→${fmtMins(w.mins)}`);
      prevMins = w.mins;
    }
  }

  const dupes = [...seenIds.entries()].filter(([, n]) => n > 1);
  return { prov, exec, sig, problems, dupes, inSession, outSession, timeUnknown, firstMins, lastMins, gaps };
}

const fmtMins = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function report(day, a) {
  const L = [];
  L.push(`\n══ ${day.date} — ${day.file}`);
  L.push(`   records: ${day.rows.length}${day.unparseable.length ? `   ⚠ ${day.unparseable.length} UNPARSEABLE line(s)` : ''}`);

  L.push('');
  L.push('   1 · PROVENANCE — where did these come from?');
  for (const [tier, n] of Object.entries(a.prov).sort((x, y) => y[1] - x[1])) {
    const mark = tier === 'LIKELY_AFL' ? '✓' : '⚠';
    L.push(`       ${mark} ${pad(tier, 18)} ${n}`);
  }
  if (!a.prov.LIKELY_AFL) {
    L.push('       → NOT ONE record looks like a real AmiBroker AFL push.');
    L.push('         A clean report below says nothing about your AFL setup.');
  }
  const sample = day.rows[0];
  if (sample) L.push(`       sample: strategy="${sample.strategy}" source="${sample.source}" barId="${sample.barId}"`);

  L.push('');
  L.push('   2 · SHAPE');
  if (!a.problems.length) L.push('       ✓ every record carries signal, instrument, strike, conf and price, correctly typed');
  for (const p of a.problems.slice(0, 8)) {
    L.push(`       ⚠ ${p.time || '?'}`);
    for (const m of p.missing) L.push(`           missing: ${m}`);
    for (const w of p.wrong) L.push(`           wrong:   ${w}`);
    for (const i of p.implausible) L.push(`           odd:     ${i}`);
  }
  if (a.problems.length > 8) L.push(`       … and ${a.problems.length - 8} more`);

  const noPrem = day.rows.filter(r => !Number(r.premium)).length;
  const noTgt = day.rows.filter(r => !Number(r.target)).length;
  if (noPrem === day.rows.length && day.rows.length) {
    L.push(`       · premium is 0 on all ${noPrem} — the AFL does not send it, so a signal cannot be sized from its own contents`);
  }
  if (noTgt === day.rows.length && day.rows.length) {
    L.push(`       · target is 0 on all ${noTgt} — same`);
  }
  if (a.dupes.length) L.push(`       ⚠ ${a.dupes.length} duplicate id(s) — the dedupe key collided`);

  L.push('');
  L.push('   3 · TIMING AND BEHAVIOUR');
  if (a.firstMins !== null) L.push(`       window: ${fmtMins(a.firstMins)} → ${fmtMins(a.lastMins)} IST`);
  L.push(`       in session (09:15–15:30): ${a.inSession}   outside: ${a.outSession}${a.timeUnknown ? `   unknown: ${a.timeUnknown}` : ''}`);
  if (a.outSession) L.push('       ⚠ signals arrived outside market hours — the bridge refuses those with MARKET_CLOSED');
  if (a.gaps.length) L.push(`       gaps >30 min: ${a.gaps.slice(0, 5).join(', ')}${a.gaps.length > 5 ? ` … +${a.gaps.length - 5}` : ''}`);
  L.push(`       direction: ${Object.entries(a.sig).map(([k, v]) => `${k} ${v}`).join('  ')}`);
  L.push(`       bridge did: ${Object.entries(a.exec).map(([k, v]) => `${k} ${v}`).join('  ')}`);

  return L.join('\n');
}

/* ── live ──────────────────────────────────────────────────────────────────
   Is AmiBroker talking to the bridge RIGHT NOW? The stored files answer "what
   arrived"; only the running bridge's counters answer "is it connected". A
   poll count of zero while the AFL is running means AmiBroker is not reaching
   this server at all — which is a different problem from a malformed signal
   and is fixed in a different place. */
async function live(base) {
  const url = (base || 'http://127.0.0.1:3000') + '/api/amibroker/status';
  let j;
  try { j = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).json(); }
  catch (e) { console.log('\n══ LIVE: bridge unreachable at ' + url + ' — ' + e.message); return; }
  const s = j.stats || {};
  console.log('\n══ LIVE BRIDGE (' + url + ')');
  console.log('   enabled ' + j.enabled + '   autoTrade(KEY1) ' + j.autoTrade + '   allowLive(KEY2) ' + j.allowLive);
  console.log('   minConfidence ' + j.minConfidence + '   dedupeSeconds ' + j.dedupeSeconds);
  console.log('   signalPolls     ' + s.signalPolls + '   ← AFL PULLING /api/amibroker/signal');
  console.log('   signalsReceived ' + s.signalsReceived + '   ← AFL PUSHING /api/amibroker/push-signal');
  console.log('   ignored ' + s.ignoredSignals + '   duplicates ' + s.duplicateSignals + '   executed ' + s.signalsExecuted);
  console.log('   lastPollAt   ' + s.lastPollAt);
  console.log('   lastSignalAt ' + s.lastSignalAt);
  if (!s.signalPolls && !s.signalsReceived) {
    console.log('   → AmiBroker has not reached this process since it started.');
    console.log('     Not a signal-quality problem. Check, in order: the AFL is applied to a');
    console.log('     chart and running; "AG: Push Signals" is ON; the Server URL matches');
    console.log('     this host and port; the API Key matches AMIBROKER_API_KEY.');
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--live')) { const i = args.indexOf('--base'); return live(i >= 0 ? args[i + 1] : undefined); }
  if (!fs.existsSync(DIR)) { console.error(`no signal store at ${path.relative(ROOT, DIR)} — nothing has ever been received`); process.exit(1); }

  let dates;
  const di = args.indexOf('--date');
  if (di >= 0 && args[di + 1]) dates = [args[di + 1]];
  else if (args.includes('--all')) {
    dates = fs.readdirSync(DIR).map(f => (f.match(/ami-signals-(\d{4}-\d{2}-\d{2})\.jsonl/) || [])[1]).filter(Boolean).sort();
  } else dates = [istToday()];

  console.log('AmiBroker signal validation');
  console.log('reads data/ami-signals/ only — the server does not need to be running');

  let any = false, anyAfl = false;
  for (const d of dates) {
    const day = loadDay(d);
    if (!day) { console.log(`\n══ ${d} — no file. Nothing was received on this date.`); continue; }
    any = true;
    const a = analyse(day);
    if (a.prov.LIKELY_AFL) anyAfl = true;
    console.log(report(day, a));
  }

  console.log('\n' + '─'.repeat(72));
  if (!any) {
    console.log('VERDICT: nothing received. Check the AFL is running, the server URL and the API key.');
  } else if (!anyAfl) {
    console.log('VERDICT: the pipe works, but NO RECORD LOOKS LIKE A REAL AFL PUSH.');
    console.log('  Everything stored is a simulator or a hand test. Until a real AFL signal');
    console.log('  arrives there is nothing of yours to validate.');
  } else {
    console.log('VERDICT: real AFL pushes are present. See the shape section for what is missing in them.');
  }
  console.log('\nNOT ANSWERED: whether the signals are any GOOD. That needs the price after');
  console.log('each signal, over enough signals to mean anything. Nothing here measures edge.');
}

if (require.main === module) main();
module.exports = { provenanceOf, checkShape, marketWindow, loadDay, analyse };
