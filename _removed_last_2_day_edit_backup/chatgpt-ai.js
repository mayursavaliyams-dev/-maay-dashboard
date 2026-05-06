/**
 * ══════════════════════════════════════════════════════════════
 *  ANTIGRAVITY — ChatGPT (OpenAI) AI Decision Layer
 *  Integrates OpenAI GPT-4o / GPT-4o-mini for trade analysis,
 *  market commentary, and free-form chat.
 *
 *  ENV VARS:
 *    OPENAI_API_KEY=sk-xxxxxx         (required)
 *    OPENAI_MODEL=gpt-4o-mini         (optional, default gpt-4o-mini)
 *    OPENAI_BASE_URL=https://...      (optional, for proxies/Azure)
 * ══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const fetch = require('node-fetch');

// ==================== CONFIGURATION ====================

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL    = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MAX_RETRIES     = 3;
const RETRY_DELAY_MS  = 1500;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ==================== CORE API CALL ====================

/**
 * Call OpenAI chat completions API
 * @param {Array} messages - [{ role:'system'|'user'|'assistant', content:'...' }]
 * @param {Object} options - { model, temperature, max_tokens, top_p }
 * @returns {{ success, content, usage, model, error }}
 */
async function callChatGPT(messages, options = {}) {
  if (!OPENAI_API_KEY) {
    return {
      success: false,
      content: null,
      error: 'OPENAI_API_KEY not set in .env',
      code: 'CONFIG_ERROR'
    };
  }

  const model       = options.model || OPENAI_MODEL;
  const temperature = options.temperature ?? 0.7;
  const maxTokens   = options.max_tokens || 2048;
  const url         = `${OPENAI_BASE_URL}/chat/completions`;

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(options.top_p != null && { top_p: options.top_p }),
  };

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[ChatGPT] attempt ${attempt}/${MAX_RETRIES} → ${model}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'No response body');
        let errorDetail = `HTTP ${response.status}: ${errorBody}`;

        switch (response.status) {
          case 401:
            errorDetail = '🔑 INVALID OPENAI_API_KEY. Check your key at https://platform.openai.com/api-keys';
            break;
          case 403:
            errorDetail = '🚫 ACCESS DENIED. Your OpenAI key may lack permissions or billing.';
            break;
          case 404:
            errorDetail = `❌ Model "${model}" not found. Try gpt-4o-mini or gpt-4o.`;
            break;
          case 429:
            errorDetail = '⏳ RATE LIMITED by OpenAI. Waiting...';
            await sleep(RETRY_DELAY_MS * attempt * 2);
            continue;
          case 500: case 502: case 503:
            errorDetail = `🔧 OpenAI server error (${response.status}). Retrying...`;
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
        }

        console.error(`[ChatGPT] ❌ ${errorDetail}`);
        lastError = { success: false, content: null, error: errorDetail, code: `HTTP_${response.status}`, rawError: errorBody };

        if ([401, 403, 404].includes(response.status)) return lastError;
        continue;
      }

      // ── Success ──
      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return { success: false, content: null, error: 'Empty response (no choices)', code: 'EMPTY_RESPONSE' };
      }

      const content = data.choices[0].message?.content || '';
      const usage = data.usage || {};

      console.log(`[ChatGPT] ✅ Tokens: ${usage.total_tokens || '?'} | Model: ${data.model || model}`);

      return {
        success: true,
        content,
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        },
        model: data.model || model,
        provider: 'OpenAI',
        error: null
      };

    } catch (err) {
      console.error(`[ChatGPT] ❌ Request failed (attempt ${attempt}): ${err.message}`);
      lastError = { success: false, content: null, error: err.message, code: 'NETWORK_ERROR' };
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  return lastError || { success: false, content: null, error: 'All retries exhausted', code: 'MAX_RETRIES' };
}

// ==================== TRADING SYSTEM PROMPT ====================

