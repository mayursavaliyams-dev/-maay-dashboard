# REVIEW BOARD — FORMAL REVIEW 005
## ANTIGRAVITY PRO — TRUTH VERIFICATION COMMISSION · THE TRUTH REGISTER

**Authority:** Institutional Truth Verification Commission · Supreme Scientific Audit Authority
**Date:** 2026-07-17 · **Basis:** audits 001–050, Reviews 001–004, live system, git, production logs,
plus fresh verifications run for this commission (lot-vs-data, halt-threshold forensics, charge
constants, expiry-rule probe)
**Mode:** Verification only. Truth overrides documentation, prior conclusions, and assumptions —
including this Commission's own prior numbers (one already stands retracted, one probe error is
logged below).

**Integrity note on quotas.** The instruction requests ~450 ranked entries across ten lists. Its own
closing law — *never invent evidence; Unknown remains Unknown* — supersedes the quotas. This
register contains **every evidence-backed entry the record supports**, organized under the requested
headings, and refuses padding: an invented truth-register entry would itself be a falsehood.

**Fresh verifications performed for this review:**
1. **Lot-vs-data:** latest bhavcopy (2026-06-17), lots grouped by expiry → **65 for every NIFTY
   expiry through 2030**. Registry value confirmed *by the data itself*, not by documentation.
2. **Halt-threshold forensics:** code default **5** (`parseInt(env || 5)`), `.env` sets **8**,
   production halt fired at **16** — resolved below (F-Contra-01): the brake evaluates only on a
   *new* loss; a boot-restored streak of 15 sat above the limit unhalted until the next loss.
   **The B-3 defect is now production-confirmed, not hypothesized.**
3. **Charge constants:** read as coded (STT 0.1% sell / txn 0.03503% / SEBI 0.0001% / stamp 0.003%
   buy / GST 18% / ₹20 brokerage) — assessed below.
4. **Expiry-rule probe:** the Commission's own accessor call was wrong (`expiryWeekday` undefined —
   API name mismatch); the registry's expiry data was previously verified via `preflight:registry`.
   Logged as the Commission's 13th self-caught error. Truth applies to auditors too.

---

# PART 1 — TOP VERIFIED TRUTHS (40; classification TRUE unless noted)

**Money & safety**
1. The platform is 100% paper; all 7 `placeOrder` sites guarded. (TRUE — line-verified, 012)
2. The consecutive-loss brake works when evaluated: production HALT at the first new loss past
   restore. (TRUE — log 2026-07-14 14:30)
3. `safe-write.js` provides atomic temp+rename with `.bak`; 7/7 existing backups parse. (TRUE — 025)
4. The C3-07 fix fails CLOSED on corrupt equity state (halts, refuses fabricated clean slate). (TRUE)
5. NIFTY lot = 65 — confirmed by the data across every listed expiry to 2030; SENSEX 20, BANKNIFTY 30
   broker-verified in registry. (TRUE — fresh measurement)
6. The registry fails closed on unregistered instruments (FINNIFTY→null, never a guess). (TRUE)
7. Every risk-money rule that was reached in production behaved as coded. (TRUE — halt event)

**Measurement & evidence**
8. The 88–91% strangle claim is a look-ahead artefact; one reference-price line moves it to
   65.61%/59.43%. (TRUE — 599-trade A/B)
9. The residual edge is genuinely positive out-of-sample: 26-fold walk-forward holds; 5/5 purged
   folds positive. (TRUE — and insufficient, see Part 2)
10. DSR verdict depends entirely on nTrials: 1→PASS, ≥10→FAIL; platform passes 1. (TRUE)
11. The regime decomposition is real: vol≥15% negative; DTE 1–2 carries 88% of profit; 2025 carries
    71%. (TRUE — measured)
