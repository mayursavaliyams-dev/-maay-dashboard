Q# 088 — Phase 0: Attestation

**Status: module and test applied (Tier 2). Endpoint diff PROPOSED, not applied
(Tier 1 — `server.js`).**

Run date 2026-08-08. Every number below has its command beside it.

---

## 1. What this phase had to prove

> A script that, against the running process, prints and exits non-zero on
> mismatch … It must exit non-zero when run against a deliberately stale
> process. Prove that: start a process, change the tree, run the script, show
> the non-zero exit and the raw output.

Done. Raw output in §4.

---

## 2. The design decision that makes it honest

The obvious implementation reads the files from disk when asked. That reports
**the tree the process can see**, not **the code the process is running** — which
is precisely the defect attestation exists to detect, faithfully reimplemented
inside the detector.

So the version is **sealed once at startup and never recomputed**:

```js
const sealed = sealCodeVersion(loadedProjectFiles());   // at boot, then frozen
```

The verifier re-hashes those same files from the tree *now* and compares digest
by digest. A difference means the file changed since the process loaded it.

The test asserts this directly rather than trusting the comment
(`test/attestation.test.js` §1): it seals, then changes a file, then requires the
sealed value to be unmoved — and separately requires a *fresh* seal over the same
files to differ, so that a hash which is merely constant cannot pass.

### `configured` and `active` are never merged

```
configured — the control object was constructed
active     — the things that must consult it are actually holding it
```

This distinction is the whole reason the module exists. This programme began
because a risk guard was constructed **2,300 lines after** the engines meant to
receive it. It existed. It was correct. Every engine held the raw connector. A
checker that asks "was it built?" reports that system as protected.

So `active` is computed by **identity comparison** against what each consumer
holds — not by duck-typing, because a look-alike object passes a duck-type check
and places unguarded orders.

`test/attestation.test.js` §3 proves the distinction with two graphs that differ
only in what the engines hold. A checker that reports the first as active fails.

### An unsupplied consumer set is `null`, never `false`

`false` asserts a fact about a graph that was never inspected. Absence of the
consumer list is not evidence of safety — it is absence of evidence, and the two
are recorded differently.

---

## 3. What was applied (Tier 2)

| File | Lines | What |
|---|---|---|
| `attestation.js` | 262 | `sealCodeVersion`, `loadedProjectFiles`, `computeAttestation`, `walkMutatingRoutes` |
| `scripts/attest-verify.js` | 152 | the verifier; exits 0 / 1 / 2 |
| `test/attestation.test.js` | 196 | 9 assertions across 4 sections |

```
$ node test/attestation.test.js
§1 — the code version is sealed at load time, not recomputed on demand
  ✓ sealCodeVersion returns a hash and the file list it covers
  ✓ THE TRAP: changing a file after sealing does not move the sealed value
  ✓ the version is not a constant: different content gives a different hash

§2 — configured and active are separate facts, never merged
  ✓ every control reports configured and active as distinct booleans
  ✓ an absent control is UNEVALUABLE, never false

§3 — THE REAL QUESTION: active is what the consumers hold
  ✓ guard constructed but NO engine holds it → active false, and it says why
  ✓ every engine holds the guard → active true
  ✓ ONE engine bypassing is enough to make it not active

§4 — the verify script exits non-zero against a genuinely stale process
  ✓ a REAL spawned process is verified green, then goes red when the tree moves

PASS — 0 failing
```

Exit codes: **0** code matches tree · **1** process is stale · **2** could not be
asked at all (unreachable, or the endpoint is absent).

Those are three different facts and are never collapsed into pass/fail.

---

## 4. The proof, raw

A real Node process, launched for real, sealing at its own startup — not a report
object this test authored and handed to itself (prompt F3).

