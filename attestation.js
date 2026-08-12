/* attestation — what is ACTUALLY running, derived at runtime.
   Phase 0 of the backend hardening programme. See docs/086, docs/087.

   WHY THIS EXISTS
   ---------------
   A control endpoint returned 404 for a week while the code that serves it sat
   in the working tree. A wiring edit matched nothing and its test passed anyway.
   Until "the running process contains this change" is a checkable fact, every
   acceptance test in this programme tests the repository's intentions rather
   than the system's behaviour.

   THE ONE RULE THAT MAKES THIS HONEST
   -----------------------------------
   The code version is SEALED AT STARTUP and never recomputed.

   The obvious implementation reads the files when asked, and therefore reports
   the tree the process can SEE rather than the code the process is RUNNING —
   which is the defect this module exists to detect, faithfully reimplemented
   inside the detector. `sealCodeVersion` reads once, freezes, and the frozen
   value is what is served. A verifier compares it against the tree as it stands
   now; a difference means the process is stale.

   THE SECOND RULE
   ---------------
   `configured` and `active` are different facts and are never merged.

     configured — the control object was constructed
     active     — the things that must consult it are actually holding it

   That distinction is the whole point. This programme exists because a risk
   guard was constructed 2,300 lines AFTER the engines that were meant to receive
   it. It existed. It was correct. Every engine held the raw connector. A checker
   that answers "was it built?" would have reported that system as protected.

   THE THIRD RULE
   --------------
   An unsupplied consumer set yields `active: null` — UNEVALUABLE — never false.
   `false` asserts a fact about a graph that was never inspected. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

/* ── the code version ──────────────────────────────────────────────────────── */

/** Hash the given files ONCE and freeze the result.
 *
 *  Call this at startup, keep the returned object, and serve that object
 *  forever. Do not call it again to answer a request — that would report the
 *  current tree, not the running code, and this module would become the bug.
 */
function sealCodeVersion(filePaths) {
  const files = [];
  for (const p of filePaths) {
    let sha256 = null;
    let bytes = null;
    try {
      const buf = fs.readFileSync(p);
      sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      bytes = buf.length;
    } catch (e) {
      // A file that cannot be read is recorded as unreadable, not skipped.
      // Skipping would let a deleted file leave the hash unchanged.
      sha256 = `UNREADABLE:${e.code || 'ERR'}`;
    }
    files.push(Object.freeze({ path: p, rel: path.relative(ROOT, p).replace(/\\/g, '/'), sha256, bytes }));
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const hash = crypto.createHash('sha256')
    .update(files.map((f) => `${f.rel}:${f.sha256}`).join('\n'))
    .digest('hex');

  return Object.freeze({
    hash,
    files: Object.freeze(files),
    fileCount: files.length,
    sealedAt: new Date().toISOString(),
    sealedPid: process.pid,
  });
}

/** The project's own .js files that this process has actually loaded.
 *
 *  Derived from require.cache, so it is what was REQUIRED, not what is on disk.
 *  A file present in the tree but never loaded cannot affect behaviour and is
 *  deliberately absent; a file loaded from outside the project (node_modules)
 *  is excluded because it is pinned by the lockfile, not by this repository.
 */
function loadedProjectFiles() {
  const out = [];
  for (const p of Object.keys(require.cache)) {
    if (!p.startsWith(ROOT)) continue;
    if (p.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (!p.endsWith('.js')) continue;
    out.push(p);
  }
  return out.sort();
}

/* ── controls ──────────────────────────────────────────────────────────────── */

const UNEVALUABLE = (note) => ({ configured: false, active: null, note });

/** Is every consumer holding the control object itself?
 *
 *  Identity comparison, deliberately. A consumer holding a DIFFERENT object that
 *  merely looks similar is the failure mode — a look-alike passes a duck-type
 *  check and places unguarded orders.
 */
function consumersHolding(control, consumers) {
  if (!consumers || typeof consumers !== 'object') return null;
  const names = Object.keys(consumers);
  if (names.length === 0) return null;
  const bypassing = names.filter((n) => consumers[n] !== control);
  return { bypassing: bypassing.sort(), total: names.length };
}

/** Is this middleware the control gate?
 *
 *  MEASURED 2026-08-08 — the first version of this identified the gate BY NAME.
 *  `ControlAuth.gate(action)` returns an arrow function directly, so:
 *
 *      new ControlAuth({...}).gate('engine-TRADE-MODE').name === ""
 *
 *  Every gated route would have been counted as ungated. The detector built to
 *  find unprotected routes would have reported the protected ones as
 *  unprotected — and Phase 1A, which gates everything and asserts the ungated
 *  count reaches zero, could never have gone green no matter what was fixed.
 *
 *  Identity, not naming:
 *    1. an explicit marker, if control-auth is ever changed to set one; or
 *    2. the closure's own source text, which is identical for every gate
 *       because they all come from the same body in control-auth.js.
 *
 *  This predicate must be proven against a REAL gate before its counts are
 *  trusted — see test/attestation.test.js §5. A route-counter whose notion of
 *  "gated" was never checked against a gate is a counter of nothing.
 */
function isControlGate(fn) {
  if (typeof fn !== 'function') return false;
  if (fn.__controlGate) return true;
  let src = '';
  try { src = Function.prototype.toString.call(fn); } catch (_) { return false; }
  return /x-control-token/.test(src) && /controlVia/.test(src);
}

/** Walk the router stack the process actually built.
 *
 *  Per prompt F2: this reads the live Express app, not a list of route strings
 *  assembled by reading source. A route added by a plugin, a router mounted
 *  under a prefix, or a route whose path is computed all appear here and appear
 *  nowhere in a grep.
 *
 *  @param isGate  override the predicate. The caller may know something this
 *                 module does not; it may not know less.
 */
function walkMutatingRoutes(app, isGate = isControlGate) {
  const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
  const stack = app && app._router && app._router.stack;
  if (!Array.isArray(stack)) return null;

  const routes = [];
  const visit = (layers, prefix) => {
    for (const layer of layers) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).filter((m) => MUTATING.has(m));
        if (methods.length === 0) continue;
        const handles = (layer.route.stack || []).map((s) => s.handle);
        routes.push({
          path: prefix + (layer.route.path || ''),
          methods,
          handlerCount: handles.length,
          gated: handles.some((h) => isGate(h)),
        });
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        visit(layer.handle.stack, prefix);
      }
    }
  };
  visit(stack, '');
  return routes;
}