12. Bootstrap 95% CI on Sharpe = [0.20, 2.80]; +₹226/trade erases the edge. (TRUE)
13. The AI model's own persisted stats show 44/130 = 33.8% factor accuracy. (TRUE — its own file)
14. Two ensemble members have never voted (0/21) while carrying weight. (TRUE)
15. `news` voted bullish 20/21; `oi` 19/21 at ~20–29% accuracy. (TRUE)
16. N_eff ≈ 3.71 of 7 voting legs (n=21 caveat attached). (TRUE as computed; thin sample declared)
17. The displayed confidence was persisted in 1 of 21 decisions; that one: 91 → LOSS. (TRUE)
18. The 12-outcome condor set: P(win) ≈75% roughly calibrated; expectancy ₹41.90/trade. (TRUE)
19. `prob` = `Math.round(rawP×100)` — a unit conversion, not a calibration. (TRUE)
20. Brier/ECE/MCE/LogLoss had never been computed before audit 048. (TRUE)
21. Deterministic replay is byte-identical where inputs exist. (TRUE — 037)
22. Bhavcopy integrity: 600 files, 0 duplicates, 0 empty, 0% missing fields, stable 34 columns. (TRUE)
23. Intraday capture: exactly one ~complete session exists (99%); others 8–30%. (TRUE)
24. 37 experiments + 14 result sets were deleted in `3e388d1`; recoverable today from blobs. (TRUE)
25. The deleted optimizer swept 40 configs ranked by win-rate; contains `BEST_GUESS`. (TRUE — exhumed)
26. The model was re-specified 2026-07-01 (8→9 factors; baseline 92→99) with learned state carried.
    (TRUE — git)
