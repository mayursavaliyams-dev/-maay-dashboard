# India Stock Master — full reference

> **What this file is.** The complete text of `india_stock_master_report.pdf`, written out in
> Markdown so an agent working in this repository can read it without opening a PDF. It
> documents every one of the 72 columns in `india_stock_master.csv`, where each column
> comes from, how often it changes, and how it can mislead you.
>
> **How to use it in VS Code.** Keep this file next to the data in `market-data/`. Add the line
> below to `CLAUDE.md` so every session picks it up:
>
> ```
> - `market-data/REFERENCE_STOCK_MASTER.md` — the 72 columns of the national security
>   master: meaning, source, update frequency and the traps. Read before touching any column.
> ```
>
> **Standing rule for anyone using this data.** Every figure below is a snapshot of one
> afternoon — **2026-08-11**. Applying it to an earlier date in a backtest is
> look-ahead bias. Where a column is blank, it is blank because the source is silent; do not
> fill it with a plausible value.

---

## 1 · What the dataset is

5,658 securities × 72 columns, one row per **ISIN**, built on
2026-08-11 from official NSE archives and BSE APIs only. No third-party site was
scraped. A company listed on both exchanges appears once, with both exchanges' data joined on
its ISIN.

| Segment | Securities |
|---|---|
| BSE Equity | 2,698 |
| NSE Mainboard | 2,401 |
| NSE SME (Emerge) | 559 |
| **Total** | **5,658** |

| Listing | Count | What it means for you |
|---|---|---|
| NSE + BSE | 2,271 | Price, volume and fundamentals available from both exchanges |
| NSE only | 689 | Mostly SME (Emerge) scrips |
| BSE only | 2,698 | Small and inactive scrips; no NSE delivery data |

Total market capitalisation across the file: **₹492 lakh crore**.
208 stocks are F&O eligible. 264 are under some surveillance measure.

---

## 2 · Market structure — the fields that decide your universe

Two equity exchanges — **NSE** and **BSE** — each with a mainboard and an SME platform
(NSE Emerge, BSE SME). SEBI regulates, NSDL and CDSL hold the demat, NSE Clearing and Indian
Clearing Corporation settle.

### NSE series

| Series | Meaning | Intraday? | For a trading universe |
|---|---|---|---|
| `EQ` | Normal rolling settlement — the main series | Yes | Include |
| `BE` | Trade-to-trade — compulsory delivery | No | Exclude from intraday strategies |
| `BZ` | Trade-to-trade plus non-compliance / surveillance | No | Exclude entirely |
| `SM` / `ST` | SME Emerge segment | Limited | Lot-based, thin liquidity |
| `SZ` | Suspended SME | No | Exclude |
| `GB` / `GS` | Sovereign gold bond / government security | No | Not equity — keep separate |

### BSE groups

| Group | Meaning | For a trading universe |
|---|---|---|
| `A` | Most liquid, rolling settlement | Safe |
| `B` | Normal rolling settlement | Check liquidity first |
| `T` / `XT` | Trade-to-trade | Not for intraday |
| `M` / `MT` | SME platform | Lot-based |
| `Z` | Not complying with listing conditions | Exclude |
| `R` | Rights entitlement — a temporary security, not a share | Exclude |

---

## 3 · ISIN — the primary key, explained

**ISIN** (International Securities Identification Number) is a twelve-character code under
ISO 6166, allotted in India by NSDL. It is the only identifier that is independent of the
exchange, which is why it is the key of this dataset.

### Structure — `INE002A01018` (Reliance Industries)

| `IN` | `E` | `002A` | `01` | `01` | `8` |
|---|---|---|---|---|---|
| Country (India) | Issuer type | Issuer code (the company) | Issue type | Serial | Check digit |

### Third character — measured on this dataset, not quoted from a blog

| Prefix | Meaning | Count in this data | Example |
|---|---|---|---|
| `INE` | Company or PSU equity and debt | 4,702 BSE + 2,399 NSE | `INE002A01018` |
| `INF` | Mutual fund and ETF units | 257 | `INF204KB14I2` (NIFTYBEES) |
| `IN9` | Overflow, used when the INE issuer-code space is exhausted | 10 | — |
| `IN0` | Government securities, SGB, state loans | not in the equity master | `IN0020200104` (SGB) |

### Issue type — characters 8–9

| Code | Meaning | Count | Example |
|---|---|---|---|
| `01` | Fully paid equity share | 100% of NSE mainboard (2,401 of 2,401) | `INE002A01018` |
| `20` | Rights Entitlement — temporary | 3 | `INE680A20011` |
| `A1` `B1` `C1` `1A` | ETF / MF unit sub-schemes, always with an INF prefix | 140 | `INF789F1AZC0` |

**The equity filter that works:** `isin.startswith("INE")` and `isin[7:9] == "01"`. True for all
2,401 NSE mainboard stocks, and it excludes ETFs, rights entitlements and government securities
automatically.

### Check digit

The last character is a **Luhn (mod-10)** check digit. Convert each letter to a number
(A=10 … Z=35), then double every second digit from the right, subtracting 9 where the double
exceeds 9; the total must be divisible by 10.

```python
def isin_valid(x: str) -> bool:
    d = "".join(str(int(c, 36)) if c.isalpha() else c for c in x)
    total, dbl = 0, False
    for ch in reversed(d):
        v = int(ch)
        if dbl:
            v = v * 2 - 9 if v * 2 > 9 else v * 2
        total += v
        dbl = not dbl
    return total % 10 == 0
```

