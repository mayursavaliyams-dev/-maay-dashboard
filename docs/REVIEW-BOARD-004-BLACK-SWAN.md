# REVIEW BOARD — FORMAL REVIEW 004
## ANTIGRAVITY PRO — BLACK SWAN & CATASTROPHIC FAILURE ANALYSIS

**Authority:** Institutional Black Swan Review Board · Independent Failure Analysis Division
**Date:** 2026-07-17 · **Basis:** audits 001–050, Reviews 001–003, live observation 2026-07-13→17,
plus new measurements taken for this review (write-atomicity census, dual-instance analysis)
**Mode:** Failure discovery only. No code. No redesign.

**Board integrity note on the requested quotas.** The instruction demands "Top 25" in eight
categories (≈200 entries) plus a Top 100. The closing rules of the same instruction — *never invent
information; Unknown must remain Unknown; evidence is mandatory* — override the quotas. This
register contains **100 failure modes, every one anchored to evidence or explicitly classed
HYPOTHESIS/UNKNOWN**, organized so each category presents its full evidence-backed top list. The
Board will not pad a risk register with invented entries; a padded register is itself a failure mode
(it buries the real risks — see FM-G09).

**Scope framing (verified):** the platform is 100% paper. No catastrophic loss of *money* is
possible today (all 7 order sites guarded — audit 012). The catastrophic-loss surface is therefore:
**scientific evidence, irreplaceable data, state integrity, and human trust.** Every severity below
is rated against that surface, with a forward note where the same flaw would be lethal if the
platform ever went live.

**New measurements for this review:**
- Write atomicity census: **20 modules** write via `safe-write` (atomic temp+rename, `.bak`);
  **32 raw `writeFileSync` sites** remain (5 in `server.js`, incl. the `.env` OAuth rewrite), each a
  torn-write exposure on power/disk failure. (MEASURED)
- Dual-instance analysis: **no `EADDRINUSE` handler exists**; engines are constructed at
  `server.js:3537`, `listen()` at `:7277`, and boot logs show trades opening **before** the listen
  banner. A second instance therefore runs engines — and writes state files — for the window before
  the port bind fails, and its crash behavior is unhandled. (MEASURED boot order; window DERIVED)

