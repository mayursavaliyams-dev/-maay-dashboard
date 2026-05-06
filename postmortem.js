/**
 * Post-mortem — analyze today's bot activity vs what backtest would have predicted.
 *
 * Run anytime after market close (~3:30 PM IST) to get a clear summary of:
 *   - Whether a signal fired today
 *   - Entry / exit prices + P&L (paper or live)
 *   - Server-side errors during the day
 *   - Comparison to backtest expectation
 *
 * Usage:
 *   node postmortem.js               # today
 *   node postmortem.js 2026-04-30    # specific date
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const BASE     = process.env.PREFLIGHT_BASE || 'http://localhost:3000';
const TARGET   = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });  // YYYY-MM-DD IST
const LOG_PATH = path.resolve('./data/logs/server.log');

function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, { timeout: 5000 }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const dim = s => `\x1b[90m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;

async function main() {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  POST-MORTEM — ${TARGET}`);
  console.log(`${'═'.repeat(64)}\n`);

  // ── Today's trades from server ──
  let trades, risk, position;
  try {
    [trades, risk, position] = await Promise.all([
      getJson('/api/trades'),
      getJson('/api/risk'),
      getJson('/api/position')
    ]);
  } catch (err) {
    console.error(red('  Server unreachable:'), err.message);
    process.exit(1);
  }

  // Filter trades to TARGET date (TODAY in IST)
  const all = (trades.history || trades || []);
  const today = all.filter(t => {
    const ts = t.exitAt || t.entryAt || t.entryTimestamp;
    if (!ts) return false;
    const d = typeof ts === 'string' ? ts.slice(0, 10) : new Date(ts * (ts > 1e12 ? 1 : 1000)).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return d === TARGET;
  });

  console.log(bold('  TRADES'));
  if (!today.length) {
    if (position && position.open) {
      console.log(`  ${yellow('⏳')} Position still OPEN — bot entered today, hasn't exited yet.`);
      const p = position.position || position;
      console.log(`     Type: ${p.type} ${p.strike}  Entry ₹${p.entryPrice}  Current ₹${p.currentPrice || '?'}  P&L ${(((p.currentPrice || p.entryPrice) / p.entryPrice - 1) * 100).toFixed(1)}%`);
    } else {
      console.log(`  ${dim('No trade fired today.')}`);
      console.log(`  ${dim('Possible reasons: no ORB break, no EMA crossover, signal blocked by halt, market holiday.')}`);
    }
  } else {
    for (const t of today) {
      const pnlPct = parseFloat(t.finalPnlPct || t.pnlPct || 0);
      const sign = pnlPct >= 0 ? green('+' + pnlPct.toFixed(1) + '%') : red(pnlPct.toFixed(1) + '%');
      console.log(`  ${pnlPct >= 0 ? green('✓') : red('✗')} ${t.instrument || 'NIFTY'} ${t.type || ''} ${t.strike || ''}`);
      console.log(`     Entry ₹${t.entry || t.entryPrice}  →  Exit ₹${t.exit || t.exitPrice}  =  ${sign}  (${t.reason || t.exitReason || '?'})`);
      console.log(`     ${dim('exited at')} ${t.exitAt || '?'}`);
    }
  }

  // ── Risk summary ──
  console.log(`\n${bold('  RISK')}`);
  console.log(`  Today's PnL — SENSEX: ₹${(risk.sensexTodayPnl || 0).toLocaleString('en-IN')}   NIFTY: ₹${(risk.niftyTodayPnl || 0).toLocaleString('en-IN')}   TOTAL: ${risk.totalTodayPnl >= 0 ? green('₹' + (risk.totalTodayPnl || 0).toLocaleString('en-IN')) : red('₹' + (risk.totalTodayPnl || 0).toLocaleString('en-IN'))}`);
  console.log(`  Trades today: ${(risk.sensexTradesToday || 0) + (risk.niftyTradesToday || 0)}/${risk.maxTrades}   Consec losses: NIFTY ${risk.niftyConsecLosses || 0}   Halt: ${risk.limitBreached ? red('YES') : green('no')}`);

  // ── Server-side errors today ──
  if (fs.existsSync(LOG_PATH)) {
    const log = fs.readFileSync(LOG_PATH, 'utf8');
    const errs = log.split('\n').filter(line => /401|Authentication|ERR|Error:|Failed|crash/i.test(line));
    console.log(`\n${bold('  SERVER LOG ERRORS')}`);
    if (errs.length === 0) {
      console.log(`  ${green('✓')} No errors found in server.log`);
    } else {
      console.log(`  ${red(errs.length + ' suspicious lines')} (last 5):`);
      errs.slice(-5).forEach(e => console.log(`    ${dim(e.slice(0, 100))}`));
    }
  } else {
    console.log(`\n  ${dim('No server.log found (server runs in foreground / not via Task Scheduler).')}`);
  }

  // ── Backtest expectation ──
  console.log(`\n${bold('  BACKTEST EXPECTATION (NIFTY Thursday strategy)')}`);
  if (fs.existsSync('./backtest-real-results.json')) {
    const r = JSON.parse(fs.readFileSync('./backtest-real-results.json', 'utf8'));
    const s = r.stats || {};
    console.log(`  Historical avg win rate: ${s.winRate}%`);
    console.log(`  Historical avg P&L per trade: ${s.avgPnlPct >= 0 ? '+' : ''}${s.avgPnlPct}%`);
    console.log(`  ${dim('A losing day is normal — strategy expects a ~30% loss rate.')}`);
  }

  console.log(`\n${'─'.repeat(64)}\n`);
}

main().catch(err => { console.error('postmortem crashed:', err); process.exit(2); });
