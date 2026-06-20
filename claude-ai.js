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
    const setup = grab('SETUP') || 'No Setup';
    const entrySpot = grab('ENTRY_TRIGGER_SPOT');
    // ── Validate the trigger spot is actually near the live spot (catch made-up levels) ──
    const spot = Number(spotPrice) || 0;
    const eNum = parseFloat(String(entrySpot || '').replace(/[^0-9.]/g, ''));
    const notes = [];
    let valid = true;
    if (!/no setup/i.test(setup) && spot && eNum && Math.abs(eNum - spot) / spot > 0.05) {
      valid = false; notes.push('entry-trigger spot > 5% off live spot');
    }
    return {
      setup,
      targetStrike:     grab('TARGET_STRIKE'),
      entryTriggerSpot: entrySpot,
      stopLossSpot:     grab('STOP_LOSS_SPOT'),
      probability,
      logic:            grab('LOGIC'),
      valid,
      validationNotes:  notes,
      raw:              text
    };
  } catch {
    return null;
  }
}

// ─── 4. Mean-Reversion (Buy Low / Sell High) — Gujarati ──────────────────────

/**
 * AI mean-reversion advisor (oversold buy / overbought sell). Reads RSI, the
 * nearest support/resistance, and EMA50 vs price, and returns a JSON decision.
 * The prompt + the `logic` field are in Gujarati per the user's preference.
 *
 * @param {object} ctx — { symbol, currentPrice, rsiValue, supportLevel,
 *                          resistanceLevel, ema50 }
 * Returns parsed object or null (disabled / timeout / parse fail):
 *   { action: 'BUY_LOW'|'SELL_HIGH'|'HOLD', entryPrice, stopLoss, targetPrice,
 *     confidenceScore, logic }
 */
async function claudeMeanReversion(ctx) {
  if (!ENABLED || !API_KEY) return null;

  const {
    symbol = 'NIFTY', currentPrice, rsiValue,
    supportLevel, resistanceLevel, ema50,
    // extra indicators (optional — improve the read when provided)
    bbUpper, bbLower, bbPctB, stochK, macdHist
  } = ctx;

  const system = `તમે એક એક્સપર્ટ આલ્ગોરિધમિક ટ્રેડર છો. તમારી જવાબદારી "નીચે ખરીદો અને ઉપર વેચો" (Buy Low, Sell High / Mean Reversion) સ્ટ્રેટેજી પર કામ કરવાની છે. તમારો ઉદ્દેશ્ય ઓવરસોલ્ડ (Oversold) અને ઓવરબોટ (Overbought) કન્ડિશન શોધીને ટ્રેડ લેવાનો છે.`;

  const user = `### 📊 લાઈવ માર્કેટ ડેટા:
- સિમ્બોલ: ${symbol}
- હાલનો ભાવ (LTP): ${currentPrice}
- RSI (14-પિરિયડ): ${rsiValue}
- નજીકનો સપોર્ટ (Support) લેવલ: ${supportLevel}
- નજીકનો રેઝિસ્ટન્સ (Resistance) લેવલ: ${resistanceLevel}
- 50 EMA: ${ema50}
- Bollinger Bands: અપર ${bbUpper ?? 'N/A'} / લોઅર ${bbLower ?? 'N/A'} / %B ${bbPctB ?? 'N/A'} (0=લોઅર બેન્ડ, 1=અપર બેન્ડ)
- Stochastic %K: ${stochK ?? 'N/A'} (20 ની નીચે = oversold, 80 ની ઉપર = overbought)
- MACD હિસ્ટોગ્રામ: ${macdHist ?? 'N/A'} (પોઝિટિવ = bullish મોમેન્ટમ)

### 🎯 તમારે આ ડેટાનું એનાલિસિસ કરવાનું છે:
૧. **એન્ટ્રી ઝોન ચકાસો:** જો પ્રાઈઝ સપોર્ટ/લોઅર બેન્ડની નજીક હોય (%B ≤ 0.2) અને RSI 30 ની નીચે + Stochastic 20 ની નીચે હોય, તો તે મજબૂત "Buy Low" તક છે. જો પ્રાઈઝ રેઝિસ્ટન્સ/અપર બેન્ડ પાસે હોય (%B ≥ 0.8) અને RSI 70 ની ઉપર + Stochastic 80 ની ઉપર હોય, તો તે મજબૂત "Sell High" (શોર્ટ) તક છે.
૨. **ટ્રેન્ડ કન્ફર્મેશન:** 50 EMA અને MACD હિસ્ટોગ્રામ ચેક કરો. ભાવ EMA થી ખૂબ દૂર હોય તો mean-reversion ની શક્યતા; પણ MACD strong-opposite હોય તો સાવધાન રહો (HOLD આપો).
૩. **રિસ્ક મેનેજમેન્ટ:** ટાર્ગેટ અને સ્ટોપલોસ એ રીતે નક્કી કરો કે રિસ્ક-રિવોર્ડ રેશિયો ઓછામાં ઓછો 1:2 રહે.

### 📝 ફાઇનલ આઉટપુટ ફોર્મેટ (ફક્ત JSON):
મારે જવાબમાં કોઈપણ પ્રકારની વધારાની સમજૂતી કે ટેક્સ્ટ જોઈતી નથી. કૃપા કરીને મને માત્ર નીચે મુજબના JSON ફોર્મેટમાં જ જવાબ આપો:

{
  "action": "BUY_LOW" | "SELL_HIGH" | "HOLD",
  "entryPrice": <એન્ટ્રી માટેનો ભાવ>,
  "stopLoss": <સ્ટોપલોસ નો ભાવ>,
  "targetPrice": <ટાર્ગેટ ભાવ>,
  "confidenceScore": <0 થી 100 વચ્ચેનો સ્કોર>,
  "logic": "<તમારો નિર્ણય શા માટે લીધો તે માત્ર 1 લાઈનમાં ગુજરાતીમાં જણાવો>"
}`;

  try {
    const text = await _claude(system, user, 350);
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    const action = ['BUY_LOW', 'SELL_HIGH', 'HOLD'].includes(p.action) ? p.action : 'HOLD';
    const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : (parseFloat(v) || null);
    const e = num(p.entryPrice), sl = num(p.stopLoss), tp = num(p.targetPrice);
    // ── Validate against spot — catch hallucinated / incoherent levels ──
    const spot = Number(currentPrice) || 0;
    const notes = [];
    let valid = true;
    if (action !== 'HOLD') {
      const nearSpot = (v) => v && spot && Math.abs(v - spot) / spot < 0.12;   // within 12% of spot
      if (!nearSpot(e)) { valid = false; notes.push('entry far from spot'); }
      if (action === 'BUY_LOW'  && !(tp > e && sl < e)) { valid = false; notes.push('BUY_LOW levels incoherent'); }
      if (action === 'SELL_HIGH' && !(tp < e && sl > e)) { valid = false; notes.push('SELL_HIGH levels incoherent'); }
    }
    return {
      action,
      entryPrice:      e,
      stopLoss:        sl,
      targetPrice:     tp,
      confidenceScore: p.confidenceScore != null ? Math.min(100, Math.max(0, parseInt(p.confidenceScore, 10) || 0)) : null,
      logic:           typeof p.logic === 'string' ? p.logic : '',
      valid,
      validationNotes: notes
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
  claudeMeanReversion,
  claudeAiStatus
};
