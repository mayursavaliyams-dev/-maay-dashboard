/**
 * FORWARD-TEST LOGGER — Sharded data collection for validation
 *
 * When FORWARD_TEST_DATE_FROM is set, isolates all trades from that date onward
 * into a separate shard: data/forward-test/{date}-strangle.jsonl + daily stats.
 *
 * Purpose: Collect clean, independent validation data before live approval.
 * - All forward-test trades are logged to sharded JSONL (one per line)
 * - Daily stats: count, wins, pnl, avg points per trade, margin utilization
 * - Files persist so stats accumulate correctly across sessions/days
 */

const fs = require('fs');
const path = require('path');

class ForwardTestLogger {
  constructor() {
    // FORWARD_TEST_DATE_FROM: e.g. "2026-06-22" — start of the validation window.
    // Empty = disabled (log to global trades.json instead).
    this.startDate = (process.env.FORWARD_TEST_DATE_FROM || '').trim();
    this.enabled = this.startDate && /^\d{4}-\d{2}-\d{2}$/.test(this.startDate);
    this.dataDir = path.join(__dirname, 'data', 'forward-test');
    
    // File paths — created on first write
    this.tradesFile = path.join(this.dataDir, `${this.startDate}-strangle.jsonl`);
    this.statsFile = path.join(this.dataDir, `${this.startDate}-stats.json`);
    
    // In-memory cache of stats (loaded at startup, updated on each trade)
    this.stats = {};
    if (this.enabled) {
      this._ensureDir();
      this._loadStats();
    }
  }

  _ensureDir() {
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch (_) {}
  }

  _loadStats() {
    if (!fs.existsSync(this.statsFile)) return;
    try {
      this.stats = JSON.parse(fs.readFileSync(this.statsFile, 'utf8')) || {};
    } catch (_) {
      this.stats = {};
    }
  }

  _istDate() {
    return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /**
   * Log a closed trade.
   * call with trade object: { inst, structure, credit, pnlAbs, pnlPct, ... }
   */
  logTrade(trade) {
    if (!this.enabled) return;
    
    const today = this._istDate();
    
    // Only log if the trade date is >= startDate
    const tradeDate = trade.date || today;
    if (tradeDate < this.startDate) return;
    
    try {
      this._ensureDir();
      
      // Append to JSONL (one trade per line, newline-delimited)
      const line = JSON.stringify(trade) + '\n';
      fs.appendFileSync(this.tradesFile, line);
      
      // Update in-memory stats
      this._updateStats(trade, tradeDate);
      this._saveStats();
    } catch (err) {
      console.error('[forward-test-logger] Error logging trade:', err.message);
    }
  }

  _updateStats(trade, date) {
    // Initialize date bucket if not present
    if (!this.stats[date]) {
      this.stats[date] = {
        date,
        tradeCount: 0,
        wins: 0,
        losses: 0,
        netPnl: 0,
        avgPnlPerTrade: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
      };
    }
    
    const day = this.stats[date];
    day.tradeCount++;
    
    const pnl = Number(trade.pnlAbs || 0);
    day.netPnl += pnl;
    
    if (pnl > 0) {
      day.wins++;
      day.avgWin = (day.avgWin * (day.wins - 1) + pnl) / day.wins; // rolling avg
    } else if (pnl < 0) {
      day.losses++;
      day.avgLoss = (day.avgLoss * (day.losses - 1) + pnl) / day.losses;
    }
    
    day.winRate = day.tradeCount ? +(100 * day.wins / day.tradeCount).toFixed(1) : 0;
    day.avgPnlPerTrade = day.tradeCount ? +(day.netPnl / day.tradeCount).toFixed(2) : 0;
  }

  _saveStats() {
    try {
      this._ensureDir();
      fs.writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2));
    } catch (err) {
      console.error('[forward-test-logger] Error saving stats:', err.message);
    }
  }

  /**
   * Get the full status of the current forward-test window
   */
  status() {
    if (!this.enabled) {
      return { enabled: false, message: 'FORWARD_TEST_DATE_FROM not set' };
    }
    
    const dates = Object.keys(this.stats).sort();
    const totalTrades = dates.reduce((sum, d) => sum + (this.stats[d].tradeCount || 0), 0);
    const totalWins = dates.reduce((sum, d) => sum + (this.stats[d].wins || 0), 0);
    const totalNetPnl = dates.reduce((sum, d) => sum + (this.stats[d].netPnl || 0), 0);
    
    return {
      enabled: true,
      windowStart: this.startDate,
      totalDays: dates.length,
      totalTrades,
      totalWins,
      totalNetPnl: +totalNetPnl.toFixed(2),
      overallWinRate: totalTrades ? +(100 * totalWins / totalTrades).toFixed(1) : 0,
      avgPnlPerTrade: totalTrades ? +(totalNetPnl / totalTrades).toFixed(2) : 0,
      dates: dates.map(d => ({
        date: d,
        ...this.stats[d],
      })),
    };
  }
}

module.exports = ForwardTestLogger;