/** Compute the attestation from live objects.
 *
 *  @param sealed   the frozen object from sealCodeVersion(), taken at startup
 *  @param graph    the live object graph:
 *                    guardedBroker, orderConsumers   — who may place orders
 *                    killSwitch,    killConsumers    — who must ask before acting
 *                    dataGate,      dataConsumers    — who must ask before trusting
 *                    controlAuth,   app              — the gate, and the router
 */
function computeAttestation({ sealed, graph = {} } = {}) {
  const controls = {};

  /* ── the order chokepoint ── */
  {
    const g = graph.guardedBroker;
    if (!g) {
      controls.orderChokepoint = UNEVALUABLE('no guarded broker supplied — unevaluable');
    } else {
      const configured = typeof g.placeOrder === 'function' && typeof g.requestApproval === 'function';
      const held = consumersHolding(g, graph.orderConsumers || graph.consumers);
      controls.orderChokepoint = held === null
        ? { configured, active: null, note: 'guard exists but no consumers supplied — unevaluable. A guard nobody holds is the defect this check exists for, so absence of the consumer list is not evidence of safety.' }
        : {
          configured,
          active: configured && held.bypassing.length === 0,
          bypassing: held.bypassing,
          consumerCount: held.total,
          note: held.bypassing.length
            ? `${held.bypassing.length} of ${held.total} order-capable consumers hold something other than the guard`
            : `all ${held.total} order-capable consumers hold the guard`,
        };
    }
  }

  /* ── the control gate ── */
  {
    const ca = graph.controlAuth;
    if (!ca) {
      controls.controlGate = UNEVALUABLE('no control auth supplied — unevaluable');
    } else {
      const configured = typeof ca.gate === 'function';
      let mode = null;
      try { mode = ca.mode && ca.mode(); } catch (_) { mode = null; }
      const routes = walkMutatingRoutes(graph.app);
      if (routes === null) {
        controls.controlGate = {
          configured, active: null, mode: mode && mode.mode,
          note: 'no express app supplied — the gate exists, but whether it is installed on the mutating routes is unevaluable',
        };
      } else {
        const ungated = routes.filter((r) => !r.gated);
        controls.controlGate = {
          configured,
          active: configured && ungated.length === 0,
          mode: mode && mode.mode,
          routes: { mutating: routes.length, gated: routes.length - ungated.length, ungated: ungated.length },
          ungatedPaths: ungated.map((r) => `${r.methods.join('|').toUpperCase()} ${r.path}`).sort(),
          note: ungated.length
            ? `${ungated.length} of ${routes.length} mutating routes carry no gate`
            : `all ${routes.length} mutating routes carry the gate`,
        };
      }
    }
  }

  /* ── the kill switch ── */
  {
    const ks = graph.killSwitch;
    if (!ks) {
      controls.killSwitch = UNEVALUABLE('no kill switch supplied — unevaluable');
    } else {
      const configured = typeof ks.blocksNewEntries === 'function' && typeof ks.trip === 'function';
      const held = consumersHolding(ks, graph.killConsumers);
      let tripped = null;
      try { tripped = !!ks.blocksNewEntries(); } catch (_) { tripped = null; }
      controls.killSwitch = held === null
        ? { configured, active: null, tripped, note: 'kill switch exists but no consumers supplied — unevaluable' }
        : {
          configured,
          active: configured && held.bypassing.length === 0,
          tripped,
          bypassing: held.bypassing,
          note: held.bypassing.length
            ? `${held.bypassing.length} of ${held.total} consumers do not hold the kill switch`
            : `all ${held.total} consumers hold the kill switch`,
        };
    }
  }

  /* ── the data gate ── */
  {
    const dg = graph.dataGate;
    if (!dg) {
      controls.dataGate = UNEVALUABLE('no data gate supplied — unevaluable');
    } else {
      const configured = typeof dg.checkInstrument === 'function' && typeof dg.checkStrategy === 'function';
      const held = consumersHolding(dg, graph.dataConsumers);
      controls.dataGate = held === null
        ? { configured, active: null, note: 'data gate exists but no consumers supplied — unevaluable' }
        : {
          configured,
          active: configured && held.bypassing.length === 0,
          bypassing: held.bypassing,
          note: held.bypassing.length
            ? `${held.bypassing.length} of ${held.total} consumers do not hold the data gate`
            : `all ${held.total} consumers hold the data gate`,
        };
    }
  }

  return {
    schema: 'attestation/1',
    codeVersion: sealed
      ? { hash: sealed.hash, fileCount: sealed.fileCount, sealedAt: sealed.sealedAt, sealedPid: sealed.sealedPid }
      : null,
    files: sealed ? sealed.files.map((f) => ({ rel: f.rel, sha256: f.sha256, bytes: f.bytes })) : null,
    controls,
    process: {
      pid: process.pid,
      startedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
    },
    reportedAt: new Date().toISOString(),
  };
}

module.exports = {
  sealCodeVersion, loadedProjectFiles, computeAttestation, walkMutatingRoutes, isControlGate,
};