const TRADE_SYSTEM_PROMPT = `You are an expert Indian index options trading analyst working with the "Anti-Gravity" intraday strategy.

You analyze SENSEX, NIFTY, and BANKNIFTY weekly expiry options.

Strategy rules:
- Trade weekly options on expiry day (SENSEX=Tue, NIFTY=Thu, BANKNIFTY=Wed)
- Enter after Opening Range Breakout (ORB) at 9:30 AM IST
- CALL when price breaks above ORB High + above VWAP + volume spike
- PUT when price breaks below ORB Low + below VWAP + volume spike
- WAIT when signals conflict or confidence is below 70%
- Stop loss: 50% of option premium
- Target: 2x-3x of entry premium (antigravity = explosive 5x-50x on momentum)
- Time filter: best trades between 9:31-10:30 AM, avoid after 2 PM

You must be concise, data-driven, and always mention specific price levels.
When analyzing trades, respond in JSON format when asked.`;

// ==================== TRADE ANALYSIS ====================

async function analyzeTradeSignal(marketData) {
  const {
    price, orHigh, orLow, vwap, volumeSpike, trend,
    hour, minute, instrument, candleStrength, oiData,
    pcr, maxPain, dayHigh, dayLow
  } = marketData;

  const inst = instrument || 'SENSEX';

  const userPrompt = `Analyze this ${inst} market snapshot and recommend CALL, PUT, or WAIT:

📊 LIVE DATA:
- Instrument: ${inst}
- Current Price: ₹${price}
- ORB High: ₹${orHigh || 'N/A'}
- ORB Low: ₹${orLow || 'N/A'}
- VWAP: ₹${vwap || 'N/A'}
- Day High: ₹${dayHigh || 'N/A'}
- Day Low: ₹${dayLow || 'N/A'}
- Volume Spike: ${volumeSpike ? 'YES ⚡' : 'NO'}
- Trend: ${trend || 'UNKNOWN'}
- Time: ${hour}:${String(minute).padStart(2, '0')} IST
- Candle Strength: ${candleStrength || 'N/A'}
- PCR: ${pcr || 'N/A'}
- Max Pain: ${maxPain || 'N/A'}
- OI Data: ${oiData ? JSON.stringify(oiData) : 'N/A'}

Respond ONLY in this JSON format:
{
  "signal": "CALL" | "PUT" | "WAIT",
  "confidence": 0-100,
  "reasons": ["reason1", "reason2", "reason3"],
  "warnings": ["warning1"],
  "entry_strategy": "description of optimal entry",
  "suggested_strike": "ATM/OTM recommendation",
  "target_mult": "2x-5x or 5x-10x etc",
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "market_structure": "trending/ranging/volatile"
}`;

  const result = await callChatGPT([
    { role: 'system', content: TRADE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ], { temperature: 0.3, max_tokens: 800 });

  if (!result.success) {
    return {
      signal: 'WAIT', confidence: 0,
      reasons: ['ChatGPT analysis unavailable: ' + result.error],
      warnings: ['Falling back to rule-based engine'],
      source: 'fallback'
    };
  }

  try {
    let jsonStr = result.content;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];

    const analysis = JSON.parse(jsonStr);
    analysis.source = 'chatgpt';
    analysis.provider = 'OpenAI';
    analysis.model = result.model;
    analysis.tokens = result.usage;
    return analysis;
  } catch (parseErr) {
    return {
      signal: 'WAIT', confidence: 0,
      reasons: ['ChatGPT response was not valid JSON'],
      warnings: [result.content.substring(0, 300)],
      source: 'parse-error',
      rawContent: result.content
    };
  }
}

// ==================== MARKET COMMENTARY ====================

