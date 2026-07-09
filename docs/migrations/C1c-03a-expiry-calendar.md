# C1c · Step 3a — the expiry calendar was inverted

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Severity** | **Critical** — corrupted every PoP the module produces |
| **Files changed** | `instrument-registry.js`, `pop-seller.js` (+ both suites) |
| **Backup** | `backups/migration-C1c-3a-expiry-20260709-182306/ROLLBACK.sh` (HEAD `d0558fd`) |
| **Tests** | 27/27 suites · registry 68 → **88** · pop-seller 103 → **104** |

---

## Root cause

```js
const targetDay = (inst === 'SENSEX' || inst === 'BANKEX') ? 2 : 4;   // pop-seller.js:31
```

"NIFTY expires Thursday, SENSEX expires Tuesday." The broker contract master says the **exact opposite**:
NIFTY's expiries fall on **Tuesdays** (2026-07-14, -21, -28); SENSEX's on **Thursdays** (2026-07-09, -16, -23, -30).

Worse, the function assumed a **weekly** expiry for every instrument. BANKNIFTY, FINNIFTY, MIDCPNIFTY and
BANKEX are **MONTHLY-only** post-SEBI, so their DTE was capped at 8 days when the truth is ~19.

`T` feeds Black-Scholes, so this corrupted every delta, every PoP, every premium estimate and every
breakeven the module produced. Understating `T` shrinks `|delta|`, which **inflates** PoP — positions
looked *safer* than they were.

## Measured impact (5% OTM call, IV 14%, replayed at 2026-07-09 09:30 IST)

| Instrument | old T | true T | PoP reported | PoP true | error |
|---|---|---|---|---|---|
| NIFTY | 0.63 d | 5.25 d | 100.0% | 99.8% | −0.2 pts |
| **BANKNIFTY** | 0.63 d | **19.25 d** | **100.0%** | **91.8%** | **−8.2 pts** |
| SENSEX | 5.63 d | 0.50 d | 99.7% | 100.0% | +0.3 pts |

A BANKNIFTY strike advertised at **100% probability of profit** actually carried an **8.2% chance of loss**.

## Fix

The expiry calendar now lives in the **Instrument Registry**, derived from the broker's own expiry lists —
not from folklore. The rule, exactly as the contract master shows it:

- every **NSE** instrument expires on a **Tuesday** (`expiryDow: 2`); every **BSE** instrument on a **Thursday** (`expiryDow: 4`)
- **weekly** instruments take the **next** such weekday; **monthly-only** take the **last** such weekday of the month
- contracts stop trading at **15:30 IST**

New registry API, pure — `now` is injected, so the calendar is deterministic under test:
`expiryDow(inst)` · `nextExpiry(inst, now)` · `timeToExpiryYears(inst, now)`

`pop-seller.daysToExpiry()` is now a one-line delegation. Its hardcoded weekday is gone, honouring
"no market constants outside the registry".

### Verified against the broker, every case including the edges

```
NIFTY      -> 2026-07-14  ok      BANKNIFTY  -> 2026-07-28 (last Tue) ok
SENSEX     -> 2026-07-09  ok      BANKEX     -> 2026-07-30 (last Thu) ok
FINNIFTY   -> 2026-07-28  ok      MIDCPNIFTY -> 2026-07-28            ok

SENSEX    15:29 IST -> 2026-07-09 ; 15:30 IST -> 2026-07-16   (close rollover)
BANKNIFTY 2026-07-28 15:30 IST    -> 2026-08-25               (monthly rollover)
BANKNIFTY 2026-12-29 15:30 IST    -> 2027-01-26               (year boundary)
```

`timeToExpiryYears` floors at half a day so Black-Scholes never sees `T <= 0`.

## Backward compatibility

`server.js` untouched. `daysToExpiry(inst)` keeps its signature and units (years). For a disabled
instrument it returns `null`, and `server.js:4156`'s `+(dte*365).toFixed(1)` yields `0` rather than throwing.

## Still open

**D5** — `bsDelta` returns `±1` whenever `T <= 0`, ignoring moneyness. Not fixed here: different root cause,
own commit (**C1c-3b**). The half-day floor means `scanPoP` never reaches that branch today.

## Rollback

```bash
bash backups/migration-C1c-3a-expiry-20260709-182306/ROLLBACK.sh
```
