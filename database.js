/**
 * SIMPLE JSON DATABASE
 * File-based storage without native dependencies
 * Stores data in JSON files for easy portability
 */

const fs = require('fs');
const path = require('path');

class SimpleDB {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.ensureDir();

    // Initialize data files
    this.files = {
      prices: 'prices.json',
      candles: 'candles.json',
      trades: 'trades.json',
      signals: 'signals.json',
      optionChain: 'optionchain.json'
    };

    // Initialize all files
    Object.values(this.files).forEach(file => this.initFile(file));

    console.log('✅ Database initialized:', dataDir);
  }

  /**
   * Ensure data directory exists
   */
  ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Initialize JSON file if it doesn't exist
   */
  initFile(filename) {
    const filepath = path.join(this.dataDir, filename);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, JSON.stringify([], null, 2));
    }
  }

  /**
   * Read data from file
   */
  read(filename) {
    try {
      const filepath = path.join(this.dataDir, filename);
      const data = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading ${filename}:`, error.message);
      return [];
    }
  }

  /**
   * Write data to file
   */
  write(filename, data) {
    try {
      const filepath = path.join(this.dataDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`Error writing ${filename}:`, error.message);
      return false;
    }
  }

  /**
   * Append to array
   */
  append(filename, item) {
    const data = this.read(filename);
    data.push(item);
    return this.write(filename, data);
  }

  /**
   * Save price data
   */
  savePrice(price, volume = 0, source = 'demo') {
    return this.append(this.files.prices, {
      timestamp: new Date().toISOString(),
      price,
      volume,
      source
    });
  }

  /**
   * Save OHLCV candle
   */
  saveCandle(date, time, open, high, low, close, volume = 0, source = 'demo') {
    return this.append(this.files.candles, {
      date,
      time,
      open,
      high,
      low,
      close,
      volume,
      source
    });
  }

  /**
   * Save trade
   */
  saveTrade(trade) {
    return this.append(this.files.trades, {
      ...trade,
      id: Date.now(),
      createdAt: new Date().toISOString()
    });
  }

  /**
   * Save signal
   */
  saveSignal(data) {
    return this.append(this.files.signals, {
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get price history
   */
  getPriceHistory(limit = 100) {
    const data = this.read(this.files.prices);
    return data.slice(-limit).reverse();
  }

  /**
   * Get candles by date
   */
  getCandlesByDate(date) {
    const data = this.read(this.files.candles);
    return data.filter(c => c.date === date).sort((a, b) => a.time.localeCompare(b.time));
  }

  /**
   * Get available dates
   */
  getAvailableDates() {
    const data = this.read(this.files.candles);
    const dates = [...new Set(data.map(c => c.date))];
    return dates.sort().reverse();
  }

  /**
   * Get trades
   */
  getTrades(limit = 50) {
    const data = this.read(this.files.trades);
    return data.slice(-limit).reverse();
  }

  /**
   * Get trades by date
   */
  getTradesByDate(date) {
    const data = this.read(this.files.trades);
    return data.filter(t => t.date === date);
  }

  /**
   * Get all trades stats
   */
  getTradingStats() {
    const data = this.read(this.files.trades);

    const total = data.length;
    const wins = data.filter(t => t.pnl > 0).length;
    const losses = data.filter(t => t.pnl <= 0).length;
    const totalPnl = data.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgMultiplier = data.length > 0
      ? (data.reduce((sum, t) => sum + (t.multiplier || 0), 0) / data.length).toFixed(2)
      : 0;
    const maxMultiplier = data.length > 0
      ? Math.max(...data.map(t => t.multiplier || 0))
      : 0;

    return {
      total_trades: total,
      winning_trades: wins,
      losing_trades: losses,
      win_rate: total > 0 ? ((wins / total) * 100).toFixed(2) : 0,
      total_pnl: totalPnl.toFixed(2),
      avg_multiplier: avgMultiplier,
      max_multiplier: maxMultiplier
    };
  }

  /**
   * Get signals
   */
  getSignals(limit = 50) {
    const data = this.read(this.files.signals);
    return data.slice(-limit).reverse();
  }

  /**
   * Clear old data (keep last N records)
   */
  prune(limit = 10000) {
    Object.values(this.files).forEach(filename => {
      const data = this.read(filename);
      if (data.length > limit) {
        this.write(filename, data.slice(-limit));
      }
    });
    console.log('🗑️  Database pruned');
  }

  /**
   * Get database size
   */
  getSize() {
    let totalSize = 0;
    let totalRecords = 0;

    Object.entries(this.files).forEach(([name, filename]) => {
      const filepath = path.join(this.dataDir, filename);
      if (fs.existsSync(filepath)) {
        const stats = fs.statSync(filepath);
        totalSize += stats.size;
        const data = this.read(filename);
        totalRecords += data.length;
      }
    });

    return {
      size: (totalSize / 1024).toFixed(2) + ' KB',
      records: totalRecords
    };
  }
}

module.exports = SimpleDB;
