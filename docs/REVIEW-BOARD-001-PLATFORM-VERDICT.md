# REVIEW BOARD — FORMAL REVIEW 001
## ANTIGRAVITY PRO — PLATFORM-WIDE SCIENTIFIC & ENGINEERING VERDICT

**Authority:** Independent Scientific Review Board (Red Team)
**Date:** 2026-07-17 · **Basis:** 52 numbered audit documents (001–050), live measurements 2026-07-13 → 17, git history, PM2/daemon logs, 49/49 test suites
**Mode:** Verification only. No implementation. No optimization.

---

# 1. EXECUTIVE SUMMARY

ANTIGRAVITY PRO is a competently engineered, fully explainable, 100% paper-trading research
platform whose **headline quantitative claims did not survive measurement**, whose **correct
instruments were never consulted by its own decision paths**, and whose **evidence-collection
surfaces (persistence, calibration, availability) are broken in ways that destroy the very
forward-test evidence the platform needs next**.

The Board's verdicts are issued **per decision**, not as one blended grade:

| Decision under review | Verdict |
|---|---|
| **Deploy any strategy to live trading** | **REJECT** |
| **The claimed 88–91% strangle edge** | **REJECT** (look-ahead artefact — measured) |
| **The residual strangle edge (59.4% / Sharpe 1.50)** | **INSUFFICIENT EVIDENCE** |
| **The confluence AI model as decision support** | **REJECT** (in current form) |
| **Continued operation as a paper research platform** | **PASS WITH CONDITIONS** (5 conditions, §14) |

---

# 2. VERIFIED FACTS (confirmed by inspection, logs, or git — not quantitative harnesses)

- V1. The platform is 100% paper. All 7 `placeOrder` call sites are guarded (verified line-by-line, audit 012). No live order path exists from any engine.
- V2. The NIFTY circuit-breaker **fired and worked**: `⛔ HALT: 16 losses in a row` at 2026-07-14 14:30:26 (error.log). The brake design is sound when reached.
- V3. The AI model was silently re-specified on 2026-07-01 (commit `04c35a6`): 8→9 factors, six priors changed, normalisation target 92→99. Learned state carried forward without reset. `reset()` exists (`confluence-learner.js:187`) and was not called.
- V4. `data/confluence-weights.json` is untracked in git. No version field, no schema, no timestamp.
- V5. Commit `3e388d1` (2026-06-21, "chore: … junk") deleted 37 backtest/strategy scripts and 14 result files, including a failure post-mortem and a 40-configuration optimizer. They survive only as git blobs.
- V6. The recurring bot "deaths" are not crashes: PM2's daemon log shows 12 `New PM2 Daemon started` lines, each coinciding with a session start; the daemon dies with the shell tree that spawned it. No scheduled task exists (`schtasks /Query` → not found; creation from this environment → Access denied).
- V7. `strangle-engine` and `bounce-engine` do not persist their open books; restarts destroyed 24 and then 20+ open paper positions (observed live, twice). `signal-paper` and `ai-agents` do persist.
- V8. 0 of 172 HTTP routes carry authentication; the server binds `0.0.0.0:3000`; `POST /api/strategy-config/reset` deletes `config-overrides.json`, which has no backup.
- V9. `data/opt-candles/` is under a silent FIFO cap of 40 (`server.js:578`, delete inside empty catch). It contains the platform's only ~complete intraday session (2026-07-08, 669 series, 99% bar coverage), which is not re-derivable.
- V10. Seven correct statistical validators exist in `bt-validate.js`. Their only production caller passes `nTrials || 1`; a second call site hard-codes `nTrials: 5`. The parameter's own comment reads "for deflated Sharpe honesty".

# 3. MEASURED FACTS (quantitative harnesses, reproducible, seeded where stochastic)

