/**
 * TELEGRAM ALERTS (lightweight, outbound only) for the stock bot.
 * Sends entry / exit / halt / EOD / token alerts to the operator's phone.
 * Disabled unless TELEGRAM_ENABLED=true with a bot token + chat id — every
 * method is a safe no-op when disabled, so callers never need to guard.
 *
 * Setup: @BotFather → /newbot → token; message the bot, then read chat.id from
 *   https://api.telegram.org/bot<TOKEN>/getUpdates
 */

const fetch = require('node-fetch');

class TelegramAlerter {
  constructor(config = {}) {
    this.botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId   = config.chatId   || process.env.TELEGRAM_CHAT_ID   || '';
    this.enabled  = (config.enabled ?? (process.env.TELEGRAM_ENABLED === 'true'))
                    && !!this.botToken && !!this.chatId;
    if (process.env.TELEGRAM_ENABLED === 'true' && (!this.botToken || !this.chatId)) {
      console.warn('[telegram] TELEGRAM_ENABLED=true but bot token / chat id missing — alerts off');
    }
  }

  _istTime() {
    return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' IST';
  }

  async _send(text) {
    if (!this.enabled) return { ok: false, skipped: true };
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        timeout: 8000
      });
      const j = await res.json();
      if (!j.ok) console.warn('[telegram] send failed:', j.description);
      return j;
    } catch (e) {
      console.warn('[telegram] send error:', e.message);
      return { ok: false, error: e.message };
    }
  }

  sendAlert(title, body) { return this._send(`🔔 <b>${title}</b>\n\n${body}\n<i>${this._istTime()}</i>`); }

  sendEntry(pos) {
    return this._send(
      `🟢 <b>ENTRY — ${pos.symbol}</b>\n` +
      `${pos.side} ${pos.qty} @ ₹${pos.entryPrice.toFixed(2)}\n` +
      `SL ₹${pos.sl.toFixed(2)} · Target ₹${pos.target.toFixed(2)}\n` +
      `Reason: ${pos.reason}\n<i>${this._istTime()}</i>`
    );
  }

  sendExit(closed) {
    const emoji = closed.finalPnlAbs >= 0 ? '✅' : '❌';
    return this._send(
      `${emoji} <b>EXIT — ${closed.symbol}</b> (${closed.exitReason})\n` +
      `${closed.side} ${closed.qty} | ₹${closed.entryPrice.toFixed(2)} → ₹${closed.exitPrice.toFixed(2)}\n` +
      `Gross ₹${closed.grossPnl} − charges ₹${closed.charges} = <b>net ₹${closed.finalPnlAbs}</b> (${closed.finalPnlPct}%)\n` +
      `<i>${this._istTime()}</i>`
    );
  }

  sendHalt(symbol, reason) {
    return this._send(`⛔ <b>HALT — ${symbol}</b>\nAuto trading disabled: <b>${reason}</b>\nReview, then POST /api/engine/reset?sym=${symbol}\n<i>${this._istTime()}</i>`);
  }

  sendEod(s) {
    const lines = Object.entries(s.symbols).filter(([, v]) => v.trades > 0)
      .map(([k, v]) => `  ${k}: ${v.trades} trades, ₹${v.pnl}`).join('\n');
    return this._send(
      `📊 <b>EOD ${s.date}</b>\nNet P&L: <b>₹${s.totalPnl}</b> · Win ${s.overallWinRate}%\n${lines || '  no trades'}\n<i>${this._istTime()}</i>`
    );
  }

  sendTest() {
    return this._send(`✅ <b>Test — Antigravity Stock Bot</b>\nTelegram alerts working.\nChat: ${this.chatId}\n<i>${this._istTime()}</i>`);
  }
}

module.exports = TelegramAlerter;