27. `reset()` exists and was never called for that transition. (TRUE)
28. 0/25 result files carry provenance. (TRUE)
29. 32 raw `writeFileSync` sites remain outside safe-write; 20 modules use safe-write. (TRUE — census)
30. Engines construct at `server.js:3537`, listen at `:7277`; trades have opened pre-listen. (TRUE)
31. PM2 daemon died with the operator's shell 12 times; the bot itself never crashed once. (TRUE)
32. `strangle`/`bounce`/`gamma` lose open books on restart; `signal-paper`/`agents` restore. (TRUE)
33. The FIFO caps (40/120) delete oldest-first inside empty catches. (TRUE)
34. `/api/positions` (new) sums only priced rows; 20+ bounce rows honestly UNKNOWN. (TRUE — 56 tests + live)
35. The VRP stand-down gate is operating and refusing thin premium, with reasons logged. (TRUE — live)
36. `agents-engine` measured its own 2.7× overshoot on 33 outcomes and shrank itself; disclosed its
    weak PF 0.94 in its own header. (TRUE — the repository's best scientific act)
37. The NIFTY directional strategy was honestly invalidated (PF 0.94 / 1200 trades) and disabled. (TRUE)
38. Explainability is complete: 21/21 decisions retain full leg-level attribution; no black box
    exists anywhere. (TRUE)
39. Charges direction-bug magnitude = ₹0.32/trade (0.001−0.00003 on gross), immaterial. (TRUE —
    supersedes the retracted ₹157.62)
40. 49/49 test suites pass, including tripwires proven red first. (TRUE — last run)

# PART 2 — TOP FALSE / OUTDATED ASSUMPTIONS (30)

| # | Belief | Verdict | Reality (evidence) |
|---|---|---|---|
| 1 | "SHORT_STRANGLE has an 89% validated edge" | **FALSE** | look-ahead artefact (M1) |
| 2 | "The 600-day backtest reconfirms the selling edge" | **FALSE** as stated | 59.4% net; DSR-FAIL at honest trials |
| 3 | "Deflated Sharpe certifies our edge at 95%" | **FALSE** | certified at nTrials=1 only |
| 4 | "The displayed number is a probability" | **FALSE** | affine heuristic; no calibration |
| 5 | "High agreement ⇒ higher accuracy" | **UNVERIFIED**, coded as true | p=0.209; unanimous call lost |
| 6 | "The ensemble has 9 factors" | **FALSE** | 7 vote; N_eff ≈3.7 |
| 7 | "The learner up-weights what works" | **FALSE** | corr(w,acc)=0.177 |
| 8 | "consecLosses limit is 8, so we halt at 8" | **PARTIALLY TRUE** | env=8 (code default 5); restored streaks bypass until next loss — halt observed at 16 |
| 9 | "`/api/risk` shows our risk" | **FALSE** | env defaults + day-scoped recount |
| 10 | "`.env` is the configuration" | **FALSE** | overrides silently win |
| 11 | "Backups exist for critical data" | **FALSE** | 0 of 9 critical; 1 orphan |
| 12 | "Deleting config-overrides is a safe recovery step" (runbook) | **FALSE & DANGEROUS** | sole unbacked state store |
| 13 | "The bot keeps crashing" | **FALSE** | the daemon dies with the shell; app never crashed |
| 14 | "PM2 means always-on" | **PARTIALLY TRUE** | only while its daemon lives; no boot hook |
| 15 | "Restart is safe" | **FALSE** | 3 engines' books destroyed each time |
| 16 | "Our results are reproducible — the code is deterministic" | **FALSE** | 0/25 provenance; results overwritten |
| 17 | "We validated with walk-forward/purged-kfold" (pre-042 belief) | **FALSE** | zero strategy callers before the audit |
| 18 | "Old experiments were junk" | **FALSE** | they were the control group |
| 19 | "The model is the same model as before July" | **FALSE** | re-specified beneath its state |
| 20 | "Charges are modeled correctly" | **MOSTLY TRUE** | rates plausible as coded; short-side leg-swap ₹0.32; **BSE instruments charged NSE txn rate; IPFT omitted; exact circular still unverified (E1)** |
| 21 | "Slippage is negligible" | **UNVERIFIED**, assumed 0 | ₹226/tr sensitivity says it is decisive |
| 22 | "₹1L capital ⇒ returns on ₹1L" | **FALSE** | SPAN margin 1.2–1.5L not modeled |
| 23 | "Kelly sizing is available if needed" | **DANGEROUS-FALSE** | seeded 0.9 from invalidated claim; kelly(0.512)<0 |
| 24 | "The gamma numbers are the gamma" | **PARTIALLY TRUE** | two models diverge 6.79%; no ground truth |
| 25 | "OI units are consistent" | **UNKNOWN**, assumed | oiUnit unresolved since 006 |
| 26 | "Lot handling in backtests is fixed" | **PARTIALLY TRUE** | rows[0] read wrong 27/600 days |
| 27 | "The intraday archive is accumulating" | **PARTIALLY TRUE** | under FIFO-40 death row |
| 28 | "Auth exists" | **PARTIALLY TRUE** | built, tested, guards nothing (0/172) |
| 29 | "Docs describe the system" | **OUTDATED** in ops | runbook prescribes bare node + config deletion |
| 30 | "Paper P&L totals on dashboards are complete" | **FALSE** historically | unpriced books; the new panel is the first honest total |

# PART 3 — REPOSITORY MYTHS (15)

M1 "89% win engine" (founding myth — FALSE) · M2 "It crashes a lot" (daemon-kill myth) ·
M3 "Everything is backed up" · M4 "The AI is learning" (it jitters noise) · M5 "VERY HIGH means
very likely" · M6 "We have 9 independent signals" · M7 "The validator approved us" (never ran) ·
M8 "Cleanup made the repo healthier" (destroyed the controls) · M9 "The brake protects us at 8"
(only on the next loss) · M10 "The risk API shows engine risk" · M11 "config in .env" ·
M12 "restart is harmless" · M13 "we model costs conservatively" (zero slippage) · M14 "the platform
is unmonitorable" (instruments exist, unread) · M15 "more modules = more capability" (11 unused).

# PART 4 — TOP CONTRADICTIONS (20)

1. **F-Contra-01 (new, resolved):** limit "8" vs halt at "16" — env=8, code default=5, boot-restored
   streak bypasses until next loss. Three sources, three numbers; production reconciled them.
2. `.env` 2% vs engine 5% daily-loss.
3. `.env` SENSEX auto=false vs engine true.
4. `/api/risk` 0 losses vs engine 15/16.
5. "honesty" comment vs `nTrials‖1` argument.
6. `paper=true` everywhere vs ₹7L "allocation" language from an invalidated backtest.
7. Registry fail-closed vs `bt-lib` rows[0] lot guess.
8. `Unknown≠Zero` doctrine vs 119 `‖0` sites.
9. Explainability excellence vs zero readers of explanations.
10. Brake exists vs zero verdict-consumers reading it.
11. `prob` field name vs rounding implementation.
12. `mtm` rupees vs `pnlPts` points beside it (unit trap).
13. `credit: true` boolean beside `entryNet` price (type trap).
14. Runbook "delete config" vs config = sole state.
15. "Validated by real data" claims vs contaminated column in the loaders.
16. Docs "Positions & P&L verification" panel vs no open-book aggregation until 07-14.
17. `ecosystem.config.js` autorestart vs runbook bare `node`.
18. Two `bsGamma`s, one name.
19. Memory note "sizing forces ≥1 lot" vs later-corrected memory (self-contradiction, logged).
20. Commission's ₹157.62 vs measured ₹0.32 (self-contradiction, retracted).

# PART 5 — HIDDEN ASSUMPTIONS (15)

Agreement⇒correctness · v1≡v2 models · P(win) is the decision variable · fills at open, stops at
exact 2×, zero spread · rows[0] lot · unknown=0 · running=supervised · restart-safe books ·
same-file writers are exclusive (no lock; dual-writer window measured) · NSE txn rate applies to
BSE legs · clock-string times never cross midnight · 30-day-stale equity means "fresh start is
safe" · JSON parse success means state is trustworthy (version blind) · trial count "is about 1" ·
displayed number ≈ persisted number.

# PART 6 — TOP DANGEROUS BELIEFS (10)

1. "The brake would have stopped it at 8" — bypass proven in production.
2. "It's only paper, so numbers can't hurt" — A-11 human-mirror vector (the sole real-money path).
3. "PASS from the validator means edge" — at nTrials=1 PASS is unconditional.
4. "Calibrated once ⇒ calibrated" — model re-spec broke lineage silently.
5. "Cleanup is hygiene" — last cleanup destroyed the control group.
6. "Restart to fix it" — restart erases evidence.
7. "We'd notice if data vanished" — orphan dataset proved otherwise.
8. "Registry covers sizing everywhere" — backtests bypass it.
9. "Kelly is off" — one env flag from betting a negative edge.
10. "The dashboards are informational" — `<58` gates decisions; 6 surfaces render authority.

# PART 7 — TOP UNKNOWN FACTS (15; remain UNKNOWN)

v1/v2 stat mixture (permanent) · agreement-term sign · true calibration of displayed confidence ·
liquidity-regime slice · oiUnit (broker/BSE) · true slippage & margin profile · disk-full behavior ·
halt-recovery end-to-end · dual-writer corruption incidence · memory-leak profile · Linux behavior ·
second-instance crash mode · deleted studies' findings (until exhumed) · exchange circular rates
(E1) · current exchange expiry-weekday truth vs registry (Commission probe failed; registry
previously verified — reverify via preflight).

# PART 8 — DIMENSION TRUTHS (concise)

**Scientific (25→ top):** the measurement stack itself is sound — A/B harnesses, seeded bootstrap,
permutation tests, DSR ladder all reproduce; every headline *claim* they tested fell. Science here
is healthy as *method*, false as *inherited belief*.
**Engineering (25→ top):** mechanisms do what their code says (brake, guards, atomicity, gates);
the falsehoods live in *wiring* (what reads what) and *lifecycle* (what survives restart).
**Architecture (25→ top):** structure is honest (no hidden globals found beyond documented state;
no circular deps found); the untruths are *aspirational components presented as capabilities* (11
built-unused) and *authority inversion* (UI promotes ungated opinion).

# PART 9 — CRITICAL EVIDENCE MISSING

Exchange fee circular (E1) · broker oiUnit statement · ≥200 labelled outcomes · persisted shown-
confidence stream · trial-count ledger · off-machine copy attestations · a single load/perf
baseline · Linux run log · restore-drill record.

---

# TRUTH SCORES (derived; base = claims examined in this register)

| Dimension | Score | Derivation |
|---|---|---|
| **Repository Truth** | **4 / 10** | 40 verified truths vs 30 false/outdated + 15 myths still circulating in docs/memory |
| **Scientific Truth** | **2 / 10** | every inherited quantitative claim failed; method-truths rescued the score from 1 |
| **Engineering Truth** | **6 / 10** | mechanisms truthful; wiring/lifecycle beliefs false |
| **Architecture Truth** | **5 / 10** | structure honest; capability claims inflated (11 unused) |
| **Research Truth** | **2 / 10** | exploratory-only by own standard; control group destroyed |

---

# INSTITUTIONAL RECOMMENDATION

**Unchanged and now truth-grounded:** paper operation **PASS WITH CONDITIONS** (Reviews 001–004
conditions; survival-ordered) · live **REJECT** · claimed edge **REJECT** · residual edge
**INSUFFICIENT EVIDENCE** · confluence model as decision support **REJECT**.

**The Commission's finding-of-findings:** this repository's deepest truth is that **its falsehoods
were all locally recorded as truths by its own instruments** — the 33.8% in the model's file, the
16/8 in the halt log, the nTrials comment, the artefact-vs-reality A/B one line apart. Nothing here
required external revelation. **The truth was on disk the entire time. The failure mode of this
platform is not deception. It is unread truth.**

— Institutional Truth Verification Commission, 2026-07-17
