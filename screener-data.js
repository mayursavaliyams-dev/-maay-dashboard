/* screener-data — fetch, cache and age the numbers a screen runs on.
   Research: docs/090.

   THE CONSTRAINT THAT SHAPES THIS
     The universe holds 5,798 instruments. Fetching all of them live, per screen,
     is not a design — it is a rate-limit incident. So the numbers are cached on
     disk and a screen runs against the cache.

   WHICH MAKES STALENESS THE CENTRAL PROBLEM
     A cached screen is a screen of the past. That is fine, and it is only fine if
     the result SAYS SO. Every row carries `asOf`, every response carries the
     oldest and newest row in it, and a symbol that has never been fetched is
     reported as never fetched rather than quietly skipped.

     "No results" and "no data" are different answers. A screener that cannot tell
     them apart is a random number generator with a finance vocabulary.

   ON PARTIAL FETCHES
     A fetch of 400 symbols where 40 fail is not a failed fetch and not a clean
     one. `fetchInto` returns both counts and the per-symbol errors, and the
     caller decides. Nothing here treats a failure as an absent stock. */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync } = require('./safe-write');
const F = require('./screener-fields');
const technicals = require('./stock-technicals');

const CACHE_FILE = path.join(__dirname, 'data', 'screener-cache.json');
const CHUNK = 40;                    // symbols per yahoo call
const DEFAULT_MAX_AGE_MS = 6 * 3600 * 1000;

function _yahoo() {
  const YahooFinance = require('yahoo-finance2').default;
  return new YahooFinance({ suppressNotices: ['yahooSurvey'] });
}

/** yahoo wants RELIANCE.NS / RELIANCE.BO. The universe stores the bare symbol
 *  plus an exchange letter, so the suffix is derived rather than guessed. */
function toYahooSymbol(symbol, exchange) {
  if (/\.(NS|BO)$/i.test(symbol)) return symbol;
  return `${symbol}.${String(exchange).toUpperCase() === 'BSE' ? 'BO' : 'NS'}`;
}

class ScreenerData {
  constructor({ file = CACHE_FILE, now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.cache = {};                 // yahooSymbol -> { asOf, quote, financialData, ... }
    this.loadError = null;
    this.load();
  }

  load() {
    /* readJsonSync, not JSON.parse(readFileSync(...)).
       safe-write leaves a `.bak` beside every atomic write, and readJsonSync
       falls back to it when the primary is corrupt. Parsing inline throws away
       that recovery and turns a torn write into a lost cache — 208 symbols
       re-fetched at best, and a screen that silently reports every stock as
       never-fetched at worst. The `fallback` distinguishes ENOENT (a first run)
       from unreadable, which must never look the same. */
    try {
      const j = this._read(this.file, { fallback: null });
      if (j === null) { this.cache = {}; this.loadError = null; return; }
      if (!j || typeof j.rows !== 'object' || j.rows === null || Array.isArray(j.rows)) {
        this.cache = {};
        this.loadError = 'cache file has the wrong shape — refusing to treat it as an empty cache';
        return;
      }
      this.cache = j.rows;
      this.loadError = null;
    } catch (e) {
      this.cache = {};
      this.loadError = `${e.code || 'ERR'}: ${e.message}`;
    }
  }

  // seam, so a test can inject a reader without the module reaching the disk
  _read(file, opts) { return require('./safe-write').readJsonSync(file, opts); }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileAtomicSync(this.file, JSON.stringify({
      savedAt: new Date(this.now()).toISOString(),
      count: Object.keys(this.cache).length,
      rows: this.cache,
    }));
  }

