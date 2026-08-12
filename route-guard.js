/* route-guard — an ungated mutating route cannot be created.
   Phase 1A of the backend hardening programme. See docs/086, docs/087.

   THE DEFECT THIS REPLACES
   ------------------------
   58 mutating routes. 9 gated. 49 open, including:

       POST /api/nifty/engine/mode     → niftyEngine.setTradeMode(mode)

   which flips NIFTY between paper and live in three lines, and whose SENSEX twin
   two hundred lines earlier IS gated. A previous pass gated /api/engine/* and
   never looked for the instrument-prefixed duplicates.

   WHY THE FIX IS NOT "GATE 49 ROUTES"
   -----------------------------------
   Because that is what was done last time, and it produced this. Enumerating by
   hand reproduces the defect: a control applied to some of the things it should
   cover provides the safety of the ones it missed.

   So the registration functions themselves are wrapped. `app.post(...)` gates
   its route because it was registered, not because anybody remembered. Adding a
   new mutating route next year gates it automatically. Leaving one open requires
   an allowlist entry, which appears in a diff and carries a written reason.

   WHAT IS COVERED
   ---------------
   Express offers several ways to register the same route, and a guard covering
   one of them is a guard over one:

       app.post(path, …)              wrapped
       app.put / patch / delete       wrapped
       app.all(path, …)               wrapped — it registers every verb
       app.route(path).post(…)        wrapped, via the Route returned by app.route

   GET and HEAD are deliberately untouched. This mechanism exists to stop state
   changing without a credential; read paths have a different argument and are
   not smuggled in under this one. */
'use strict';

const { isControlGate } = require('./attestation');

const MUTATING = ['post', 'put', 'patch', 'delete'];

function normalisePath(p) {
  return typeof p === 'string' ? p.replace(/\/+$/, '') || '/' : String(p);
}

/** Build a matcher from the allowlist, rejecting entries that are not arguable. */
function compileAllowlist(allowlist) {
  const entries = [];
  for (const raw of allowlist || []) {
    if (!raw || typeof raw.path !== 'string') {
      throw new Error('[route-guard] allowlist entry has no path');
    }
    if (!raw.reason || typeof raw.reason !== 'string' || raw.reason.trim().length < 8) {
      // An unexplained exemption is how the list grows. Whoever adds one has to
      // say why in the same edit, so the reason is reviewed with the exemption
      // rather than reconstructed later from the path name.
      throw new Error(`[route-guard] allowlist entry ${raw.path} has no reason — an exemption without an argument is not an exemption`);
    }
    const methods = (raw.methods && raw.methods.length ? raw.methods : MUTATING).map((m) => m.toLowerCase());
    entries.push({ path: normalisePath(raw.path), methods, reason: raw.reason, used: false });
  }
  return entries;
}

function allowlistHit(entries, method, path) {
  const p = normalisePath(path);
  return entries.find((e) => e.path === p && e.methods.includes(method.toLowerCase())) || null;
}

/** Wrap an app so every mutating registration carries the gate.
 *
 *  Install immediately after `const app = express()` and BEFORE any route is
 *  registered. Routes registered earlier are not wrapped — `auditRoutes` exists
 *  to catch that, and the install records where it happened so the gap is
 *  visible rather than assumed absent.
 *
 *  @param gate       (action) => middleware. The real ControlAuth gate factory.
 *  @param allowlist  [{ path, methods, reason }] — each requires a reason.
 *  @param actionOf   name the control action for the audit log. Defaults to the path.
 */
