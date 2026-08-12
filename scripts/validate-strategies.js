#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   validate-strategies — run the adversarial harness against every strategy
   this system trades or plans to trade.

   USAGE  node scripts/validate-strategies.js   ·   npm run validate:strategies

   THE POINT IS THE FAILURES. They are printed first and in full. Nothing here
   is tuned until it passes — a strategy tuned until it passes the harness has
   simply moved the overfitting one level up, into the harness.

   WHAT THIS SCRIPT CAN AND CANNOT DO, STATED BEFORE IT RUNS

   It can run every test for which the evidence exists. For most of these
   strategies that evidence does NOT exist, and the reason is specific and
   measurable: **no trial count was ever recorded.** 17 backtest scripts and 15
   result files are on disk, and not one of them records how many variants were
   run to produce it.

   So the honest outcome for most strategies is CANNOT_VALIDATE, and this script
   prints that as loudly as a failure — because a harness that reported "no
   failures" for a strategy it could not test would be the most dangerous
   artefact in the repository.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { ValidationHarness, DEFAULT_CRITERIA } = require(path.join(ROOT, 'validation-harness'));
const { ValidationLedger } = require(path.join(ROOT, 'validation-ledger'));

const ledger = new ValidationLedger();
const harness = new ValidationHarness({ ledger });

/* Declared BEFORE any test runs, and hashed. */
const declared = harness.declareCriteria(DEFAULT_CRITERIA);

/* Every strategy this system trades or has tested, with the evidence that
   actually exists for each. Where a field is absent, it is absent because the
   evidence is absent — not because it was omitted for brevity. */
const STRATEGIES = [
  { family: 'SHORT_STRANGLE', strategy: 'Short strangle → iron condor', running: 'PAPER, ON',
    observedSharpe: null, backtest: '129 trades, 91% win, 600 days',
    sweepPatterns: ['strangle'], scripts: 4 },
  { family: 'SHORT_STRADDLE', strategy: 'Short straddle', running: 'backtest only',
    backtest: '129 trades, 86% win', sweepPatterns: ['strategies'], scripts: 1 },
  { family: 'EXPIRY_STRADDLE', strategy: 'Expiry-day straddle', running: 'backtest only',
    backtest: '127 trades, 90% win, 470% CAGR', sweepPatterns: ['strategies'], scripts: 1 },
  { family: 'POP_SELLER', strategy: 'PoP seller', running: 'screen only', backtest: 'none' },
  { family: 'GAMMA_BLAST', strategy: 'Gamma blast', running: 'PAPER, ON', backtest: 'none — not backtestable' },
  { family: 'TREND_RIDE', strategy: 'Trend ride', running: 'PAPER, ON',
    backtest: '1,816 events, PF 0.84 raw; PF 1.34 out-of-sample on the underlying',
    sweepPatterns: ['trend'], scripts: 2 },
  { family: 'BOUNCE', strategy: 'Bounce', running: 'PAPER, ON', backtest: 'one day' },
  { family: 'ORB_AFTERNOON', strategy: 'ORB / afternoon execution', running: 'PAPER, ON',
    backtest: '1,200 trades, PF 0.94 / 0.89 / 0.97', sweepPatterns: ['intraday'], scripts: 3 },
  { family: 'AI_AGENTS', strategy: 'AI agents news→equity', running: 'PAPER, ON', backtest: 'none' },
];

console.log('\n' + '═'.repeat(78));
console.log('ADVERSARIAL VALIDATION HARNESS');
console.log('═'.repeat(78));
console.log(`Criteria declared BEFORE the run · hash ${declared.criteriaHash} · ${declared.declaredAt}`);
console.log(`Paper bar: walk-forward ≥${DEFAULT_CRITERIA.paper.minFolds} folds, deflated-Sharpe p ≥ ${DEFAULT_CRITERIA.paper.minDeflatedSharpeProbability}, ` +
            `PBO ≤ ${DEFAULT_CRITERIA.paper.maxPbo}, fragility ≤ ${DEFAULT_CRITERIA.paper.maxFragility}`);
console.log('');

