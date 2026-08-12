# 075 — Phases 1 and 2: The Safety Net and The Chokepoint

**Companion to:** [074 — Phase 0: Inventory and Truth](074-PHASE0-INVENTORY-AND-TRUTH.md)
**Date:** 2026-07-31
**Result:** full suite **79/79**, smoke **7 passed / 0 failed / 2 not covered**
**Audit score: 0 / 17 → 11 / 17**
**Phase 3 has NOT started** and must not, per the sequencing rule, until the
chokepoint has survived one full week of live operation.

---

## 1. What was built, in order

### Phase 1 — the safety net (order path only)

| # | Artefact | File |
|---|---|---|
| 1.1 | Characterization tests — pin the order path exactly as it is, defects included | `test/order-path-characterization.test.js` |
| 1.2 | Golden-path replay fixtures from **real captured sessions** | `scripts/build-order-fixtures.js` → `test/fixtures/order-path/*.json` |
| 1.3 | Parity harness — replay both paths, diff what the **broker** saw | `parity-harness.js` |
| 1.4 | Smoke suite — under two minutes, run before every deploy | `scripts/smoke.js` (`npm run smoke`) |

**The fixtures are not synthetic.** Each is derived from this system's own
warehouse capture, and each session was assigned the character it actually
exhibits, measured rather than chosen:

| Character | Session | Evidence |
|---|---|---|
| quiet | 2026-07-29 | range 61.8 pts over the captured window |
| trending | 2026-07-30 | range 92.2 pts, net +41.3, cadence held at 5 min |
| expiry | 2026-07-28 | Tuesday — NIFTY expiry weekday per the registry |
| feed-gap | 2026-07-27 | a 44.7-minute hole in an otherwise 60-second feed |

The feed-gap fixture preserves its holes as `skipped` intents rather than
zero-filling them. A fixture that quietly repaired a gap would test the opposite
of what it exists to test.

**The parity harness diffs submissions, not return values.** A return value says
what the caller saw; a submission log says what the market saw. They differ
exactly at a retry, a coalesced duplicate, or a swallowed failure — which is to
say, exactly where money is lost. Differences are reported with a machine key
(`field:lots`, `count:submissions`) and must be accepted **by name**; an unnamed
difference always fails. Silent tolerance would stop it being evidence.

### Phase 2 — the chokepoint

| # | Change | Where |
|---|---|---|
| 2.0 | Fixed the blocker Phase 1 found (below) | `risk-manager.js` |
| 2.2 | Construction order — a pure move, no behaviour change | `server.js` 5825 → 245 |
| 2.3 | Seven call sites moved | `execution-engine.js` ×2, `afternoon-engine.js` ×2, `amibroker-bridge.js`, `server.js` ×2 |
| 2.3 | The portfolio state the risk layer evaluates against | `risk-state.js`, `server.js:_riskStateNow` |
| 2.3 | One shared, fail-closed placement path | `place-guarded.js` |
| 2.4 | Raw capability neutralised on the instance | `risk-guard.js` |
| 2.5 | Automatic latching circuit breaker | `order-breaker.js`, wired in `risk-guard.js` |
| — | Order retry disabled at the connector | `live-connector.js` |
| — | Reducing orders can never be refused | `risk-guard.js:approveReducing` |
| — | Proof suite for all of the above | `test/order-path-chokepoint.test.js` |

---

## 2. What the safety net caught before anything was moved

This is the return on Phase 1, and it is the reason the phase order in the brief
is not negotiable. Both findings were invisible to source reading — doc 074 was
written from source and contains neither — and both would have fired on the
first live order after the move.

### 2.1 The risk layer could not open a position it did not already hold

`concentrationByStrike` computed `mine = riskByStrike[key]`. A strike **absent**
from the map yielded null, which made the check `UNEVALUABLE`, and `UNEVALUABLE`
blocks under the default `RISK_FAIL_MODE=BLOCK`.

If the caller builds that map from open positions — the obvious construction —
then "absent" means "nothing held here", which is a **known zero**, not an
unknown. So the layer approved orders only at strikes and expiries **already
held** and refused every genuinely new position. The same conflation blocked any
new expiry.

