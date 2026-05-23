/**
 * PINE → JS STRATEGY CONVERTER (agent-assisted)
 *
 * Sends a TradingView Pine Script to the Claude API and asks it to produce a
 * self-contained JavaScript strategy module matching this bot's multiconfirm
 * interface:  evaluate({ closes, volumes, candle, vwap, htfClose }) →
 *             { signal: 'CALL'|'PUT'|'WAIT', callScore, putScore, layers, shields, values }
 *
 * SAFETY: generated code is AI-written and UNREVIEWED. This module only WRITES
 * the file to ./generated-strategies/ — it never requires() or executes it, and
 * never wires it into auto-trading. A human must read it, backtest it, and
 * enable it deliberately. We surface that in the response.
 *
 * Uses raw HTTPS via node-fetch (already a dependency — no SDK install needed),
 * model claude-opus-4-7, adaptive thinking, and prompt caching on the large
 * fixed instruction block so repeat conversions are cheap.
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-7';
const OUT_DIR = path.resolve('./generated-strategies');

// The big, stable instruction block — cached so repeated conversions only pay
// for the (small, varying) Pine script at the end.
const SYSTEM_PROMPT = `You convert TradingView Pine Script trading strategies into a single self-contained
JavaScript (CommonJS) module for an options-trading bot. Output ONLY the JavaScript code —
no markdown fences, no prose, no explanation.

The module MUST export exactly this shape:

  module.exports = { name: '<kebab-case-name>', evaluate };

where:

  function evaluate({ closes, volumes, candle, vwap, htfClose, cfg = {} }) { ... }

Inputs:
  closes   : number[]  — close-price series, oldest → newest (treat as the bar closes)
  volumes  : number[]  — matching volume series
  candle   : { open, high, low, close }  — the latest bar
  vwap     : number    — session VWAP (may be 0/undefined; guard it)
  htfClose : number|null — a higher-timeframe reference close for HTF filters (may be null)
  cfg      : object    — optional overrides of any tunable constant

It MUST return:
  {
    signal: 'CALL' | 'PUT' | 'WAIT',   // CALL = Pine long/CE BUY, PUT = Pine short/PE BUY
    callScore: number,                 // count of bullish core layers satisfied (0..N)
    putScore: number,                  // count of bearish core layers satisfied (0..N)
    layers: { <layerName>: { bull: boolean, bear: boolean, ...extra } },
    shields: { <shieldName>: { ok?: boolean, bull?: boolean, bear?: boolean, value?: number } },
    values: { price, ...any computed indicator values }
  }

Rules:
1. Pure functions only — NO network, NO file IO, NO require() of anything except a
   self-contained set of helper functions you define at the top of the file.
2. NO look-ahead: every indicator uses only data up to the last array element.
3. Implement each Pine indicator faithfully with plain JS (ema, sma, rsi, atr, etc.).
   If an indicator needs per-bar high/low you don't have, approximate from the close
   series and note it in a code comment — never fabricate data.
4. Map Pine's session/time filters, multi-layer confirmations, and shields (ADX,
   Supertrend, higher-TF, etc.) onto layers{} and shields{} so a dashboard can show them.
5. Combine layers exactly as the Pine script does: a CALL/PUT only fires when ALL the
   required core layers AND all enabled shields agree; otherwise WAIT.
6. Make every threshold a constant near the top, overridable via cfg.
7. The code must be syntactically valid Node.js and runnable with node -c.

Return the JavaScript module text and nothing else.`;

function isConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
}

// Strip accidental ```js fences if the model adds them despite instructions.
function stripFences(text) {
  return text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

/**
 * Convert Pine source → JS strategy module text. Returns { ok, name, code, file, usage }
 * or { ok:false, error }. Writes the file to ./generated-strategies/ on success.
 */
async function convert(pineSource, suggestedName) {
  if (!isConfigured()) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not set in .env — Pine conversion disabled.' };
  }
  if (!pineSource || pineSource.trim().length < 40) {
    return { ok: false, error: 'Pine script too short / empty.' };
  }

  const body = {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
    ],
    messages: [
      { role: 'user', content: `Convert this Pine Script to the JS strategy module described. Suggested module name: "${suggestedName || 'pine-strategy'}".\n\nPINE SCRIPT:\n\n${pineSource}` }
    ]
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      timeout: 120000
    });
  } catch (e) {
    return { ok: false, error: `network error calling Claude API: ${e.message}` };
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
    return { ok: false, error: `Claude API ${res.status}${detail ? ': ' + detail : ''}` };
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    return { ok: false, error: 'Claude refused to convert this script.' };
  }
  // Concatenate all text blocks (skip thinking blocks).
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) return { ok: false, error: 'empty response from Claude' };

  const code = stripFences(text);

  // Derive a safe filename from the suggested name.
  const slug = (suggestedName || 'pine-strategy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pine-strategy';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${slug}.js`);
  const header = `// ⚠️ AI-GENERATED from a Pine Script on ${new Date().toISOString()}.\n` +
                 `// UNREVIEWED. Read it, backtest it, and enable it deliberately. Do NOT auto-trade blind.\n\n`;
  fs.writeFileSync(file, header + code);

  return {
    ok: true,
    name: slug,
    file: path.relative(process.cwd(), file),
    bytes: code.length,
    usage: data.usage || null
  };
}

function listGenerated() {
  try {
    return fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.js')).map(f => {
      const full = path.join(OUT_DIR, f);
      const st = fs.statSync(full);
      return { name: f.replace(/\.js$/, ''), file: path.relative(process.cwd(), full), size: st.size, modified: st.mtime.toISOString() };
    });
  } catch (_) { return []; }
}

module.exports = { convert, listGenerated, isConfigured, OUT_DIR };