`INE002A01018` → `1823140021001018` → sum mod 10 = 0 → valid. All 5,658 ISINs in this
file pass.

**Why never the symbol.** A rename changes the NSE symbol; a BSE scrip code can be reused. An
ISIN changes only when the security itself changes, such as a face-value split. Joining
historical data on a symbol produces silently wrong results.

---

## 4 · Data dictionary — all 72 columns

"Filled" is the number of the 5,658 rows that carry a value.

### Identity

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `isin` | 5,658 | ISO 6166 twelve-character security identifier | NSE EQUITY_L + BSE ListofScripData | Daily | The primary key. The only join that survives a symbol change or a scrip-code reuse. |
| `isin_valid` | 5,658 | Whether the ISIN passes the Luhn mod-10 check digit | Computed | — | True for every row in this file; a False would mean a corrupt source value. |
| `nse_symbol` | 2,960 | NSE trading symbol | NSE EQUITY_L / SME_EQUITY_L | Daily | Changes on rename or merger. Blank for the 2,698 BSE-only scrips. |
| `bse_code` | 4,969 | BSE six-digit scrip code | BSE ListofScripData | Daily | A string, not a number. Casting to int destroys leading zeros. |
| `bse_ticker` | 4,969 | BSE scrip id (short name) | BSE ListofScripData | Daily | Often differs from the NSE symbol for the same company. |
| `company_name` | 5,658 | Company name, NSE spelling preferred | NSE + BSE | Daily | NSE and BSE spell the same company differently. Never join on this. |
| `listed_on` | 5,658 | NSE+BSE / NSE only / BSE only | Computed | — | Tells you which exchange the liquidity columns came from. |
| `segment` | 5,658 | NSE Mainboard / NSE SME (Emerge) / BSE Equity | Computed | — | SME scrips trade in lots and are thinly traded — different rules apply. |

### Contract

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `nse_series` | 2,960 | NSE settlement series: EQ BE BZ SM ST SZ | NSE | Daily | BE and BZ are trade-to-trade — no intraday. SZ appears once and is a suspended series. |
| `bse_group` | 4,969 | BSE group: A B T X XT M MT Z R | BSE | Daily | T and Z are trade-to-trade or non-compliant. R is a rights entitlement, not a share. |
| `bse_status` | 4,969 | Active / Suspended / Delisted | BSE | Daily | Every row in this file is Active — the source was queried with status=Active. |
| `settlement_type` | 4,955 | T+1 or T+0 settlement cycle | BSE ComHeader | Daily | T+0 is an optional segment available on a limited list of scrips. |
| `nse_listing_date` | 2,960 | Date of listing on NSE | NSE | Static | Two formats in the file: 06-OCT-2008 (mainboard) and 09-Apr-21 (SME). Use it to avoid survivorship bias. |
| `face_value` | 2,960 | Face value per share in rupees | NSE | On corporate action | Changes on a split — a signal that historical prices need adjusting. |
| `paid_up_value` | 2,960 | Paid-up value per share in rupees | NSE | On corporate action | Lower than face value on partly paid shares. |
| `nse_market_lot` | 2,401 | Cash-segment market lot | NSE | Static | Almost always 1 on the mainboard. Blank for BSE-only scrips. |

### Classification

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `macro_sector` | 4,701 | BSE's macro sector | BSE ComHeader | Quarterly | Uses BSE's vocabulary, not NSE's. 'Fast Moving Consumer Goods' has no NSE equivalent. |
| `sector` | 4,701 | BSE's sector (second level) | BSE ComHeader | Quarterly | The main classification field — best coverage of the four levels. |
| `industry` | 4,701 | BSE's industry group (third level) | BSE ComHeader | Quarterly | Use for sector-neutral screens. |
| `basic_industry` | 4,701 | BSE's basic industry (finest level) | BSE ComHeader | Quarterly | The right level for pair trading — finer than sector. |
| `nse_industry` | 750 | NSE's own industry classification | Nifty index constituent lists | On rebalance | Only available for index members — blank for 86% of rows. Supplementary, not primary. |
| `bse_industry_legacy` | 4,955 | BSE's older single-line industry label | BSE ComHeader | Quarterly | Superseded by the four-level fields above. Kept for cross-checking only. |
| `in_nifty50` | 5,658 | Nifty 50 constituent flag (Y/N) | NSE ind_nifty50list.csv | On rebalance | Re-download after the March and September rebalances or this goes stale. |
| `in_niftybank` | 5,658 | Nifty Bank constituent flag (Y/N) | NSE ind_niftybanklist.csv | On rebalance | Currently 14 constituents, not the 12 many references still quote. |
| `in_nifty500` | 5,658 | Nifty 500 constituent flag (Y/N) | NSE ind_nifty500list.csv | On rebalance | The usual definition of the investable universe. |
| `in_niftytotalmarket` | 5,658 | Nifty Total Market constituent flag (Y/N) | NSE ind_niftytotalmarket_list.csv | On rebalance | The widest NSE index universe — 750 names. |
| `bse_index` | 1,731 | Main BSE index membership | BSE ComHeader | On rebalance | Reports one index only, not every index the scrip belongs to. |

