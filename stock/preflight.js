/**
 * STOCK BOT PRE-FLIGHT — run before market opens (e.g. 09:00 IST) to confirm
 * the bot is ready. Prints PASS/WARN/FAIL per check; exits non-zero on any FAIL.
 *   node preflight.js          (server must be running on PREFLIGHT_BASE)
 */

require('dotenv').config();
const http = require('http');

const BASE = process.env.PREFLIGHT_BASE || `http://localhost:${process.env.PORT || 3100}`;
const LIVE = (process.env.TRADE_MODE || 'paper') === 'live';

let pass = 0, fail = 0, warn = 0;
const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const green = s => c(32, s), red = s => c(31, s), yellow = s => c(33, s), dim = s => c(90, s);
const PASS = (l, d = '') => { pass++; console.log(`  ${green('✓')} ${l.padEnd(42)} ${dim(d)}`); };
const WARN = (l, d = '') => { warn++; console.log(`  ${yellow('⚠')} ${l.padEnd(42)} ${yellow(d)}`); };
const FAIL = (l, d = '') => { fail++; console.log(`  ${red('✗')} ${l.padEnd(42)} ${red(d)}`); };

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + path, { timeout: 5000 }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log(`\n🔎 Stock bot preflight — ${BASE}  (mode: ${LIVE ? 'LIVE' : 'paper'})\n`);

  // 1. Server reachable
  let health;
  try { const r = await getJson('/api/health'); health = r.json; PASS('Server reachable', `strategy=${health.strategy}`); }
  catch (e) { FAIL('Server reachable', e.message); return done(); }

  // 2. Bot loop running
  health.botRunning ? PASS('Bot loop running') : WARN('Bot loop running', 'botRunning=false — POST /api/bot/start');

  // 3. Token (live only)
  try {
    const { json: t } = await getJson('/api/token-status');
    if (!LIVE) PASS('Dhan token', 'paper mode — not required');
    else if (!t.valid) FAIL('Dhan token', t.reason || 'invalid/expired — refresh before open');
    else if (t.hoursLeft < 2) WARN('Dhan token', `only ${t.hoursLeft}h left`);
    else PASS('Dhan token', `${t.hoursLeft}h left`);
  } catch (e) { WARN('Dhan token', e.message); }

  // 4. Watchlist has live prices
  try {
    const { json: w } = await getJson('/api/watchlist');
    const priced = w.rows.filter(r => r.price > 0).length;
    const src = w.rows[0]?.source || '?';
    if (priced === 0) FAIL('Live prices', 'no symbol has a price yet');
    else if (LIVE && src === 'paper-sim') FAIL('Live prices', 'LIVE mode but feed is paper-sim — check Dhan creds');
    else PASS('Live prices', `${priced}/${w.rows.length} priced (src=${src})`);
  } catch (e) { FAIL('Live prices', e.message); }

  // 5. No active halts
  try {
    const { json: rk } = await getJson('/api/risk');
    const halted = rk.perSymbol.filter(s => s.halt.halted);
    halted.length ? WARN('Risk halts clear', `halted: ${halted.map(s => s.symbol + ':' + s.halt.reason).join(', ')}`)
                  : PASS('Risk halts clear');
    PASS('Capital configured', `₹${rk.perSymbol[0]?.capital?.toLocaleString('en-IN')} · daily limit ₹${rk.perSymbol[0]?.dailyLossLimit?.toLocaleString('en-IN')}`);
  } catch (e) { FAIL('Risk status', e.message); }

  // 6. securityId map (needed for live)
  try {
    const fs = require('fs');
    const ids = JSON.parse(fs.readFileSync('./data/equity-ids.json', 'utf8'));
    const wl = (process.env.WATCHLIST || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const missing = wl.filter(s => !ids[s]);
    if (!LIVE) PASS('securityId map', `${Object.keys(ids).length} mapped (paper ignores)`);
    else if (missing.length) FAIL('securityId map', `missing: ${missing.join(', ')} — run: node equity-resolver.js`);
    else PASS('securityId map', `${wl.length}/${wl.length} mapped`);
  } catch (e) {
    LIVE ? FAIL('securityId map', 'data/equity-ids.json missing — run: node equity-resolver.js')
         : WARN('securityId map', 'no equity-ids.json (fine for paper)');
  }

  done();
}

function done() {
  console.log(`\n  ${green(pass + ' pass')}  ${yellow(warn + ' warn')}  ${red(fail + ' fail')}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('preflight crashed:', e.message); process.exit(1); });