async function getMarketCommentary(marketData) {
  const { price, vwap, trend, volumeSpike, orHigh, orLow, instrument } = marketData;
  const inst = instrument || 'SENSEX';

  const result = await callChatGPT([
    { role: 'system', content: `You are a concise Indian market analyst specializing in ${inst} options. Give a 3-4 sentence market commentary with specific levels, direction bias, and suggested action. Use bullet points.` },
    { role: 'user', content: `${inst} at ₹${price}. VWAP: ₹${vwap || 'N/A'}. Trend: ${trend || 'sideways'}. Volume: ${volumeSpike ? 'spiking' : 'normal'}. ORB Range: ₹${orLow || '?'} — ₹${orHigh || '?'}.` }
  ], { temperature: 0.5, max_tokens: 300 });

  return result.success ? result.content : 'ChatGPT commentary unavailable — ' + result.error;
}

// ==================== STRATEGY ADVISOR ====================

async function getStrategyAdvice(question, context = {}) {
  const contextStr = Object.keys(context).length
    ? `\n\nCurrent market context:\n${JSON.stringify(context, null, 2)}`
    : '';

  const result = await callChatGPT([
    { role: 'system', content: TRADE_SYSTEM_PROMPT + '\n\nYou are also a strategy mentor. Answer questions about options trading, risk management, and the Anti-Gravity strategy. Be practical and specific.' + contextStr },
    { role: 'user', content: question }
  ], { temperature: 0.6, max_tokens: 1024 });

  return result;
}

// ==================== MULTI-INSTRUMENT ANALYSIS ====================

async function analyzeAllInstruments(instruments) {
  const prompt = `Analyze these simultaneous market conditions across all instruments and give a unified trading recommendation:

${instruments.map(i => `
📊 ${i.instrument}:
  Price: ₹${i.price} | ORB: ₹${i.orbLow || '?'} — ₹${i.orbHigh || '?'}
  VWAP: ₹${i.vwap || '?'} | Signal: ${i.signal} (${i.confidence}%)
`).join('\n')}

Answer in JSON:
{
  "best_instrument": "SENSEX|NIFTY|BANKNIFTY",
  "best_signal": "CALL|PUT|WAIT",
  "confidence": 0-100,
  "reasoning": "why this instrument right now",
  "capital_allocation": "how to split capital across instruments",
  "risk_assessment": "overall market risk level"
}`;

  const result = await callChatGPT([
    { role: 'system', content: TRADE_SYSTEM_PROMPT },
    { role: 'user', content: prompt }
  ], { temperature: 0.3, max_tokens: 600 });

  if (!result.success) return { error: result.error };

  try {
    let jsonStr = result.content;
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
    return { success: true, analysis: JSON.parse(jsonStr), model: result.model, tokens: result.usage };
  } catch (_) {
    return { success: true, content: result.content, model: result.model };
  }
}

// ==================== HEALTH CHECK ====================

async function testConnection() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  🧪 Testing ChatGPT Connection                   ║');
  console.log('╚══════════════════════════════════════════════════╝');

  if (!OPENAI_API_KEY) {
    console.error('  ❌ OPENAI_API_KEY not set in .env');
    return { connected: false, error: 'OPENAI_API_KEY not configured' };
  }

  console.log(`  Model:   ${OPENAI_MODEL}`);
  console.log(`  Base:    ${OPENAI_BASE_URL}`);
  console.log(`  API Key: ${OPENAI_API_KEY.substring(0, 8)}...${OPENAI_API_KEY.slice(-4)}`);
  console.log('');

  const result = await callChatGPT([
    { role: 'user', content: 'Reply with exactly: OK' }
  ], { max_tokens: 10, temperature: 0 });

  if (result.success) {
    console.log(`  ✅ Connected to OpenAI (${result.model})!\n`);
    return { connected: true, provider: 'OpenAI', model: result.model, response: result.content };
  } else {
    console.error(`  ❌ Failed: ${result.error}\n`);
    return { connected: false, provider: 'OpenAI', error: result.error, code: result.code };
  }
}

// ==================== EXPORTS ====================

module.exports = {
  callChatGPT,
  analyzeTradeSignal,
  getMarketCommentary,
  getStrategyAdvice,
  analyzeAllInstruments,
  testConnection,
  config: {
    provider: 'OpenAI',
    model: OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL,
    hasKey: !!OPENAI_API_KEY,
  }
};