```
  [proc] listening 4571 — sealed at startup

═══ RUN 1 — process fresh, tree untouched ═══
══ ATTESTATION ══
  endpoint        http://127.0.0.1:4571/a
  process pid     20648   started 2026-08-08T07:19:30.471Z
  sealed at       2026-08-08T07:19:30.502Z
  code version    a3e6c47ec5aaf053   over 2 loaded files

══ CONTROLS  (reported, never folded into the exit code) ══
  orderChokepoint    configured=false UNEVALUABLE
                     no guarded broker supplied — unevaluable
  …

PASS — all 2 loaded files are byte-identical to the tree.
       (This says the code matches. It says nothing about whether it works.)
   EXIT CODE: 0

═══ the tree moves — one comment appended to flatten.js ═══

═══ RUN 2 — SAME process, changed tree ═══
FAIL — the running process is STALE. 1 of 2 loaded files differ from the tree:

  CHANGED  flatten.js
            in process c94d88f97240…   in tree 32af8bbcb159…

       The process is running code that no longer exists in this tree.
       Any test you run against the tree is testing something else.
   EXIT CODE: 1
```

Note that control status is printed and **deliberately excluded from the exit
code**. "Is the code current?" and "is the system safe?" are different questions;
merging them would make one of the two answers useless.

### Against the real server

```
$ node scripts/attest-verify.js --url http://127.0.0.1:3000
FAIL — http://127.0.0.1:3000/api/attestation returned HTTP 404.
       The attestation endpoint is not in the running process.
       Either the diff has not been applied, or the process has not restarted.
   EXIT CODE: 2
```

Correct, and it is the finding: the endpoint is Tier 1, the diff below is
unapplied, and the tool says so instead of failing silently.

---

## 5. THE DIFF — Tier 1, `server.js`. Not applied.

Two hunks.

### Hunk 1 — require, beside the other control requires (~line 246)

```diff
 const { placeGuarded } = require('./place-guarded');
 const instrumentRegistry = require('./instrument-registry');
+const { sealCodeVersion, loadedProjectFiles, computeAttestation } = require('./attestation');
```

### Hunk 2 — seal, and serve. Immediately before `app.listen(...)`

Placement is load-bearing and is the reason this is one hunk and not two:

- **The seal must be after every top-level `require`.** `loadedProjectFiles()`
  reads `require.cache`. Sealing earlier under-reports the loaded set, and a file
  outside the sealed set can change without the verifier noticing — the tool
  would report PASS on a stale process, which is worse than not having it.
- `DataGate` is required at line 5962, so anything sealing before that misses it.
- Sealing immediately before `listen` means the seal covers everything loaded and
  nothing is served before it exists.

```diff
+/* ── ATTESTATION ──────────────────────────────────────────────────────────────
+   Sealed HERE, immediately before listen, because loadedProjectFiles() reads
+   require.cache and every top-level require must already have run — DataGate is
+   required at line 5962. Sealing earlier under-reports the loaded set, and a
+   file outside the sealed set can change without the verifier noticing, which
+   would make this tool report PASS on a stale process. That is worse than not
+   having the tool.
+
+   Never recompute this. Serving a freshly computed hash would report the tree
+   this process can see rather than the code it is running — the defect
+   attestation exists to detect. See attestation.js. */
+const ATTESTATION_SEAL = sealCodeVersion(loadedProjectFiles());
+console.log(`[attestation] sealed ${ATTESTATION_SEAL.hash.slice(0, 16)} over ${ATTESTATION_SEAL.fileCount} loaded files`);
+
+/* Read-only, and deliberately ungated: an operator must be able to ask "what is
+   running?" from a phone during an incident, and this response contains no
+   credential. It DOES list loaded file paths and control status, which has
+   reconnaissance value — once CONTROL_TOKEN is set, wrap this in
+   control('attestation-read'); scripts/attest-verify.js already sends the token
+   as an x-control-token header, so that is a config change, not a code change. */
+app.get('/api/attestation', (req, res) => {
+  res.json(computeAttestation({
+    sealed: ATTESTATION_SEAL,
+    graph: {
+      app,
+      guardedBroker,
+      orderConsumers: {
+        /* FILL FROM THE REAL GRAPH. Each entry must be the broker object the
+           engine is ACTUALLY holding — engine.broker, not guardedBroker. Writing
+           guardedBroker on both sides makes the check compare a value with
+           itself and pass unconditionally, which is prompt failure F2 exactly. */
+      },
+      controlAuth,
+      killSwitch,
+      killConsumers: {},
+      dataGate: typeof dataGate !== 'undefined' ? dataGate : null,
+      dataConsumers: {},
+    },
+  }));
+});
+
 app.listen(PORT, '0.0.0.0', () => {
```

### The one thing the operator must not skip