- M1. Look-ahead: 9 files select strikes from `day.underlying` (= same-day close). One line changed (today's close → previous close) moves the flagship strangle from **88.15% → 65.61% gross win**, ₹28.77 → ₹4.87 premium/trade (599 trades, 600-day real bhavcopy).
- M2. Cost-netted (platform's own `charges.js`): **59.43% win, ₹225.68/trade, annualised Sharpe 1.50**; walk-forward OOS holds (26 folds); purged 5-fold all positive.
- M3. Deflated Sharpe on that edge: **100% PASS at nTrials=1; 86.85% FAIL at 5; 76.89% FAIL at 10; 54.68% FAIL at 40; 41.09% at 100.** The deleted optimizer alone swept 40 configs ranked by win rate.
- M4. Regime slices (look-ahead-free, cost-net): realised vol ≥15% → **₹−13/trade (Sharpe −0.06)**; DTE 3–4 → **₹−257/trade**; DTE 1–2 carries 88% of all profit; 2025 alone carries 71%.
- M5. Bootstrap (10,000 seeded resamples): 95% CI on Sharpe **[0.20, 2.80]**; +₹226/trade of unmodelled cost erases the edge; the backtest models zero slippage and zero spread.
- M6. Live AI model: factors correct **44/130 = 33.8%**; 16 of 20 populated cells below 50%; 7 of 27 cells carry weight from n=0; corr(weight, accuracy) = 0.177.
- M7. Ensemble: `volume` and `fii` cast **0 votes in 21 decisions** while weighted 8.06/10.08; `news` voted bullish 20/21; effective independent legs **N_eff = 3.71 of 7**.
- M8. Confidence: displayed "probability" is an affine heuristic; the value shown was persisted in **1 of 21** decisions; the sole persisted case: score 91 → LOSS. Actual outcome of the 21: 5 wins (23.8%).
- M9. Meta-label calibration (n=12, one structure): Brier 0.177 vs 0.187 constant (BSS +0.054, not significant); `prob` = `Math.round(rawP×100)` — a unit conversion, not a calibration; P(win)≈75% correct while expectancy = **₹41.90/trade** (total ₹503 over 12 trades; loss/win ratio 2.89×).
- M10. `charges.js` short-side direction error re-measured: **₹0.32/trade (0.1%)**. The Board's earlier figure of ₹157.62 is **retracted** (self-correction, doc 045 §0.4).
- M11. Positions book (live): a naive aggregator would report ₹0 for 20+ bounce positions publishing no price; the shipped book reports them as UNKNOWN and sums only priced rows.

# 4. DERIVED FACTS (computed from measured facts; assumptions stated)

- D1. The platform's honest trial count is ≥50 (10 surviving variants + 40 deleted configs + hand-tuned parameters). Therefore the residual edge's DSR ≤ ~51% ⇒ statistically unsupported. (Assumes trials share the dataset — they do.)
- D2. Expected damage from the agreement term is **unknown in sign**: mean agreement was 6.1pp higher on losses (p=0.209, underpowered). Derived conclusion: the term is *unvalidated*, not *inverted*.
- D3. Every unmodelled friction (SPAN margin ~₹1.2–1.5L vs ₹1L divisor, short-STT direction, stop slippage, spread ×4 executions, kurtosis 30.6) biases M2 downward. ₹226/trade is the optimistic bound.
- D4. Given V6+V7: every session end kills the daemon and every restart destroys two engines' open books ⇒ the paper forward-test record is being systematically censored. Evidence collection is currently **self-erasing**.

# 5. EVIDENCE (where each item can be re-run)

- Docs 001–050 under `docs/` (52 files), each with its harness description.
- Harnesses in scratchpad (deterministic; seeded LCG where stochastic): look-ahead A/B, cost-net, DSR ladder, regime slices, bootstrap, calibration metrics, ensemble correlation, usage/window analysis.
- Logs: `logs/error.log` (HALT line), `C:\Users\Admin\.pm2\pm2.log` (12 daemon starts), PM2 process table.
- Git: commits `7823864`, `f8609ec`, `0d1acec`, `fefd38b` (the only production fixes); `3e388d1` (the deletion); `04c35a6` (the re-spec).
- Test suites: 49/49 green at last run, including 30-assertion look-ahead tripwire (proven red first) and 56-assertion positions-book suite.

# 6. CONTRADICTIONS (both halves documented)

- C1. `.env` declares `MAX_DAILY_LOSS_PERCENT=2`, `SENSEX_AUTO_ENABLED=false`; the engine runs at 5% with SENSEX auto **on** (`config-overrides.json` silently wins).
- C2. `/api/risk` reported `consecLosses: 0` while the engine held 15 (and later 16). The monitoring surface contradicts the state it claims to monitor.
- C3. The comment "for deflated Sharpe honesty" sits on a parameter that is fed `1` — the only value at which the check cannot fail.
- C4. "89% win validated by real backtest" (project memory/marketing) vs 59.4% cost-net measured, failing deflation.
- C5. A "VERY HIGH conviction" badge is rendered from a confidence stream whose recorded accuracy is 5/21, and whose displayed values were discarded 20/21 times.
- C6. The runbook instructs deleting `config-overrides.json` as a recovery step; audits show it is the sole, unbacked store of all engine state.

# 7. HIDDEN ASSUMPTIONS (unstated premises the system relies on)

- H1. *Agreement implies correctness* — hard-coded into the confidence formula; never tested.
- H2. *Model v1 ≡ v2 because the file still parses* — the re-spec inherited alien learned state.
- H3. *P(win) is the decision-relevant quantity* — expectancy is; never computed.
- H4. *Fills at bhavcopy open, stops at exactly 2× off the day's high, zero spread* — all four legs of the backtest's execution model.
- H5. *The lot on `rows[0]` is the day's lot* — the lot is per-contract (per-expiry); wrong on 27/600 days.
- H6. *Unknown = 0* — 119 `|| 0` sites; includes `(eventRisk || 0) < 70`, which opens the gate on feed outage.
- H7. *A running process implies a supervised process* — the daemon's lifetime was tied to a shell nobody knew about.

# 8. SCIENTIFIC WEAKNESSES

- S1. No hypothesis registry; zero pre-registered nulls; by the programme's own standard all results are exploratory.
- S2. Survivorship engineered by deletion: 37 experiments removed, only the winner retained (V5). The control group was destroyed.
- S3. Multiple-testing correction implemented but disarmed (M3/V10).
- S4. Underpowered inference throughout: n=12 (calibration), n=21 (decisions), n=130 (weights), 599 fat-tailed trades (kurtosis 30.6).
- S5. Temporal integrity fixed in 1 of 9 contaminated files; the other 8 remain (uncommitted-fix status: only `bt-validate.js`/`bt-real.js` touched).
- S6. No provenance: 0/25 result files carry gitSha/dataHash/seed.

# 9. ENGINEERING WEAKNESSES

- E1. Availability: no session-independent supervisor (V6). Single command fix exists; requires operator elevation.
- E2. Durability: open books of 3 engines die on restart (V7); combined with PM2 autorestart this erases evidence on every crash (D4).
- E3. Silent destruction: FIFO caps with `catch(_){}` (V9); HTTP-deletable unbacked config (V8).
- E4. Fail-open instances: event-risk gate on unknown input (H6); historical C3-07 class fixed in execution-engine but pattern persists elsewhere.
- E5. Security: 0/172 routes authenticated on a LAN-exposed bind; `auth.js` complete and unused.

# 10. ARCHITECTURE WEAKNESSES

- A1. Decision layer is capital-risk-blind: 10/10 inputs are market data; `consecLosses/halted` read by 0 of 4 verdict-consuming engines; five uncoordinated risk opinions.
- A2. The feature-store break: features computed and discarded; all downstream science stands on unkept data.
- A3. Eleven built-correct-unused components (validators, auth, contracts, reset, sizer, module surfaces, ops tooling). The system's failure mode is non-consultation, not absence.
- A4. Lineage not statically derivable: 45/55 write sites use variable paths.
- A5. SPOF `safe-write.js` (28 dependents) — mitigated by being the best-verified file in the repo; noted, not critical.

# 11. RISK ASSESSMENT

| Risk | Class | Blast radius | Note |
|---|---|---|---|
| Loss of only complete intraday session (FIFO-40) | **CRITICAL** | Irreversible scientific loss | deadline ~35 sessions |
| Loss of 37 deleted experiments on `git gc` | **CRITICAL** | Irreversible; nTrials becomes unknowable | any time |
| Evidence self-erasure (restarts × non-persistence) | **HIGH** | Forward-test record censored | ongoing, observed twice |
| Misleading confidence on 6 dashboards | **HIGH** | Human decision contamination | paper-only caps severity |
| Risk-blind recommendation surface | **HIGH** | Same | paper-only caps severity |
| LAN-exposed unauthenticated control plane | **MEDIUM** | Config deletion, engine toggling | local network only |
| `charges.js` direction bug | **LOW** | ₹0.32/trade | reclassified after M10 |
| Live-money exposure | **NONE** | — | V1 holds |

# 12. UNKNOWNS (declared, not filled)

- U1. Which of the model's statistics belong to v1 vs v2 — permanently unresolvable (V3/V4).
- U2. Whether the agreement term helps, harms, or is neutral (D2).
- U3. True calibration of the displayed probability — unverifiable until shown values are persisted (M8).
- U4. Liquidity-regime robustness — volume exists in source data, unloaded.
- U5. Broker chain `oiUnit`; BSE bhavcopy OI unit (open since audit 006).
- U6. True slippage/margin profile of the strangle (D3 bounds it below ₹226 but does not locate it).

# 13. REQUIRED EVIDENCE (to change any verdict)

- R1. For the residual edge → PASS: a pre-registered forward test, ≥ ~200 labelled outcomes, cost- and margin-realistic, with a persistent trial counter feeding DSR, and regime gates fixed **before** observation, not after.
- R2. For the AI model → reconsideration: model versioning + spec-hash guard; persisted shown-confidence; a reliability curve on ≥100 outcomes; phantom legs zero-weighted.
- R3. For platform evidence integrity: open-book persistence for strangle/bounce/gamma; session-independent supervision (the one-line scheduled task); the two irreplaceable-data rescues executed.
- R4. For any live consideration (far future): all of the above plus an authenticated control plane and a risk-state-aware decision surface.

# 14. INSTITUTIONAL RECOMMENDATION

**REJECT** — live deployment of any strategy; the claimed 88–91% edge; the confluence model as decision support in current form.

**INSUFFICIENT EVIDENCE** — the residual strangle edge (genuinely positive out-of-sample; fails honest deflation; concentrated in one DTE band and one calendar year; optimistic-bound costs).

**PASS WITH CONDITIONS** — continued paper-research operation, conditional on:

1. **Rescue the irreplaceables now**: copy `opt-candles/2026-07-08.json` out of the FIFO directory; exhume the 37 deleted experiments from git blobs. (Cost: one `cp`, one `git show` loop.)
2. **Make evidence durable**: persist open books for strangle/bounce/gamma-blast (pattern exists in signal-paper).
3. **Make the platform survive its operator**: create the ONLOGON task (operator action; launcher already written).
4. **Arm the honesty parameter**: persist a trial counter; pass it to `deflatedSharpe`.
5. **Persist the shown confidence**: route the inline `learn()` path through the tracked path so score is never null.

Implementation of conditions belongs to the engineering agent, not this Board. The Board will re-review upon submission of evidence per §13.

**The cost of rejecting a correct idea is lower than accepting a false one. The residual edge may be real. It has not earned belief yet.**

— Independent Scientific Review Board, 2026-07-17