  /** Fetch symbols that are absent or older than maxAgeMs, and cache them.
   *
   *  @returns { requested, fetched, skippedFresh, failed, errors[] }
   *           `failed` is never folded into `fetched`.
   */
  async fetchInto(symbols, { maxAgeMs = DEFAULT_MAX_AGE_MS, deep = false, bars = false, yf = null } = {}) {
    const api = yf || _yahoo();
    const cutoff = this.now() - maxAgeMs;
    const need = [];
    let skippedFresh = 0;

    for (const s of symbols) {
      const hit = this.cache[s];
      /* The bars check asks for the RAW series, not the computed technicals.
         It asked for `hit.technicals` first, and every symbol looked fresh
         because technicals had been computed on an earlier run — so the raw bars
         needed for backtesting were never stored and the re-fetch did nothing at
         all. A freshness check must name the artefact the caller actually
         wants. */
      const fresh = hit && Date.parse(hit.asOf) >= cutoff
        && (!deep || hit.financialData) && (!bars || Array.isArray(hit.bars));
      if (fresh) skippedFresh++; else need.push(s);
    }

    const errors = [];
    let fetched = 0;

    for (let i = 0; i < need.length; i += CHUNK) {
      const batch = need.slice(i, i + CHUNK);
      let quotes = [];
      try {
        quotes = await api.quote(batch);
        if (!Array.isArray(quotes)) quotes = [quotes];
      } catch (e) {
        /* A whole batch failing is one event, recorded once with its symbols —
           not 40 identical errors, and not silence. */
        errors.push({ symbols: batch, stage: 'quote', reason: e.message.slice(0, 200) });
        continue;
      }

      const seen = new Set();
      for (const q of quotes) {
        if (!q || !q.symbol) continue;
        seen.add(q.symbol);
        const prev = this.cache[q.symbol] || {};
        this.cache[q.symbol] = { ...prev, asOf: new Date(this.now()).toISOString(), quote: q };
        fetched++;
      }
      // A symbol yahoo simply did not return is a fact about that symbol.
      for (const s of batch) {
        if (!seen.has(s)) errors.push({ symbols: [s], stage: 'quote', reason: 'not returned by the vendor' });
      }

      if (deep) {
        for (const s of batch) {
          if (!seen.has(s)) continue;
          try {
            const r = await api.quoteSummary(s, {
              modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'assetProfile'],
            });
            Object.assign(this.cache[s], {
              financialData: r.financialData || {},
              defaultKeyStatistics: r.defaultKeyStatistics || {},
              summaryDetail: r.summaryDetail || {},
              assetProfile: r.assetProfile || {},
            });
          } catch (e) {
            errors.push({ symbols: [s], stage: 'quoteSummary', reason: e.message.slice(0, 200) });
          }
        }
      }

      if (bars) {
        for (const s of batch) {
          if (!seen.has(s)) continue;
          try {
            /* One year plus a margin: SMA 200 needs 200 usable sessions, and
               stock-technicals discards everything before a corporate action, so
               asking for exactly 200 would silently return null for any stock
               that had a split. 400 calendar days is ~270 sessions. */
            const from = new Date(this.now() - 400 * 86400000).toISOString().slice(0, 10);
            const h = await api.chart(s, { period1: from, interval: '1d' });
            const quotes = (h && h.quotes) || [];
            if (!quotes.length) {
              errors.push({ symbols: [s], stage: 'chart', reason: 'no bars returned' });
              continue;
            }
            const t = technicals.compute(quotes);
            /* compute() reports its own failure. Storing an `ok:false` result as
               though it were technicals would make every derived field null with
               no way to tell an unfetchable stock from a newly listed one. */
            if (!t.ok) {
              errors.push({ symbols: [s], stage: 'technicals', reason: t.reason || 'compute declined', bars: t.bars });
              continue;
            }
            this.cache[s].technicals = t;
            this.cache[s].barsAsOf = new Date(this.now()).toISOString();
            this.cache[s].barCount = quotes.length;

            /* The RAW bars are kept, not just the computed result.
               Backtesting a screen means recomputing the technicals as they stood
               on a past date, which needs the series — a stored `sma50` is one
               number from one day and cannot be rewound. Compact tuples
               [epochMs, o, h, l, c, v]: ~270 bars x 208 names is a few MB, where
               the full objects would be tens. */
            this.cache[s].bars = quotes
              .filter((b) => b && b.close != null && b.date)
              .map((b) => [
                new Date(b.date).getTime(),
                b.open == null ? null : +b.open,
                b.high == null ? null : +b.high,
                b.low == null ? null : +b.low,
                +b.close,
                b.volume == null ? null : +b.volume,
              ]);
          } catch (e) {
            errors.push({ symbols: [s], stage: 'chart', reason: e.message.slice(0, 200) });
          }
        }
      }
    }

    if (fetched) this.save();
    return { requested: symbols.length, fetched, skippedFresh, failed: errors.length, errors };
  }

  /** Screenable rows for these symbols, plus what is missing and how old.
   *
   *  `neverFetched` is returned SEPARATELY from the rows. Folding it in as rows
   *  of nulls would make a symbol we have never looked at indistinguishable from
   *  one whose fields the vendor does not carry. */
  rowsFor(symbols) {
    const rows = [];
    const neverFetched = [];
    let oldest = null;
    let newest = null;

    for (const s of symbols) {
      const hit = this.cache[s];
      if (!hit) { neverFetched.push(s); continue; }
      const row = F.toRow({
        symbol: s,
        quote: hit.quote || {},
        financialData: hit.financialData || {},
        defaultKeyStatistics: hit.defaultKeyStatistics || {},
        summaryDetail: hit.summaryDetail || {},
        assetProfile: hit.assetProfile || {},
        technicals: hit.technicals || {},
      });
      row.asOf = hit.asOf;
      row.hasDeep = !!hit.financialData;
      row.hasBars = !!hit.technicals;
      row.barCount = hit.barCount || null;
      rows.push(row);
      const t = Date.parse(hit.asOf);
      if (oldest === null || t < oldest) oldest = t;
      if (newest === null || t > newest) newest = t;
    }

    return {
      rows,
      neverFetched,
      asOf: {
        oldest: oldest === null ? null : new Date(oldest).toISOString(),
        newest: newest === null ? null : new Date(newest).toISOString(),
        spreadMinutes: (oldest === null || newest === null) ? null : Math.round((newest - oldest) / 60000),
      },
    };
  }

  /** Symbols that carry a RAW bar series, for backtesting.
   *  Only those: a symbol with computed technicals but no bars cannot be rewound
   *  to a past date, and including it would silently shrink the universe on
   *  every as-of date without saying so. */
  universeWithBars() {
    return Object.entries(this.cache)
      .filter(([, v]) => Array.isArray(v.bars) && v.bars.length)
      .map(([symbol, v]) => ({ symbol, bars: v.bars }));
  }

  status() {
    const all = Object.values(this.cache);
    const times = all.map((r) => Date.parse(r.asOf)).filter(Number.isFinite);
    return {
      ok: this.loadError === null,
      loadError: this.loadError,
      cached: all.length,
      withDeep: all.filter((r) => r.financialData).length,
      withBars: all.filter((r) => r.technicals).length,
      oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
      newest: times.length ? new Date(Math.max(...times)).toISOString() : null,
      file: this.file,
    };
  }
}

module.exports = { ScreenerData, toYahooSymbol, CACHE_FILE };