Measured, reproducibly:

```
new strike, absent from map   ->  BLOCKED concentrationByStrike:UNEVALUABLE
same strike, present as ZERO  ->  APPROVED
new EXPIRY, absent from map   ->  BLOCKED concentrationByExpiry:UNEVALUABLE
```

Nobody had seen it because the guard sat in one of twelve order paths and was
never asked.

**The fix does not guess.** Making absence mean zero everywhere would have been
worse than the bug: a risk map that failed to build would then read as a
portfolio with no risk, and every check would report PASS. Instead the caller
**declares** `riskMapComplete: true` when its maps are exhaustive, and only then
does an absent key read as zero. A caller that omits the flag gets the old
fail-closed behaviour, so forgetting it blocks orders rather than releasing them.

### 2.2 Nothing in production ever called `requestApproval`

Verified by search across the whole tree: the only callers were tests. The
guarded broker refuses any order without an approval — so the one path that did
hold it could never have placed an order either. **The chokepoint was not narrow.
It was inert.** `risk-state.js` and `server.js:_riskStateNow()` are the missing
half.

### 2.3 Two order sites were exits, and the guard would have trapped them

`execution-engine.js:678` and `afternoon-engine.js:671` are `_exit()` paths.
Every control in the guard — limits, kill switch, breaker — exists to stop risk
being **added**. Applied to a closing order they do the opposite: each would have
held the position open in exactly the conditions that tripped it.

`approveReducing()` is the answer. A closing order still passes through the
chokepoint — recorded, counted by the breaker, and labelled `why: REDUCING` in
the audit trail — but is never denied by it. The label is deliberate: an
unconditional approval that looked identical to an evaluated one would make the
trail unreadable precisely where it matters most.

Because that door skips every limit, `test/order-path-chokepoint.test.js §5`
enumerates its callers and asserts each is inside an `_exit()` path. Exactly two
files may call it.

---

## 3. The construction-order move (2.2)

```
before:  guardedBroker at server.js:5825
         engines       at 3226, 3391, 3512, 3573   ← 2,252–2,599 lines EARLIER

after:   guardedBroker at server.js:247
         engines       at 3320, 3489, 3614, 3679   ← all AFTER
```

At the moment `new ExecutionEngine({...})` ran, the identifier `guardedBroker`
was in the temporal dead zone. The engines could not have received the guard even
deliberately. Every line was correct in isolation; only the order was wrong,
which is why it survived review — and why the ordering is now asserted by a test
rather than trusted to the next reader.

---

## 4. The seven moves (2.3)

| Site | Kind | Route now |
|---|---|---|
| `execution-engine.js` entry | adds risk | `placeGuarded` — evaluated in full, may be refused |
| `execution-engine.js` exit | reduces risk | `approveReducing` — recorded, never refused |
| `afternoon-engine.js` entry | adds risk | `placeGuarded` |
| `afternoon-engine.js` exit | reduces risk | `approveReducing` |
| `amibroker-bridge.js` | **ambiguous** | `placeGuarded` — see below |
| `server.js` `/api/trade/execute` | adds risk | `placeGuarded` |
| `server.js` TradingView webhook | adds risk | `placeGuarded` |

**The AmiBroker decision, stated because it is a judgement call.** A SELL from
AmiBroker may close a long or open a short, and the bridge has no position book
to tell them apart. Both directions are evaluated in full as entries rather than
waved through as reducing. Treating an ambiguous SELL as a close would let a
short entry past every limit — expensive and irreversible. Treating a genuine
close as an entry can at worst refuse an exit the operator can still make
manually. The failure is directed towards the recoverable error.

**The TradingView webhook** is unauthenticated and its callers cannot be
enumerated from source (doc 074 §0.5). It is therefore the site that most needs
the risk layer in front of it, not least.

**Two engines are now gated on a margin verdict they do not yet have.**
`getMarginVerdict` is an injected callback; where it is absent the intent carries
`marginVerdict: null`, the margin check reports `UNEVALUABLE`, and the order
blocks. This is deliberate and it is a live gate: these engines may not go live
until a margin source is wired to them. It is recorded here so it is not later
mistaken for a bug.

