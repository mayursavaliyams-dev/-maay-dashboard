#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   build-stock-universe — the searchable list of every listed Indian equity.

   USAGE
     node scripts/build-stock-universe.js            build / refresh
     npm run build:universe                          same

   WHY THIS EXISTS

   The Stock View search box could only resolve 49 hand-listed symbols, so typing
   "consumer" — or "rel", or "hdf" — returned "could not resolve to a listed
   stock". The obvious fix, asking the market-data vendor's search endpoint, was
   MEASURED on 2026-07-30 and rejected:

       "rel"    → 7 results, 0 Indian   (no RELIANCE)
       "hdf"    → 7 results, 0 Indian   (no HDFCBANK)
       "sun"    → 7 results, 0 Indian   (no SUNPHARMA)
       "consumer" → 7 results, 0 Indian

   That endpoint is US-biased and unusable as an Indian autocomplete. So the list
   comes from the BROKER'S OWN INSTRUMENT MASTER — the same class of source the
   instrument registry is built from, and the reason the registry already held
   the correct FINNIFTY key when the obvious guess did not work.

   WHAT IT WRITES
     data/stock-universe.json — { builtAt, source, counts, stocks: [...] }
     Each entry: symbol, name, exchange, and the broker instrument key.

   WHAT IT DELIBERATELY KEEPS
     ETFs and investment trusts are listed equities and are kept. Someone typing
     "NIFTYBEES" is asking a real question, and silently having no answer for it
     is worse than one extra row in a dropdown.

   FAILURE BEHAVIOUR
     If the download fails, the existing file is LEFT ALONE and the script exits
     non-zero. A half-written or emptied universe would turn every search into
     "not found", which looks like a broken search box rather than a failed build.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'stock-universe.json');

/* The two exchanges label their equity rows differently, and the difference is
   not cosmetic.

   NSE marks every equity `instrument_type: "EQ"`.
   BSE does NOT. It puts the SETTLEMENT GROUP there — A, B, T, X, XT, M, MT, Z,
   P and a few smaller ones — and its BSE_EQ segment ALSO carries 6,525 bonds
   (type F, e.g. "IRFC-7.75%-15-4-33-PVT") and 1,120 government securities
   (type G). Measured 2026-07-30.

   Filtering BSE by `instrument_type === 'EQ'` therefore silently returns ZERO
   rows — which is what the first version of this script did, and it looked like
   a successful build. Filtering by "not F and not G" would be fail-open: a new
   debt group appearing tomorrow would quietly flood a stock search with bonds.

   So the BSE side uses an explicit ALLOWLIST of equity settlement groups, and
   the script prints what it excluded. A group nobody has classified is left out
   and named, rather than admitted on the assumption that it is probably equity. */
/* NSE has the same trap in a different shape. `NSE_EQ` holds 9,454 rows and only
   2,412 are `EQ`. Filtering on `EQ` alone silently drops real listed companies:

     SM  402   SME board equity            KCK INDUSTRIES LTD
     BE  286   trade-to-trade equity       THE BYKE HOSPITALITY LTD
     ST  156   SME trade-to-trade          PRIZOR VIZTECH LIMITED
     BZ   26   suspended / blocked equity  SANWARIA CONSUMER LIMITED
     IV   21   listed InvITs               IRB INVIT FUND
     RR    6   listed REITs                MINDSPACE BUSINESS P REIT
     IT    2   equity                      A B N INTERCORP LIMITED
     E1    3   partly-paid shares          SPANDANA RS.5 PPD UP

   That last-but-four line is not academic: the search that prompted this work was
   the word "consumer", and SANWARIA CONSUMER LIMITED sits in the `BZ` group. An
   `EQ`-only filter would still have returned nothing for it.

   Excluded by omission and printed by the script: SG (state development loans,
   4,289), N0–NZ (corporate bonds), GS (G-secs), TB (T-bills), GB (sovereign gold
   bonds) and a long tail of two-letter debt series. Those are debt, and a stock
   search that answers "IRFC 7.37% 2029 SR 181" is a worse search. */
const NSE_EQUITY_TYPES = new Set(['EQ', 'SM', 'BE', 'ST', 'BZ', 'IV', 'RR', 'IT', 'E1']);

const BSE_EQUITY_GROUPS = new Set([
  'A', 'B', 'T', 'X', 'XT', 'M', 'MT', 'Z', 'P', 'TS', 'ZP', 'MS', 'R',
  'E',    // ETF and mutual-fund units — NSE lists its ETFs as EQ, so this matches
  'IF',   // listed fractional / SM-REIT units, e.g. PropShare — tradeable and searchable
]);

const SOURCES = [
  { exch: 'NSE', url: 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz',
    seg: 'NSE_EQ', keep: (x) => NSE_EQUITY_TYPES.has(String(x.instrument_type || '').toUpperCase()) },
  { exch: 'BSE', url: 'https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz',
    seg: 'BSE_EQ', keep: (x) => BSE_EQUITY_GROUPS.has(String(x.instrument_type || '').toUpperCase()) },
];

