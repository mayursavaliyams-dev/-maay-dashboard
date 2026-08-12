# 090 — Screener-style Query Language: Research, then Design

**Researched and measured 2026-08-10.** Every capability claim below has the
command or the source beside it. Where I could not establish something, it says
so rather than guessing.

---

## 1. What Screener.in actually does

**Verified from their own pages:**

- Conditions are joined by the keyword **`AND`**. A published example, verbatim:
  `Market Capitalization > 30000 AND Debt to equity < 0.5 AND Current price > 100`
- Field names are **human-readable, multi-word, case-insensitive in practice** —
  real screens mix `Price to book value`, `Price to Earning`, `sales`,
  `Net profit` in one query.
- Comparison operators `>` and `<` appear throughout. A real published screen:
  `Price to book value < 2 and Price to Earning < 15 and Dividend yield > .1 and
  Debt to equity < 1 and sales > 100 and Net profit > 10`
- **Custom ratios** are a separate feature: a *mathematical formula* over fields,
  with **no inequality** — that is the stated difference from a screen query.
  Their example is "the difference of the current price from its 52-week low".

**NOT established, and I am not going to assume it:**

- Whether `OR` is supported.
- Whether parentheses work, and what the precedence is.
- Whether arithmetic between fields is allowed *inside a screen query* (it is
  clearly allowed inside a custom ratio).
- Whether `>=`, `<=`, `=` exist.

The official guide says only *"Build your own query or set your own criteria as
per your requirements. You can create any equation"* and specifies no grammar.
The custom-ratio help page names no operators at all. Both were fetched; neither
answers the question.

**What that means for us:** their grammar is a floor, not a specification. We do
not have to copy an under-documented language — and copying an unknown is not
possible anyway.

---

## 2. What we can actually screen on — measured, not assumed

This is the part that decides what is buildable, so it was measured before any
design.

### The universe we hold

`data/stock-universe.json` — **5,798 instruments**, fields
`s` (symbol) · `n` (name) · `e` (exchange) · `t` (type) · `f` · `k` (instrument key).

**No prices. No fundamentals.** It is a name-to-key map, nothing more.

### What `yahoo-finance2` returns for an Indian stock

Already a dependency and already used in eight places in `server.js`. Measured
against `RELIANCE.NS`, live:

| Field | Value returned | Source module |
|---|---|---|
| `regularMarketPrice` | 1327.3 | `quote` |
| `marketCap` | 17,961,651,798,016 | `quote` |
| `trailingPE` | 24.019 | `quote` |
| `forwardPE` | 18.559 | `quote` |
| `priceToBook` | 1.987 | `quote` |
| `epsTrailingTwelveMonths` | 55.26 | `quote` |
| `bookValue` | 668.045 | `quote` |
| `fiftyTwoWeekLow` / `High` | 1249.8 / 1611.8 | `quote` |
| `averageDailyVolume3Month` | 14,829,746 | `quote` |
| `debtToEquity` | 36.653 | `financialData` |
| `revenueGrowth` | 0.297 | `financialData` |
| `earningsGrowth` | −0.224 | `financialData` |
| `profitMargins` | 0.0661 | `financialData` |
| `operatingMargins` | 0.1233 | `financialData` |
| `totalRevenue` | 11,296,050,249,728 | `financialData` |
| `totalDebt` | 3,979,999,969,280 | `financialData` |
| `pegRatio` | 0.82 | `defaultKeyStatistics` |
| `enterpriseValue` | 21,280,034,127,872 | `defaultKeyStatistics` |
| `beta` | 0.157 | `summaryDetail` |

`quote` returns **81 fields** in total.

### What Screener has and we do NOT

Measured absent for `RELIANCE.NS`:

- **`returnOnEquity`** — absent
- **`returnOnAssets`** — absent
- **`currentRatio`** — absent

ROE and ROCE are among the most-used ratios on Screener, and **we cannot compute
them from this source.** Nothing in the design below pretends otherwise: a query
naming a field we do not have is a **refusal that names the field**, never a
silent zero and never a silently empty result.

### The technicals we can compute ourselves

`stock-technicals.js` already computes, from bars: `sma`, `ema`, `rsi`, `macd`,
`atr`, `changePct`, `volatility`, `trendFromMAs`, `positionInRange`.