### Size & price

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `close_price` | 5,468 | Closing price on trade_date, in rupees | NSE PR mcap file, else BSE bhavcopy | Daily | A snapshot. Meaningless without trade_date beside it. |
| `shares_outstanding` | 2,958 | Total listed shares (issue size) | NSE PR mcap file | Daily | Full issue size, not free float. NSE-sourced, so blank for BSE-only scrips. |
| `mcap_cr` | 5,396 | Full market capitalisation in rupees crore | NSE PR mcap file, else BSE | Daily | In CRORE. Index weights need free-float market cap, which this is not. |
| `mcap_rank` | 5,396 | Rank by full market cap, 1 = largest | Computed | Daily | A one-day snapshot rank, not the six-month average SEBI uses. |
| `sebi_mcap_class` | 5,396 | Large Cap (top 100) / Mid Cap (101-250) / Small Cap | Computed | Daily | SEBI's rule uses six-month average market cap. This is indicative only. |
| `high_52w` | 5,466 | 52-week high in rupees | BSE (adjusted), else NSE pd file | Daily | Check high_52w_src before trusting it. |
| `low_52w` | 5,486 | 52-week low in rupees | BSE (adjusted), else NSE pd file | Daily | Same caveat as high_52w. |
| `high_52w_src` | 5,466 | "BSE adj" or "NSE unadj" — where the 52-week values came from | Computed | — | "NSE unadj" means the range is NOT adjusted for bonus or split. 583 rows. |
| `corp_action_suspect` | 5,658 | Flag where price and 52-week range disagree sharply | Computed | — | Y means a bonus/split, or a genuine multi-bagger rally. Check by hand before acting on it. |
| `pct_below_52w_high` | 5,346 | Percent below the 52-week high (negative = below) | Computed | Daily | Breakout screens use this. Combine with corp_action_suspect == N. |
| `pct_above_52w_low` | 5,346 | Percent above the 52-week low | Computed | Daily | Measures recovery from the drawdown low. |

### Liquidity

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `liquidity_source` | 5,457 | Whether the 22-day columns are NSE or BSE figures | Computed | — | NSE and BSE volumes are not comparable. Never rank across the two sources. |
| `days_traded_22d` | 5,457 | Days actually traded out of the 22 sampled | bhavcopy | Daily | Below 20 is illiquid. This is the cheapest universe filter there is. |
| `avg_volume_22d` | 5,457 | Mean daily quantity traded | bhavcopy | Daily | One block deal inflates it. Compare against the median before believing it. |
| `median_volume_22d` | 2,947 | Median daily quantity traded | NSE bhavcopy | Daily | More robust than the mean. NSE only — blank for BSE-only scrips. |
| `avg_turnover_cr_22d` | 5,457 | Mean daily turnover in rupees crore | bhavcopy | Daily | The most direct input to position sizing. |
| `avg_trades_22d` | 5,457 | Mean daily number of trades | bhavcopy | Daily | High volume with few trades means block-deal driven — useless for intraday. |
| `avg_delivery_pct_22d` | 2,715 | Mean delivery percentage | NSE sec_bhavdata_full | Daily | NSE publishes this, BSE does not. High = investor-driven, low = speculative. |
| `avg_daily_range_pct_22d` | 5,457 | Mean (High − Low) ÷ Close, in percent | Computed | Daily | Sets a realistic stop-loss width and shows the intraday opportunity. |
| `daily_vol_pct_22d` | 5,398 | Standard deviation of daily returns, in percent | Computed | Daily | Only 22 samples. Fine for ranking, not for pricing. |
| `ann_volatility_pct` | 5,398 | Annualised volatility = daily × √252, in percent | Computed | Daily | NOT an option-pricing input. The sample is far too short. |

### Derivatives

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `fo_eligible` | 5,658 | Y if the stock trades in the F&O segment | NSE fo_mktlots.csv | Monthly | The list changes as SEBI's entry and exit criteria bite. |
| `lot_size_current` | 208 | Lot size for the nearest expiry | NSE fo_mktlots.csv | Monthly | THIS MONTH'S lot. Applying it to a past contract corrupts every lot count. |
| `lot_size_next` | 207 | Lot size for the following expiry | NSE fo_mktlots.csv | Monthly | Differs from lot_size_current during a revision — that difference is the warning. |
| `lot_notional_rs` | 208 | lot_size_current × close_price, in rupees | Computed | Daily | Not margin. SPAN + Exposure is typically 15–25% of this and moves with volatility. |
| `fo_max_expiry_months` | 208 | How many future expiries have a published lot | Computed | Monthly | Long for indices (LEAPS), normally 3 for stocks. |
| `fo_underlying_name` | 208 | Underlying name exactly as NSE prints it | NSE fo_mktlots.csv | Monthly | Does not match company_name character for character. |
| `fo_ban_today` | 5,658 | Y if the stock is in the F&O ban period today | NSE fo_secban.csv | Daily | Changes daily. During a ban you may only reduce, never open. |