---

## 5. Bypass is impossible, not discouraged (2.4)

A test asserting "no file calls `live.placeOrder`" is a rule a future change can
route around, and it fails at review time rather than run time. So the wrapped
connector's own `placeOrder` is **replaced with a thrower** at construction, after
the real method is captured privately.

```
before wrapping:  connector.placeOrder works
after  wrapping:  connector.placeOrder throws RISK_BYPASS_ATTEMPT
                  a reference stashed elsewhere fails identically
                  the guard still reaches the broker via its private _send
```

A missed call site, a new engine, a copy-pasted route — each now fails
immediately and loudly instead of quietly succeeding past the risk layer.

---

## 6. The automatic breaker (2.5)

The kill switch is manual and deliberate. It is the wrong instrument for a loop
that fires two hundred orders in four seconds: by the time a human has noticed
and clicked, the damage is complete. A runaway loop is a more common cause of
ruin than any strategy error and the one failure an operator cannot outrun.

Three breakers, each latching independently:

| Breaker | Trips on |
|---|---|
| `rate` | more than N orders in a rolling window, across everything |
| `perInstrument` | more than M orders in that window for one instrument |
| `duplicate` | the same instrument\|strike\|type\|side\|lots again inside a short window |

**Latching is the point.** A breaker that self-clears when the rate falls back
under the limit lets a loop through in bursts forever. Reset is explicit,
attributed, and refuses an unattributed `by`.

A different size is **not** a duplicate — a strategy asking for more size asks
once, for more. A retry loop asks for the same thing again. That distinction is
what separates the breaker from a rate limit.

**What it cannot see, stated rather than papered over.** It counts orders
arriving at the chokepoint. The connector's `_post` retried a failed order up to
three more times *below* this point, so four broker submissions could arrive from
one intent and the breaker would count one. That is fixed at the connector in the
same phase — `retries: 0` for `/v2/orders` specifically — because an order is not
a read:

> A 5xx or a dropped socket **after** the exchange has accepted the order is
> indistinguishable from one before. Whether Dhan de-duplicates on
> `correlationId` is **Unknown** and has not been confirmed with the broker.
> Until it is confirmed in writing, an order is sent exactly once and an
> ambiguous failure is escalated to a human rather than resolved by guessing.

---

## 7. Audit score, before and after

Re-run per 7.4. The three items marked **new** were discovered by the Phase 1
safety net and did not exist in doc 074's list.

| # | Defect | Before | After |
|---|---|---|---|
| A1 | Every order passes one chokepoint | 1 of 12 | **12 of 12** ✓ |
| A2 | Construction order correct for the order path | FAIL | **PASS** ✓ |
| A3 | Raw order capability unreachable | FAIL | **PASS** ✓ |
| A4 | Order rate / duplicate breaker | ABSENT | **PRESENT** ✓ |
| A5 | `getPositions` distinguishes error from empty | FAIL | FAIL — Phase 5 |
| A6 | Order retry is idempotency-safe | FAIL | **PASS** ✓ |
| A7 | Capability selected by explicit declaration | FAIL | FAIL — Phase 4 |
| A8 | Malformed numeric config fails closed | FAIL | FAIL — Phase 4 |
| A9 | `tradesToday` survives restart | FAIL | FAIL — Phase 5 |
| A10 | `openPosition` survives restart | FAIL | FAIL — Phase 5 |
| A11 | Kill switch authenticated | FAIL | FAIL — operations, doc 073 A2 |
| A12 | Characterization tests on the order path | ABSENT | **PRESENT** ✓ |
| A13 | Parity harness | ABSENT | **PRESENT** ✓ |
| A14 | Smoke suite | ABSENT | **PRESENT** ✓ |
| A15 | *(new)* The risk layer can open a position it does not hold | FAIL | **PASS** ✓ |
| A16 | *(new)* `requestApproval` is actually called in production | FAIL | **PASS** ✓ |
| A17 | *(new)* A closing order can never be refused | FAIL | **PASS** ✓ |