**Legend.** P: Obs=observed in production · H/M/L/R(are) likelihood under current practice.
Sev: C/H/M/L/I. Rec: recovery difficulty E(asy)/M(od)/H(ard)/**I**(rreversible).
Det: detectability — Silent / Delayed / Loud. Class: VERIFIED/MEASURED/DERIVED/HYPOTHESIS/UNKNOWN.

---

# SECTION A — TOP BLACK SWAN RISKS (15; catastrophic, compounding, or irreversible)

| ID | Failure mode | P | Sev | Blast radius | Rec | Det | Class · evidence |
|---|---|---|---|---|---|---|---|
| A-01 | **`git gc`/re-clone erases the 37 deleted experiments** — the platform's entire research control group exists only as unreferenced blobs | M | **C** | honest nTrials becomes permanently unknowable; survivorship locked in forever | **I** | Silent | VERIFIED (043; `3e388d1`) |
| A-02 | **FIFO-40 deletes the only complete intraday session** (~35 sessions out), inside `catch(_){}` | **H** (certain on schedule) | **C** | only tick-adjacent dataset; not re-derivable from any source | **I** | Silent | VERIFIED (039; `server.js:578`) |
| A-03 | **Evidence self-erasure loop**: session end kills PM2 daemon → restart → 3 engines' open books destroyed | **Obs ×2** | **C** | forward-test record — the platform's only clean evidence — systematically censored | H | Delayed | VERIFIED (pm2.log ×12; live) |
| A-04 | **One HTTP POST deletes the sole store of all engine state** (`config-overrides.json`, no backup) — and the runbook recommends doing it | M | **C** | 5% brake, ₹7L allocation, all auto flags; reconstruction from memory only | **I** | Delayed | VERIFIED (039 §1; 029) |
| A-05 | **Dual-writer window**: second instance runs engines & writes state before port-bind fails; no EADDRINUSE handling | M | H | interleaved writes to ledgers/equity from two processes; safe-write protects atomicity per file but not cross-process ordering | H | Silent | MEASURED (boot order) + DERIVED |
| A-06 | **Torn writes at 32 raw `writeFileSync` sites on power/disk failure** — incl. `.env` rewrite with live tokens (`server.js:2028`) | L–M | H | corrupted env/reports; `.env` corruption = broker auth loss | M–H | Delayed | MEASURED (census) |
| A-07 | **30-day staleness rule silently forgives a loss streak**: `restoreEquity` treats >30d-old state as "fresh paper run" — a dormant 15-loss engine reboots clean | M (given operating pattern) | H | brake disarmed exactly after long outages — the highest-risk resume moment | M | Silent | DERIVED (code path, exec-engine `restoreEquity`) |
| A-08 | **Silent-catch destruction as a pattern**: every deletion path (`FIFO`, temp cleanup) swallows errors — failures of the destroyer are unobservable | H | H | data loss cannot even be detected post-hoc | I | **Silent** | VERIFIED (039) |
| A-09 | **The "cleanup" recurrence**: the social pattern that produced `3e388d1` (deleting "junk") remains unguarded by any policy | M | **C** | next sweep could take ledgers/docs/archives | I | Loud-but-late | VERIFIED precedent |
| A-10 | **Model state poisoning is invisible**: v1/v2 statistics mixture is permanently indistinguishable; a future re-spec repeats it silently | Obs (once) / H (recurrence) | H | all learned weights untrustworthy after any spec change | **I** | Silent | VERIFIED (044) + UNKNOWN |
| A-11 | **False-confidence cascade to a human**: uncalibrated "VERY HIGH · 8x%" on 6 dashboards → owner manually mirrors paper calls with real money outside the platform | UNKNOWN (behavioral) | **C** (only path to real-money loss today) | human account | H | Silent | HYPOTHESIS — the only live-money vector the Board can construct |
| A-12 | **Backup theater**: 7 `.bak` files, 0 of 9 critical datasets, 1 orphan; PIT window = one write | H | H | recovery assumed where none exists | H | Delayed | VERIFIED (025/039) |
| A-13 | **Disk-full during session**: safe-write temp creation fails → behavior at 20 modules unknown; raw sites partially write | L | H | unknown; possibly wedged engines with stale state | M | UNKNOWN | UNKNOWN (never simulated) |
| A-14 | **`equity-*.json` both-files corruption after crash** — brake state unrecoverable → engine HALTS (fail-closed, good) but operator `reset` under pressure wipes streak | L | M–H | risk history | M | Loud | VERIFIED mechanism (C3-07 fix) + HYPOTHESIS on operator action |
| A-15 | **Repository single-machine existence**: no off-machine copy of `data/` (incl. paper ledgers, model artifact) — one SSD failure ends the project's evidence base | M | **C** | everything not in git (51 JSON datasets; model; ledgers) | **I** | Loud | VERIFIED (025: no off-machine backup) |

# SECTION B — TOP ENGINEERING RISKS (15)

| ID | Failure mode | P | Sev | Rec | Det | Class · evidence |
|---|---|---|---|---|---|---|
| B-01 | Open books non-persistent (strangle/bounce/gamma) — kill -9 = book gone | Obs | H | H | Delayed | VERIFIED |
| B-02 | PM2 daemon lifetime coupled to operator shell; no ONLOGON task (creation blocked; operator action pending) | Obs ×12 | H | E (one line) | Delayed | VERIFIED |
| B-03 | `setAutoEnabled()` ignores `_haltedReason` — boot-time call can re-arm a halted engine (historic B-3) | M | H | E | Silent | VERIFIED (012) |
| B-04 | 119 `\|\|0` coercions — unknown→zero; incl. `(eventRisk\|\|0)<70` fail-open gate | H | H | M | Silent | VERIFIED/MEASURED |
| B-05 | `.env` rewritten non-atomically with tokens on OAuth callback (`server.js:2028`) | L–M | H | M | Delayed | VERIFIED (B-6) |
| B-06 | No EADDRINUSE/second-instance guard; engines tick pre-listen | M | H | M | Silent | MEASURED |
| B-07 | Blocking `readdirSync`/JSON on hot paths; event-loop stalls under growth | M | M | M | Delayed | VERIFIED (026) |
| B-08 | Memory profile never captured; leak status UNKNOWN across multi-day runs | — | M | M | Delayed | UNKNOWN (026) |
| B-09 | Watchlist 429 storms — no backoff; broker throttling risk to all consumers on shared key | Obs | M | E | Loud | VERIFIED (logs) |
| B-10 | `entryAt` clock-strings without dates — cross-midnight/session ambiguity in records | H | M | E | Silent | VERIFIED |
| B-11 | Timezone: server timestamps mix IST wall-clock strings and epoch; DST absent in India (safe) but any host-TZ change skews session gating | L | M | M | Silent | DERIVED |
| B-12 | Config drift: `.env` decoy vs overrides — operators reason from the wrong file | Obs | M | E | Silent | VERIFIED (004) |
| B-13 | Windows/Linux path & CRLF divergence (repo developed on win32; LF/CRLF warnings observed) — Linux deploy untested | M | M | M | Delayed | VERIFIED (git warnings) + UNKNOWN |
| B-14 | Rollback scripts exist per-migration but never rehearsed end-to-end | M | M | M | — | VERIFIED (never exercised) |
| B-15 | `stock/` legacy tree still contains a parallel server & engine (3 raw write sites) — half-dead duplicate logic | M | M | M | Silent | VERIFIED (component audit) |

# SECTION C — TOP DATA RISKS (15)

| ID | Failure mode | P | Sev | Rec | Det | Class |
|---|---|---|---|---|---|---|
| C-01 | Look-ahead column consumed by 8 remaining files — every rerun re-poisons results | H (on any rerun) | **C**(sci) | E | Silent | MEASURED |
| C-02 | Lot from `rows[0]` — wrong 27/600 days; sizing noise in every backtest | H | M | E | Silent | MEASURED (032) |
| C-03 | oiUnit UNKNOWN (broker chain; BSE bhavcopy) — any OI-based signal unscaled | — | H(sci) | M | Silent | UNKNOWN (A-13/006) |
| C-04 | No trading calendar; 27 unexplained missing weekdays — gap vs holiday indistinguishable | H | M | M | Silent | MEASURED (031) |
| C-05 | Intraday WS capture 8–30% on 4/5 sessions — silent partial capture presented as sessions | H | H(sci) | I (past) | **Silent** | MEASURED (034) |
| C-06 | No Greeks/IV in any source; two bsGamma models diverge 6.79%; no adjudication possible | Obs | H(sci) | — | Silent | MEASURED (036) |
| C-07 | Fabricated IV fallback 0.14 (`gex-skew.js:49`) enters GEX when feed absent | M | M | E | Silent | VERIFIED |
| C-08 | `signal-outcomes.json` dual-writer (server + signal-health) — last-writer-wins on the calibration dataset | M | H(sci) | H | Silent | VERIFIED (038) |
| C-09 | Results overwritten in place — the previous run is destroyed by the next | H | H(sci) | I | Silent | VERIFIED (015) |
| C-10 | Bad tick/negative price from live feed: bt path filters `o>0`; live-chain path filters UNKNOWN | L | M | E | Delayed | UNKNOWN (live path unaudited for this) |
| C-11 | Wrong-expiry selection: historic NIFTY/SENSEX weekday swap (caught by registry); regression possible wherever registry bypassed | L (post-registry) | H | E | Delayed | VERIFIED history |
| C-12 | Duplicate/ooo events in `trades[]` (seq counter vs 21 retained — pruning by TRADES_KEEP) — long-horizon learning history unreconstructable | H | M(sci) | I | Silent | VERIFIED (slice caps) |
| C-13 | `pnlPts` vs `mtm` unit conflation risk by any new consumer (points vs rupees, `credit:true` boolean) | M | M | E | Silent | MEASURED (live payloads) |
| C-14 | Bhavcopy schema drift (34 cols stable so far) — parser has no column-name verification, positional only | L | H | E | Loud | VERIFIED (positional parse) |
| C-15 | `confirmed-signals.json` orphan: live file gone, `.bak` stranded — dataset death unnoticed by any monitor | Obs | M | I | **Silent** | VERIFIED (025) |

# SECTION D — TOP OPERATIONAL RISKS (12)

| ID | Failure mode | P | Sev | Rec | Det | Class |
|---|---|---|---|---|---|---|
| D-01 | No session-independent supervision (task pending operator) — every teardown = outage until manual start | Obs | H | E | Loud | VERIFIED |
| D-02 | Reboot → nothing starts (no resurrect hook) | H | H | E | Loud | VERIFIED |
| D-03 | INC-001 pattern: unattended death, MTTD ∞ — no alerting of process death exists | Obs | H | E | **Silent** | VERIFIED (021/029) |
| D-04 | `/api/risk` fabricates state — operator dashboards contradict engine truth | Obs | H | E(fix)/H(trust) | Silent | VERIFIED (013) |
| D-05 | Unauthenticated LAN control plane — any device can toggle engines / delete config | H (exposure) | H | E | Silent | VERIFIED (023) |
| D-06 | Token expiry unmonitored (`tokenExpiryDays: -8` served as healthy) | Obs | M | E | Silent | VERIFIED (healthz payload) |
| D-07 | Log hygiene: 429 storms + survey spam bury real events (the HALT line sat among noise) | Obs | M | E | — | VERIFIED |
| D-08 | No incident records — recurrence of any failure is undetectable as recurrence | Obs | M | E | — | VERIFIED (029) |
| D-09 | Operator-pressure reset: `POST /api/engine/reset` erases streak with no confirmation, no audit line | M | M | I | Silent | VERIFIED route + HYPOTHESIS on use |
| D-10 | Windows sleep/hibernate stalls timers mid-session — engines resume with stale clocks | M | M | E | Silent | HYPOTHESIS (untested) |
| D-11 | PM2 max_restarts=10 then gives up — crash-loop ends in silent stop | L | M | E | Delayed | VERIFIED config |
| D-12 | Single operator; no second person can run/recover the system (bus factor 1) | H | M | H | — | VERIFIED (context) |

# SECTION E — TOP SCIENTIFIC RISKS (15)

| ID | Failure mode | P | Sev | Class |
|---|---|---|---|---|
| E-01 | Multiple-testing correction disarmed (`nTrials‖1`) — false discovery institutionalized | Obs | **C** | MEASURED |
| E-02 | Survivorship by deletion (37 experiments) — effect size of surviving strategy inflated by construction | Obs | **C** | VERIFIED |
| E-03 | Regime concentration read as robustness (aggregate Sharpe 1.62 masking negative cells) | Obs | H | MEASURED |
| E-04 | Post-hoc filter temptation (DTE 1–2 / vol gate from the diagnostic table) — next curve-fit staged | H | H | DERIVED (045 §0.2 warning) |
| E-05 | Underpowered inference as habit: n=12, n=21, n=130 driving displayed numbers | Obs | H | MEASURED |
| E-06 | Calibration permanently unverifiable while shown confidence is discarded (20/21) | Obs | H | MEASURED |
| E-07 | Expectancy blindness: P(win) reported on 2.89× asymmetric payoffs | Obs | H | MEASURED |
| E-08 | Zero-slippage execution model on 4-leg trades; ₹226/tr sensitivity to erasure | Obs | H | MEASURED |
| E-09 | Margin mis-divisor (₹1L vs SPAN ₹1.2–1.5L) inflates return-on-capital | Obs | M | DERIVED |
| E-10 | Learning-on-live-state (no frozen training set) — label leakage cannot be excluded | Obs | H | VERIFIED (018) |
| E-11 | Agreement term unvalidated in the direction of MORE confidence | Obs | H | UNKNOWN sign |
| E-12 | No pre-registration — every future "discovery" inherits exploratory status silently | Obs | H | VERIFIED |
| E-13 | Fat-tail blindness: kurtosis 30.6 with 599 trades treated as adequate | Obs | M | MEASURED |
| E-14 | Provenance absence (0/25) — no result can be re-derived after data changes | Obs | H | MEASURED |
| E-15 | Cross-version model stats (v1/v2) pollute any future learning analysis | Obs | H | UNKNOWN (permanent) |

# SECTION F — TOP ARCHITECTURE RISKS (10)

| ID | Failure mode | P | Sev | Class |
|---|---|---|---|---|
| F-01 | Risk-blind decision layer; brake with zero readers | Obs | **C**(if live)/H | MEASURED |
| F-02 | Five uncoordinated risk opinions; no authority | Obs | H | VERIFIED |
| F-03 | Feature-store break — downstream science on discarded data | Obs | H | VERIFIED |
| F-04 | SPOF `safe-write` (28 dependents) — excellent today; any regression is global | Obs | M | VERIFIED |
| F-05 | 11 built-unused components — capability believed present because it exists | Obs | H | VERIFIED |
| F-06 | Lineage unbuildable (45/55 variable writes) — impact analysis impossible | Obs | M | MEASURED |
| F-07 | 7,350-line monolith; 172 routes; change blast radius unbounded | Obs | M | VERIFIED |
| F-08 | Legacy `stock/` parallel tree — drift & duplicate logic | Obs | M | VERIFIED |
| F-09 | Protected-file process without emergency path — critical fixes (e.g., `/api/risk`) queue behind approvals | Obs | M | VERIFIED (process) |
| F-10 | Dashboard as implicit authority: UI promotes ungated opinions into decisions | Obs | H | DERIVED (049) |

# SECTION G — TOP AI/DECISION RISKS (10)

| ID | Failure mode | P | Sev | Class |
|---|---|---|---|---|
| G-01 | Model learns from noise (33.8%; n=0 weights drift) | Obs | H | MEASURED |
| G-02 | Explainability as trust-multiplier on a broken model (perfect leg table, 24% stream) | Obs | H | MEASURED (046) |
| G-03 | Phantom voters with weight (volume/fii) | Obs | M | MEASURED |
| G-04 | Constant voter (news 20/21 bullish) shifts every verdict's intercept | Obs | M | MEASURED |
| G-05 | Correlated members double-counted (N_eff 3.71/7) — shared error amplified with tighter stated confidence | Obs | H | DERIVED |
| G-06 | Silent re-spec recurrence (no SpecGuard) | H | H | VERIFIED pattern |
| G-07 | Default confidence 60 fabricated for silent legs | Obs | M | VERIFIED |
| G-08 | Learning-rate on single observations (no min-n) — 4/4 streak treated as signal | Obs | M | MEASURED |
| G-09 | **Audit-AI failure class (self-referential):** hallucinated findings — this programme logged 12 self-caught false claims incl. one published number later retracted (₹157.62→₹0.32); unreviewed AI audit output is itself a risk channel | Obs | M | VERIFIED (self-record) |
| G-10 | Memory drift in agent context (one prior memory was wrong about sizing) — stale "facts" steering future sessions | Obs | M | VERIFIED (memory note) |

# SECTION H — MARKET-EVENT RISKS (8; paper-context, live-lethal flagged)

| ID | Failure mode | P | Sev(paper/live) | Class |
|---|---|---|---|---|
| H-01 | Overnight gap through short strikes: condor wings cap loss (engine `forceCondor:true`, maxLoss published) — but backtested *strangle* stats don't model gaps-at-open beyond OHLC | M | M / **C** | VERIFIED config + DERIVED gap-model gap |
| H-02 | Flash crash: stop model assumes fill at exactly 2× off day-high — untrue in dislocation | L | M / **C** | MEASURED assumption |
| H-03 | Vol-regime inversion: seller negative at RV≥15%, no gate — a VIX spike is walked into | M | H / **C** | MEASURED (045) |
| H-04 | Exchange halt / circuit breaker: engine behavior on frozen feed UNKNOWN (timers continue, MTM stale) | L | M / H | UNKNOWN |
| H-05 | Broker outage mid-session: 429/ENOTFOUND observed; engines skip ticks (fail-quiet); recovery behavior unverified end-to-end | Obs | M / H | VERIFIED logs + UNKNOWN recovery |
| H-06 | Expiry-day wrong-expiry selection where registry bypassed (historic swap precedent) | L | M / **C** | VERIFIED history |
| H-07 | Lot-size revision mid-series: registry fail-closed protects live; backtests mis-lot 27/600 | M | L / M | MEASURED |
| H-08 | SEBI rule change (white-box, algo tagging) — paper exempt today; any productization inherits compliance debt incl. absent audit trail | L | I / H | VERIFIED (022) + UNKNOWN scope |

---

# RISK HEAT MAP (likelihood × impact; entries = failure IDs)

```
                 IMPACT →      LOW            MEDIUM              HIGH                CRITICAL
  LIKELIHOOD ↓
  OBSERVED                    D-07           B-09 D-06 G-03/4    B-01 B-02 D-01..05  A-03  E-01 E-02
                                             C-15 E-09 G-07..10  C-05 C-06 E-03..15  (evidence loss,
                                                                 F-01..10 G-01/02/05  live)
  HIGH                                       C-02 C-04 C-12      A-08 B-04 C-01 C-09  A-02 (deadline)
                                             B-10 D-12           E-04 G-06
  MEDIUM                                     B-13..15 D-09/10    A-05 A-06 A-07 A-12  A-01 A-04 A-09
                                             H-01 H-07           B-03 B-06 C-08 H-03  A-15
  LOW                          H-08          B-11 C-10 D-11      A-13 A-14 C-14 H-02  A-11(sev only)
                                                                 C-11 H-04..06
```
Reading: the register's mass sits in **Observed×High** — these are not predictions; they are the
current operating state. The four **Critical** cells that are not yet observed are all *scheduled*
(A-02 deadline), *one-command-away* (A-01, A-04), or *one-disk-away* (A-15).

---

# SCORES (derived; each from cited findings)

| Score | Value | Derivation |
|---|---|---|
| **Repository Survival Score** (12-month survival of the scientific asset base under current practice) | **3 / 10** | Two irreversible deadline losses pending (A-01/02); no off-machine copy (A-15); deletion culture precedent (A-09); offset by git for code and 52 docs |
| **Operational Resilience Score** | **2.5 / 10** | Observed session-coupled death (×12), no reboot path, no alerting, MTTD ∞ precedent; offset by PM2-while-alive + verified brake |
| **Scientific Robustness Score** | **1.5 / 10** | E-01/02 institutionalized; calibration unverifiable; provenance absent; offset by paper-ledger honesty + deterministic replay |
| **Engineering Robustness Score** | **4 / 10** | safe-write (20 modules) + guarded order path + fail-closed brake verified in production; offset by 32 raw writes, fail-opens, non-persistence, dual-writer window |

---

# FINAL INSTITUTIONAL RECOMMENDATION

**PASS WITH CONDITIONS** — continued **paper** operation, with the conditions of Reviews 001–003
now re-ranked by this analysis into survival order:

1. **Off-machine + out-of-FIFO copies of the irreplaceables** (A-02, A-01, A-15) — the only
   Critical items that are irreversible and scheduled.
2. **Break the evidence-erasure loop** (A-03): operator's ONLOGON task + open-book persistence.
3. **Guard the destroyer paths** (A-04, A-08): backup-before-delete on config; deletions must log.
4. **Arm honesty & calibration** (E-01, E-06): trial counter; persist shown confidence.

**REJECT** — any live deployment (unchanged); additionally this review finds the live-lethal set
(H-01/02/03, F-01, B-03) individually disqualifying.

**INSUFFICIENT EVIDENCE** — residual edge (unchanged); plus newly-flagged UNKNOWNs that must close
before any promotion: disk-full behavior (A-13), halt-recovery end-to-end (H-05), liquidity slice,
oiUnit.

**The Board's closing observation.** This platform's black swans are not exotic. They are
scheduled deletions, one-line HTTP calls, a daemon tied to a login shell, and a garbage collector.
The catastrophic tail here is not fat — it is *booked in advance*. That is the best possible news:
every Critical item above has a rescue costing minutes. Reality has announced its attacks; the
platform has simply not yet moved.

— Institutional Black Swan Review Board, 2026-07-17