### Fundamentals

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `eps_standalone` | 4,427 | Standalone earnings per share, rupees | BSE ComHeader | Quarterly | Wrong picture for a holding company — use the consolidated figure there. |
| `eps_consolidated` | 4,445 | Consolidated earnings per share, rupees | BSE ComHeader | Quarterly | The correct figure whenever the company has subsidiaries. |
| `ceps` | 4,386 | Cash EPS = EPS + depreciation per share | BSE ComHeader | Quarterly | More informative than EPS in capital-intensive industries. |
| `pe_standalone` | 4,413 | Price ÷ standalone EPS | BSE ComHeader | Daily price, quarterly earnings | Negative for loss-making companies. Always filter to > 0 before ranking. |
| `pe_consolidated` | 4,445 | Price ÷ consolidated EPS | BSE ComHeader | Daily price, quarterly earnings | Can differ hugely from the standalone figure — Reliance is 20.4 vs 45.8. |
| `pb` | 3,918 | Price to book ratio | BSE ComHeader | Quarterly | Meaningful for banks and NBFCs, much less so for asset-light businesses. |
| `book_value_ps` | 3,541 | Book value per share = close_price ÷ pb | Computed | Quarterly | Derived — blank wherever pb is blank. |
| `earnings_yield_pct` | 3,493 | Earnings yield = 100 ÷ P/E | Computed | Daily | Directly comparable against a bond yield. |
| `roe_pct` | 3,951 | Return on equity, percent | BSE ComHeader | Quarterly | Uses BSE's own TTM convention — will not tie exactly to another provider. |
| `opm_pct` | 3,300 | Operating profit margin, percent | BSE ComHeader | Quarterly | Same convention caveat. |
| `npm_pct` | 3,340 | Net profit margin, percent | BSE ComHeader | Quarterly | Same convention caveat. |

### Surveillance

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `asm_stage` | 197 | ASM stage — LT-ASM Stage I..IV or ST-ASM | NSE api/reportASM | Daily | ASM brings 100% margin and often a 5% price band. |
| `gsm_stage` | 67 | GSM stage, 0 to LXII | NSE api/reportGSM | Daily | At higher stages the scrip trades once a week. Exclude these outright. |
| `surveillance_flag` | 5,658 | Y if any ASM or GSM measure applies | Computed | Daily | The cheapest safety check before opening a position. Refresh it every morning. |

### Meta

| Column | Filled | Meaning | Source | Updates | Watch out for |
|---|---|---|---|---|---|
| `trade_date` | 5,658 | The trading day every price-derived column is true of | Computed | — | Fixed at 2026-08-11 for the whole file. Never treat these figures as current. |
| `bse_url` | 4,966 | BSE quote page link | BSE | Static | For manual verification of any row you do not trust. |
| `mcap_category_nse` | 2,958 | NSE's listing category for the scrip | NSE PR mcap file | Daily | A listing status such as "Listed" — not a size class. Do not confuse with sebi_mcap_class. |

---

## 5 · Source catalogue

Every source is an official exchange endpoint. This list is enough to rebuild the whole file.

| Exchange | Dataset | Endpoint | Format | Frequency | Records |
|---|---|---|---|---|---|
| NSE | Equity master | `nsearchives.nseindia.com/content/equities/EQUITY_L.csv` | CSV | Daily | 2,401 |
| NSE | SME (Emerge) master | `nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv` | CSV | Daily | 559 |
| BSE | Scrip master | `api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?segment=Equity&status=Active` | JSON | Daily | 4,971 |
| BSE | Company header | `api.bseindia.com/BseIndiaAPI/api/ComHeadernew/w?quotetype=EQ&scripcode={code}` | JSON per scrip | Daily | 4,960 |
| BSE | 52-week high/low, adjusted | `api.bseindia.com/BseIndiaAPI/api/HighLow/w?Type=EQ&flag=C&scripcode={code}` | JSON per scrip | Daily | 4,951 |
| NSE | Security-wise bhavcopy | `nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` | CSV × 22 days | Daily | ~3,300/day |
| BSE | UDiFF bhavcopy | `bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_YYYYMMDD_F_0000.CSV` | CSV × 22 days | Daily | ~4,300/day |
| NSE | PR archive (mcap, pd, sme) | `nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PRDDMMYY.zip` | ZIP | Daily | 2,992 / 3,637 |
| NSE | F&O lot sizes | `nsearchives.nseindia.com/content/fo/fo_mktlots.csv` | CSV | Monthly | 215 |
| NSE | F&O ban list | `nsearchives.nseindia.com/content/fo/fo_secban.csv` | CSV | Daily | varies |
| NSE | ASM surveillance | `nseindia.com/api/reportASM` | JSON | Daily | 198 |
| NSE | GSM surveillance | `nseindia.com/api/reportGSM` | JSON | Daily | 82 |
| NSE | Index constituents | `nsearchives.nseindia.com/content/indices/ind_*list.csv` | CSV | On rebalance | 50 / 14 / 500 / 750 |

**Refresh order.** Daily files (bhavcopy, ban list, ASM/GSM) after about 18:30 IST. Lot sizes in
the first week of the month. Index lists after the March and September rebalances. The BSE
per-scrip APIs monthly — the fundamentals behind them only change quarterly.

**One practical note:** the BSE per-scrip APIs throttle above roughly 8 concurrent connections.
Eight threads sustains about 5 requests a second; 24 threads stalls completely.

---

## 6 · Data quality

### Coverage of the fields that matter

