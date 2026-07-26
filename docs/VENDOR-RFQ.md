# Vendor RFQ — Historical Data Request (copy-paste ready)

Send the message below to intraday-data vendors (TrueData, Global Datafeeds/GDFL,
iVolatility, Definedge/Opstra, NSE data desk, etc.). Ask 2–3 for quotes and
compare. The two tracks can be quoted separately — buy Track A first if budget is
tight.

---

## Message to paste

Subject: Quote request — historical intraday NIFTY/BANKNIFTY index + options data

Hello,

I'm building a quantitative backtest and need historical intraday data. Please
quote the two items below (separately, so I can choose). For each, share: price,
exact **coverage start date** available, **file format/sample**, delivery method,
and whether **Open Interest, Volume and Implied Volatility** are included.

**TRACK A — Index underlying (1-minute)**
- Instruments: NIFTY 50, NIFTY BANK, SENSEX (spot index)
- Granularity: 1-minute OHLC
- Period: 2013 → present (or earliest you have)
- Fields: datetime (IST), open, high, low, close

**TRACK B — Index OPTIONS intraday (the important one)**
- Instruments: NIFTY & BANKNIFTY options (SENSEX options optional)
- Granularity: 1-minute per contract (tick if available, else 1-minute)
- Strikes: ATM ± 15 strikes, every expiry (weekly + monthly)
- Period: from weekly-options launch (NIFTY ~2019, BANKNIFTY ~2016) → present
- Required fields per row:
  datetime, expiry, strike, option_type (CE/PE),
  open, high, low, close (premium),
  **volume, open_interest** (mandatory),
  **implied_volatility** (or bid & ask so IV can be derived)
- Preferred: aligned underlying spot per timestamp; bid/ask if available
- Format: CSV or Parquet, partitioned by date, with an `instrument` column

Questions:
1. What is the earliest date each track is available?
2. Can you send a small **sample file** (one day) for each track so I can verify
   the schema before purchase?
3. Is OI + IV included for the full options history, or only recent years?
4. One-time historical dump vs subscription — and price for each?

Thank you.

---

## Checklist before you pay (do not skip)

- [ ] Got a **sample file** and confirmed it has: strike, CE/PE, OHLC, **volume**,
      **open_interest**, **IV** (or bid/ask).
- [ ] Confirmed the **start date** actually covers the weekly-options era you want
      (don't pay for "12 years" that is only spot + monthly).
- [ ] Confirmed timestamps are IST and 1-minute (or tick), not just EOD.
- [ ] Sent me the sample file → I verify it loads in `bt-trend-ride.js` before you
      buy the full history. One command:
      `node bt-trend-ride.js --src=purchased --dir=<sample-folder>`

Once the sample verifies, buy the full set, drop it in a folder, and I run the
real net-of-cost backtest.
