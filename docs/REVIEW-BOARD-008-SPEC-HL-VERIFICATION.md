# REVIEW BOARD — FORMAL REVIEW 008
## SPECIFICATION REVIEW — "DATA VERIFICATION ENGINE" (High/Low tick verification, notifications, audit log)

**Authority:** Independent Scientific Review Board · **Date:** 2026-07-17
**Input under review:** owner-submitted specification (verification rules 1–9, double verification,
notification system, 4-level alerts, audit log with CSV export)
**Mode:** Specification audit only. No implementation (belongs to the engineering agent).
**Fresh measurements for this review:** current H/L write path (`server.js:481–488`), WS feed fields
(`dhan-ws-feed.js:203/:207`), existing reconcile task (`server.js:759–873`), existing validation
census on the H/L path.

---

# 1. EXECUTIVE SUMMARY

The specification's *direction* is exactly right — it demands fail-closed tick handling, explicit
uncertainty states, and a per-decision audit log: three doctrines this platform was repeatedly
convicted of violating (034, 046, 048, 039). However, **four of its nine rules rest on assumptions
the measured system contradicts**, one rule **contradicts the platform's own research thesis**, the
"Verified by Exchange Data" badge **repeats the exact honesty defect of Review 046**, and the spec
**duplicates an existing, stronger verification mechanism it does not mention** (the 1-minute-candle
reconcile task already in production). Verdict: **PASS WITH CONDITIONS (8)**.

# 2. WHAT THE MEASURED SYSTEM ALREADY HAS (the spec is not written against a blank slate)

- **V1.** H/L updates happen at `server.js:481–488` (`observedHigh > rec.high` → update + touch
  event). Validation on this core path is minimal; scattered `>0 && isFinite` guards exist on
  *consumer* paths (`:885`, `:1050`). (MEASURED)
- **V2.** **A reconcile mechanism already exists**: `server.js:759–873` periodically reconciles
  today's 1-minute option candles into the live H/L record ("H/L reconcile deferred: No intraday
  candles yet" seen in production logs). This is *stronger* than tick-pair confirmation — it is
  exchange-derived OHLC confirmation. The spec's "double verification" partially re-invents it.
  (VERIFIED)
- **V3.** The Dhan WS feed **does expose the exchange last-trade-time** (`ltt`, `:203/:207`).
  Rules 2 and 6 are feasible. **No sequence-number field is parsed** — Rule 8 is currently
  inapplicable as "if available" correctly anticipates. (MEASURED)