| Parameter | Column | Filled | Coverage | Blank |
|---|---|---|---|---|
| ISIN | `isin` | 5,658 | 100.0% | 0 |
| NSE symbol | `nse_symbol` | 2,960 | 52.3% | 2,698 |
| BSE scrip code | `bse_code` | 4,969 | 87.8% | 689 |
| Sector | `sector` | 4,701 | 83.1% | 957 |
| Close price | `close_price` | 5,468 | 96.6% | 190 |
| Market cap | `mcap_cr` | 5,396 | 95.4% | 262 |
| Shares outstanding | `shares_outstanding` | 2,958 | 52.3% | 2,700 |
| 52-week high/low | `high_52w` | 5,466 | 96.6% | 192 |
| 22-day liquidity | `avg_volume_22d` | 5,457 | 96.4% | 201 |
| Delivery % | `avg_delivery_pct_22d` | 2,715 | 48.0% | 2,943 |
| P/E | `pe_standalone` | 4,413 | 78.0% | 1,245 |
| P/B | `pb` | 3,918 | 69.2% | 1,740 |
| ROE | `roe_pct` | 3,951 | 69.8% | 1,707 |
| F&O lot size | `lot_size_current` | 208 | 3.7% | 5,450 |

### Integrity checks

| Check | Result | Meaning |
|---|---|---|
| ISIN check digit | 5,658 of 5,658 valid | Format and Luhn both pass |
| Duplicate ISIN | 0 | One ISIN, one row |
| Duplicate NSE symbol | 0 | SME to mainboard migrations resolved |
| 52-week values BSE-adjusted | 4,883 | The other 583 come from the unadjusted NSE file |
| Corporate-action suspects | 458 | Bonus/split or a genuine sharp rally — verify by hand |

### Independent verification — recomputed a second way

| What was checked | Method | Result |
|---|---|---|
| ISIN check digit | A second Luhn implementation, separate from the build script | 5,658 / 5,658 pass |
| Market cap | Compared against close_price × shares_outstanding | Max relative error 2.5e-10 |
| Average volume | RELIANCE recomputed from the 22 raw bhavcopy files | 12,045,083 — exact match |
| Index membership | Counted against NSE original lists | Nifty 50 = 50, Bank = 14, 500 = 500 |
| F&O list | Against the 215 symbols in fo_mktlots | 208 stocks + 6 indices + 1 header = 215 |
| Surveillance | Against the 279 flagged ISINs in ASM + GSM | 264 matched; the other 15 are suspended or delisted |
| CSV / XLSX / JSON | Row and column counts across all three files | 5,658 × 72 in all three |

### Columns that are most often blank

| Column | Blank | Why |
|---|---|---|
| `lot_size_next` | 96% | Differs from lot_size_current during a revision — that difference is the warning. |
| `lot_size_current` | 96% | THIS MONTH'S lot. Applying it to a past contract corrupts every lot count. |
| `lot_notional_rs` | 96% | Not margin. SPAN + Exposure is typically 15–25% of this and moves with volatility. |
| `fo_max_expiry_months` | 96% | Long for indices (LEAPS), normally 3 for stocks. |
| `fo_underlying_name` | 96% | Does not match company_name character for character. |
| `nse_industry` | 87% | Only available for index members — blank for 86% of rows. Supplementary, not primary. |
| `nse_market_lot` | 58% | Almost always 1 on the mainboard. Blank for BSE-only scrips. |
| `avg_delivery_pct_22d` | 52% | NSE publishes this, BSE does not. High = investor-driven, low = speculative. |
| `median_volume_22d` | 48% | More robust than the mean. NSE only — blank for BSE-only scrips. |
| `shares_outstanding` | 48% | Full issue size, not free float. NSE-sourced, so blank for BSE-only scrips. |
| `mcap_category_nse` | 48% | A listing status such as "Listed" — not a size class. Do not confuse with sebi_mcap_class. |
| `nse_symbol` | 48% | Changes on rename or merger. Blank for the 2,698 BSE-only scrips. |
| `nse_series` | 48% | BE and BZ are trade-to-trade — no intraday. SZ appears once and is a suspended series. |
| `nse_listing_date` | 48% | Two formats in the file: 06-OCT-2008 (mainboard) and 09-Apr-21 (SME). Use it to avoid survivorship bias. |
| `face_value` | 48% | Changes on a split — a signal that historical prices need adjusting. |
| `paid_up_value` | 48% | Lower than face value on partly paid shares. |

### Three warnings

1. **This is a snapshot, not a series.** Price, market cap and every ratio are true of
   2026-08-11 and false of the next day.
2. **Fundamentals use BSE's own TTM conventions.** They will not tie figure-for-figure with
   another data provider. Do not reconcile them; pick one source and stay with it.
3. **22-day volatility is not an option-pricing input.** The sample is too small. Use it to
   rank and screen, never to price.

---

## 7 · Market picture

### Size classes (indicative, per the SEBI definition)

| Class | Companies | Mcap (₹ lakh cr) | Share | Smallest mcap (₹ cr) | F&O |
|---|---|---|---|---|---|
| Large Cap | 100 | 284.44 | 57.8% | 113,173 | 93 |
| Mid Cap | 150 | 102.30 | 20.8% | 38,118 | 91 |
| Small Cap | 5,146 | 105.25 | 21.4% | 0 | 24 |

### By sector

