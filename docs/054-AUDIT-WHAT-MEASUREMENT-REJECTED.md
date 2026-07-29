# 054 — Audit 2026-07-29: one real defect, and three improvements measurement rejected

**Author:** Chief Architect
**Date:** 2026-07-29
**Status:** Complete. One S2 defect found and fixed (docs/053). Three further proposals
were measured and **not built**.
**Purpose:** to record what was *not* worth doing, and why, so the next person does not
rediscover it.

---

## 1. Why this document exists

An audit that only lists what it fixed is half an audit. Three plausible, virtuous-
sounding improvements were proposed during this one — including one I had recommended
myself, in writing, the day before. Each was killed by a measurement that took minutes
and would have cost days to learn afterwards.

Recording a null result is worth as much as recording a fix. Without this page the
same three proposals return, because each of them still *sounds* right.

---

## 2. What was real

**Broker rate-limiting.** 477 refusals in one session log, 458 from one endpoint. Root
cause: no component owned the broker call rate, so the front end set it. Fixed in
`381f6d2` — single-flight, an adaptive per-instrument floor, a 429 cooldown, and
statistics that are no longer hard-coded to zero. Measured after: **458 → 0** under a
240-request load test, cache hit rate 7.3% → 59.2%. Full write-up in **docs/053**.

That was the only defect this audit found that was actually harming the system.

---

## 3. Rejected: a shared client-side scheduler

**The proposal**, made by me in docs/053 §7: the poll cadences are uncoordinated —
`dashboard.html` alone runs seventeen timers — so replace them with one scheduler that
fans out.

**The measurement**, before building anything:

| | |
|---|---|
| Requests from one open dashboard tab | **262 / minute** |
| Server CPU, no tab open | **4.1 %** |
| Server CPU, one dashboard tab | **3.2 %** |
| p95 response time under that load | **3 ms** (max 16 ms) |

262 requests a minute costs the server **nothing measurable** — the endpoints are cheap
in-memory reads, and the genuinely expensive ones (chain fetches) are now floored by the
connector. CPU with a tab open was *lower* than idle, which is noise, and the point:
the effect is below the measurement floor.

**Verdict: not built.** A scheduler would add a coordination layer, a new failure mode
and a twenty-two-page migration, to fix a cost that does not exist. I withdraw the
recommendation I made in docs/053 §7.

**What would change this:** many tabs open at once, or a hosted deployment with real
users. The measurement is per-tab; it does not license unlimited fan-out.

---

## 4. Rejected: converting the 112 silent catches

**The proposal:** the `no-silent-catch` ratchet sits at its limit (112, of which 57 are
in `server.js`), and this very session produced four defects that were invisible for
exactly that reason. Convert them.

**The measurement:** rather than judge which *look* dangerous, an instrumented copy of
the whole tree was built on a spare port, with every `catch(_) {}` rewritten to report
its file, line and error. Production was never touched. It was exercised across 27
endpoints × 3 rounds plus 70 seconds of the server's own background work.

**Result: none of the 92 instrumented catches fired.**

A null result is only worth anything if the instrument is proven, so it was: 57 call
sites present in the instrumented `server.js`, the reporter confirmed loaded, and the
mechanism verified to fire when a catch is forced. "Nothing found" and "the instrument
was off" look identical otherwise.

**Verdict: not built.** Converting 112 catches with no defect behind any of them is
churn that touches a protected file for no measured gain.

**What this does not say:** the silent catches remain a latent risk, and the ratchet
should stay. They are not swallowing anything *today*, on *these paths*. A catch on a
path this probe did not exercise is still unproven.

---

## 5. Rejected: hunting a memory leak

**The proposal:** the heap assertions in the suite are skipped (they need
`--expose-gc`), so retention is unverified for a process that runs all day.

**The measurement:** working set sampled over four minutes on the live server —
204.5 → 187.2 → 187.1 → 192.3 → **92.6 MB**. It fell by half when the collector ran.

**Verdict: not built.** There is no growth signal to chase.

---

## 6. What the audit did produce, besides docs/053

`tools/ui-measure.js`, promoted out of the session scratchpad into the repo. Every UI
claim in docs/052 and docs/053 — "no page scrolls", "13px or more", "one palette", "262
requests a minute" — was produced by throwaway scripts. docs/052 §7 already said
promoting them was the next step, because *a measurement nobody can repeat is an
assertion with extra steps*.

It earned its place immediately: on first run it found that **`pop.html` scrolled
422px**. That page had no bounded region and had been fitting by coincidence — it fitted
in Edge and overflowed in Chrome once the shared type tokens grew. **A page that fits in
one browser and not another is not fitting, it is coinciding.** Fixed the same way as
every other page.

It also records two traps that cost real time today:

- Launching `msedge.exe` while the user's own Edge is running makes the new process hand
  off to the existing instance and exit 0. Puppeteer reports *"Failed to launch the
  browser process: Code: 0"* with an empty stderr, which reads as "Edge is broken" and
  is not. Chrome is preferred for this reason.
- A killed run leaves a locked profile in TEMP and every later launch fails on it. Each
  run now gets its own profile directory.

---

## 7. Institutional Recommendation

The pattern across all three rejections is the same, and it is the point of this page:

> **Measure the harm before building the fix.** Each proposal was defensible from the
> code alone. Each dissolved on contact with a number that took minutes to obtain.

Two further notes for whoever audits next:

**A negative result requires a proven instrument.** The silent-catch probe was only
worth reporting because it was verified to fire. An unverified null is not evidence of
health; it is an absence of evidence, and the two are routinely confused.

**My own prior recommendation was among the things rejected.** docs/053 §7 proposed the
scheduler; measurement here withdrew it. A written recommendation is not a commitment,
and a plan that survives its first measurement unchanged has usually not been measured.
