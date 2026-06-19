/**
 * CLAUDE AI INTEGRATION — Antigravity Pro
 *
 * Three capabilities:
 *   1. claudeSignalFilter()   — validates a CALL/PUT signal with Claude reasoning
 *   2. claudeTradeNarration() — writes a human-readable Telegram alert for any trade event
 *   3. claudeEodJournal()     — writes end-of-day session recap from closed trades
 *
 * Requirements:
 *   ANTHROPIC_API_KEY in .env
 *   CLAUDE_AI_ENABLED=true  (default: false — safe opt-in)
 *
 * All calls are non-blocking with a hard 6-second timeout so the trading loop
 * never stalls waiting for Claude.
 */

const https = require('https');

const ENABLED        = process.env.CLAUDE_AI_ENABLED === 'true';
const API_KEY        = process.env.ANTHROPIC_API_KEY || '';
const MODEL          = 'claude-haiku-4-5-20251001'; // fastest + cheapest
const TIMEOUT_MS     = 6000;
const API_HOST       = 'api.anthropic.com';
const API_PATH       = '/v1/messages';

// ─── internal: raw Claude call ───────────────────────────────────────────────

async function _claude(systemPrompt, userPrompt, maxTokens = 300) {
  if (!ENABLED || !API_KEY) return null;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const req = https.request({
      hostname: API_HOST,
      path: API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed?.content?.[0]?.text?.trim() || null);
        } catch { resolve(null); }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ─── 1. Signal Filter ────────────────────────────────────────────────────────

/**
 * Validates a CALL/PUT signal from the rule-based engine.
 * Returns { approved, reason, adjustedConfidence } — or falls back to
 * { approved: true } if Claude is disabled or times out (never blocks a trade).
 *
 * @param {object} ctx  — { signal, confidence, price, orHigh, orLow, vwap,
 *                          trend, hour, minute, instrument, reasons, warnings }
 */
async function claudeSignalFilter(ctx) {
  const fallback = { approved: true, reason: 'AI filter offline', adjustedConfidence: ctx.confidence };
  if (!ENABLED || !API_KEY) return fallback;

  const {
    signal, confidence, price, orHigh, orLow, vwap,
    trend = 'UNKNOWN', hour, minute, instrument = 'SENSEX',
    reasons = [], warnings = []
  } = ctx;

  const system = `You are a senior options trader reviewing intraday signals for Indian index options (${instrument}).
You receive a CALL or PUT signal from a rule-based ORB+VWAP engine and must decide in <200ms whether to approve or veto it.
Reply with ONLY valid JSON: {"approved": true|false, "reason": "one sentence", "adjustedConfidence": 0-100}
Never add commentary outside the JSON.`;

  const user = `Signal: ${signal} | Instrument: ${instrument}
Rule engine confidence: ${confidence}%
Price: ${price} | ORB High: ${orHigh || 'N/A'} | ORB Low: ${orLow || 'N/A'} | VWAP: ${vwap || 'N/A'}
Trend: ${trend} | Time: ${hour}:${String(minute).padStart(2,'0')} IST
Reasons: ${reasons.join(', ') || 'none'}
Warnings: ${warnings.join(', ') || 'none'}

Approve this trade? JSON only.`;

  try {
    const text = await _claude(system, user, 120);
    if (!text) return fallback;
    // extract JSON even if Claude wraps it in backticks
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    return {
      approved:            parsed.approved !== false,
      reason:              parsed.reason || '',
      adjustedConfidence:  typeof parsed.adjustedConfidence === 'number'
                             ? Math.min(100, Math.max(0, parsed.adjustedConfidence))
                             : ctx.confidence
    };
  } catch {
    return fallback;
  }
}

// ─── 2. Trade Narration ───────────────────────────────────────────────────────

/**
 * Writes a sharp Telegram-ready alert for a trade event.
 * event: 'ENTRY' | 'EXIT' | 'SL_HIT' | 'TARGET_HIT' | 'TRAIL_LOCKED'
 *
 * Returns a string or null if disabled/timeout.
 */
async function claudeTradeNarration(event, tradeCtx) {
  if (!ENABLED || !API_KEY) return null;

  const {
    instrument = 'SENSEX', signal, strike, premium, lots,
    pnlAbs, pnlPct, exitReason, capital,
    confidence, orbHigh, orbLow, vwap, tradeMode = 'paper'
  } = tradeCtx;

  const system = `You are a compact trading assistant writing Telegram alerts for an options bot.
Write in plain text (no markdown headers, no emojis unless they aid clarity).
Max 4 lines. Be direct: what happened, key numbers, one-line risk note.
Never use hype language or predictions.`;

  const eventDescs = {
    ENTRY:        `Trade entered: ${instrument} ${signal} ${strike} @ ₹${premium}/unit | ${lots} lot(s) | Capital deployed: ₹${capital || '?'}`,
    EXIT:         `Trade closed: ${instrument} ${signal} ${strike} | P&L: ₹${pnlAbs} (${pnlPct}%) | Reason: ${exitReason}`,
    SL_HIT:       `Stop-loss hit on ${instrument} ${signal} ${strike} | Loss: ₹${pnlAbs} (${pnlPct}%) | Reason: ${exitReason}`,
    TARGET_HIT:   `Target hit on ${instrument} ${signal} ${strike} | Profit: ₹${pnlAbs} (${pnlPct}%)`,
    TRAIL_LOCKED: `Trail locked on ${instrument} ${signal} ${strike} | Locked: ₹${pnlAbs} (${pnlPct}%) | Still in trade`
  };

  const user = `Event: ${event}
${eventDescs[event] || event}
Context: ORB High=${orbHigh || 'N/A'} ORB Low=${orbLow || 'N/A'} VWAP=${vwap || 'N/A'} AI confidence=${confidence || 'N/A'}%
Mode: ${tradeMode.toUpperCase()}
Write the Telegram alert now.`;

  try {
    const text = await _claude(system, user, 200);
    return text || null;
  } catch {
    return null;
  }
}

// ─── 3. Gamma Blast detector ─────────────────────────────────────────────────

/**
 * AI layer on top of the rule-based gamma-blast alert. Asks Claude to read the
 * live option chain and judge an imminent expiry-day gamma squeeze / OI trap.
 *
 * @param {object} ctx — { indexName, currentTime, spotPrice, vwap, pcr,
 *                          optionChainData: [{strike, ceOI, peOI, ceLtp, peLtp, ...}] }
 * Returns a parsed object or null (disabled / timeout / parse fail — caller
 * keeps the rule-based result as the source of truth):
 *   { setup, targetStrike, entryTriggerSpot, stopLossSpot, probability, logic, raw }
 */
async function claudeGammaBlast(ctx) {
  if (!ENABLED || !API_KEY) return null;

  const {
    indexName = 'NIFTY', currentTime = '', spotPrice, vwap, pcr,
    optionChainData = []
  } = ctx;

  const system = `You are an elite quantitative options trader and algorithm risk analyst specializing in Indian indices (Nifty, BankNifty, Sensex). Your objective is to detect an imminent 'Gamma Blast' (Gamma Squeeze / Short Covering trap) on Expiry Day based on live option chain data.`;

  const user = `### 📊 LIVE MARKET SNAPSHOT:
- Index: ${indexName}
- Current Time: ${currentTime}
- Spot Price: ${spotPrice}
- VWAP: ${vwap}
- PCR (Put-Call Ratio): ${pcr}

### 🔗 FILTERED OPTION CHAIN (JSON):
${JSON.stringify(optionChainData)}

### 🎯 YOUR ANALYSIS TASKS:
1. **Identify the 'Trap Zone':** Analyze the JSON data to locate specific OTM (Out-of-the-Money) strikes with unusually high Open Interest where option writers are dangerously close to the Spot Price.
2. **Gamma Acceleration Trigger:** Determine the exact Spot Price level. At what index level will market makers be forced into aggressive delta-hedging (buying/selling the underlying) to cover their naked positions?
3. **Zero-to-Hero Feasibility:** Evaluate if the premium of the target strike is cheap enough right now to yield a rapid 3x to 5x return if the Gamma Blast triggers.
4. **Decay vs. Blast:** Confirm if this is a genuine breakout setup or just a theta-decay trap.

### 📝 REQUIRED OUTPUT FORMAT:
You MUST respond with a concise, actionable alert. Do not include any extra conversational text. Format your response exactly like this:

SETUP: [Bullish / Bearish / No Setup]
TARGET_STRIKE: [e.g., 47500 CE]
ENTRY_TRIGGER_SPOT: [Exact Spot price level that confirms the blast]
STOP_LOSS_SPOT: [Spot price level where the setup fails]
PROBABILITY: [0-100%]
LOGIC: [Explain the OI trap and Gamma levels in 2 concise sentences]`;

  try {
    const text = await _claude(system, user, 400);
    if (!text) return null;
    // Parse the fixed-field structured response.
    const grab = (label) => {
      const m = text.match(new RegExp(label + '\\s*:\\s*(.+)', 'i'));
      return m ? m[1].trim().replace(/^\[|\]$/g, '').trim() : null;
    };
    const probRaw = grab('PROBABILITY');
    const probability = probRaw ? Math.min(100, Math.max(0, parseInt(probRaw.replace(/[^0-9]/g, ''), 10) || 0)) : null;
    return {
      setup:            grab('SETUP') || 'No Setup',
      targetStrike:     grab('TARGET_STRIKE'),
      entryTriggerSpot: grab('ENTRY_TRIGGER_SPOT'),
      stopLossSpot:     grab('STOP_LOSS_SPOT'),
      probability,
      logic:            grab('LOGIC'),
      raw:              text
    };
  } catch {
    return null;
  }
}

// ─── health check ─────────────────────────────────────────────────────────────

function claudeAiStatus() {
  return {
    enabled:   ENABLED,
    hasApiKey: !!API_KEY,
    model:     MODEL,
    timeoutMs: TIMEOUT_MS
  };
}

module.exports = {
  claudeSignalFilter,
  claudeTradeNarration,
  claudeGammaBlast,
  claudeAiStatus
};