| Sector | Companies | Mcap (₹ lakh cr) | Share | Median P/E | F&O |
|---|---|---|---|---|---|
| Financial Services | 673 | 116.93 | 23.8% | 14.9 | 52 |
| Capital Goods | 701 | 48.63 | 9.9% | 23.8 | 23 |
| Healthcare | 289 | 36.05 | 7.3% | 28.5 | 16 |
| Automobile and Auto Components | 175 | 36.01 | 7.3% | 24.6 | 15 |
| Oil, Gas & Consumable Fuels | 56 | 33.61 | 6.8% | 13.3 | 9 |
| Information Technology | 247 | 31.08 | 6.3% | 19.9 | 12 |
| Fast Moving Consumer Goods | 363 | 27.27 | 5.5% | 17.4 | 14 |
| Metals & Mining | 89 | 24.72 | 5.0% | 15.7 | 10 |
| Power | 44 | 20.88 | 4.2% | 18.3 | 8 |
| Consumer Services | 216 | 19.26 | 3.9% | 19.0 | 9 |
| Consumer Durables | 232 | 17.09 | 3.5% | 26.6 | 10 |
| Telecommunication | 32 | 16.73 | 3.4% | 17.6 | 3 |
| Chemicals | 285 | 14.47 | 2.9% | 19.1 | 5 |
| Services | 460 | 12.41 | 2.5% | 12.9 | 5 |
| Construction Materials | 62 | 9.94 | 2.0% | 18.3 | 5 |
| Construction | 126 | 9.12 | 1.9% | 17.2 | 3 |
| Realty | 170 | 7.69 | 1.6% | 16.5 | 6 |
| Textiles | 294 | 2.96 | 0.6% | 12.8 | 1 |
| Media, Entertainment & Publication | 98 | 1.32 | 0.3% | 7.9 | 0 |
| Diversified | 14 | 1.09 | 0.2% | 13.8 | 0 |
| Utilities | 17 | 0.34 | 0.1% | 24.0 | 0 |
| Forest Materials | 58 | 0.25 | 0.0% | 12.1 | 0 |

### Top 25 by market capitalisation

| # | Symbol | ISIN | Company | Mcap (₹ lakh cr) | P/E | P/B | F&O |
|---|---|---|---|---|---|---|---|
| 1 | RELIANCE | `INE002A01018` | Reliance Industries Limited | 17.92 | 45.8 | 3.4 | Y |
| 2 | BHARTIARTL | `INE397D01024` | Bharti Airtel Limited | 11.67 | 76.8 | 11.7 | Y |
| 3 | HDFCBANK | `INE040A01034` | HDFC Bank Limited | 11.23 | 14.9 | 2.4 | Y |
| 4 | ICICIBANK | `INE090A01021` | ICICI Bank Limited | 10.26 | 19.6 | 4.0 | Y |
| 5 | SBIN | `INE062A01020` | State Bank of India | 9.84 | 12.2 | 2.4 | Y |
| 6 | TCS | `INE467B01029` | Tata Consultancy Services Limited | 8.85 | 16.9 | 10.2 | Y |
| 7 | BAJFINANCE | `INE296A01032` | Bajaj Finance Limited | 6.81 | 35.7 | 8.6 | Y |
| 8 | LT | `INE018A01030` | Larsen & Toubro Limited | 5.55 | 75.7 | 8.3 | Y |
| 9 | LICI | `INE0J1Y01017` | Life Insurance Corporation Of India | 5.14 | — | — | Y |
| 10 | HINDUNILVR | `INE030A01027` | Hindustan Unilever Limited | 4.85 | 31.6 | 9.6 | Y |
| 11 | INFY | `INE009A01021` | Infosys Limited | 4.83 | 15.7 | 5.8 | Y |
| 12 | SUNPHARMA | `INE044A01036` | Sun Pharmaceutical Industries Limited | 4.66 | 155.1 | 19.7 | Y |
| 13 | TITAN | `INE280A01028` | Titan Company Limited | 4.55 | 85.5 | 30.3 | Y |
| 14 | MARUTI | `INE585B01010` | Maruti Suzuki India Limited | 4.40 | 31.2 | 5.0 | Y |
| 15 | M&M | `INE101A01026` | Mahindra & Mahindra Limited | 4.30 | 26.8 | 7.6 | Y |
| 16 | ADANIPOWER | `INE814H01029` | Adani Power Limited | 4.03 | 33.2 | 9.7 | Y |
| 17 | KOTAKBANK | `INE237A01036` | Kotak Mahindra Bank Limited | 3.91 | 26.3 | 3.5 | Y |
| 18 | ADANIENT | `INE423A01024` | Adani Enterprises Limited | 3.90 | 40.4 | 22.8 | Y |
| 19 | ADANIPORTS | `INE742F01042` | Adani Ports and Special Economic Zone  | 3.84 | 153.9 | 13.1 | Y |
| 20 | AXISBANK | `INE238A01034` | Axis Bank Limited | 3.83 | 14.8 | 2.3 | Y |
| 21 | HCLTECH | `INE860A01027` | HCL Technologies Limited | 3.71 | 31.4 | 10.1 | Y |
| 22 | ITC | `INE154A01025` | ITC Limited | 3.50 | 18.3 | 4.8 | Y |
| 23 | ULTRACEMCO | `INE481G01011` | UltraTech Cement Limited | 3.47 | 46.1 | 5.8 | Y |
| 24 | HAL | `INE066F01020` | Hindustan Aeronautics Limited | 3.28 | 35.8 | 10.7 | Y |
| 25 | NTPC | `INE733E01010` | NTPC Limited | 3.28 | 13.8 | 2.1 | Y |

