# TD-1 — `option-analyzer` fallback Greeks use a hardcoded 15% volatility

| | |
|---|---|
| **Raised** | 2026-07-09 (during migration C1c-9) |
| **Status** | **OPEN** — deliberately not fixed in C1c-9 |
| **Severity** | Medium |
| **Location** | [option-analyzer.js:166](../../option-analyzer.js#L166) (inside `calculateGreeks`) |
| **Consumer** | [server.js:2269](../../server.js#L2269) — the fallback Greeks path |

---

## Evidence

```js
calculateGreeks(strike, type, spotPrice, inst = DEFAULT_INST) {
  const timeToExpiry = this.getTimeToExpiry(inst);
  const riskFreeRate = 0.065;   // 6.5% RBI rate
  const volatility = 0.15;      // 15% typical for SENSEX   ← TD-1
  ...
}
```

Every fallback Greek — delta, gamma, theta, vega — is computed at a **fixed 15% implied volatility**, regardless of what the market is actually pricing. This is a volatility product whose fallback analytics ignore volatility.

The irony is that the caller has usually **already solved for the real IV** two lines earlier:

```js
const sig = optionAnalyzer._impliedVol(spot, strike, _bsmT, 0.065, ltp, type);
if (sig > 0.001 && sig < 5) { iv = +(sig * 100).toFixed(2); bsm = optionAnalyzer._rawGreeks(...); }
const fallback = bsm || optionAnalyzer.calculateGreeks(strike, type, spot, inst);   // ← discards `iv`
```

When the broker supplies an IV but no Greeks, `bsm` is `null`, so the fallback runs — and it throws away the broker's own IV in favour of `0.15`.

Asserted, so it cannot regress silently, in `test/option-analyzer.test.js`:

```
✓ DEBT TD-1: fallback greeks always use sigma = 0.15, whatever the live IV (not fixed in C1c-9)
✓ DEBT TD-1 recorded: option-analyzer.js hardcodes `volatility = 0.15` for the fallback greeks
```

## Impact

Vega scales linearly in σ and gamma as `1/σ`. At a true IV of 30% (a stressed BANKNIFTY), a fallback vega computed at 15% is **~2× too small** and the fallback gamma **~2× too large**. The error is unbounded in either direction because it depends entirely on how far the live IV sits from 15%.

Scope is limited: only legs where the broker returns an IV but zero/absent Greeks. The primary path (`_rawGreeks` with the solved `sig`) is unaffected.

## Why it was not fixed in C1c-9

C1c-9 was approved to fix **one root cause** — the wrong time-to-expiry — under the explicit instruction *"Do not fix the hardcoded fallback volatility (0.15) in this commit."* Bundling it would have mixed two independent behaviour changes into one diff, making it impossible to attribute a moved Greek to the right cause.

## Recommended remediation

1. Add a characterization test capturing today's fallback Greeks at σ = 0.15.
2. Change the signature to `calculateGreeks(strike, type, spotPrice, inst, sigma = null)`.
3. When `sigma` is `null`, **refuse** rather than defaulting: return the zeroed `{ unresolved: true }` shape that C1c-9 already introduced for an unresolvable `T`. A Greek computed from an invented volatility is a fabricated number, exactly like one computed from an invented lot size.
4. At `server.js:2269`, pass the IV the caller already has: `optionAnalyzer.calculateGreeks(strike, type, spot, inst, iv > 0 ? iv / 100 : null)`.
5. Consider deleting the fallback entirely — if the broker gives an IV, `_rawGreeks(spot, strike, _bsmT, 0.065, iv/100, type)` is strictly better and already exists.

Step 5 is probably the right answer: the fallback exists only because `bsm` is `null` when `iv > 0`, which is an *ordering* accident, not a requirement.

## Related

- **TD-2** — the shared-singleton race in the same call path.
- `pop-seller.js` had the same class of defect (`realPoP` falls back to `0.14 + moneyness × 0.5` when no IV is available).
- `option-analyzer.js:163` also hardcodes `riskFreeRate = 0.065`, duplicated in `pop-seller.js:52` and `gex-skew.js:18`; `vol-context.js:42` uses `r = 0`.