**0 / 17 → 11 / 17.**

The six that remain are named with the phase that owns them. None belongs to
Phase 2, and none was deferred for convenience: A7 and A8 are Phase 4
(configuration), A5, A9 and A10 are Phase 5 (state and persistence), and A11 is
an operations change tracked in doc 073.

### Defects still pinned as defects

Each is an assertion that currently passes *because* the defect is present. When
it is fixed, its assertion is inverted in the same commit — a characterization
that quietly disappears has not been fixed, it has been forgotten.

- The client's **default** retry policy still submits four times on a 500. Only
  the order path opts out; any new order path that forgets the option inherits it.
- Concurrent identical orders are **coalesced** by the connector's in-flight map.
  Practically rare — the key includes a millisecond-resolution `correlationId` —
  but the safety is an artefact of clock resolution, not a decision.
- `getPositions()` / `getOrders()` resolve to `[]` on failure and when
  disconnected. **An unreachable broker is indistinguishable from a flat book.**
  This blocks reconciliation, which is why doc 074 §0.8 moved it ahead of Phase 5.
- `TRADE_MODE` is latched at construction: setting it to `paper` on a running
  process changes nothing while appearing to.
- A malformed `MAX_TRADES_PER_DAY` evaluates to `NaN`, and `tradesToday >= NaN`
  is false for every count — the daily trade limit is silently disabled.
- Two identical intents in the same millisecond receive the same approval token.
  It fails closed (the second is refused as a replay), so it is recorded rather
  than alarmed about.

---

## 8. Verification

| Evidence | Result |
|---|---|
| Full suite | **79 / 79 suites** |
| Smoke | 7 passed, 0 failed, 2 not covered, 0.0s (budget 120s) |
| Parity, all four recorded sessions | identical, one accepted difference: `field:approval` |
| Chokepoint proof | 41 assertions |
| Characterization | 70 assertions |
| Repo-integrity ratchet | fired on untracked modules — **fixed by tracking them**, not by relaxing it |
| Perf ratchet | fired on 2 unvalidated JSON reads in `parity-harness.js` — **fixed in the harness**, not by raising the budget |

Both ratchets that fired were fixed at the cause. A ratchet that gets raised to
accommodate new code has stopped being a ratchet.

**The one accepted parity difference is `field:approval`** — a guarded order
carries an approval field a raw order does not. It is named explicitly in
`scripts/smoke.js`; every other difference fails the gate.

**A note on the parity clock.** The guard's clock in the parity step is driven by
each fixture's own `at` timestamps. The captured intents are ~5 minutes apart;
replaying them against a clock advancing by a millisecond presented a whole
session as a burst and latched the breaker — measuring the harness rather than
the move. This is recorded because the first run did exactly that, and the
diagnosis was not obvious.

---

## 9. What has NOT been done

- **Phase 3 has not started.** Per the sequencing rule it must not until the
  chokepoint has survived **one full week of live operation**. It has survived
  zero days. Nothing in this document is evidence about production behaviour;
  it is evidence about recorded sessions and unit behaviour.
- **Phase 6** — no suspected-dead path has been instrumented, and nothing has
  been deleted. The candidates are listed in doc 074 §0.5 and stay listed.
- **Shadow running (7.2)** has not been set up.
- **The margin verdict** is not wired to the two engines that now require one.
  Until it is, their live entries block. That is the correct state, not a bug.
- **`getRiskState` supplies null for greeks, day P&L, consecutive losses,
  expiry-day and minutes-to-close.** Each null makes its check `UNEVALUABLE`,
  and each therefore blocks. Filling them in is real work and is deliberately
  not disguised: a fabricated zero in `dayRealisedPnl` would tell the day-loss
  limit that nothing has been lost today.

## 10. Next

1. Deploy. Observe one full session. The smoke suite runs first, every time.
2. One week of live operation with the chokepoint in place.
3. Re-run the audit and publish the score again.
4. Only then, Phase 3 — and per 3.4, extraction begins with order handling, not
   with the reporting surfaces that would show more visible progress.
