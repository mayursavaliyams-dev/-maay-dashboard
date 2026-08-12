# 067 — Portfolio Risk Layer

**ANTIGRAVITY PRO** · **Date:** 2026-07-30 · **Status:** built, tested, **ON by default**
**Suites:** 74/74 green · **New modules:** `risk-config.js`, `kill-switch.js`,
`risk-manager.js`, `risk-guard.js` · **Tests:** 100 checks

---

## 1. The architectural decision, and why it is the whole design

The requirement is *"no order may reach the broker without passing through it."*

That cannot be delivered by a module engines are supposed to call. **Eight call
sites reach `placeOrder` in this repository today:**

```
afternoon-engine.js:520, :671      execution-engine.js:540, :678
amibroker-bridge.js:623            limit-order-engine.js:386
server.js:1985, :7606
```

A ninth will be added by someone who has not read the risk layer's documentation,
and it will be the one that matters, because nothing announces a missing call.

**So the broker itself is wrapped.** `RiskGuardedBroker.placeOrder` refuses any
order not carrying a valid, unused, unexpired approval issued by the risk manager
for that exact instrument, strike, side and size. The guarantee becomes
structural: to bypass the risk layer you would have to reach past the object every
engine was handed.

This is the same reasoning that produced one `/api` middleware rather than 42
route patches when an endpoint was answering with the wrong instrument.

### The approval is bound, single-use and expiring

| Property | Why |
|---|---|
| **Bound** | An approval for 2 lots of 24300CE cannot send a PE, a different strike, a different instrument, or more lots. A generic "yes" is a key that opens every door once one is open |
| **Single-use** | Replaying an approval would let one risk decision authorise unlimited orders |
| **Expiring** (30 s) | An approval issued against an equity and a book from ten minutes ago is an approval about a different market |
| **Re-checked at send** | The kill switch is consulted again between approval and send — the gap is exactly where a day-loss limit gets crossed |

Constructing a guard **without** a risk manager throws. An object that looks
guarded and is not is worse than no guard at all.

---

## 2. The pre-trade checks

Fourteen checks in seven families, each independently configurable, each able to
block.