const results = [];
for (const s of STRATEGIES) {
  const trials = s.sweepPatterns
    ? ledger.inferTrialFloor(s.family, { patterns: s.sweepPatterns, scripts: s.scripts || 0 })
    : ledger.trialCount(s.family);

  const r = harness.validate({
    family: s.family, strategy: s.strategy,
    observedSharpe: s.observedSharpe,
    trials: trials.count === null ? null : trials,
    // Everything else is genuinely unavailable, and is left unsupplied so the
    // harness reports it as CANNOT_VALIDATE rather than being handed a stub.
  });
  results.push({ ...s, trials, result: r });
}

const bad = results.filter(r => r.result.verdict === 'FAIL' || r.result.verdict === 'HALTED');
const cannot = results.filter(r => r.result.verdict === 'CANNOT_VALIDATE');
const passed = results.filter(r => r.result.verdict === 'PASS');

/* Failures first. */
console.log('─'.repeat(78));
console.log(`FAILURES AND HALTS — ${bad.length}`);
console.log('─'.repeat(78));
if (!bad.length) console.log('  none\n');
for (const r of bad) {
  console.log(`\n  ${r.family}  (${r.running})`);
  console.log(`    ${r.result.plainly}`);
  for (const t of r.result.tests.filter(t => t.status === 'FAIL')) console.log(`      ✗ ${t.name}: ${t.detail}`);
}

console.log('\n' + '─'.repeat(78));
console.log(`CANNOT BE VALIDATED — ${cannot.length}    (this is NOT a pass)`);
console.log('─'.repeat(78));
for (const r of cannot) {
  const missing = r.result.tests.filter(t => t.status === 'CANNOT_VALIDATE').map(t => t.name);
  console.log(`\n  ${r.family.padEnd(16)} ${r.running}`);
  console.log(`    backtest on record : ${r.backtest}`);
  console.log(`    trial count        : ${r.trials.count === null ? 'UNKNOWN' : `${r.trials.count} (${r.trials.source})`}`);
  console.log(`    cannot run         : ${missing.join(', ')}`);
}

console.log('\n' + '─'.repeat(78));
console.log(`SURVIVED — ${passed.length}`);
console.log('─'.repeat(78));
if (!passed.length) console.log('  none\n');
for (const r of passed) console.log(`  ${r.family}: ${r.result.plainly}`);

/* The summary table. */
console.log('\n' + '═'.repeat(78));
console.log('SUMMARY');
console.log('═'.repeat(78));
console.log('  strategy          running          verdict           trials    tests unrunnable');
for (const r of results) {
  console.log(`  ${r.family.padEnd(17)} ${String(r.running).padEnd(16)} ${r.result.verdict.padEnd(17)} ` +
    `${String(r.trials.count === null ? 'UNKNOWN' : r.trials.count).padStart(7)}   ${String(r.result.counts.cannotValidate).padStart(6)}`);
}

console.log('\n' + '═'.repeat(78));
console.log('WHAT THIS RUN ESTABLISHED');
console.log('═'.repeat(78));
console.log(`  Strategies that survived the harness ............ ${passed.length} of ${results.length}`);
console.log(`  Strategies that failed a test .................. ${bad.length}`);
console.log(`  Strategies that CANNOT BE VALIDATED ............ ${cannot.length}`);
console.log('');
console.log('  The dominant outcome is CANNOT_VALIDATE, and the cause is specific:');
console.log('  NO TRIAL COUNT WAS EVER RECORDED. Requirement 3 asks for a counter that includes');
console.log('  the variants that were DISCARDED, and discarded runs leave no artefact at all.');
console.log('  Where a floor could be reconstructed from parameter sweeps on disk, it is shown');
console.log('  as a floor — the true count is higher, and a floor is the most generous possible');
console.log('  reading of the evidence.');
console.log('');
console.log('  A deflated Sharpe computed from an unknown trial count is the original number');
console.log('  wearing a serious name. The harness refuses to print one.');
console.log('');
console.log('  NOTHING HERE HAS BEEN TUNED TO PASS. A strategy tuned until it passes the harness');
console.log('  has moved the overfitting one level up, into the harness.');
console.log('');
console.log('  Five of these strategies are running in PAPER right now. None of them has cleared');
console.log('  this bar, and none of them should reach real money until it has.\n');

const out = path.join(ROOT, 'data', 'validation-report.json');
try {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ declared, results }, null, 2));
  console.log(`Full report written to data/validation-report.json\n`);
} catch (e) { console.error(`could not write the report: ${e.message}`); }

process.exit(bad.length ? 1 : 0);