### Top 15 by 22-day average turnover

| Symbol | Turnover (₹ cr/day) | Volume/day | Delivery % | Ann. vol % | Source |
|---|---|---|---|---|---|
| HDFCBANK | 2,246 | 29,627,827 | 63.4 | 21.8 | NSE |
| KALYANKJIL | 2,129 | 37,720,929 | 15.7 | 52.9 | NSE |
| ICICIBANK | 1,813 | 12,631,850 | 61.8 | 15.6 | NSE |
| INFY | 1,573 | 14,115,774 | 53.0 | 31.8 | NSE |
| RELIANCE | 1,566 | 12,045,083 | 57.0 | 20.6 | NSE |
| SBIN | 1,175 | 11,225,924 | 50.2 | 21.6 | NSE |
| BHARTIARTL | 1,148 | 5,926,444 | 65.4 | 17.4 | NSE |
| INDOMIM | 1,130 | 14,929,731 | 28.4 | 280.7 | NSE |
| BAJFINANCE | 1,090 | 10,094,065 | 61.9 | 41.7 | NSE |
| BSE | 1,087 | 3,025,761 | 38.8 | 30.1 | NSE |
| TCS | 1,035 | 4,486,167 | 47.2 | 36.0 | NSE |
| ETERNAL | 988 | 33,248,423 | 48.0 | 34.9 | NSE |
| AXISBANK | 981 | 7,797,974 | 63.1 | 25.4 | NSE |
| MANIPALHOS | 890 | 13,467,486 | 46.9 | 91.8 | NSE |
| M&M | 834 | 2,531,956 | 57.0 | 25.6 | NSE |

---

## 8 · F&O universe

208 **stocks** trade in derivatives. Six indices also do — `NIFTY`, `BANKNIFTY`,
`FINNIFTY`, `MIDCPNIFTY`, `NIFTYNXT50`, `NIFTYFPI` — and are not counted here because they are
not part of the equity master.

### SEBI entry criteria (effective 30 August 2024)

| Criterion | Threshold | Previously |
|---|---|---|
| Top 500 by average market cap and daily traded value | Six-month average | — |
| MQSOS — median quarter-sigma order size | ₹75 lakh | ₹25 lakh |
| MWPL — market-wide position limit | ₹1,500 crore | ₹500 crore |
| ADDV — average daily delivery value | ₹35 crore | ₹10 crore |

**Exit:** failing any one criterion removes the stock, unless it satisfies the Product Success
Framework — clients of ≥15% of all brokers (minimum 200 brokers), trading on 75% of days,
average daily premium turnover ≥ ₹75 crore, average daily notional open interest ≥ ₹500 crore.
Reviewed on the 15th of each month.

### Twenty largest lot notionals

| Symbol | Lot size | Price ₹ | Lot notional ₹ | Delivery % | Ann. vol % |
|---|---|---|---|---|---|
| LAURUSLABS | 850 | 1,858.00 | 1,579,300 | 49.0 | 29.0 |
| ABCAPITAL | 3,100 | 407.15 | 1,262,165 | 46.4 | 30.1 |
| RBLBANK | 3,175 | 389.70 | 1,237,298 | 49.1 | 23.3 |
| CHOLAFIN | 625 | 1,914.40 | 1,196,500 | 57.0 | 34.2 |
| OFSS | 100 | 11,896.00 | 1,189,600 | 36.9 | 33.0 |
| PAYTM | 725 | 1,593.70 | 1,155,432 | 38.3 | 43.4 |
| POLYCAB | 125 | 9,125.00 | 1,140,625 | 46.6 | 25.9 |
| BOSCHLTD | 25 | 45,185.00 | 1,129,625 | 40.8 | 25.5 |
| ADANIENSOL | 675 | 1,622.00 | 1,094,850 | 36.9 | 20.8 |
| APOLLOHOSP | 125 | 8,750.50 | 1,093,812 | 61.1 | 16.2 |
| MANAPPURAM | 3,000 | 360.00 | 1,080,000 | 39.8 | 29.4 |
| CUMMINSIND | 200 | 5,378.50 | 1,075,700 | 55.8 | 21.0 |
| ZYDUSLIFE | 900 | 1,191.00 | 1,071,900 | 52.8 | 27.5 |
| AUBANK | 1,000 | 1,070.90 | 1,070,900 | 52.5 | 30.4 |
| BIOCON | 2,500 | 426.00 | 1,065,000 | 48.2 | 28.2 |
| BHEL | 2,625 | 403.00 | 1,057,875 | 40.4 | 29.9 |
| MOTHERSON | 6,150 | 169.25 | 1,040,888 | 47.8 | 35.9 |
| MARICO | 1,200 | 855.00 | 1,026,000 | 59.7 | 18.4 |
| BHARATFORG | 500 | 2,051.00 | 1,025,500 | 48.8 | 34.3 |
| NYKAA | 3,125 | 325.00 | 1,015,625 | 58.0 | 21.6 |

Lot notional is **not** margin. Actual SPAN + Exposure margin is typically 15–25% of it and
moves with volatility — take the number from your broker's margin calculator, not from here.

In ban today (2026-08-11 + 1): **SAIL, BANDHANBNK**

---

## 9 · Surveillance — ASM and GSM

