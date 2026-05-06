/**
 * TELEGRAM LIVE ALERT SYSTEM — Antigravity Pro
 * 
 * Real-time trading alerts via Telegram Bot API.
 * No npm dependency needed — uses native Node.js https module.
 *
 * Features:
 *   - Signal alerts (CALL/PUT)
 *   - Gamma Blast alerts
 *   - Position tracking (entry, SL, trail, target)
 *   - Expiry morning briefing
 *   - Daily summary
 *   - Interactive bot commands (/blast, /position, /status, /help)
 *   - Rate limiting (20 msg/min)
 *   - Retry with exponential backoff
 */

const https = require('https');

class TelegramAlerter {
  constructor(config = {}) {
    this.enabled    = config.enabled ?? (process.env.TELEGRAM_ENABLED === 'true');
    this.botToken   = config.botToken   || process.env.TELEGRAM_BOT_TOKEN   || '';
    this.chatId     = config.chatId     || process.env.TELEGRAM_CHAT_ID     || '';
    this.connected  = false;
    this.lastError  = null;

    // Rate limiting: max 20 messages per 60 seconds
    this._msgTimes  = [];
    this._rateLimit = 20;
    this._rateWindow = 60000; // ms

    // Deduplication: track last sent message hash to avoid repeats
    this._lastHash  = {};

    // Polling state for bot commands
    this._pollOffset = 0;
    this._pollTimer  = null;
    this._commandHandlers = {};

    // Stats
    this.stats = { sent: 0, errors: 0, lastSentAt: null };
  }

  // ══════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════

