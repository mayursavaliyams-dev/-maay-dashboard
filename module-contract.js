'use strict';
/**
 * module-contract.js — the API Rule, made executable.
 *
 * THE API RULE (ratified by the owner, 2026-07-09). Every future module must expose:
 *   REST API · WebSocket · Health · Metrics · Version · Configuration ·
 *   OpenAPI documentation · Structured logging · Graceful shutdown · Health score
 *
 * ─── WHAT THIS MODULE IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────
 *
 * A module does not get an API by writing one. It gets an API by DESCRIBING itself and
 * letting this file build the surface. Eleven surfaces × N modules, hand-written, is how
 * eleven surfaces drift. Here they are built once, tested once, and cannot disagree.
 *
 * TWO STRUCTURAL FACTS, MEASURED 2026-07-09, THAT SHAPE THIS DESIGN:
 *
 *   1. All 168 routes live in `server.js`, which is PROTECTED and uses NO `express.Router()`.
 *      A module therefore cannot mount a route by itself. `router()` below returns a fully
 *      formed Router that needs exactly ONE approved line in server.js to mount:
 *          app.use('/api/m', require('./module-contract.js').mountAll());
 *      One approved edit, and every present and future module has its eleven surfaces.
 *      Until that line exists, the surfaces are real, tested, and simply not reachable
 *      over HTTP. That is a deployment gap, not a design gap — and it is stated, not hidden.
 *
 *   2. There is NO WebSocket SERVER. The `ws` dependency is used in exactly one place —
 *      `dhan-ws-feed.js` — as a CLIENT to the broker. No page calls `new WebSocket(...)`;
 *      `dashboard.html` runs 16 polling timers instead. Creating a WS server means attaching
 *      to the HTTP server object, which `server.js:7228` never even captures from `app.listen`.
 *      So `wsChannel()` below defines the CONTRACT and the message envelope, and reports
 *      `attached: false` honestly. **It does not pretend to be a WebSocket.**
 *      An unimplemented surface that reports itself as present is worse than an absent one.
 *
 * ─── AN ENGINE IS NOT A SERVICE ──────────────────────────────────────────────
 *
 * `charges.js` is 29 lines of pure arithmetic. `pop-seller` is a pure calculator plus a book.
 * Forcing HTTP, sockets, logging and shutdown hooks into a pure leaf destroys the property
 * that makes it testable and reusable. So the rule is applied where it belongs:
 *
 *      ENGINE  (pure)      → returns an EngineVerdict. Knows nothing of HTTP.
 *      SERVICE (this file) → wraps an engine and exposes the eleven surfaces.
 *
 * The API Rule governs the SERVICE ADAPTER, never the engine core. This preserves the
 * AI Architecture Rule (engines only produce verdicts) and the Dashboard Rule (calculation
 * lives in engines) rather than colliding with them.
 *
 * ─── FAIL CLOSED, EVERYWHERE ─────────────────────────────────────────────────
 *
 *   • health with no evidence   → 'unknown', NEVER 'ok'. Silence is not health.
 *   • healthScore with no checks→ null, NEVER 0 and never 1.
 *   • config()                  → REDACTS secrets by pattern. `.env` holds live broker
 *                                 tokens (DHAN_ACCESS_TOKEN, UPSTOX_ACCESS_TOKEN,
 *                                 ANTHROPIC_API_KEY, AUTH_SECRET). A /config endpoint is a
 *                                 credential-exfiltration route unless redaction is proven.
 *                                 Redaction is allow-list-shaped: unknown keys are redacted.
 *   • metrics()                 → reports only counters it actually observed.
 *
 * Pure leaf otherwise: requires only `express` lazily, and only inside `router()`.
 */

const os = require('os');

// ── secrets ──────────────────────────────────────────────────────────────────
// Deny-by-default. A key is exposed ONLY if it matches SAFE_KEY and matches no SECRET_KEY.
// Getting this backwards — exposing by default, hiding known-bad names — is how
// `BROKER_TOKEN_2` leaks the day someone adds it.
const SECRET_KEY = /(token|secret|key|password|passwd|pwd|auth|credential|cookie|session|bearer|signature|private)/i;
const SAFE_VALUE = /^(true|false|null|\d+(\.\d+)?|[A-Z_]{2,30})$/;

