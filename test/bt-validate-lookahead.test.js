'use strict';
/**
 * bt-validate.js — THE VALIDATOR HAS THE DEFECT IT EXISTS TO DETECT.
 * See docs/001-D-RESEARCH-INTEGRITY-AUDIT.md, finding R-01.
 *
 * WHAT `bt-validate.js` IS
 *   The repository's statistical harness: purged k-fold, walk-forward, PSR, deflated Sharpe.
 *   Its 13 exported functions are pure mathematics and are CORRECT. They are not touched here.
 *
 * THE DEFECT — in the CLI block (`if (require.main === module)`), NOT in the exports
 *   1. `:152`  const atm = atmStrike(day), off = round(day.underlying * OTM_PCT / 50) * 50;
 *              `day.underlying` is UDiFF column 20 = UndrlygPric = the day's CLOSING level.
 *              The strike is chosen from the close, and then sold at the SAME day's OPEN (`ce.o`).
 *              The strategy trades on a price that will not exist for another 6.5 hours.
 *
 *   2. `:157`  sizeLots(cap, credit)  — the 2-argument form silently uses bt-lib's LOT = 75.
 *              Measured: the real lot is 25/50/65/75 and 75 is wrong on 356/600 days (59.3%).
 *
 *   3. `:151`  the IV-proxy regime gate reads `ivPctByDate.get(day.date)` — TODAY's proxy —
 *              and that proxy (`:173`) is itself computed from TODAY's close and TODAY's opens.
 *              The gate that decides whether to trade today already knows how today closed.
 *
 * WHY THIS IS THE MOST DANGEROUS DEFECT IN THE REPOSITORY
 *   Purged k-fold defends against overfitting. Deflated Sharpe defends against selection bias.
 *   PSR defends against luck. NONE of them defends against look-ahead.
 *   Feed a leaky strategy into a perfect validator and you get a rigorously computed,
 *   statistically confident, completely wrong answer. Before this fix the harness printed:
 *
 *       Trades: 129 | Win% 91.5 | Sharpe 0.846
 *       Deflated Sharpe (12 trials): DSR=0.9999 → PASS (edge real @95%)
 *       VERDICT: ✅ Edge survives Deflated-Sharpe + walk-forward + purged k-fold — harness trusts it.
 *
 *   It certified an artefact at 95% confidence.
 *
 * BLAST RADIUS OF THE FIX: ZERO CONSUMERS.
 *   `module.exports` (:136) publishes ONLY the 13 pure statistics functions. `strangleTrades` and
 *   `ivProxyPercentiles` live inside the `require.main` block and are exported to nobody.
 *   The only caller of this module — `forward-test-report.js` — uses `expectancy`, `sharpe` and
 *   `deflatedSharpe` alone. Fixing the strategy changes NO shipped result. It changes one number:
 *   the one that was wrong.
 *
 *   @test:characterization @test:unit @test:regression @test:failure @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bt-validate.js'), 'utf8');
const V = require('../bt-validate.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

// ── @test:regression — the 13 pure statistics are the public surface and MUST NOT MOVE ──
{
  const EXPECTED = ['normCdf', 'normInv', 'mean', 'std', 'skewness', 'kurtosis', 'sharpe',
    'probabilisticSharpe', 'expectedMaxSharpe', 'deflatedSharpe', 'walkForward', 'purgedKFold',
    'expectancy'];
  for (const k of EXPECTED) {
    ok(typeof V[k] === 'function',
      `REGRESSION: bt-validate still exports ${k}() — the mathematics is CORRECT and is not being changed`);
  }
  eq(Object.keys(V).length, EXPECTED.length,
    'REGRESSION: the public surface is EXACTLY the 13 statistics functions — the leaky strategy ' +
    'lives in the require.main block and is exported to nobody. This is why the fix has zero consumers');

  // The one real consumer uses only pure statistics — prove the numbers it gets are unchanged.
  eq(V.sharpe([1, 2, 3, 4]).toFixed(6), (2.5 / V.std([1, 2, 3, 4], true)).toFixed(6),
    'REGRESSION: sharpe() is untouched — forward-test-report.js depends on it');
  eq(V.expectancy([100, -50, 100, -50]).trades, 4,
    'REGRESSION: expectancy() is untouched — forward-test-report.js depends on it');
}

// ── @test:characterization — what the CLI block does TODAY ────────────────────
{
  const cli = SRC.slice(SRC.indexOf('if (require.main === module)'));
  ok(cli.length > 500, 'CHARACTERIZATION: the strategy lives in the require.main block');
  ok(/const \{ roundTripCharges \} = require\('\.\/charges\.js'\)/.test(cli),
    'CHARACTERIZATION: it applies real charges — the cost model was never the problem');
}

// ── TRIPWIRE 1 — the strike must NOT be chosen from TODAY'S close ─────────────
{
  const cli = SRC.slice(SRC.indexOf('if (require.main === module)'));
  const strat = cli.slice(cli.indexOf('function strangleTrades'), cli.indexOf('function ivProxyPercentiles'));

  ok(!/atmStrike\(day\)/.test(strat),
    'TRIPWIRE 1: strangleTrades() must NOT call atmStrike(day) — `day.underlying` is TODAY\'S CLOSE, ' +
    'and the trade is entered at TODAY\'S OPEN. That is the look-ahead');
  ok(!/day\.underlying\b/.test(strat),
    'TRIPWIRE 1b: strangleTrades() must not read `day.underlying` at all when selecting a strike');
  ok(/prev|yesterday/i.test(strat),
    'TRIPWIRE 1c: the strike must be chosen from the PREVIOUS day\'s close — the last price that ' +
    'actually existed before the entry');
}

// ── TRIPWIRE 2 — the position must be sized with the REAL per-day lot ─────────
{
  const cli = SRC.slice(SRC.indexOf('if (require.main === module)'));
  ok(/sizeLots\([^)]*,\s*[\w.]*\.?lot\b/.test(cli) || /sizeLots\(cap,\s*credit,\s*lot\)/.test(cli),
    'TRIPWIRE 2: sizeLots() must be passed the REAL per-day lot (bt-lib exposes day.lot from ' +
    'NewBrdLotQty, column 28). The 2-argument form silently uses LOT = 75, which is wrong on ' +
    '356 of 600 days (59.3%)');
  ok(!/qty\s*=\s*lots\s*\*\s*LOT\b/.test(cli),
    'TRIPWIRE 2b: qty must be lots * the REAL lot, not lots * the hardcoded LOT');
}

// ── TRIPWIRE 3 — the regime gate must not know how today closed ───────────────
{
  const cli = SRC.slice(SRC.indexOf('if (require.main === module)'));
  const strat = cli.slice(cli.indexOf('function strangleTrades'), cli.indexOf('function ivProxyPercentiles'));
  ok(!/ivPctByDate\.get\(day\.date\)/.test(strat),
    'TRIPWIRE 3: the IV-proxy gate must NOT read TODAY\'S proxy. The proxy is computed from ' +
    'today\'s close and today\'s opens — a gate that decides whether to trade today cannot ' +
    'already know how today went');
}

// ── TRIPWIRE 4 — the end-to-end number. THE ONE THAT MATTERS. ────────────────
// Before the fix the harness printed: Win% 91.5, DSR 0.9999, "PASS (edge real @95%)".
// An honest short strangle on this data does not win 9 times in 10. If it still does,
// the leak is still there.
{
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bt-validate.js')],
    { encoding: 'utf8', timeout: 120000 });

  const m = /Trades:\s*(\d+)\s*\|\s*Win%\s*([\d.]+)/.exec(out);
  ok(m, 'TRIPWIRE 4: the harness still runs and still reports trades and win%');
  const trades = +m[1], winPct = +m[2];

  ok(trades > 50, `TRIPWIRE 4a: the harness still produces a real sample (${trades} trades)`);
  ok(winPct < 80,
    `TRIPWIRE 4b: WITHOUT look-ahead the win rate must fall well below the 91.5% it reported while ` +
    `it could see the future. Measured now: ${winPct}%. If this is still ~91%, the strike is still ` +
    `being chosen from a price the strategy could not have known`);

  ok(!/harness trusts it/.test(out) || winPct < 80,
    'TRIPWIRE 4c: the harness must not certify an edge it obtained by seeing the future');
}

// ── @test:failure — the fix must not fabricate a lot ─────────────────────────
{
  const cli = SRC.slice(SRC.indexOf('if (require.main === module)'));
  ok(!/day\.lot\s*\|\|\s*75/.test(cli) && !/day\.lot\s*\?\?\s*(75|LOT)/.test(cli),
    'FAILURE PATH: when the per-day lot is unreadable the day must be SKIPPED, never sized with a ' +
    'guessed 75. Unknown != Zero. null != 75');
}

// ── @test:rollback — one command reverts it ──────────────────────────────────
{
  ok(/module\.exports\s*=\s*\{[\s\S]*expectancy\s*\}/.test(SRC),
    'ROLLBACK: the public surface is untouched, so `git checkout -- bt-validate.js` fully reverts ' +
    'this change and no consumer notices either way');
}

console.log(`\n${n} assertions passed`);