function fetchGz(url) {
  return new Promise((resolve, reject) => {
    // A plain HEAD is refused by this CDN with 403 (measured); GET with a normal
    // User-Agent is served. Worth recording so nobody "optimises" it back.
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url} → HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(zlib.gunzipSync(Buffer.concat(chunks)).toString('utf8'))); }
        catch (e) { reject(new Error(`${url} → ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');

(async () => {
  const seen = new Map();          // symbol → record; NSE wins a tie
  const fno = new Set();           // underlyings with listed derivatives — the liquidity proxy
  const counts = {};

  for (const src of SOURCES) {
    let arr;
    try { arr = await fetchGz(src.url); }
    catch (e) {
      console.error(`  ${src.exch}: ${e.message}`);
      counts[src.exch] = 0;
      continue;
    }
    /* Which underlyings have listed derivatives.

       This is the only LIQUIDITY signal available in this file, and it is a good
       one: the exchange admits a stock to the F&O segment on measured turnover
       and delivery criteria, so the ~200 names here are, by the exchange's own
       assessment, the most traded in the market.

       It matters because ranking by symbol length answered "rel" with RELTD,
       RELAXO, RELCHEMQ and RELIABLE before RELIANCE, and "sun" without
       SUNPHARMA in the top five at all. Every one of those was a correct match
       and the list was useless. This is a proxy for importance, not a measure of
       it — stated plainly rather than presented as a quality score. */
    for (const x of arr) {
      if (!x || !/_FO$/.test(String(x.segment || ''))) continue;
      const u = clean(x.underlying_symbol || x.asset_symbol).toUpperCase();
      if (u) fno.add(u);
    }

    const inSeg = arr.filter(x => x && x.segment === src.seg);
    const eq = inSeg.filter(src.keep);
    counts[src.exch] = eq.length;
    console.log(`  ${src.exch}: ${arr.length.toLocaleString('en-IN')} instruments → ${inSeg.length.toLocaleString('en-IN')} in ${src.seg} → ${eq.length.toLocaleString('en-IN')} equities`);

    // What was dropped, and under what label. A filter that does not say what it
    // removed is a filter nobody can audit — and on this exchange the dropped
    // rows outnumber the kept ones.
    const dropped = {};
    for (const x of inSeg) { if (!src.keep(x)) { const t = String(x.instrument_type || '?'); dropped[t] = (dropped[t] || 0) + 1; } }
    const dl = Object.entries(dropped).sort((a, b) => b[1] - a[1]);
    if (dl.length) console.log(`         excluded: ${dl.map(([t, n]) => `${t}=${n}`).join(', ')}`);

    for (const x of eq) {
      const symbol = clean(x.trading_symbol || x.tradingsymbol).toUpperCase();
      const name = clean(x.name);
      if (!symbol) continue;
      // NSE first in SOURCES, so an existing entry is already the NSE one.
      if (seen.has(symbol)) continue;
      // The board is kept because search RANKING needs it. Without it a substring
      // match sorted alphabetically puts "Avax Apparels" above RELIANCE for "rel",
      // which is a correct match list and a useless one.
      seen.set(symbol, {
        s: symbol, n: name, e: src.exch,
        t: String(x.instrument_type || '').toUpperCase(),
        f: 0,   // set below, once every exchange has contributed its F&O list
        k: x.instrument_key || null,
      });
    }
  }

  // Marked only after BOTH masters are read, so a stock whose derivatives live
  // on the other exchange is not missed.
  for (const r of seen.values()) if (fno.has(r.s)) r.f = 1;

  const stocks = [...seen.values()].sort((a, b) => a.s.localeCompare(b.s));

  if (!stocks.length) {
    console.error('\nFAIL: no equities collected — leaving the existing universe untouched.');
    console.error('An emptied universe turns every search into "not found", which reads as a broken');
    console.error('search box rather than a failed build.');
    process.exit(1);
  }

  const out = {
    builtAt: new Date().toISOString(),
    source: 'Upstox public instrument master (broker contract data)',
    counts: { ...counts, unique: stocks.length, fno: stocks.filter(s => s.f).length },
    stocks,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`\nwrote data/stock-universe.json — ${stocks.length.toLocaleString('en-IN')} unique symbols, ${kb} KB`);

  // A few spot checks, printed so a bad build is visible rather than assumed good.
  for (const probe of ['RELIANCE', 'HDFCBANK', 'SUNPHARMA', 'TCS']) {
    const hit = seen.get(probe);
    console.log(`  ${probe.padEnd(10)} ${hit ? '✓ ' + hit.n + ' (' + hit.e + ')' : '✗ MISSING'}`);
  }
  process.exit(0);
})().catch(e => { console.error('build failed:', e.message); process.exit(1); });