  /**
   * Connect and verify bot token + chat ID.
   * Call this once at server startup.
   */
  async connect() {
    if (!this.enabled) {
      console.log('[telegram] Alerts DISABLED (TELEGRAM_ENABLED ≠ true)');
      return false;
    }
    if (!this.botToken || !this.chatId) {
      console.log('[telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      this.enabled = false;
      return false;
    }

    try {
      const me = await this._apiCall('getMe');
      if (me.ok) {
        this.connected = true;
        this.botName = me.result.username;
        console.log(`[telegram] Connected as @${this.botName}`);
        // Send startup message
        await this._send(
          '🚀 <b>Antigravity Pro — Bot Connected</b>\n\n' +
          `Bot: @${this.botName}\n` +
          `Time: ${this._istTime()}\n\n` +
          'Send /help for available commands.'
        );
        return true;
      } else {
        this.lastError = me.description || 'Unknown error';
        console.error('[telegram] Auth failed:', this.lastError);
        return false;
      }
    } catch (err) {
      this.lastError = err.message;
      console.error('[telegram] Connect error:', err.message);
      return false;
    }
  }

  /**
   * Start polling for incoming bot commands.
   * Call after connect() if you want interactive commands.
   */
  startCommandPolling(interval = 5000) {
    if (!this.connected) return;
    this._pollTimer = setInterval(() => this._pollUpdates(), interval);
    console.log(`[telegram] Command polling started (${interval}ms)`);
  }

  stopCommandPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Register a command handler.
   * handler(chatId, args) => Promise<string> — return message text (HTML).
   */
  onCommand(command, handler) {
    this._commandHandlers[command.toLowerCase().replace('/', '')] = handler;
  }

  // ══════════════════════════════════════════════════════════
  // ALERT METHODS — Called from server.js
  // ══════════════════════════════════════════════════════════

  /**
   * 🔥 Signal Alert — CALL or PUT detected
   */
  async sendSignalAlert({ signal, confidence, strike, target, price, orbHigh, orbLow, vwap }) {
    if (!this._shouldSend('signal', signal + confidence)) return;

    const emoji = signal === 'CALL' ? '🔥' : '💥';
    const direction = signal === 'CALL' ? '▲ BULLISH' : '▼ BEARISH';

    const msg =
      `${emoji} <b>${signal} SIGNAL FIRED!</b>\n\n` +
      `Direction: ${direction}\n` +
      `Confidence: <b>${confidence}%</b>\n` +
      `Strike: <b>${strike}</b>\n` +
      `Target: <b>${target}</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `SENSEX: ₹${price}\n` +
      `ORB: ${orbHigh || '--'} / ${orbLow || '--'}\n` +
      `VWAP: ${vwap || '--'}\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * ☢️ Gamma Blast Alert
   */
  async sendGammaBlastAlert(blastData) {
    if (!blastData || !blastData.blastActive) return;
    if (!this._shouldSend('blast', blastData.blastLevel + blastData.blastScore)) return;

    const emoji = { NUCLEAR: '☢️', EXTREME: '🔥', HIGH: '⚡' }[blastData.blastLevel] || '📊';
    const rank = blastData.greekRank || {};
    const m = blastData.metrics || {};

    const msg =
      `${emoji} <b>GAMMA BLAST — ${blastData.blastLevel}!</b>\n\n` +
      `Score: <b>${blastData.blastScore}/100</b>\n` +
      `Greek Rank: <b>${rank.total || 0}/100</b> (Grade ${rank.grade || '?'})\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `ATM Gamma: ${m.atmGamma || '--'}\n` +
      `ATM Delta: ${m.atmDelta || '--'}\n` +
      `Gamma/Delta: ${m.gammaPerDelta || '--'}\n` +
      `GTR Ratio: ${m.gammaThetaRatio || '--'}\n` +
      `IV: ${m.iv || '--'}%\n` +
      `Time to Expiry: ${m.timeToExpiry ? (m.timeToExpiry * 365).toFixed(2) + ' days' : '--'}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `${blastData.alert?.description || ''}\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * 📈 Position Entered
   */
  async sendPositionEntered({ type, strike, entryPrice, sl, trailAt }) {
    const msg =
      `📈 <b>POSITION ENTERED</b>\n\n` +
      `Type: <b>${type} ${strike}</b>\n` +
      `Entry: <b>₹${Number(entryPrice).toFixed(1)}</b>\n` +
      `Stop Loss: ₹${Number(sl).toFixed(1)} (−35%)\n` +
      `Trail Trigger: ₹${Number(trailAt).toFixed(1)} (1.5x)\n` +
      `Target: ₹${(Number(entryPrice) * 2.5).toFixed(1)} (2.5x)\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * ⚡ Trail Locked
   */
  async sendTrailLocked({ type, strike, mult, lockedFloor, currentPrice }) {
    if (!this._shouldSend('trail', strike)) return;

    const msg =
      `⚡ <b>TRAIL LOCKED!</b>\n\n` +
      `${type} ${strike}\n` +
      `Multiplier: <b>${Number(mult).toFixed(2)}x</b>\n` +
      `Floor Locked: ₹${Number(lockedFloor).toFixed(1)}\n` +
      `Current: ₹${Number(currentPrice).toFixed(1)}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `✅ Profit protected — trailing from here\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * 🔴 Stop Loss Hit
   */
  async sendSLHit({ type, strike, mult, entryPrice, currentPrice }) {
    const msg =
      `🔴 <b>STOP LOSS HIT!</b>\n\n` +
      `${type} ${strike}\n` +
      `Multiplier: <b>${Number(mult).toFixed(2)}x</b>\n` +
      `Entry: ₹${Number(entryPrice).toFixed(1)}\n` +
      `Current: ₹${Number(currentPrice).toFixed(1)}\n` +
      `P&L: <b>${((Number(mult) - 1) * 100).toFixed(1)}%</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `❌ Exit immediately!\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * 🟡 Trail Exit
   */
  async sendTrailExit({ type, strike, mult, entryPrice, exitPrice }) {
    const msg =
      `🟡 <b>TRAIL STOP EXIT</b>\n\n` +
      `${type} ${strike}\n` +
      `Multiplier: <b>${Number(mult).toFixed(2)}x</b>\n` +
      `Entry: ₹${Number(entryPrice).toFixed(1)} → Exit: ₹${Number(exitPrice).toFixed(1)}\n` +
      `P&L: <b>+${((Number(mult) - 1) * 100).toFixed(1)}%</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `✅ Profit booked via trailing stop\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * 🚀 Target Hit
   */
  async sendTargetHit({ type, strike, mult, entryPrice, currentPrice }) {
    const msg =
      `🚀 <b>TARGET HIT!</b> 🎯\n\n` +
      `${type} ${strike}\n` +
      `Multiplier: <b>${Number(mult).toFixed(2)}x</b> 🏆\n` +
      `Entry: ₹${Number(entryPrice).toFixed(1)} → ₹${Number(currentPrice).toFixed(1)}\n` +
      `P&L: <b>+${((Number(mult) - 1) * 100).toFixed(1)}%</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `🎉 Consider booking profits!\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * 📤 Position Exited (manual)
   */
  async sendPositionExited({ type, strike, mult, pnlPct, exitReason }) {
    const isWin = Number(mult) >= 1;
    const emoji = isWin ? '✅' : '❌';
    const msg =
      `${emoji} <b>POSITION CLOSED</b>\n\n` +
      `${type} ${strike}\n` +
      `Result: <b>${Number(mult).toFixed(2)}x</b> (${isWin ? '+' : ''}${pnlPct}%)\n` +
      `Reason: ${exitReason}\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * ⏱️ Expiry Morning Briefing
   */
  async sendExpiryMorning({ spot, atm, ceEstimate, gammaBlast, daysToExpiry }) {
    const blastEmoji = gammaBlast?.blastLevel === 'NUCLEAR' ? '☢️'
                     : gammaBlast?.blastLevel === 'EXTREME' ? '🔥'
                     : gammaBlast?.blastLevel === 'HIGH' ? '⚡' : '📊';

    const msg =
      `⏱️ <b>EXPIRY DAY BRIEFING</b>\n\n` +
      `📅 SENSEX Weekly Expiry — TODAY\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `Spot: <b>₹${Number(spot).toLocaleString()}</b>\n` +
      `ATM Strike: <b>${atm}</b>\n` +
      `ATM CE Est: <b>₹${ceEstimate || '--'}</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `Gamma Blast: ${blastEmoji} <b>${gammaBlast?.blastLevel || '--'}</b> (${gammaBlast?.blastScore || 0}/100)\n` +
      `Greek Rank: ${gammaBlast?.greekRank?.total || 0}/100 (${gammaBlast?.greekRank?.grade || '?'})\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📋 <b>Checklist:</b>\n` +
      `• ORB Window: 9:15-9:20 AM\n` +
      `• Range ≥ 0.8% (~${(Number(spot) * 0.008).toFixed(0)} pts)\n` +
      `• Body ≥ 70% of range\n` +
      `• SL: −35% | Trail: 1.5x → lock 50%\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * 📊 Daily Summary (end of day)
   */
  async sendDailySummary({ tradesCount, closedPositions, currentSignal, confidence, botRunning }) {
    const trades = closedPositions || [];
    let tradeLines = trades.length === 0
      ? 'No trades today'
      : trades.map(t => {
          const isWin = parseFloat(t.finalMult) >= 1;
          return `${isWin ? '✅' : '❌'} ${t.type} ${t.strike} → ${t.finalMult}x (${isWin ? '+' : ''}${t.finalPnlPct}%)`;
        }).join('\n');

    const msg =
      `📊 <b>DAILY SUMMARY</b>\n\n` +
      `Date: ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}\n` +
      `Bot Status: ${botRunning ? '🟢 Running' : '🔴 Stopped'}\n` +
      `Trades Today: ${tradesCount || 0}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `<b>Trades:</b>\n${tradeLines}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `Last Signal: ${currentSignal || 'WAIT'} (${confidence || 0}%)\n` +
      `Time: ${this._istTime()}`;

    return this._send(msg);
  }

  /**
   * 🔔 Generic alert (for custom messages)
   */
  async sendAlert(title, body) {
    return this._send(`🔔 <b>${title}</b>\n\n${body}\nTime: ${this._istTime()}`);
  }

  /**
   * Test message — verify connection works
   */
  async sendTest() {
    return this._send(
      '✅ <b>Test Alert — Antigravity Pro</b>\n\n' +
      'Telegram alerts are working correctly!\n' +
      `Bot: @${this.botName || '?'}\n` +
      `Chat: ${this.chatId}\n` +
      `Time: ${this._istTime()}`
    );
  }

  // ══════════════════════════════════════════════════════════
  // BOT COMMAND POLLING
  // ══════════════════════════════════════════════════════════

  async _pollUpdates() {
    if (!this.connected) return;
    try {
      const res = await this._apiCall('getUpdates', {
        offset: this._pollOffset,
        timeout: 1,
        allowed_updates: ['message']
      });
      if (!res.ok || !res.result || res.result.length === 0) return;

      for (const update of res.result) {
        this._pollOffset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text || !msg.text.startsWith('/')) continue;

        const parts = msg.text.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase().replace('/', '').split('@')[0]; // handle /cmd@BotName
        const args = parts.slice(1);
        const fromChatId = msg.chat.id;

        // Only respond to our configured chat
        if (String(fromChatId) !== String(this.chatId)) continue;

        const handler = this._commandHandlers[cmd];
        if (handler) {
          try {
            const reply = await handler(fromChatId, args);
            if (reply) await this._send(reply);
          } catch (err) {
            await this._send(`❌ Command error: ${err.message}`);
          }
        } else if (cmd === 'help') {
          // Built-in help
          const cmds = Object.keys(this._commandHandlers);
          await this._send(
            '📖 <b>Antigravity Bot Commands</b>\n\n' +
            cmds.map(c => `/${c}`).join('\n') + '\n/help\n\n' +
            'All alerts are sent automatically when events trigger.'
          );
        }
      }
    } catch (err) {
      // Silent — don't flood console on poll errors
    }
  }

  // ══════════════════════════════════════════════════════════
  // CORE SEND + API
  // ══════════════════════════════════════════════════════════

  async _send(text, parseMode = 'HTML') {
    if (!this.enabled || !this.connected) return null;
    if (!this._checkRateLimit()) {
      console.warn('[telegram] Rate limit hit — skipping message');
      return null;
    }

    try {
      const res = await this._apiCall('sendMessage', {
        chat_id: this.chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true
      });

      if (res.ok) {
        this.stats.sent++;
        this.stats.lastSentAt = new Date().toISOString();
        return res.result;
      } else {
        this.stats.errors++;
        this.lastError = res.description || 'Send failed';
        console.error('[telegram] Send failed:', this.lastError);
        return null;
      }
    } catch (err) {
      this.stats.errors++;
      this.lastError = err.message;
      console.error('[telegram] Send error:', err.message);
      // Retry once with backoff
      await this._sleep(2000);
      try {
        const res = await this._apiCall('sendMessage', {
          chat_id: this.chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true
        });
        if (res.ok) { this.stats.sent++; return res.result; }
      } catch (_) { /* give up */ }
      return null;
    }
  }

  /**
   * Raw Telegram Bot API call using native https
   */
  _apiCall(method, params = {}) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(params);
      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${this.botToken}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON from Telegram API'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Telegram API timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  _checkRateLimit() {
    const now = Date.now();
    this._msgTimes = this._msgTimes.filter(t => now - t < this._rateWindow);
    if (this._msgTimes.length >= this._rateLimit) return false;
    this._msgTimes.push(now);
    return true;
  }

  /**
   * Deduplication: prevent same alert type from sending the same content within 60s
   */
  _shouldSend(category, contentKey) {
    if (!this.enabled || !this.connected) return false;
    const key = `${category}:${contentKey}`;
    const now = Date.now();
    if (this._lastHash[key] && now - this._lastHash[key] < 60000) return false;
    this._lastHash[key] = now;
    return true;
  }

  _istTime() {
    return new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Get status for API/dashboard
   */
  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.connected,
      botName: this.botName || null,
      chatId: this.chatId ? '***' + this.chatId.slice(-4) : null,
      stats: this.stats,
      lastError: this.lastError,
      polling: !!this._pollTimer
    };
  }
}

module.exports = TelegramAlerter;
