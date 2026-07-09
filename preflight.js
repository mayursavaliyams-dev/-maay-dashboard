/**
 * Pre-flight check — run this 8:30 AM IST Thursday (or any trading day) to
 * verify the bot is ready BEFORE market opens.
 *
 * Each check prints PASS/FAIL/WARN. Exits non-zero if any FAIL so you can
 * see the result at a glance. Run via:  node preflight.js   or   preflight.bat
 */
const http = require('http');

const BASE = process.env.PREFLIGHT_BASE || 'http://localhost:3000';
const NIFTY_AUTO_EXPECTED = String(process.env.NIFTY_AUTO_ENABLED || 'true') === 'true';

let pass = 0, fail = 0, warn = 0;

function color(code, s) { return `\x1b[${code}m${s}\x1b[0m`; }
const green = s => color(32, s), red = s => color(31, s), yellow = s => color(33, s), dim = s => color(90, s);

function PASS(label, detail = '')  { pass++; console.log(`  ${green('✓')} ${label.padEnd(40)} ${dim(detail)}`); }
function WARN(label, detail = '')  { warn++; console.log(`  ${yellow('⚠')} ${label.padEnd(40)} ${yellow(detail)}`); }
function FAIL(label, detail = '')  { fail++; console.log(`  ${red('✗')} ${label.padEnd(40)} ${red(detail)}`); }

