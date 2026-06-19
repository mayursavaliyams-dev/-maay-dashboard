/**
 * REDIS STORE — Antigravity Pro (redis v3 client)
 *
 * Persists intraday high/low, ORB, breakout, reversal data.
 * Uses redis@3 which works with Redis Server 3.x (Windows package).
 * All ops are fire-and-forget — never blocks trading loop.
 */

const redis  = require('redis');
const TTL    = 12 * 3600; // 12-hour TTL

let client = null;
let ready  = false;

function connect() {
  return new Promise(resolve => {
    try {
      const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
      // redis@3 createClient
      client = redis.createClient({ url });

      client.on('ready', () => {
        ready = true;
        console.log('[redis] connected (v3) — high/low persistence ON');
        resolve(true);
      });
      client.on('error', e => {
        if (!ready) { console.warn('[redis] connect failed:', e.message); resolve(false); }
      });
      client.on('end', () => { ready = false; });
    } catch(e) {
      console.warn('[redis] init error:', e.message);
      resolve(false);
    }
  });
}

function isReady() { return ready && client; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function _set(key, value) {
  if (!isReady()) return;
  client.set(key, JSON.stringify(value), 'EX', TTL, err => {
    if (err) console.warn('[redis] set err:', key, err.message);
  });
}

function _get(key) {
  return new Promise(resolve => {
    if (!isReady()) return resolve(null);
    client.get(key, (err, val) => {
      if (err || !val) return resolve(null);
      try { resolve(JSON.parse(val)); } catch { resolve(null); }
    });
  });
}

function _today() {
  return new Date(Date.now() + 5.5*3600*1000).toISOString().slice(0,10);
}

// ── High/Low record ───────────────────────────────────────────────────────────
async function saveHL(inst, rec) {
  _set(`ag:hl:${inst}`, {
    date:     rec.date,
    high:     rec.high,    highAt: rec.highAt,
    low:      rec.low,     lowAt:  rec.lowAt,
    highPath: (rec.highPath||[]).slice(-50),
    lowPath:  (rec.lowPath||[]).slice(-50),
    chainLog: (rec.chainLog||[]).slice(-30)
  });
}

async function loadHL(inst) {
  const v = await _get(`ag:hl:${inst}`);
  return (v && v.date === _today()) ? v : null;
}

// ── ORB ───────────────────────────────────────────────────────────────────────
async function saveORB(inst, orbHigh, orbLow) {
  _set(`ag:orb:${inst}`, { orbHigh, orbLow, date: _today() });
}

async function loadORB(inst) {
  const v = await _get(`ag:orb:${inst}`);
  return (v && v.date === _today()) ? v : null;
}

// ── Breakouts ─────────────────────────────────────────────────────────────────
async function saveBreakouts(inst, events) {
  _set(`ag:bo:${inst}`, (events||[]).slice(-80));
}

async function loadBreakouts(inst) {
  return _get(`ag:bo:${inst}`);
}

// ── Reversals ─────────────────────────────────────────────────────────────────
async function saveReversals(inst, events) {
  _set(`ag:rv:${inst}`, (events||[]).slice(-60));
}

async function loadReversals(inst) {
  return _get(`ag:rv:${inst}`);
}

// ── Option H/L ────────────────────────────────────────────────────────────────
async function saveOptHL(inst, strike, type, rec) {
  if (rec.date !== _today()) return;
  _set(`ag:opthl:${inst}:${strike}:${type}`, {
    date:     rec.date,
    high:     rec.high,    highAt: rec.highAt,
    low:      rec.low,     lowAt:  rec.lowAt,
    highPath: (rec.highPath||[]).slice(-30),
    lowPath:  (rec.lowPath||[]).slice(-30)
  });
}

async function loadOptHL(inst, strike, type) {
  const v = await _get(`ag:opthl:${inst}:${strike}:${type}`);
  return (v && v.date === _today()) ? v : null;
}

// Restore ALL of today's option-strike H/L records (scan keys). Used on boot so
// the per-strike record timelines survive a restart, not just spot H/L.
async function loadAllOptHL() {
  return new Promise(resolve => {
    if (!isReady()) return resolve([]);
    client.keys('ag:opthl:*', async (err, keys) => {
      if (err || !keys || !keys.length) return resolve([]);
      const out = [];
      let pending = keys.length;
      keys.forEach(k => {
        client.get(k, (e, val) => {
          if (!e && val) {
            try {
              const rec = JSON.parse(val);
              if (rec && rec.date === _today()) {
                // key form: ag:opthl:<inst>:<strike>:<type>
                const parts = k.split(':');
                out.push({ inst: parts[2], strike: parts[3], type: parts[4], rec });
              }
            } catch (_) {}
          }
          if (--pending === 0) resolve(out);
        });
      });
    });
  });
}

// ── Status ────────────────────────────────────────────────────────────────────
async function status() {
  if (!isReady()) return { connected: false };
  return new Promise(resolve => {
    client.info('server', (err, info) => {
      if (err) return resolve({ connected: false });
      const ver = (info.match(/redis_version:([^\r\n]+)/)||[])[1] || '?';
      client.dbsize((e, keys) => resolve({
        connected: true, version: ver.trim(), keys: keys || 0
      }));
    });
  });
}

module.exports = {
  connect, isReady, status,
  saveHL, loadHL,
  saveORB, loadORB,
  saveBreakouts, loadBreakouts,
  saveReversals, loadReversals,
  saveOptHL, loadOptHL, loadAllOptHL
};