So the honest shape of what we can build is a **technical + market-data screener
with a real fundamental subset** — not a Screener.in clone, because the ratio
coverage is not there.

---

## 3. A units trap found while measuring

`dividendYield` for the same stock, at the same moment:

```
quote.dividendYield          = 0.45
summaryDetail.dividendYield  = 0.0045
```

**A factor of 100.** One is a percentage, the other a fraction.

A screen written as `Dividend yield > 1` means "above 1%" to the person writing
it. Against the first field it returns stocks above 1%; against the second it
returns stocks above 100% and therefore **nothing at all** — an empty result that
looks like a correct answer to a demanding query.

This is why every field in the registry below carries a **declared unit and a
declared source**, and why two fields that differ only in unit may never share a
name.

---

## 4. Where our design departs from Screener, and why

### 4.1 A missing value is UNEVALUABLE, not `false`

This is the important one.

In a conventional screener, a stock whose P/E is unavailable simply does not
appear. The result set silently blends "did not pass the test" with "could not be
tested", and a data outage becomes an ordinary-looking screen result.

Ours reports three sets, never merged:

```
MATCHED      the condition was evaluated and held
REJECTED     the condition was evaluated and did not hold
UNEVALUABLE  a field the query needs is missing for this stock — with the field named
```

If 400 of 500 stocks are UNEVALUABLE because a fetch failed, the screen says so.
That is the same three-valued discipline the order path already uses
(PASS / BLOCKED / UNEVALUABLE, never merged), applied to research.

### 4.2 A full grammar, because it is not harder

`AND` · `OR` · `NOT` · parentheses · arithmetic (`+ - * /`) · comparisons
(`> >= < <= = !=`), with `NOT` > `AND` > `OR` precedence and parentheses to
override.

Screener may or may not support `OR` — unknown, §1. Writing a real recursive
descent parser is a morning's work and removes the question. A string-split on
`" and "` would be less code and would silently mis-parse the first query
containing the word "and" inside a field name.

### 4.3 The query is parsed, never evaluated as code

No `eval`, no `new Function`. A screen query is user input arriving over HTTP; a
grammar that reaches the JavaScript evaluator is a remote code execution hole
wearing a finance costume. The parser produces an AST and the evaluator walks it.

### 4.4 Every field declares its provenance

Each registry entry carries where the number came from, its unit, and whether it
is live or as-of. A screen result that cannot say where its numbers came from
cannot be checked later, and an unrepeatable screen is an anecdote.

---

## 5. The grammar

```
query      := orExpr
orExpr     := andExpr ( OR andExpr )*
andExpr    := notExpr ( AND notExpr )*
notExpr    := NOT notExpr | comparison
comparison := arith ( ( '>' | '>=' | '<' | '<=' | '=' | '==' | '!=' ) arith )?
arith      := term ( ('+' | '-') term )*
term       := factor ( ('*' | '/') factor )*
factor     := '-' factor | '(' orExpr ')' | NUMBER | FIELD
FIELD      := one or more words, matched longest-first against the registry
```

`AND` / `OR` / `NOT` are case-insensitive. Field names are matched
**longest-first**, so `Price to book value` wins over `Price`, and a shorter name
can never shadow a longer one that also matches.

---

## 6. What is NOT built yet

- **ROE / ROCE / current ratio** — no source. A query naming them is refused by
  name.
- **Historical / as-of screening.** Every number is "now". "P/E was under 15 last
  March" needs a store we do not have.
- **Sector and industry filters** — the universe file has no sector column.
- **Saved screens and sharing.**
- **Anything that ranks.** This filters. Ranking a filtered set by a formula is a
  separate feature and is not smuggled in here.

---

## Sources

- [Guide to creating screens — Screener](https://www.screener.in/guides/creating-screens/)
- [How to create Custom Ratios in Screener — Screener Knowledge Base](https://support.screener.in/article/32-how-to-create-custom-ratios-in-screener)
- [QUERY — a published Screener screen](https://www.screener.in/screens/131217/query/)
- [Ratios — a published Screener screen](https://www.screener.in/screens/335774/ratios/)
- [Using Screeners — r/IndiaInvestments wiki](https://www.indiainvestments.wiki/stocks/using-screeners)