`orderConsumers` is left empty on purpose. Filling it requires naming, for each
engine, **the property that actually holds its broker** — and reading each one,
rather than assuming they are alike, is the entire value of the check.

With it empty, `orderChokepoint.active` reports `null` / UNEVALUABLE. That is
correct and honest: nothing was inspected. It must never be filled with
`guardedBroker` on both sides — that compares a value with itself, passes
unconditionally, and is failure mode F2 in the implementation prompt.

I did not fill it because determining each engine's broker property is a read of
Tier 1 code whose result belongs in Phase 4's construction-order map, and I would
be guessing at property names I have not confirmed.

---

## 6. What I did NOT verify

- **The endpoint has never run inside `server.js`.** The diff is unapplied. Its
  hunks are placed against lines 246 and the `app.listen` call as they stand
  today; if `server.js` moves, the placement argument in §5 still holds but the
  line numbers will not.
- **`walkMutatingRoutes` has never been run against *this application's* Express
  app.** It is now proven against a real Express app with a real gate (§5), which
  is a much stronger claim than the first draft of this document could make — but
  a four-route app is not `server.js`. Its handling of **mounted sub-routers and
  computed paths in this codebase** remains unproven, and the route counts it
  produces must not be trusted until it has run in-process. Phase 1A's entire
  acceptance test depends on it, and the first thing Phase 1A must do is compare
  its in-process count against the 58 measured by parsing. **If those two numbers
  disagree, the discrepancy is the finding** — not something to reconcile by
  adjusting either side.
- **`killConsumers` and `dataConsumers` are empty**, so those two controls will
  report UNEVALUABLE even after the diff is applied. That is accurate, not a
  placeholder to be quietly filled.
*(The gate-detection risk originally listed here was checked and turned out to be
a real defect. It is now §6a, found and fixed, rather than an open risk.)*

---

## 6a. A defect in my own Phase 0 code, found before it shipped

The first version of `walkMutatingRoutes` identified the control gate **by
function name**, matching `control`, `gate`, or anything ending `Gate`. Checked
against the real thing:

```
$ node -e "… new ControlAuth({auth}).gate('engine-TRADE-MODE') …"
  typeof            : function
  mw.name           : ""
  regex would match : false
```

`ControlAuth.gate(action)` returns an arrow function directly. An arrow function
assigned to nothing has the name `""`. **Every gated route would have been
counted as ungated** — and Phase 1A, whose acceptance test gates everything and
asserts the ungated count reaches zero, could never have gone green no matter how
much was fixed. The detector built to find unprotected routes would have reported
the protected ones as unprotected.

Replaced with identity rather than naming: an explicit `__controlGate` marker if
one is ever set, else the closure's own source text, which is identical for every
gate because they all come from the same body in `control-auth.js`.

The rule that follows, and which `test/attestation.test.js` §5 now enforces:

> **A route-counter whose notion of "gated" was never checked against a gate is a
> counter of nothing.**

§5 therefore proves the predicate against a gate obtained from the real
`ControlAuth` — including the assertion that its `.name` is still `""`, so that
if `control-auth.js` ever changes, the reasoning is re-derived rather than
assumed. It also asserts that a handler merely *named* `control` is **not**
counted as a gate, since naming is exactly what this replaced.

`walkMutatingRoutes` is now also exercised against a real Express app with a real
gate installed (§5), rather than only against constructed router stacks.

I found this only because §6 of this document required me to write down what I
had not verified. The list is the mechanism, not the paperwork.

---

## 7. An observation from this session, recorded not fixed

The server was running and answering HTTP 200 at the start of this session. Part
way through it stopped. The task log ends with routine output — no stack trace,
no exit line, nothing.

I restarted it (`pid 22020`, listening on 3000, connector upstox, paper). I could
not establish why it stopped, and I am not going to guess. Recorded as **D-18**.

It is worth saying plainly that this is the argument for Phase 0 rather than an
aside about it: a process that vanishes without a record, on a machine where
"what is running" was already not a checkable fact, is exactly the condition this
phase exists to remove. Attestation as built answers *what code is running*. It
does not answer *is it running at all*, and nothing in this system does.

---

## 8. Next

Phase 0b — the option-candle deletion at 41 files. Test first, then the Tier 1
diff, with the file count as of today and the number of trading days remaining.