| Family | Checks |
|---|---|
| Capital | `maxDeployed`, `maxDeployedPerUnderlying` |
| Position counts | `maxOpenPositions`, `maxLotsPerInstrument` |
| Portfolio greeks | `netDelta`, `netGamma`, `netVega`, `netTheta` — **with a separate, tighter set on expiry day** |
| Day stops | `dayLossLimit` (realised), `dayTrailingDrawdown` (from the day's peak) |
| Concentration | `concentrationByExpiry`, `concentrationByStrike` |
| Expiry timing | `expiryNoNewEntry` |
| Data | `dataFreshness` |
| Plus | `killSwitch`, and `sizing` as a blocking check in its own right |

### Greek limits are normalised per ₹1 lakh

An absolute limit would have to be rewritten every time the capital changed, and
would not be. `RISK_MAX_NET_GAMMA_PER_LAKH: 8` means the same thing at ₹1 lakh
and at ₹7 lakh.

### Expiry day is a different rule set, and that is the point

| Limit | Normal | Expiry day |
|---|---|---|
| Net delta / lakh | 150 | **60** |
| **Net gamma / lakh** | 8 | **2** |
| Net vega / lakh | 400 | **150** |

Gamma is why this section exists. As time to expiry goes to zero, the gamma of a
near-the-money option goes to infinity in the model and to *enormous* in fact — so
**a position inside its limit yesterday can be far outside it today without a
single trade being placed.**

The test that proves it: gamma of 20 on ₹7 lakh equity is 2.86 per lakh. It passes
on a normal day (limit 8) and **blocks on expiry day** (limit 2). A value inside
both limits would have proved nothing, which is what the first version of that
test did.

---

## 3. Fail closed — three outcomes, not two

Every check returns **PASS**, **BLOCKED**, or **UNEVALUABLE**, and the third is
the one that decides whether the layer works.

> A limit that cannot be measured blocks. If it passed, the layer's own blind
> spots would be the widest hole in it — and they would be invisible precisely
> because nothing could see them.

Eight unevaluable conditions are individually tested: unknown equity, absent
greeks, **one** absent greek, an unreadable position count, unknown start-of-day
equity, unknown day peak, unknown risk-by-expiry, unknown data age.

`UNEVALUABLE` is never merged into `BLOCKED`. *"We could not measure it"* and
*"it is too big"* are different facts and need different responses.

`RISK_FAIL_MODE: 'WARN'` exists for a deliberate, temporary, logged decision. It
is not the default.

---

## 4. Sizing from risk, not from capital

```
riskBudget = equity × RISK_PER_TRADE_RISK_PCT / 100
lossPerLot = stopDistance × lotSize
lots       = floor(riskBudget / lossPerLot)
```

Sizing from capital asks *"how much can I afford to buy"*, and the answer is the
same whether the stop is two rupees away or forty. Sizing from risk fixes what is
lost if the stop is hit, and derives the quantity.

**Measured in the tests:** a 20-point stop gives 5 lots, a 40-point stop gives 2 —
and both risk within one lot's worth of the same budget.

### Kelly is a ceiling that only ever lowers the size

| Case | Result |
|---|---|
| Kelly proposes more than the hard budget | **Capped at the budget**, and the record says it was capped |
| Kelly proposes less | The smaller number wins |
| **Kelly edge is negative** | **Size zero.** Not a small positive number — that is how a losing strategy keeps trading |

Four refusals rather than guesses: no stop distance (`STOP_UNDEFINED`), unknown
lot size (`LOT_SIZE_UNKNOWN` — a guessed lot is a fabricated rupee figure), a
negative edge, and a budget too small for one lot (**refused, not rounded up**).

---

## 5. The kill switch

**Five triggers:** day loss limit · consecutive losses · broker API error rate
over a trailing window · data staleness · a human.

**Two actions:** `STOP_ENTRIES` (default) or `FLATTEN`. Flatten is *not* the
default — forcing exits into the same disordered market that tripped the switch is
itself a risk, and it should be a decision rather than a surprise.

### The properties that make it a kill switch rather than a pause

| Property | Behaviour |
|---|---|
| **Sticky across restarts** | State on disk, read at construction. The most likely thing after a system trips on a bad day is that someone restarts it |
| **Corrupt state reads as TRIPPED** | Recovers from safe-write's backup first; only when both copies are unreadable does it fail closed. A crash must not silently clear the switch |
| **First reason wins** | A later symptom does not overwrite the original cause — that is the only account of what happened |
| **Reset needs a named human** | `reset({ by: '' })` is refused. There is no automatic path back and no timer |
| **Trips when it cannot tell** | A missing day-P&L trips `UNEVALUABLE`. "We cannot tell whether we are down 3%" is not a safe state to keep trading in |
| **Full window before judging** | One failed call out of one is a 100% error rate; requiring a full window stops it tripping on the first hiccup of the morning |

---

## 6. Configuration

**30 limits.** Precedence: `config-overrides.json` → `process.env` → documented
defaults.

**Reloadable without restart — and never silently.** Every reload diffs old
against new and logs each change by name, old value, new value and who did it, at
**warning** level whichever direction it moved. *A risk limit that changed and
nobody noticed is the same as no limit.*

**A limit that will not parse is refused and reported.** `NaN` compares false
against everything, so a mistyped threshold does not merely fail to bind — **it
disables the check it belongs to and every order passes.**

`RISK_ENABLED` defaults to **true**. It is the only flag in this codebase that
defaults to enabled, because a risk layer that has to be switched on is a risk
layer that will be off on the day it was needed.

---

## 7. Acceptance: the replay of two real crash days

`npm run replay:badday` — days chosen from **812 real daily bars**
(2023-03-08 → 2026-06-18), not invented.

### 2025-04-07 — gap −5.00% at the open

```
when           price     move   mod.P&L   γ/lakh   new entries   blocked by
09:15 open   21758.4      -5%    -14.9%    74.46   BLOCKED   killSwitch, netDelta, netGamma,
                                                             dayLossLimit, dayTrailingDrawdown
extreme     21743.65   -5.07%   -15.18%    77.60   BLOCKED   (same)
close        22161.6   -3.24%    -7.42%    24.05   BLOCKED   + netVega
```
**First block: 09:15. Kill switch: tripped at 09:15.** Nothing could be opened all day.

### 2024-06-04 — election day, 8.16% range, closed −5.93%

```
when           price     move   mod.P&L   γ/lakh   new entries   blocked by
09:15 open   23179.5   -0.36%       0%      3.79   ALLOWED   —
extreme     21281.45   -8.52%   -30.34%   712.10   BLOCKED   killSwitch, maxDeployed, netDelta,
                                                             netGamma, dayLossLimit, trailing DD
close        21884.5   -5.93%   -19.14%   134.88   BLOCKED   (same)
```

### The finding — and it is the one worth keeping

**The two days behave completely differently, and the difference is the honest
limit of what a pre-trade layer can do.**

- On the **gap day**, the damage is visible at 09:15. Every limit fires before a
  single order can be placed. The layer prevents the day.
- On **election day**, the open was −0.36% and **nothing was wrong**. The layer
  correctly allowed entries, then blocked everything once the collapse began.

> **A pre-trade risk layer cannot prevent losses on a position that was already
> open when the market broke.** It stops the second, third and fourth trades — it
> does not stop the first. On 2024-06-04 that distinction is the entire outcome,
> and any report claiming the layer "would have prevented" that day would be
> false.

### What the replay does not claim

The rupee figures are **modelled**, and from a formula anyone can check:

```
breach = |move| − 1.5%          (strikes at 1.5% OTM)
points = breach × prevClose / 100
loss   = points × 2 lots × 65
```

Premium received (reduces it) and vol expansion (increases it, usually by more)
are **both excluded rather than netted**, because one "adjusted" figure would hide
two assumptions inside one number.

**An earlier version of this script used `0.9 × (move%)²` and reported −65% on the
8.5% day.** The magnitude was not absurd; the coefficient was invented. It was
replaced, because the script's own header warns against exactly that — a
confident, well-formatted, unfalsifiable figure.

**The option chains for these dates were never stored**, so no measured book
exists for them. The deliverable is *which limits fire and when*, not a
saved-money number.

---

## 8. Every block, size reduction and kill event is logged

With: which limit · the observed value · the threshold · the strategy ·
instrument · strike · side · timestamp.

Three separate records: `riskManager.auditTrail()` (blocks and size reductions),
`killSwitch.status().history` (trips and resets), `data/risk-config-changes.json`
(limit changes).

A **size reduction** is its own event. An order approved for 2 lots when 5 were
requested is a risk decision, and it is invisible if only blocks are recorded.

---

## 9. What is deliberately not done

| Not done | Why |
|---|---|
| No automatic kill-switch reset | Any timer that clears it makes it a pause |
| `FLATTEN` is not the default | Forcing exits into a disordered market is itself a risk |
| Blocks are not aggregated into a score | "Risk score 82" cannot be acted on; "netGamma 4.1 vs limit 2 on expiry day" can |
| No estimate of the loss the layer "saved" | It depends on positions and chains that were never stored (§7) |

---

## 10. Verification

| Check | Result |
|---|---|
| `test/risk-layer.test.js` | **100 checks** |
| Every limit fired individually | 13 limits, each blocking on its own, each carrying observed value and threshold |
| Fail-closed cases | 8 unevaluable conditions, each blocking and each marked `UNEVALUABLE` |
| Chokepoint | no approval, forged, reused, stale, mismatched instrument / strike / side / size — all refused; reads pass through |
| Kill switch | trips on all five triggers; survives restart; corrupt state reads tripped; reset needs a named human |
| Replay | two real crash days, 812-bar history |
| Full suite | **74/74 green** |
| Ratchets | three fired during this work and all three were fixed rather than moved: a silent catch, two raw `writeFileSync`, four unvalidated JSON reads |

### The ratchets are worth noting

`kill-switch.js` and `risk-config.js` were writing with raw `writeFileSync`. **The
kill-switch state is precisely the file that must never be found half-written**,
so both now use safe-write's atomic path, and reads go through `readJsonSync` —
which recovers from its own backup before failing, and refuses to guess when both
copies are gone.

---

## Summary

Fourteen checks in seven families, all configurable, all able to block, all
fail-closed. Sizing from a risk budget with Kelly as a ceiling that only ever
lowers it. A sticky kill switch that survives restarts and needs a human to clear.
Every limit change logged by name.

Two things I would want said back before this is relied on:

1. **The guarantee is structural, not procedural.** The broker is wrapped, so a
   ninth `placeOrder` call site added next month is covered without being edited.
   That is the only version of "no order bypasses the risk layer" that stays true.

2. **The replay shows what a pre-trade layer cannot do.** On a −5% gap it stops
   everything before the open. On election day it correctly allowed the 09:15
   entry, because at 09:15 nothing was wrong — and then blocked everything as the
   market collapsed. It limits the damage; it does not prevent the position that
   was already on. Any claim otherwise would be a claim this replay contradicts.
