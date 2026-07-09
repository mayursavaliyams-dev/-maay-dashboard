# TD-2 — a single shared `OptionAnalyzer` is mutated per request

| | |
|---|---|
| **Raised** | 2026-07-09 (during migration C1c-9) |
| **Status** | **OPEN** — deliberately not fixed in C1c-9 |
| **Severity** | Medium-High (data correctness under concurrency) |
| **Location** | [server.js:198](../../server.js#L198), [server.js:2248-2249](../../server.js#L2248-L2249) |

---

## Evidence

```js
// server.js:198 — ONE instance, for the whole process
const optionAnalyzer = new OptionAnalyzer();

// server.js:2248-2249 — inside async _buildOptionSnapshot(instrument), mutated per request
optionAnalyzer.spotPrice   = spot;
optionAnalyzer.strikePitch = meta.step;
```

`_buildOptionSnapshot` is `async` and awaits `meta.priceGetter()` and `meta.chainGetter(price)` before it reaches these lines, and awaits nothing after them until the Greeks are computed. But the function is invoked concurrently for different instruments (`/api/nifty/options/analytics`, `/api/banknifty/...`, `/api/options/analytics`). Two in-flight requests share one object:

```
request A (NIFTY)    request B (SENSEX)
  await chainGetter
                       await chainGetter
  spotPrice = 24000
  strikePitch = 50
                       spotPrice = 80000     ← clobbers A
                       strikePitch = 100     ← clobbers A
  ... uses spotPrice ...                     ← A now reads SENSEX's spot
```

Node's single-threaded event loop does **not** protect this: the mutation and the read are separated by other `await`s further down the same function, so another request's continuation can run in between.

## Impact

`this.spotPrice` and `this.strikePitch` are read by `generateOptionChain`, `generateOI`, `calculateMaxPain` and the synthetic-chain helpers. A cross-instrument interleave silently produces analytics for one instrument computed against another's spot — a NIFTY chain priced off an 80,000 SENSEX spot.

Mitigating factors, stated honestly rather than as reassurance:
- `_optionSnapshotCache` (server.js:2231) coalesces in-flight requests **per instrument**, so the window is narrow.
- The functions on the hot path (`calculateGreeks`, `_rawGreeks`, `_impliedVol`) take spot as an **argument** and do not read `this.spotPrice`. So today the race corrupts the *simulation* helpers, not the live Greeks.

That second point is precisely why C1c-9 must not make it worse.

## Why C1c-9 did not add `optionAnalyzer.inst`

The obvious fix for the expiry bug was one line:

```js
optionAnalyzer.inst = inst;      // NOT DONE
```

That would have extended this race to the **expiry calendar**, hence to `T`, hence to *every Greek* — moving the race off the simulation helpers and onto the live analytics path. It would have taken a latent bug and made it load-bearing.

C1c-9 therefore threads `inst` as a **function argument**:

```js
calculateGreeks(strike, type, spotPrice, inst = DEFAULT_INST)
getTimeToExpiry(inst = DEFAULT_INST, now = new Date())
```

No new shared state. Asserted by test:

```
✓ C1c-9 (req 2): no OptionAnalyzer.inst was added
✓ C1c-9 (req 1): a fresh instance carries no instrument state either
✓ C1c-9 (req 2): `this.inst =` appears nowhere in the source
```

## Recommended remediation

1. **Preferred:** make `OptionAnalyzer` stateless. Every method already takes `spotPrice`; delete `this.spotPrice` / `this.strikePitch` and pass a pitch argument to the three helpers that need it. Then the singleton is safe by construction.
2. **Cheaper:** construct a fresh `new OptionAnalyzer()` per request in `_buildOptionSnapshot`. The object is tiny; the allocation is irrelevant next to a network round-trip. This is a one-line change and removes the race immediately.
3. **Do not** add locks or request-scoped globals.

Option 2 is the pragmatic first step; option 1 is the correct destination and is a prerequisite for ever running the analytics off the request thread.

## Related

- **TD-1** — the hardcoded 15% fallback volatility, in the same call path.
- This is the same defect class as `position-sizer` P3 (C1c-5): state that should have been a parameter.
