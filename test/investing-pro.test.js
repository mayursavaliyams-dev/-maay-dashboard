'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const ROOT = path.join(__dirname, '..');
const ip = require(path.join(ROOT, 'investing-pro.js'));

console.log('\ninvesting-pro');

ok(ip.norm('TCS.NS') === 'TCS', 'symbols are normalized away from Yahoo suffixes');
ok(ip.norm(' tcs ') === 'TCS', 'symbols are trimmed and upper-cased');
ok(ip.indianStock('TCS').ok === true, 'TCS is accepted because it is in the Indian stock universe');
ok(ip.indianStock('AAPL').ok === false, 'AAPL is rejected because ProPicks source is India-only here');

{
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'investing-propicks.example.json'), 'utf8'));
ok(example.market === 'India', 'example export is explicitly India-only');
ok(example.sourceLinks && /investing\.com\/equities\/india/.test(example.sourceLinks.indiaShares),
  'example export names Investing.com India as the source');
ok(example.sourceLinks && /investing\.com\/pro\/watchlist\/w-78178381\.iwl\/v-68f5a6e5/.test(example.sourceLinks.propicks),
  'example export names the InvestingPro watchlist as the source');
ok(example.stocks && example.stocks.TCS, 'example export carries a TCS row');
  ok(example.stocks.TCS.priceRange && Object.prototype.hasOwnProperty.call(example.stocks.TCS.priceRange, 'updatedAt'),
    'price-range update date is part of the schema');
ok(Array.isArray(example.stocks.TCS.propicks), 'ProPicks rows are part of the schema');
ok(Object.prototype.hasOwnProperty.call(example.stocks.TCS.propicks[0], 'priceWhenAdded'),
  'ProPicks rows include the InvestingPro price-when-added field');
ok(/investing\.com\/pro\/watchlist\/w-78178381\.iwl\/v-68f5a6e5/.test(example.stocks.TCS.propicksUrl),
  'per-stock row can carry the InvestingPro watchlist URL');
}

{
  const out = ip.forSymbol('AAPL');
  ok(out && out.ok === false, 'non-Indian symbols are rejected before any ProPicks row is read');
  ok(/Indian NSE\/BSE|Indian/.test(out.reason || out.source || ''), 'the failure names the Indian stock universe guard');
}

console.log(`\n${n} checks passed\n`);
