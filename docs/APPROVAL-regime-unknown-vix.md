# APPROVAL PACKAGE — `server.js:5785` `_computeRegime()` scores an UNREACHABLE VIX as a CALM one

**PROPOSAL ONLY. `server.js` has not been modified by this package.** Suite 45/45 at time of writing.

---

## Current Behaviour

`server.js:5766-5796`, `_computeRegime(inst)`:

```js
let vix = null, ivp = null;
try { const v = await eventEngine.getVix(); vix = Number(v.value) || null; … } catch (_) {}
…
const cIVP   = ivp != null ? ivp : 50;
const cVRP   = vrp != null ? clamp01(50 + vrp * 8) : 50;
const cPCR   = pcr != null ? (pcr < 0.7 ? 30 : pcr > 1.4 ? 55 : 70) : 55;
const cPanic = vix != null && vix >= 22 ? 0 : vix != null && vix >= 18 ? 40 : 100;
const raw    = Math.round(0.30*cIVP + 0.28*cVRP + 0.17*cPCR + 0.15*cEvent + 0.10*cPanic);
const verdict = score >= 62 ? 'SELL-ON' : score >= 45 ? 'REDUCE' : 'STAND-DOWN';
```

`cPanic` is the "is the market panicking" component: **0 when VIX ≥ 22, 40 when ≥ 18, else 100.**
`100` means *maximally safe to sell premium*.

The `vix != null` guards show the author knew the value could be absent, and chose to fall through to
**100** — the most permissive value on the scale.

## Evidence — VERIFIED

`vix` originates at `server.js:5772`:

```js
try { const v = await eventEngine.getVix(); vix = Number(v.value) || null; … } catch (_) {}
```

`eventEngine.getVix()` is a **Yahoo Finance network call** wrapped in its own `catch (_) {}`
(`event-engine.js:73`). Measured from this machine: it returned `{"value":12.34,…}` in **4,513 ms**.
So the value **is normally present** — this defect fires only when Yahoo is unreachable, which is
exactly when volatility is least knowable.

Isolating `cPanic` (all other inputs held constant, `ivp=60, vrp=1, pcr=1.0, eventRisk=0`):

| VIX | `cPanic` | regime score | verdict |
|---|---|---|---|
| 25 (panic, known) | 0 | 61 | REDUCE |
| 19 (elevated, known) | 40 | 65 | SELL-ON |
| 12 (calm, known) | 100 | **71** | SELL-ON |
| **null (unreachable)** | **100** | **71** | **SELL-ON** |

**An unreachable VIX scores identically to a calm one.** Isolated swing from a known panic to an
unreachable reading: **+10 points**, which is the full `0.10 × 100` weight. Near the `>= 62` boundary,
that single component decides the verdict.

`ivp` and `vrp` share the shape (`!= null ? … : 50`) — a missing reading becomes a **neutral 50**.
`ivp` is itself derived from `vix`, so one outage moves two components at once.

## Root Cause

**A missing measurement is substituted with a value on the same scale as a measurement.** `100` is not
"unknown"; it is "measured, and maximally calm". `50` is not "unknown"; it is "measured, and exactly
neutral". The charter's rule — *Unknown ≠ Zero, and `null` is never a default* — is violated three
times inside one expression, in the function that decides whether to sell premium.

This is the same fail-open already fixed twice: `execution-engine.restoreEquity()` (a corrupt file left
`consecLosses = 0`, disarming the loss brake) and `event-risk-filter.loadCalendar()` (a corrupt calendar
read as "no events scheduled").

**Note the layering.** `event-risk-filter.js:57` had the identical defect and was fixed today (Task A,
non-protected): an unknown VIX there now yields `REDUCE`. That fix does **not** reach this one.
`_computeRegime` computes its verdict independently and publishes it at `GET /api/regime/:inst`.

## Exact File / Exact Lines

`server.js`, lines **5781, 5782, 5785** (three expressions inside `_computeRegime`).

## Blast Radius

- `GET /api/regime/:inst` — the published regime verdict and score.
- `server.js:5838` passes `components.ivImplied` into `eventRiskFilter.assess()`. **Already handled**
  by Task A; that call now REDUCEs on an unknown VIX regardless of this package.
- `_recordVRP` (`:5850`) already guards `c.ivImplied == null` and skips. Unaffected.
- `strangle-engine` does **not** read `/api/regime`. **No paper order path changes.**
- Dashboard panels that render the regime verdict will show `STAND-DOWN`/`UNKNOWN` during a Yahoo
  outage instead of `SELL-ON`.

## Minimal Safe Fix

Do **not** invent a substitute number. Make the absence visible, and fail closed on the verdict.

## Exact Diff