- **V4.** The H/L data path is **mixed WS + REST polling** (429 storms logged). Rule 7 ("tick must
  come from the active websocket") as written would either mark all REST-sourced updates INVALID or
  be vacuous. (MEASURED)
- **V5.** WS delivery was **8–30% on 4 of 5 captured sessions** (034). (MEASURED)
- **V6.** `data/opthl/` sits under a **FIFO-120 silent delete cap** (039). (VERIFIED)

# 3. FINDINGS

| # | Finding | Class | Severity |
|---|---|---|---|
| F-1 | **Ownership conflict staged:** live path (`:481`), reconcile task (`:759`), and the proposed engine = **three writers to one truth** (`rec.high`). The platform's dual-writer lessons (038; Review 004 A-05) forbid this. The engine must be THE single gate, or subordinate to the reconcile — one owner, decided before any code. | DERIVED | **CRITICAL (design)** |
| F-2 | **Rule 9 ("realistic price jump") contradicts the platform's own thesis.** Gamma-blast research hunts 5–50× expiry-day premium moves; the sole complete intraday session (2026-07-08) is valuable precisely because it contains violent legitimate moves. An unspecified "realism" threshold would reject the platform's core research events. Confirmation-by-candle (V2) is the correct filter; a static jump bound is not. | DERIVED | **HIGH** |
| F-3 | **The badge repeats the 046 conviction.** Rules 1–9 are *feed-plausibility* checks. "Verified by Exchange Data" is an *exchange-truth* claim. Presenting the first as the second is exactly the heuristic-as-fact defect of the "probability" badge. Two honest levels exist and must be labeled distinctly: `FEED-VALIDATED` (rules 1–9 passed) and `EXCHANGE-RECONCILED` (candle/bhavcopy confirmed — V2 already computes this). | VERIFIED doctrine | **HIGH** |
| F-4 | **Double-verification-by-next-tick starves on this feed.** With 8–30% delivery (V5) and illiquid strikes, the "next tick" may be minutes away or lost — a real high would sit in Yellow indefinitely or die unconfirmed. The spec must define a confirmation timeout and a candle-fallback (V2), or verified notifications will be systematically late/missing on exactly the fast days they matter. | MEASURED premise | **HIGH** |
| F-5 | **Rule 3 (circuit range) has no source.** Index options carry *dynamic* price bands, not fixed circuits; the bound requires exchange documentation (CE-6 class, Review 006). Until obtained: threshold UNKNOWN — a guessed band produces both false-accepts and false-rejects. | UNKNOWN | MEDIUM |
| F-6 | **Rule 7 as written mismatches the mixed pipeline** (V4). Either scope the engine to WS-sourced instruments only, or redefine as "from a declared active source with source-tag logged." | MEASURED | MEDIUM |
| F-7 | **"Stored permanently" contradicts the live FIFO-120** on the same data family (V6). The spec adds records to a lifecycle that silently deletes them. Retention must be declared (039's registry doctrine) before "permanent" is promised. | VERIFIED | MEDIUM |
| F-8 | **Audit-log export + "admin panel" lands on an unauthenticated `0.0.0.0` server** (023: 0/172 routes authed). A CSV-export endpoint without auth extends the attack surface; and no admin panel exists today (new scope). | VERIFIED | MEDIUM |
| F-9 | **The log must distinguish INVALID from ABSENT.** A feed gap (delivery 8–30%) is not a rejected tick; silence is not health (034). Unknown ≠ Zero applies to gaps: log heartbeat/absence explicitly or the audit trail will read clean during outages. | DOCTRINE | MEDIUM |
| F-10 | Rule 4 edge: minimum option tick is ₹0.05; `0` is correctly invalid, but the jump filter (F-2) interacting with near-tick lows (₹0.05→₹0.10 = +100%) must not reject legitimate micro-price doubles. | DERIVED | LOW |

# 4. WHAT THE SPEC GETS RIGHT (survivals — counter-evidence duty)

- **S-1.** Reject-don't-update on failed verification = fail-closed. Correct direction; the current
  `:481` path has no such gate. (The spec fixes a real, measured weakness.)
- **S-2.** The four-state ladder **including Yellow (suspicious/waiting)** is honest-uncertainty UI —
  the exact discipline 046/048 found missing. Keep it verbatim.
- **S-3.** A per-decision audit log with reasons is the "write it down" doctrine of Review 006's
  closing. The platform lost two evidence classes forever by not doing this.
- **S-4.** "Never display until verified" inverts the platform's historical order (display first,
  verify never). Correct inversion.
- **S-5.** Rule 8's "if available" is properly humble — matches the measured absence of sequence
  fields.

# 5. CONDITIONS FOR PASS (design conditions, not implementation)

1. **One owner** for H/L truth; the engine gates `:481`, and the candle-reconcile (V2) is its
   confirmation tier — not a rival writer. (F-1)
2. **Two-tier honesty labels:** `FEED-VALIDATED` vs `EXCHANGE-RECONCILED`; the badge text must state
   which. No "Verified by Exchange Data" on tick-only evidence. (F-3)
3. **Confirmation timeout + candle fallback** replaces pure next-tick waiting; Yellow state carries
   its age. (F-4)
4. **Rule 9 threshold must be evidence-derived** (e.g., from the 2026-07-08 session's real move
   distribution, per-DTE) or replaced by candle-confirmation — never a guessed constant that would
   reject gamma-blast events. (F-2)
5. **Rule 3 deferred until the exchange price-band document is obtained** (CE-6 list); until then
   the check logs-only, never rejects. (F-5)
6. **Retention declared** for the audit log and H/L records; explicitly exempt from FIFO caps or
   consciously capped — no silent lifecycle. (F-7)
7. **Log ABSENT distinctly from INVALID**; feed-gap heartbeats recorded. (F-9)
8. **Export/panel ships behind auth** (the existing unused `auth.js` or loopback bind) — not on the
   open LAN surface. (F-8)

# 6. VERDICT

## **PASS WITH CONDITIONS (8)** — the specification is directionally correct and repairs measured
weaknesses (S-1…S-5), but four rules assume a feed the platform does not have, one rule would
reject the platform's own research subject, and the badge as worded repeats the platform's
signature honesty defect. With the eight conditions folded in, the Board supports implementation —
**by the engineering agent, upon the owner's explicit instruction; the Board writes no code.**

— Independent Scientific Review Board, 2026-07-17