function http_get(path, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const url = BASE + path;
    const req = http.get(url, { timeout }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getJson(path) {
  const r = await http_get(path);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.body);
}

async function check(label, fn) {
  try {
    const result = await fn();
    if (result === true || result === undefined) PASS(label);
    else if (result && result.warn) WARN(label, result.warn);
    else if (result && result.fail) FAIL(label, result.fail);
    else if (typeof result === 'string') PASS(label, result);
    else PASS(label);
  } catch (err) {
    FAIL(label, err.message);
  }
}

async function main() {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ANTIGRAVITY PRE-FLIGHT — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log(`  Target: ${BASE}`);
  console.log(`${'═'.repeat(64)}\n`);

  // ── 1. Server reachable ──
  await check('Server reachable', async () => {
    const h = await getJson('/api/health');
    return `${h.status || '?'}, mode: ${h.mode || '?'}`;
  });

  // ── 2. Dhan token freshness ──
  let risk = null;
  await check('Dhan token valid', async () => {
    risk = await getJson('/api/risk');
    if (risk.tokenExpired)            return { fail: 'EXPIRED — refresh now' };
    if (risk.tokenExpiryHours == null) return { warn: 'cannot read expiry' };
    if (risk.tokenExpiryHours < 1)    return { fail: `only ${risk.tokenExpiryHours}h left — refresh NOW` };
    if (risk.tokenExpiryHours < 6)    return { warn: `${risk.tokenExpiryHours}h left — refresh recommended` };
    return `${risk.tokenExpiryHours}h remaining`;
  });

  // ── 3. Live spot from Dhan (not yahoo fallback) ──
  await check('Live spot from Dhan', async () => {
    const s = await getJson('/api/sensex');
    if (s.source && s.source.includes('yahoo')) return { warn: `using yahoo_fallback (Dhan not responding) — price ${s.price}` };
    return `SENSEX ${s.price} (source: ${s.source || 'dhan'})`;
  });

  // ── 4. SENSEX engine state ──
  await check('SENSEX engine off (correct)', async () => {
    const e = await getJson('/api/engine/status');
    const c = e.config || e;
    if (c.autoEnabled === true) return { warn: 'SENSEX auto is ON — strategy has no edge here' };
    return `auto=${c.autoEnabled}, paper=${c.paperMode}`;
  });

  // ── 5. NIFTY engine state ──
  await check('NIFTY engine armed (paper)', async () => {
    const e = await getJson('/api/nifty/engine/status');
    const c = e.config || e;
    if (NIFTY_AUTO_EXPECTED && c.autoEnabled !== true)  return { fail: 'NIFTY auto is OFF — bot will NOT fire signals' };
    if (!c.paperMode)                                    return { fail: 'paperMode=false — REAL ORDERS WILL BE PLACED' };
    return `auto=${c.autoEnabled}, paper=${c.paperMode}, SL=${c.sl}% target=${c.targetMult}× trail=${c.trailMult}×`;
  });

  // ── 6. Halt status ──
  await check('No active halts', async () => {
    const e = await getJson('/api/nifty/engine/status');
    if (e.halt && e.halt.halted) return { fail: `halted: ${e.halt.reason}` };
    return 'all clear';
  });

  // ── 7. Capital + daily loss limit ──
  await check('Capital + daily loss limit', async () => {
    if (!risk) return { fail: 'risk endpoint not loaded' };
    return `₹${(risk.capital || 0).toLocaleString('en-IN')} capital, daily loss cap ₹${(risk.dailyLossLimit || 0).toLocaleString('en-IN')}`;
  });

  // ── 7b. Instrument Registry vs live broker contract master ──
  // Migration C1c-6 / requirement 15. The registry drives `pnl = points × lots × lotSize`
  // in every engine; if it has silently gone stale, every rupee is wrong and no test fails.
  // Comparison logic lives in registry-drift.js (pure, unit-tested). Deeper CLI:
  //   npm run preflight:registry     (needs no server — only a broker token)
  await check('Instrument Registry vs broker', async () => {
    if (!process.env.UPSTOX_ACCESS_TOKEN) return { warn: 'UPSTOX_ACCESS_TOKEN unset — registry NOT verified' };
    const registry = require('./instrument-registry.js');
    const { checkDrift } = require('./registry-drift.js');

    const fetchContracts = (inst) => new Promise((resolve, reject) => {
      const key = registry.catalog(inst).underlyingKey;
      const req = require('https').get(
        `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(key)}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}` }, timeout: 12000 },
        (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => { try { const j = JSON.parse(d); j.status === 'success' ? resolve(j.data) : reject(new Error(`HTTP ${res.statusCode}`)); } catch { reject(new Error('bad JSON')); } }); }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });

    let report;
    try { report = await checkDrift({ fetchContracts }); }
    catch (e) { return { warn: `could not verify: ${e.message}` }; }

    if (report.ok) return `${report.checked} instruments match the broker contract master`;
    if (report.drifted > 0) {
      const first = report.results.find((r) => !r.ok && !r.error);
      const d = first.diffs[0];
      return { fail: `DRIFT: ${first.inst} ${d.field} registry=${JSON.stringify(d.expected)} broker=${JSON.stringify(d.found)} — run \`npm run preflight:registry\`` };
    }
    return { warn: `${report.errored} instrument(s) unreachable — registry NOT verified` };
  });

  // ── 8. AmiBroker bridge ──
  await check('AmiBroker bridge', async () => {
    const r = await http_get('/api/amibroker/status');
    return r.status === 200 ? 'reachable' : { warn: `HTTP ${r.status}` };
  });

  // ── 9. Cloudflare tunnel (optional public access) ──
  await check('Public URL reachable (tunnel)', async () => {
    return new Promise((resolve) => {
      const https = require('https');
      const req = https.get('https://encoding-pierce-season-edwards.trycloudflare.com/api/health', { timeout: 5000 }, res => {
        resolve(res.statusCode === 200 ? 'reachable via trycloudflare URL' : { warn: `HTTP ${res.statusCode} — URL may have rotated` });
      });
      req.on('error', () => resolve({ warn: 'public tunnel not reachable (local-only mode is OK for paper run)' }));
      req.on('timeout', () => { req.destroy(); resolve({ warn: 'public tunnel timeout' }); });
    });
  });

  // ── Summary ──
  console.log(`\n${'─'.repeat(64)}`);
  const total = pass + fail + warn;
  if (fail === 0 && warn === 0) {
    console.log(`  ${green('✓ READY FOR MARKET')} — all ${pass}/${total} checks passed.`);
  } else if (fail === 0) {
    console.log(`  ${yellow('⚠ READY WITH WARNINGS')} — ${pass} passed, ${warn} warnings.`);
  } else {
    console.log(`  ${red('✗ NOT READY')} — ${fail} failures, ${warn} warnings, ${pass} passed.`);
  }
  console.log(`${'─'.repeat(64)}\n`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error('preflight crashed:', err); process.exit(2); });