The exchanges place scrips showing abnormal price movement under surveillance. The consequences
are concrete: 100% margin, a narrow price band, and at higher GSM stages trading only once a
week. 264 securities are currently under some measure.

| Symbol | Company | ASM | GSM | Size class |
|---|---|---|---|---|
| KALYANKJIL | Kalyan Jewellers India Limited | ST-ASM Stage I |  | Mid Cap |
| AEGISLOG | Aegis Logistics Limited | LT-ASM Stage I |  | Mid Cap |
| CPPLUS | Aditya Infotech Limited | LT-ASM Stage I |  | Mid Cap |
| CUPID | Cupid Limited | LT-ASM Stage I |  | Small Cap |
| HFCL | HFCL Limited | LT-ASM Stage I |  | Small Cap |
| STLTECH | Sterlite Technologies Limited | LT-ASM Stage IV |  | Small Cap |
| WOCKPHARMA | Wockhardt Limited | LT-ASM Stage I |  | Small Cap |
| KIRLOSENG | Kirloskar Oil Engines Limited | LT-ASM Stage I |  | Small Cap |
| ACUTAAS | Acutaas Chemicals Limited | LT-ASM Stage I |  | Small Cap |
| CEMPRO | Cemindia Projects Limited | LT-ASM Stage I |  | Small Cap |
| MTARTECH | Mtar Technologies Limited | LT-ASM Stage IV |  | Small Cap |
| TDPOWERSYS | TD Power Systems Limited | LT-ASM Stage I |  | Small Cap |
| DIACABS | Diamond Power Infrastructure Limited | LT-ASM Stage IV |  | Small Cap |
| OLAELEC | Ola Electric Mobility Limited | LT-ASM Stage I |  | Small Cap |
| ECLERX | eClerx Services Limited | ST-ASM Stage I |  | Small Cap |
| THANGAMAYL | Thangamayil Jewellery Limited | ST-ASM Stage I |  | Small Cap |
| ASTRAMICRO | Astra Microwave Products Limited | LT-ASM Stage I |  | Small Cap |
| AEQUS | Aequs Limited | LT-ASM Stage I |  | Small Cap |
| SHILPAMED | Shilpa Medicare Limited | ST-ASM Stage I |  | Small Cap |
| VISL | Vedanta Iron and Steel Limited | LT-ASM Stage I |  | Small Cap |

The first 20 are shown; filter `surveillance_flag == "Y"` in the CSV for the full list.

**Rule for any automated system:** never open a position on a scrip where
`surveillance_flag == "Y"`. The flag changes daily, so the ASM and GSM feeds must be
re-downloaded every morning.

---

## 10 · Ready-made filters

| Purpose | Condition |
|---|---|
| Tradeable universe | `bse_status == 'Active'` and `surveillance_flag == 'N'` and `nse_series == 'EQ'` and `days_traded_22d >= 20` |
| Liquid universe | `avg_turnover_cr_22d >= 25` and `median_volume_22d >= 100000` and `avg_trades_22d >= 5000` |
| Expiry-day option universe | `fo_eligible == 'Y'` and `fo_ban_today == 'N'`, then bound `lot_notional_rs` to your capital |
| Delivery-based, low speculation | `avg_delivery_pct_22d >= 50` and `ann_volatility_pct <= 35` |
| Breakout screen | `pct_below_52w_high >= -3` and `corp_action_suspect == 'N'` and `high_52w_src == 'BSE adj'` |
| Value screen | `0 < pe_consolidated < 25` and `pb < 3` and `roe_pct > 15` and `sebi_mcap_class != 'Small Cap'` |

| File | Use it for |
|---|---|
| `india_stock_master.csv` | pandas, R, any script — smallest and fastest |
| `india_stock_master.xlsx` | Reading by hand — freeze panes, auto-filter, dictionary and quality sheets |
| `india_stock_master.json` | Node.js or JavaScript — import directly |

---

## 11 · What is missing, and where it actually lives

Deliberately left blank rather than estimated. A wrong fundamental figure quietly pulls the
wrong stocks into a screen.

| Parameter | Status and how to get it |
|---|---|
| Dividend yield | In no free bulk file. Sum the last twelve months of dividends from the corporate-action file `bc*.csv` inside the NSE PR zip and compute it yourself. |
| Promoter holding / shareholding pattern | In quarterly XBRL filings, not in any master file. Pull per scrip from BSE's shareholding-pattern API — about 5,000 calls, once a quarter. |
| Free-float market cap | Available as `MktCapFF` from BSE's `StockTrading` API, per scrip. This is the figure that actually explains index weights. |
| MWPL and position limits | In NSE Clearing's daily `mwpl_cli_DDMMYYYY.xls`. Legacy XLS — needs `xlrd` or LibreOffice to read. |
| Option chain / IV / Greeks | Out of scope for a security master. Build a separate pipeline from NSE's option-chain API or the UDiFF F&O bhavcopy. |
| Historical adjusted price series | Only 22 days here. For a longer series, download the bhavcopy archive day by day and adjust for corporate actions yourself. |
| `Fast Moving Consumer Goods` macro sector | BSE uses this label for 363 rows; NSE's vocabulary calls it `Consumer Staples`. Translate it if you are matching against NSE classifications. |

---

*All data retrieved from official NSE and BSE archives and APIs on 12 August 2026. Trade data
is for 2026-08-11, the last trading day. This document is informational and is
not investment advice.*