/** Redact a config object for publication. Returns a NEW object; never mutates. */
function redactConfig(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg || {})) {
    if (SECRET_KEY.test(k)) { out[k] = '[REDACTED]'; continue; }
    if (v === null || typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string') {
      // A value that looks like a credential is redacted even under an innocent key.
      // Long opaque strings are the shape of a token; short enum-ish values are not.
      out[k] = (v.length > 24 && !SAFE_VALUE.test(v)) ? '[REDACTED]' : v;
      continue;
    }
    if (Array.isArray(v)) { out[k] = v.map((x) => (typeof x === 'string' && x.length > 24 ? '[REDACTED]' : x)); continue; }
    if (typeof v === 'object') { out[k] = redactConfig(v); continue; }
    out[k] = '[REDACTED]';                       // functions, symbols, anything unexpected
  }
  return out;
}

// ── structured logging ───────────────────────────────────────────────────────
// One JSON object per line. No dependency: pino/winston would be a new supply-chain
// surface for something this file does in twelve lines. `write` is injectable so tests
// never touch stdout and so a future sink (file, Loki) needs no code change here.
const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function createLogger(moduleName, { level = 'info', write = null, clock = null } = {}) {
  const min = LEVELS[level] || LEVELS.info;
  const sink = write || ((line) => process.stdout.write(line + '\n'));
  const now = clock || (() => new Date().toISOString());
  const emit = (lvl) => (msg, fields = {}) => {
    if (LEVELS[lvl] < min) return;
    const safe = redactConfig(fields);           // a log line is a publication surface too
    sink(JSON.stringify({ ts: now(), level: lvl, module: moduleName, msg, ...safe }));
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

// ── health ───────────────────────────────────────────────────────────────────
const HEALTH = Object.freeze({ OK: 'ok', DEGRADED: 'degraded', DOWN: 'down', UNKNOWN: 'unknown' });

/**
 * Roll up individual checks. A check is { name, status, detail? }.
 *
 * The precedence is deliberate: DOWN beats UNKNOWN beats DEGRADED beats OK.
 * UNKNOWN outranks DEGRADED because "I could not determine this" is a stronger reason
 * to withhold trust than "this is working badly but I can see it".
 */
function rollup(checks) {
  if (!checks.length) return HEALTH.UNKNOWN;                       // no evidence ⇒ not 'ok'
  if (checks.some((c) => c.status === HEALTH.DOWN)) return HEALTH.DOWN;
  if (checks.some((c) => c.status === HEALTH.UNKNOWN)) return HEALTH.UNKNOWN;
  if (checks.some((c) => c.status === HEALTH.DEGRADED)) return HEALTH.DEGRADED;
  return HEALTH.OK;
}

/**
 * Health score, 0..1, or NULL when it cannot be known.
 * `null ≠ 0`: a score of 0 means "measured, and totally unhealthy". A score of null means
 * "not measured". A dashboard that renders null as 0 turns ignorance into an alarm; one
 * that renders it as 1 turns ignorance into comfort. Both are lies. It returns null.
 */
function healthScore(checks) {
  const known = checks.filter((c) => c.status !== HEALTH.UNKNOWN);
  if (!checks.length || !known.length) return null;
  const w = { [HEALTH.OK]: 1, [HEALTH.DEGRADED]: 0.5, [HEALTH.DOWN]: 0 };
  const sum = known.reduce((s, c) => s + (w[c.status] ?? 0), 0);
  // Unknown checks are not scored, but they DO dilute: pretending a module with 1 ok check
  // and 9 unknown ones is 100% healthy is exactly the failure this whole rule exists to stop.
  return +(sum / checks.length).toFixed(4);
}

// ── the registry ─────────────────────────────────────────────────────────────
const _modules = new Map();

/**
 * Describe a module once; receive all eleven surfaces.
 *
 * @param {object} d
 * @param {string} d.name                 - stable id, e.g. 'strangle-engine'
 * @param {string} d.version              - semver of the module's contract
 * @param {() => Array<{name,status,detail?}>} [d.checks] - health evidence. Absent ⇒ 'unknown'.
 * @param {() => object} [d.metrics]      - flat map of counter/gauge name → number
 * @param {() => object} [d.config]       - current effective config; REDACTED before publication
 * @param {object} [d.openapi]            - OpenAPI 3.1 `paths` fragment for the module's own routes
 * @param {Array<{name,description}>} [d.channels] - WebSocket channels this module WOULD publish
 * @param {() => (void|Promise<void>)} [d.onShutdown]
 * @param {() => string} [d.clock]        - inject; nothing here reads the wall clock directly
 * @param {boolean} [d.replace]           - see below. Required to re-register a name.
 *
 * DUPLICATE REGISTRATION IS A BUG BY DEFAULT — two different files claiming one name would
 * silently shadow each other's health and metrics. So it throws.
 *
 * BUT a module can legitimately be loaded twice: a test that busts `require.cache` to get a
 * fresh instance produces a second, LIVE object while the registry still holds an adapter
 * closed over the DEAD one. Health and metrics would then report a discarded instance's
 * state — green lights from a corpse. `replace: true` says "I am the same module, re-loaded;
 * the newest instance owns the adapter." A self-registering engine must pass it.
 */
function defineModule(d) {
  if (!d || typeof d.name !== 'string' || !d.name) throw new Error('module needs a name');
  if (typeof d.version !== 'string' || !d.version) throw new Error(`${d.name}: version required`);
  if (_modules.has(d.name) && !d.replace) throw new Error(`module '${d.name}' is already defined`);

  const clock = d.clock || (() => new Date().toISOString());
  const logger = createLogger(d.name, { level: d.logLevel, write: d.logWrite, clock });

  const api = {
    name: d.name,
    version: d.version,
    logger,

    /** Health — evidence, or an honest 'unknown'. Never throws: a health endpoint that
     *  crashes when the module is sick is worse than useless. */
    health() {
      let checks = [];
      try {
        checks = (d.checks ? d.checks() : []) || [];
      } catch (e) {
        checks = [{ name: 'checks', status: HEALTH.DOWN, detail: `health check threw: ${e.message}` }];
      }
      return {
        module: d.name, version: d.version,
        status: rollup(checks),
        healthScore: healthScore(checks),      // null when unknowable
        checks, ts: clock(),
      };
    },

    /** A single 0..1 number, or null. Exposed separately because the rule names it separately. */
    healthScore() { return this.health().healthScore; },

    /** Metrics. Only what was actually observed — no zero-filling of counters that were
     *  never incremented, because a zero counter and an absent one mean different things. */
    metrics() {
      let m = {};
      try { m = (d.metrics ? d.metrics() : {}) || {}; } catch (e) { return { _error: e.message }; }
      const clean = {};
      for (const [k, v] of Object.entries(m)) if (Number.isFinite(v)) clean[k] = v;
      return clean;
    },

    /** Prometheus text exposition. Non-finite values are omitted, not rendered as NaN. */
    metricsText() {
      const m = this.metrics();
      const pre = d.name.replace(/[^a-zA-Z0-9]/g, '_');
      return Object.entries(m)
        .filter(([k]) => k !== '_error')
        .map(([k, v]) => `${pre}_${k.replace(/[^a-zA-Z0-9]/g, '_')} ${v}`)
        .join('\n') + '\n';
    },

    versionInfo() {
      return {
        module: d.name, version: d.version,
        platform: require('./package.json').version,
        node: process.version, pid: process.pid,
        host: os.hostname(), ts: clock(),
      };
    },

    /** Configuration — REDACTED. This is a publication surface, not a debug dump. */
    config() {
      let c = {};
      try { c = (d.config ? d.config() : {}) || {}; } catch (e) { return { _error: e.message }; }
      return redactConfig(c);
    },

    /** OpenAPI 3.1 document for this module alone. */
    openapi() {
      return {
        openapi: '3.1.0',
        info: { title: `${d.name} API`, version: d.version },
        paths: {
          [`/api/m/${d.name}/health`]:  { get: { summary: 'Health + health score', responses: { 200: { description: 'ok' } } } },
          [`/api/m/${d.name}/metrics`]: { get: { summary: 'Prometheus metrics', responses: { 200: { description: 'ok' } } } },
          [`/api/m/${d.name}/version`]: { get: { summary: 'Version info', responses: { 200: { description: 'ok' } } } },
          [`/api/m/${d.name}/config`]:  { get: { summary: 'Effective config (secrets redacted)', responses: { 200: { description: 'ok' } } } },
          ...(d.openapi || {}),
        },
      };
    },

    /**
     * WebSocket channel descriptor. HONEST: `attached:false` until a WS server exists.
     * Returning a fake subscribe() that silently never fires would satisfy a checklist and
     * mislead every caller. The contract is declared; the transport is absent; both are said.
     */
    wsChannel() {
      return {
        module: d.name,
        attached: false,
        reason: 'no WebSocket server exists; `ws` is used only as a broker client in dhan-ws-feed.js. ' +
                'Attaching one requires capturing the http.Server from app.listen() in server.js (protected).',
        channels: (d.channels || []).map((c) => ({ ...c, topic: `${d.name}.${c.name}` })),
        envelope: { topic: 'string', seq: 'monotonic integer', ts: 'ISO-8601', payload: 'object' },
      };
    },

    /** Graceful shutdown. Idempotent; never throws; always resolves. */
    async shutdown(reason = 'unspecified') {
      if (api._shutdown) return api._shutdownResult;
      api._shutdown = true;
      try {
        if (d.onShutdown) await d.onShutdown();
        logger.info('shutdown complete', { reason });
        api._shutdownResult = { module: d.name, ok: true };
      } catch (e) {
        logger.error('shutdown failed', { reason, error: e.message });
        api._shutdownResult = { module: d.name, ok: false, error: e.message };
      }
      return api._shutdownResult;
    },

    /** An express.Router carrying the module's REST surface. Requires express lazily so
     *  this file stays importable from a test that has no HTTP stack. */
    router() {
      const express = require('express');
      const r = express.Router();
      r.get('/health', (_q, res) => { const h = api.health(); res.status(h.status === HEALTH.DOWN ? 503 : 200).json(h); });
      r.get('/metrics', (_q, res) => res.type('text/plain').send(api.metricsText()));
      r.get('/metrics.json', (_q, res) => res.json(api.metrics()));
      r.get('/version', (_q, res) => res.json(api.versionInfo()));
      r.get('/config', (_q, res) => res.json(api.config()));
      r.get('/openapi.json', (_q, res) => res.json(api.openapi()));
      r.get('/ws', (_q, res) => res.status(501).json(api.wsChannel()));   // 501: declared, not implemented
      return r;
    },
  };

  _modules.set(d.name, api);
  return api;
}

const getModule = (name) => _modules.get(name) || null;
const listModules = () => [..._modules.keys()].sort();

/** Aggregate health across every registered module. Fail-closed rollup. */
function platformHealth() {
  const mods = listModules().map((n) => _modules.get(n).health());
  const scored = mods.map((m) => m.healthScore).filter((s) => s !== null);
  return {
    status: rollup(mods.map((m) => ({ name: m.module, status: m.status }))),
    healthScore: scored.length ? +(scored.reduce((a, b) => a + b, 0) / mods.length).toFixed(4) : null,
    modulesUnscored: mods.length - scored.length,
    modules: mods,
  };
}

/**
 * ONE mount point for every module. This is the single line `server.js` needs:
 *     app.use('/api/m', require('./module-contract.js').mountAll());
 * Nothing else in the protected file changes, now or for any future module.
 */
function mountAll() {
  const express = require('express');
  const root = express.Router();
  for (const name of listModules()) root.use(`/${name}`, _modules.get(name).router());
  root.get('/', (_q, res) => res.json({ modules: listModules() }));
  root.get('/health', (_q, res) => {
    const h = platformHealth();
    res.status(h.status === HEALTH.DOWN ? 503 : 200).json(h);
  });
  return root;
}

/** Shut every module down, in reverse registration order. Never rejects. */
async function shutdownAll(reason = 'SIGTERM') {
  const names = [...listModules()].reverse();
  return Promise.all(names.map((n) => _modules.get(n).shutdown(reason)));
}

/** Test seam only. Production never unregisters a module. */
function _reset() { _modules.clear(); }

module.exports = {
  defineModule, getModule, listModules, platformHealth, mountAll, shutdownAll,
  createLogger, redactConfig, healthScore, rollup, HEALTH, _reset,
};