```diff
@@ server.js:5781  _computeRegime
-  const cIVP = ivp != null ? ivp : 50;                                   // high IVP = rich premium
-  const cVRP = vrp != null ? clamp01(50 + vrp * 8) : 50;                 // positive spread = sell-friendly
+  // Unknown != Zero, and unknown != neutral. A missing reading is not a measurement of 50.
+  const cIVP = ivp != null ? ivp : null;                                 // high IVP = rich premium
+  const cVRP = vrp != null ? clamp01(50 + vrp * 8) : null;               // positive spread = sell-friendly
@@ server.js:5785
-  const cPanic = vix != null && vix >= 22 ? 0 : vix != null && vix >= 18 ? 40 : 100;
-  const raw = Math.round(0.30 * cIVP + 0.28 * cVRP + 0.17 * cPCR + 0.15 * cEvent + 0.10 * cPanic);
+  // 100 == "measured, and maximally calm". A null VIX is not that. India VIX is never 0.
+  const cPanic = vix == null ? null : vix >= 22 ? 0 : vix >= 18 ? 40 : 100;
+  const unknowns = [];
+  if (cIVP === null) unknowns.push('ivPercentile');
+  if (cVRP === null) unknowns.push('vrp');
+  if (cPanic === null) unknowns.push('indiaVix');
+  const raw = unknowns.length ? null
+    : Math.round(0.30 * cIVP + 0.28 * cVRP + 0.17 * cPCR + 0.15 * cEvent + 0.10 * cPanic);
@@ server.js:5788
-  const buf = (_regimeSmooth[inst] = (_regimeSmooth[inst] || [])); buf.push(raw); if (buf.length > 5) buf.shift();
-  const score = Math.round(buf.reduce((s, x) => s + x, 0) / buf.length);
-  const verdict = score >= 62 ? 'SELL-ON' : score >= 45 ? 'REDUCE' : 'STAND-DOWN';
+  const buf = (_regimeSmooth[inst] = (_regimeSmooth[inst] || []));
+  if (raw != null) { buf.push(raw); if (buf.length > 5) buf.shift(); }   // never smooth a null in
+  const score = raw == null ? null
+    : (buf.length ? Math.round(buf.reduce((s, x) => s + x, 0) / buf.length) : raw);
+  // FAIL CLOSED: with an input missing we do not know the regime, so we do not invite selling.
+  const verdict = score == null ? 'STAND-DOWN'
+    : score >= 62 ? 'SELL-ON' : score >= 45 ? 'REDUCE' : 'STAND-DOWN';
@@ server.js:5792
   return {
-    inst, verdict, score,
+    inst, verdict, score, unknowns,
     components: { ivPercentile: ivp, vrp, ivImplied: vix, realizedVol: …, pcr, eventRisk },
```

Four hunks, one function. No rename, no move, no reformat. `components` is unchanged — it already
reports `null` honestly; only the *scoring* changes.

## Risk

**MEDIUM.** It changes a published verdict.

- During a Yahoo outage the regime becomes `STAND-DOWN` (`score: null`, `unknowns: ['indiaVix', …]`)
  instead of `SELL-ON`. That is the intended direction: **stop inviting premium sales into volatility
  nobody can see.**
- `score: null` reaches any dashboard panel that renders it. Panels must render `—`, not `0`.
  `dashboard.html` already handles `null` for `unrealizedPnl`; the regime panel must be checked.
- No paper order path is altered. `strangle-engine` does not consume `/api/regime`.

## Rollback

```
git checkout -- server.js
```

One command. No schema change, no data migration. `unknowns` is an additive field.

## Characterization Test

`test/server-regime.test.js`, new. `server.js` cannot be required (it boots the engines), so the
scoring expression is transcribed verbatim and pinned, exactly as `test/server-config-overrides.test.js`
does — with a source-contract block that fails loudly if `server.js` drifts.

```
A. transcribe the CURRENT expression
B. assert score(vix=null) === score(vix=12)          ← passes today. THE BUG.
C. assert verdict(vix=null) === 'SELL-ON'            ← passes today
D. TRIPWIRE: verdict(vix=null) === 'STAND-DOWN'      ← FAILS today (exit 1)
E. TRIPWIRE: score(vix=null) === null                ← FAILS today
```

D and E must be red before the fix and green after. The isolated table above is the evidence they will
be red.

## Regression Tests

1. All inputs present ⇒ score and verdict byte-identical to today (the 61/65/71 table).
2. `vix = 25` ⇒ `cPanic = 0` ⇒ score 61 ⇒ `REDUCE`, unchanged.
3. `vix = null` ⇒ `score: null`, `verdict: 'STAND-DOWN'`, `unknowns: ['indiaVix','ivPercentile']`.
4. `ivp = null` alone ⇒ `unknowns: ['ivPercentile']`, verdict `STAND-DOWN`.
5. The 5-sample smoothing buffer **never ingests a null**, and a later valid sample still smooths
   across the surviving history.
6. `components` still reports the raw `null`s, unchanged.
7. `_recordVRP` still skips when `ivImplied == null` (`:5850`) — unchanged.
8. `GET /api/regime/:inst` returns 200 with `score: null` rather than throwing.
9. Full suite 45/45, gated on exit code, three consecutive runs; `data/` byte-identical after.

## Performance Impact

Three comparisons and an array push. **Unmeasurable.** `_computeRegime` is already dominated by two
network calls; the measured `getVix()` alone took **4,513 ms**.

## Approval Recommendation

**SAFE. Unconditional.**

The one condition originally attached — *"confirm every dashboard panel tolerates a `null` score"* —
has been **checked and satisfied**. `dashboard.html:757` is the only page that fetches `/api/regime`,
and `:774` already renders defensively:

```js
<span class="regchip ${rcls}">🌡️ ${rg.verdict || '—'}${rg.score != null ? ' ' + rg.score : ''}</span>
```

A `null` score renders **nothing**, never `0`; `verdict` falls back to an em-dash. `/api/event-risk` is
consumed by **no page at all**. No dashboard change is required by this patch.

---

### Deferred, deliberately not in this patch

- `eventRisk = Number((await eventEngine.eventRiskScore(5)).score) || 0` (`:5779`) — a thrown call
  becomes `0`, and `cEvent` then reads `100` (maximally safe). Same defect, **separate concern,
  separate approval**. It is not bundled here.
- `event-engine.js`'s own `vixLift = vix.value ? … : 0` — non-protected, characterized by
  `test/event-engine.test.js`, awaiting its own approval.
