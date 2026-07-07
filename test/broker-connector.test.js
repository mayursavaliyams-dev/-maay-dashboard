/**
 * Broker connector interface (#7) — unit tests. Run: node test/broker-connector.test.js
 */
'use strict';
const assert = require('assert');
const B = require('../broker-connector');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('Broker connector interface (#7)');

// a fully-conforming mock connector
const fullConnector = () => {
  const stub = () => {};
  const c = {};
  for (const m of B.CORE) c[m] = stub;
  c.refreshAuth = stub; c.getOptionHistory = stub;
  return c;
};

// ── conforms ──
{
  const good = B.conforms(fullConnector());
  ok(good.ok && good.missing.length === 0, 'full connector conforms');
  const partial = fullConnector(); delete partial.placeOrder; delete partial.getOrders;
  const bad = B.conforms(partial);
  ok(!bad.ok && bad.missing.includes('placeOrder') && bad.missing.includes('getOrders'), 'missing core methods reported');
  ok(bad.present === B.CORE.length - 2, 'present count reflects the gap');
}

// ── describe capability map ──
{
  const c = fullConnector(); delete c.getOptionHistory;
  const cap = B.describe(c);
  ok(cap.getNiftyPrice === true && cap.getOptionHistory === false, 'capability map flags present/absent');
}

// ── normalizePrice ──
{
  ok(B.normalizePrice(24000).price === 24000, 'raw number → price');
  ok(B.normalizePrice({ price: 24010 }).price === 24010, '{price} → price');
  ok(B.normalizePrice({ ltp: 24020 }).price === 24020, '{ltp} → price');
  ok(B.normalizePrice(null).price === null, 'null → null price');
  ok(B.normalizePrice({ price: 'x' }).price === null, 'non-numeric → null');
}

// ── normalizeChain ──
{
  const n = B.normalizeChain({ strikes: [{ strike: 24000 }], atm: 24000, underlying: 24010 }, 'upstox');
  ok(n.strikes.length === 1 && n.atmStrike === 24000 && n.spot === 24010 && n.source === 'upstox', 'chain normalized to canonical shape');
  ok(B.normalizeChain(null).strikes.length === 0, 'null chain → empty strikes');
  ok(B.normalizeChain({ rows: [1, 2] }).strikes.length === 2, 'accepts rows[] alias');
}

// ── registry: register, auto-activate the first conforming, list ──
{
  const reg = new B.BrokerRegistry();
  const partial = fullConnector(); delete partial.placeOrder;
  reg.register('kotak', partial);                 // non-conforming → not auto-activated
  reg.register('upstox', fullConnector());        // conforming → auto-active
  ok(reg.active().name === 'upstox', 'first conforming connector auto-activated');
  const list = reg.list();
  ok(list.find(x => x.name === 'kotak').conforms === false, 'non-conforming flagged in list');
  ok(list.find(x => x.name === 'upstox').active === true, 'active flagged');
}

// ── registry: safe swap refuses a non-conforming connector ──
{
  const reg = new B.BrokerRegistry();
  reg.register('upstox', fullConnector());
  const partial = fullConnector(); delete partial.getOptionChain;
  reg.register('dhan', partial);
  let threw = false;
  try { reg.use('dhan'); } catch (_) { threw = true; }
  ok(threw, 'use() refuses a non-conforming connector (safe swap)');
  ok(reg.active().name === 'upstox', 'active unchanged after a refused swap');
  reg.register('live', fullConnector());
  ok(reg.use('live').name === 'live', 'use() switches to a conforming connector');
}

// ── unknown connector throws ──
{
  const reg = new B.BrokerRegistry();
  let threw = false;
  try { reg.use('nope'); } catch (_) { threw = true; }
  ok(threw, 'use() on unknown name throws');
}

console.log(`\n${pass} assertions passed`);