function installRouteGuard(app, { gate, allowlist = [], actionOf = null } = {}) {
  if (typeof gate !== 'function') throw new Error('[route-guard] a gate factory is required');
  const entries = compileAllowlist(allowlist);

  const preExisting = (app._router && app._router.stack ? app._router.stack : [])
    .filter((l) => l.route && Object.keys(l.route.methods || {}).some((m) => MUTATING.includes(m)))
    .map((l) => l.route.path);

  const nameAction = actionOf || ((method, path) => `${method.toUpperCase()} ${path}`);
  const state = { entries, gated: [], exempted: [], preExisting };

  /* Inject the gate into the handler list. `isControlGate` is the same predicate
     attestation uses, so a route that already carries an explicit gate is not
     given a second one — a doubled gate logs every control action twice and
     makes the audit trail lie about how many attempts occurred. */
  const wrap = (method, path, handlers) => {
    const hit = allowlistHit(entries, method, path);
    if (hit) {
      hit.used = true;
      state.exempted.push(`${method.toUpperCase()} ${path}`);
      return handlers;
    }
    if (handlers.some((h) => isControlGate(h))) return handlers;
    state.gated.push(`${method.toUpperCase()} ${path}`);
    return [gate(nameAction(method, path)), ...handlers];
  };

  for (const method of MUTATING) {
    const original = app[method].bind(app);
    app[method] = function guardedRegister(path, ...handlers) {
      if (typeof path !== 'string' && !(path instanceof RegExp)) {
        // app.post(fn) — a middleware registration, not a route. Pass it through.
        return original(path, ...handlers);
      }
      return original(path, ...wrap(method, path, handlers));
    };
  }

  const originalAll = app.all.bind(app);
  app.all = function guardedAll(path, ...handlers) {
    if (typeof path !== 'string' && !(path instanceof RegExp)) return originalAll(path, ...handlers);
    // app.all registers every verb including the mutating ones, so it is gated
    // as a whole. The gate on a GET arriving through app.all is the price of not
    // letting app.all be the hole.
    return originalAll(path, ...wrap('all', path, handlers));
  };

  const originalRoute = app.route.bind(app);
  app.route = function guardedRoute(path) {
    const route = originalRoute(path);
    for (const method of MUTATING) {
      const orig = route[method].bind(route);
      route[method] = function guardedRouteVerb(...handlers) {
        return orig(...wrap(method, path, handlers));
      };
    }
    return route;
  };

  app.__routeGuard = state;
  return state;
}

/** Enumerate mutating routes from the stack the app ACTUALLY built.
 *
 *  Not from source text: a route added by a plugin, mounted under a prefix, or
 *  registered with a computed path appears here and appears in no grep.
 */
function auditRoutes(app, { allowlist = null } = {}) {
  const entries = allowlist ? compileAllowlist(allowlist) : (app.__routeGuard ? app.__routeGuard.entries : []);
  const routes = [];

  const visit = (layers, prefix) => {
    for (const layer of layers || []) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).filter((m) => MUTATING.includes(m));
        if (!methods.length) continue;
        const full = normalisePath(prefix + (layer.route.path || ''));
        const handles = (layer.route.stack || []).map((s) => s.handle);
        const hit = entries.length ? allowlistHit(entries, methods[0], full) : null;
        if (hit) hit.used = true;
        routes.push({
          path: full,
          methods,
          gated: handles.some((h) => isControlGate(h)),
          allowlisted: !!hit,
          reason: hit ? hit.reason : null,
        });
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        // A mounted router. layer.regexp carries the mount prefix; recover it
        // from the source rather than re-deriving the path grammar.
        let mount = '';
        const m = layer.regexp && /^\^\\?(\/[^\\?]*)/.exec(String(layer.regexp.source).replace(/\\\//g, '/'));
        if (m) mount = m[1].replace(/\/\?\(\?=\/\|\$\)$/, '').replace(/\$$/, '');
        visit(layer.handle.stack, prefix + mount);
      }
    }
  };
  visit(app && app._router && app._router.stack, '');

  routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  routes.unusedAllowlist = entries.filter((e) => !e.used).map((e) => `${e.methods.join('|').toUpperCase()} ${e.path}`);
  routes.ungated = routes.filter((r) => !r.gated && !r.allowlisted).map((r) => `${r.methods.join('|').toUpperCase()} ${r.path}`);
  return routes;
}

module.exports = { installRouteGuard, auditRoutes, compileAllowlist, MUTATING };
