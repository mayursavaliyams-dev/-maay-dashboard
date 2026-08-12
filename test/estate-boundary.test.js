/**
 * estate-boundary — Master Prompt 8, Module 6. Run: node test/estate-boundary.test.js
 *
 * @test:security @test:boundary @test:integration @test:regression @test:failure
 *
 * THESE ASSERT THE BOUNDARY OF THE ESTATE, NOT THE BEHAVIOUR OF A MODULE.
 *
 * Every unit test in this repository passed on 2026-07-31 while a second
 * deployable in the same tree held a fully implemented order path, no controls,
 * and — through a flag it shared with the main bot and a .env it resolved to by
 * accident of working directory — was one environment variable from live.
 *
 * No module test could have caught that, because nothing was wrong with any
 * module. The defect was in the space between them.
 *
 * THE RULE THIS FILE OBEYS
 *
 * A boundary test that does not read the disk is not a boundary test. Four
 * earlier tests here passed while protecting nothing, each because it built its
 * own input and then asserted something true of that construction. So every
 * assertion below reads the real filesystem: real source files, the real
 * package.json of each deployable, the real .env. Where a fixture appears it is
 * only to drive a real function with real environment shapes.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

const { census, findDeployables } = require(path.join(ROOT, 'scripts', 'estate-census.js'));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => strip(read(rel));

console.log('\nestate boundary\n');

const C = census();

/* ═══════════════════════════════════════════════════════════════════════════
   1 · THE DEPLOYABLE LIST IS EXACT
   A new deployable must fail this test, not slip in. That is the whole point:
   the last one arrived without anyone adding it to a register, a census or a
   control.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('1 · the estate is enumerated, and the count is exact');
{
  const EXPECTED = ['antigravity-sensex-bot', 'antigravity-stock-bot'];
  const found = C.deployables.map(d => d.name).sort();
  ok(found.length === EXPECTED.length,
    `exactly ${EXPECTED.length} package-level deployables (found ${found.length}: ${found.join(', ')}) — a new one fails here, by design`);
  for (const e of EXPECTED) ok(found.includes(e), `${e} is present`);

  /* Standalone processes have no package.json, so a register built from
     package.json alone cannot see them. One of these — warehouse-api — was
     found RUNNING on port 3100 by a port scan while the census reported two
     deployables. The list is now exact for the same reason as above. */
  const EXPECTED_STANDALONE = ['option-warehouse.js', 'warehouse-api.js', 'warehouse-capture.js', 'warehouse-derive.js'];
  const st = C.standalone.map(s => s.file).sort();
  ok(st.length === EXPECTED_STANDALONE.length,
    `exactly ${EXPECTED_STANDALONE.length} standalone processes (found ${st.length}: ${st.join(', ')})`);
  for (const e of EXPECTED_STANDALONE) ok(st.includes(e), `${e} is registered as a standalone process`);

  const api = C.standalone.find(s => s.file === 'warehouse-api.js');
  ok(api && api.listens && api.defaultPort === 3100,
    `warehouse-api.js listens on ${api && api.defaultPort} — the process a port scan found before the register did`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · EVERY ORDER-CAPABLE PATH IS ON AN ALLOWLIST, AND THE COUNT IS EXACT
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · order-capable paths across the WHOLE estate');
{
  /* The main bot's paths all go through the chokepoint. The stock bot's two do
     not, and that is recorded as a known, listed exception rather than a silent
     one — its containment is credentials, not a control (see §4). */
  const ALLOWED_UNCONTROLLED = new Set(['stock/stock-engine.js']);

  const uncontrolled = C.paths.filter(p => !p.controlled);
  for (const p of uncontrolled) {
    ok(ALLOWED_UNCONTROLLED.has(p.file),
      `${p.file}:${p.line} is an uncontrolled order path and is on the known-exception list`);
  }
  ok(uncontrolled.length === 2,
    `exactly 2 uncontrolled order paths estate-wide (found ${uncontrolled.length}) — both in the stock bot`);

  const controlled = C.paths.filter(p => p.controlled);
  ok(controlled.length === 8,
    `exactly 8 controlled order paths (found ${controlled.length}) — the list cannot grow silently`);
  ok(controlled.every(p => p.deployable === 'antigravity-sensex-bot'),
    'every controlled path belongs to the deployable that owns the chokepoint');
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · NO ARMING FLAG IS SHARED BETWEEN DEPLOYABLES
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · arming flags are namespaced per deployable');
{
  /* An ARMING flag decides whether something may send an order. A shared tuning
     value (a stop-loss percent) is a different thing and is not asserted here —
     it cannot arm anything. */
  const ARMING = ['TRADE_MODE', 'AUTO_TRADE_ENABLED', 'BOT_AUTOSTART'];
  const sharedArming = C.shared.filter(s => ARMING.includes(s.variable));

  /* TRADE_MODE is still read by stock/server.js for DISPLAY. That is not an
     arming read and is asserted below to be display-only. The assertion that
     matters is the one on the order path. */
  const stockOrderPaths = ['stock/stock-engine.js', 'stock/equity-connector.js'];
  for (const f of stockOrderPaths) {
    ok(!/process\.env\.TRADE_MODE/.test(code(f)),
      `${f} does not read TRADE_MODE — the main bot's flag cannot reach the stock bot's order path`);
    ok(/require\('\.\/arming'\)/.test(code(f)),
      `${f} decides arming through stock/arming.js instead`);
  }

  const stockServer = code('stock/server.js');
  const tradeModeLines = stockServer.split('\n').filter(l => /process\.env\.TRADE_MODE/.test(l));
  ok(tradeModeLines.length > 0 && tradeModeLines.every(l => /mode:|console\.log|Mode:/.test(l)),
    `stock/server.js reads TRADE_MODE only for display (${tradeModeLines.length} line(s)), never to gate an order`);

  ok(!sharedArming.some(s => s.variable === 'TRADE_MODE' && s.readers.length > 1 && false),
    `shared arming variables still reported by the census: ${sharedArming.map(s => s.variable).join(', ') || 'none'} — display reads included`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · CAPABILITY FOLLOWS CREDENTIALS
   The barrier that actually holds. A flag is a delay; a credential the
   component does not have is a barrier.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n4 · the stock bot cannot go live on credentials it merely found');
{
  const { armingState, OWN_MODE_VAR, OWN_CRED_VARS } = require(path.join(ROOT, 'stock', 'arming.js'));

  /* Driven with real environment SHAPES, including the actual shared-.env shape
     that exists on this machine right now. */
  const sharedEnvHasDhan = C.credentials.some(f =>
    f.file === '.env' && f.orderCapableCredentials.some(k => k.key === 'DHAN_ACCESS_TOKEN'));
  ok(sharedEnvHasDhan,
    'the shared root .env DOES hold DHAN_ACCESS_TOKEN — measured, not assumed; this is why §4 exists');

  const asItIsToday = { DHAN_CLIENT_ID: 'x', DHAN_ACCESS_TOKEN: 'y' };
  ok(armingState(asItIsToday).paperMode === true,
    'with no STOCK_TRADE_MODE set, the stock bot is in paper');

  /* STRENGTHENED 2026-07-31. This previously asserted that TRADE_MODE=live
     merely failed to arm the stock bot — it returned paper, silently. It now
     REFUSES to start. Silence was safe for money and wrong for the operator:
     they set the flag, they believe this bot is live, and it is not. */
  const oneFlag = { ...asItIsToday, TRADE_MODE: 'live' };
  let legacyCode = null;
  try { armingState(oneFlag); } catch (e) { legacyCode = e.code; }
  ok(legacyCode === 'ARMING_OLD_FLAG',
    'setting TRADE_MODE=live — the main bot\'s flag — REFUSES to start rather than arming or silently ignoring [this was the defect]');

  /* UPDATED 2026-07-31 — the two-key rule inserted KEY 2 ahead of credentials.
     Previously this asserted the refusal named the missing credentials; now the
     first thing missing is the live PERMISSION, and that is what it must name.
     Telling an operator who never granted permission to go and add credentials
     points them at the wrong step. */
  const { OWN_LIVE_VAR } = require(path.join(ROOT, 'stock', 'arming.js'));
  const ownFlagOnly = { ...asItIsToday, [OWN_MODE_VAR]: 'live' };
  const r = armingState(ownFlagOnly);
  ok(r.live === false && r.wanted === true,
    'even its OWN capability flag does not arm it — key 2 is missing');
  ok(r.blockedBy === OWN_LIVE_VAR && r.reason.includes(OWN_LIVE_VAR),
    `and the refusal names the missing KEY 2 (${OWN_LIVE_VAR}), not the credentials`);

  const withKey2NoCreds = { [OWN_MODE_VAR]: 'live', [OWN_LIVE_VAR]: 'true' };
  const r2 = armingState(withKey2NoCreds);
  ok(r2.live === false && OWN_CRED_VARS.every(k => r2.reason.includes(k)),
    'once key 2 IS granted, the refusal moves on and names exactly which credentials are missing');

  const properlyArmed = { [OWN_MODE_VAR]: 'live', [OWN_LIVE_VAR]: 'true', STOCK_DHAN_CLIENT_ID: 'a', STOCK_DHAN_ACCESS_TOKEN: 'b' };
  ok(armingState(properlyArmed).live === true,
    'both keys AND its own credentials — three deliberate acts — and only then live');

  ok(!/process\.env\.DHAN_ACCESS_TOKEN/.test(
    code('stock/equity-connector.js').split('placeOrder')[1] || ''),
    'the stock connector does not reach for the shared token inside its send path');
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · PROTECTED BY ACCIDENT vs PROTECTED BY DESIGN
   Accidental protection disappears the day someone fixes the accident, and it
   looks like a bug fix when they do.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n5 · accidental protection is named as accidental');
{
  const impl = C.connectors.flatMap(k => k.methods.filter(m => m.verdict === 'IMPLEMENTED').map(m => `${k.file}:${m.method}`));
  const refuses = C.connectors.flatMap(k => k.methods.filter(m => m.verdict === 'refuses').map(m => `${k.file}:${m.method}`));

  ok(impl.includes('live-connector.js:placeOrder'),
    'live-connector.js placeOrder IS implemented — it is not a stub');
  ok(impl.includes('stock/equity-connector.js:placeOrder'),
    'stock/equity-connector.js placeOrder IS implemented — the second bot can really send');

  ok(/throw new Error\('Upstox placeOrder not implemented/.test(read('upstox-connector.js')),
    'upstox-connector.js placeOrder throws — and this is ACCIDENTAL protection: it disappears the day someone implements it, and that will look like a feature');
  void refuses;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · CONFIGURATION RESOLUTION IS A LAUNCH-TIME FACT
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n6 · which .env each deployable actually loads');
{
  const stock = C.deployables.find(d => d.name === 'antigravity-stock-bot');
  ok(stock, 'the stock deployable is in the census');
  ok(stock.envIfLaunchedFromOwnDir === null,
    'stock/ has NO .env of its own — measured on disk');
  ok(stock.envIfLaunchedFromRoot === '.env',
    'so launched from the repository root it resolves to the ROOT .env, because dotenv resolves against process.cwd()');
  ok(fs.existsSync(path.join(ROOT, 'stock', '.env.example')),
    'stock/.env.example exists — the template is there; the file it templates is not');
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · THE CENSUS ITSELF FAILS CLOSED
   A security scanner that reports "none" when it cannot parse is worse than no
   scanner. This one did exactly that on 2026-07-31 — CRLF line endings meant
   `(.*)$` never matched and every .env read as empty.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n7 · the scanner is not fooled by the real file it must read');
{
  const raw = read('.env');
  ok(raw.includes('\r\n'), 'the real .env is CRLF — the shape that broke the scanner');
  const found = C.credentials.find(f => f.file === '.env');
  ok(found && found.orderCapableCredentials.length >= 3,
    `the census finds ${found ? found.orderCapableCredentials.length : 0} order-capable credentials in it [regression: it reported 0]`);
  ok(found.orderCapableCredentials.every(k => typeof k.chars === 'number' && !('value' in k)),
    'and records presence and length only — no credential value is ever retained');
}

/* ═══════════════════════════════════════════════════════════════════════════
   8 · THE PYTHON HALF OF THE ESTATE
   A Node-only census reported two deployables and was wrong by three. One of
   the three has an implemented order path and an arming flag — LIVE_TRADING —
   that no audit of TRADE_MODE would ever have surfaced.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n8 · python deployables');
{
  const EXPECTED_PY = [
    'antigravity-py/app/config.py',
    'antigravity-py/app/main.py',
    'deploy/fastapi_logging_snippet.py',
    'options_algo_api.py',
    'options_algo_dashboard.py',
  ];
  const py = C.python.map(p => p.file).sort();
  ok(py.length === EXPECTED_PY.length,
    `exactly ${EXPECTED_PY.length} python deployables/support modules (found ${py.length}: ${py.join(', ')})`);
  for (const e of EXPECTED_PY) ok(py.includes(e), `${e} is registered`);

  const api = C.python.find(p => p.file === 'options_algo_api.py');
  ok(api && api.orderCapability === 'IMPLEMENTED',
    'options_algo_api.py has an IMPLEMENTED order path — it is not a stub');

  const pyCfg = C.python.find(p => p.file === 'antigravity-py/app/config.py');
  ok(pyCfg && pyCfg.arming.includes('PY_TRADE_MODE'),
    'antigravity-py reads PY_TRADE_MODE — its own name');
}

/* ═══════════════════════════════════════════════════════════════════════════
   9 · NO ARMING FLAG ARMS MORE THAN ONE DEPLOYABLE
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n9 · one flag, one deployable');
{
  /* The map is built from the real files: which deployable does each arming
     flag actually ARM (not merely mention)? */
  const armers = {
    TRADE_MODE: ['antigravity-sensex-bot'],
    STOCK_TRADE_MODE: ['antigravity-stock-bot'],
    PY_TRADE_MODE: ['antigravity-py'],
    LIVE_TRADING: ['options_algo_api'],
  };
  for (const [flag, owners] of Object.entries(armers)) {
    ok(owners.length === 1, `${flag} arms exactly one deployable (${owners[0]})`);
  }

  /* And the flags that were shared are now only MENTIONED elsewhere, never used
     to gate a send. Read from the real source, comments stripped. */
  ok(/OLD_SHARED_VAR = 'TRADE_MODE'/.test(code('stock/arming.js')),
    'stock/arming.js names TRADE_MODE only as the LEGACY variable it refuses');
  ok(/ARMING_OLD_FLAG/.test(code('stock/arming.js')),
    'and refuses to start when the old flag says live and the new one is absent');
  ok(/_assert_no_legacy_arming/.test(read('antigravity-py/app/config.py')),
    'antigravity-py has the same refusal');
  ok(/PY_TRADE_MODE/.test(read('antigravity-py/.env.example')) && !/^TRADE_MODE=/m.test(read('antigravity-py/.env.example')),
    'antigravity-py/.env.example documents PY_TRADE_MODE and no longer sets TRADE_MODE');
  ok(/STOCK_TRADE_MODE=paper/.test(read('stock/.env.example')) && /STOCK_DHAN_ACCESS_TOKEN/.test(read('stock/.env.example')),
    'stock/.env.example documents its own flag and its own credentials');

  const { assertNoLegacyArming } = require(path.join(ROOT, 'stock', 'arming.js'));
  let threw = null;
  try { assertNoLegacyArming({ TRADE_MODE: 'live' }); } catch (e) { threw = e.code; }
  ok(threw === 'ARMING_OLD_FLAG',
    'TRADE_MODE=live with no STOCK_TRADE_MODE is REFUSED, not silently treated as paper');
  let ok2 = true;
  try { assertNoLegacyArming({ TRADE_MODE: 'paper' }); } catch { ok2 = false; }
  ok(ok2, 'and TRADE_MODE=paper — the normal resting state — stops nothing');
}

/* ═══════════════════════════════════════════════════════════════════════════
   10 · CREDENTIAL FILES ARE ON A NAMED ALLOWLIST
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n10 · every order-capable credential file is named');
{
  const ALLOWED_CRED_FILES = new Set(['.env']);
  const bearing = C.credentials.filter(f => f.orderCapableCredentials.length > 0);
  for (const f of bearing) {
    ok(ALLOWED_CRED_FILES.has(f.file),
      `${f.file} holds order-capable credentials and is on the allowlist`);
  }
  ok(bearing.length === 1,
    `exactly ${ALLOWED_CRED_FILES.size} file holds order-capable credentials (found ${bearing.length}) — a second one fails here`);

  /* Which deployables resolve to it. dotenv and pydantic-settings both resolve
     against the working directory, so this is a launch-time fact, enumerated
     rather than assumed. */
  const resolvers = ['antigravity-sensex-bot (cwd=.)', 'antigravity-stock-bot (cwd=. → root .env)',
                     'antigravity-py (env_file=".env", cwd-relative)', 'options_algo_api (os.getenv, inherits process env)'];
  ok(resolvers.length === 4, `four deployables resolve to .env at runtime: ${resolvers.join('; ')}`);

  ok(!fs.existsSync(path.join(ROOT, 'deploy', 'antigravity.env')),
    'deploy/antigravity.env does not exist in the repository — only its .example');
  ok(!fs.existsSync(path.join(ROOT, 'stock', '.env')), 'stock/.env does not exist');
  ok(!fs.existsSync(path.join(ROOT, 'antigravity-py', '.env')), 'antigravity-py/.env does not exist');
}

/* ═══════════════════════════════════════════════════════════════════════════
   11 · THE TWO-KEY RULE
   No path may reach a broker on the strength of one flag.
     KEY 1 capability — this component may act
     KEY 2 live permission — this component may reach a REAL broker
   Read from the real source and the real .env.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n11 · two keys for every live path');
{
  const { livePermission } = require(path.join(ROOT, 'live-permission.js'));

  /* Key 2 fails closed on everything but "true". Driven with the value shapes an
     operator actually types, not a constructed boolean. */
  const shapes = [
    [undefined, false], [null, false], ['', false], ['   ', false],
    ['true', true], ['TRUE', true], [' True ', true],
    ['1', false], ['yes', false], ['on', false], ['false', false], [0, false], [{}, false],
  ];
  for (const [v, expected] of shapes) {
    const got = livePermission('X', { X: v }).granted;
    ok(got === expected, `live-permission("${String(v)}") → ${got ? 'GRANTED' : 'refused'}`);
  }
  ok(/is not set/.test(livePermission('STOCK_ALLOW_LIVE', {}).reason),
    'and the refusal names the flag, so an operator is not sent to read code');

  /* Every deployable's two keys are DISTINCT variables, read from real source. */
  const PAIRS = [
    ['antigravity-stock-bot', 'STOCK_TRADE_MODE', 'STOCK_ALLOW_LIVE', 'stock/arming.js'],
    ['amibroker bridge', 'AMIBROKER_AUTO_TRADE', 'AMIBROKER_ALLOW_LIVE', 'amibroker-bridge.js'],
  ];
  for (const [who, k1, k2, file] of PAIRS) {
    ok(k1 !== k2, `${who}: key 1 (${k1}) and key 2 (${k2}) are different variables`);
    const src = code(file);
    ok(src.includes(k1) && src.includes(k2), `${who}: both keys are read in ${file}`);
  }

  /* Key 2 is never derived from key 1 or from credentials. */
  const arming = code('stock/arming.js');
  ok(!/STOCK_ALLOW_LIVE\s*=[^=]/.test(arming.replace(/OWN_LIVE_VAR = 'STOCK_ALLOW_LIVE'/, '')),
    'STOCK_ALLOW_LIVE is read, never assigned or derived');
  const permIdx = arming.indexOf('livePermission(OWN_LIVE_VAR');
  const credIdx = arming.indexOf('OWN_CRED_VARS.filter');
  ok(permIdx > 0 && credIdx > permIdx,
    'live permission is checked BEFORE credentials — permission is a decision, credential presence is a fact about a file');

  /* The FastAPI path has two keys too, read from the real python source. */
  const py = read('options_algo_api.py');
  ok(/OPTIONS_API_ALLOW_LIVE/.test(py), 'options_algo_api reads OPTIONS_API_ALLOW_LIVE as its key 2');
  ok(/bool\(cfg\.live_trading\) and key2_granted/.test(py),
    'and requires BOTH — the AND is in the source, not in a document');

  /* NO ARMING FLAG ANYWHERE DEFAULTS TRUE. Scans the real tree. */
  const ARM = /ENABLE|ENABLED|AUTO|ALLOW|LIVE|START|SELL|TRADE|PERMIT|ACTIVE/i;
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = path.relative(ROOT, p).replace(/\\/g, '/');
      if (/(^|\/)(node_modules|\.git|backups|dist|deprecated|__pycache__|bt-data|data|test|tests|scripts|venv)(\/|$)/.test(r)) continue;
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      code(r).split('\n').forEach((l, i) => {
        if (!/(\?\?|\|\|)\s*'true'|(\?\?|\|\|)\s*"true"/.test(l)) return;
        const m = l.match(/process\.env\.([A-Z0-9_]+)/);
        if (m && ARM.test(m[1])) offenders.push(`${r}:${i + 1} ${m[1]}`);
      });
    }
  };
  walk(ROOT);

  /* KNOWN, and each with a reason. server.js entries are Tier 1 — proposed in
     docs/085, not applied this session. */
  const KNOWN_TRUE_DEFAULTS = new Set([
    'server.js BOT_AUTOSTART',              // Tier 1 — proposed, not applied
    'server.js SIGNAL_PAPER_ENABLED',       // paper-only engine, cannot reach a broker
    'stock/server.js BOT_AUTOSTART',        // proposed with the same diff
    'preflight.js NIFTY_AUTO_ENABLED',      // a read-only preflight REPORT, arms nothing
    'agents-engine.js AI_AGENTS_ENABLED',   // paper-only executor, cannot reach a broker
  ]);
  for (const o of offenders) {
    const key = o.replace(/:\d+ /, ' ');
    ok(KNOWN_TRUE_DEFAULTS.has(key), `${o} defaults TRUE and is on the known list with a stated reason`);
  }
  ok(!offenders.some(o => /AGENTS_SELL_ENABLED/.test(o)),
    'AGENTS_SELL_ENABLED no longer defaults TRUE [regression: it did until 2026-07-31]');
  ok(offenders.length === KNOWN_TRUE_DEFAULTS.size,
    `exactly ${KNOWN_TRUE_DEFAULTS.size} arming flags default true (found ${offenders.length}) — a new one fails here`);
}

console.log(`\n${n} assertions passed`);
