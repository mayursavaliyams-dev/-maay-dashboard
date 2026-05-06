/**
 * REPORT GENERATOR — Antigravity Trading System
 * Generates daily/weekly/monthly P&L reports from closed positions.
 * Exports CSV and structured JSON for dashboard consumption.
 *
 * Usage:
 *   const ReportGenerator = require('./report-generator');
 *   const rg = new ReportGenerator({ dataDir: './data' });
 *   const daily  = rg.generateDailyReport(closedPositions, new Date());
 *   const weekly = rg.generateWeeklyReport(closedPositions, new Date());
 *   const csv    = rg.toCSV(closedPositions);
 */

const fs   = require('fs');
const path = require('path');

class ReportGenerator {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || path.resolve('./data');
    this.reportsDir = path.join(this.dataDir, 'reports');
    if (!fs.existsSync(this.reportsDir)) fs.mkdirSync(this.reportsDir, { recursive: true });
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _istDate(d) {
    return new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }

  _pnlOf(p) { return parseFloat(p.finalPnlAbs || 0); }

  _parsePos(p) {
    return {
      instrument: p.instrument || 'SENSEX',
      signal:     p.signal || '--',
      type:       p.type || '--',
      strike:     p.strike || 0,
      entryPrice: +parseFloat(p.entryPrice || 0).toFixed(2),
      exitPrice:  +parseFloat(p.exitPrice  || 0).toFixed(2),
      lots:       p.lots || 0,
      quantity:   p.quantity || 0,
      deployed:   +parseFloat(p.deployed || 0).toFixed(0),
      mult:       +parseFloat(p.finalMult || 0).toFixed(3),
      pnlPct:     +parseFloat(p.finalPnlPct || 0).toFixed(1),
      pnlAbs:     +this._pnlOf(p).toFixed(0),
      exitReason: p.exitReason || p.status || 'MANUAL',
      enteredAt:  p.enteredAt || '',
      exitAt:     p.exitAt || '',
      paperMode:  !!p.paperMode
    };
  }

  _aggregateStats(trades) {
    if (!trades.length) return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      grossProfit: 0, grossLoss: 0, netPnl: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, expectancy: 0, bestTrade: 0, worstTrade: 0, maxDrawdown: 0
    };

    const pnls = trades.map(t => this._pnlOf(t));
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const grossProfit = wins.reduce((s, p) => s + p, 0);
    const grossLoss   = Math.abs(losses.reduce((s, p) => s + p, 0));
    const netPnl      = grossProfit - grossLoss;
    const avgWin      = wins.length ? grossProfit / wins.length : 0;
    const avgLoss     = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99.99 : 0);
    const expectancy  = netPnl / trades.length;
    const bestTrade   = Math.max(...pnls, 0);
    const worstTrade  = Math.min(...pnls, 0);

    // Max drawdown
    let cumPnl = 0, peak = 0, maxDD = 0;
    for (const p of pnls) {
      cumPnl += p; if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl; if (dd > maxDD) maxDD = dd;
    }

    return {
      totalTrades:  trades.length,
      wins:         wins.length,
      losses:       losses.length,
      winRate:      +(wins.length / trades.length * 100).toFixed(1),
      grossProfit:  +grossProfit.toFixed(0),
      grossLoss:    +grossLoss.toFixed(0),
      netPnl:       +netPnl.toFixed(0),
      avgWin:       +avgWin.toFixed(0),
      avgLoss:      +avgLoss.toFixed(0),
      profitFactor: +profitFactor.toFixed(2),
      expectancy:   +expectancy.toFixed(0),
      bestTrade:    +bestTrade.toFixed(0),
      worstTrade:   +worstTrade.toFixed(0),
      maxDrawdown:  +maxDD.toFixed(0)
    };
  }

  // ── Daily Report ────────────────────────────────────────────────
  generateDailyReport(closedPositions, date = new Date()) {
    const target = this._istDate(date);
    const trades = closedPositions.filter(p =>
      p.exitAt && this._istDate(p.exitAt) === target
    );
    const parsed = trades.map(t => this._parsePos(t));
    const stats  = this._aggregateStats(trades);

    // Per-instrument breakdown
    const byInstrument = {};
    for (const t of parsed) {
      const k = t.instrument;
      if (!byInstrument[k]) byInstrument[k] = { trades: 0, wins: 0, pnl: 0 };
      byInstrument[k].trades++;
      if (t.pnlAbs > 0) byInstrument[k].wins++;
      byInstrument[k].pnl += t.pnlAbs;
    }
    for (const k of Object.keys(byInstrument)) {
      byInstrument[k].pnl = +byInstrument[k].pnl.toFixed(0);
      byInstrument[k].winRate = byInstrument[k].trades
        ? +(byInstrument[k].wins / byInstrument[k].trades * 100).toFixed(1) : 0;
    }

    const report = {
      type: 'daily',
      date: target,
      generatedAt: new Date().toISOString(),
      stats,
      byInstrument,
      trades: parsed
    };

    // Auto-save
    const filename = `daily_${target}.json`;
    fs.writeFileSync(path.join(this.reportsDir, filename), JSON.stringify(report, null, 2));

    return report;
  }

  // ── Weekly Report ───────────────────────────────────────────────
  generateWeeklyReport(closedPositions, endDate = new Date()) {
    const end   = new Date(endDate);
    const start = new Date(end.getTime() - 7 * 86400000);
    const endStr   = this._istDate(end);
    const startStr = this._istDate(start);

    const trades = closedPositions.filter(p => {
      if (!p.exitAt) return false;
      const d = this._istDate(p.exitAt);
      return d >= startStr && d <= endStr;
    });

    const parsed = trades.map(t => this._parsePos(t));
    const stats  = this._aggregateStats(trades);

    // Daily breakdown
    const dailyMap = {};
    for (const t of parsed) {
      const d = t.exitAt ? this._istDate(t.exitAt) : 'unknown';
      if (!dailyMap[d]) dailyMap[d] = { date: d, trades: 0, wins: 0, pnl: 0 };
      dailyMap[d].trades++;
      if (t.pnlAbs > 0) dailyMap[d].wins++;
      dailyMap[d].pnl += t.pnlAbs;
    }
    const dailyBreakdown = Object.values(dailyMap)
      .map(d => ({ ...d, pnl: +d.pnl.toFixed(0) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Per-instrument breakdown
    const byInstrument = {};
    for (const t of parsed) {
      const k = t.instrument;
      if (!byInstrument[k]) byInstrument[k] = { trades: 0, wins: 0, pnl: 0 };
      byInstrument[k].trades++;
      if (t.pnlAbs > 0) byInstrument[k].wins++;
      byInstrument[k].pnl += t.pnlAbs;
    }
    for (const k of Object.keys(byInstrument)) {
      byInstrument[k].pnl = +byInstrument[k].pnl.toFixed(0);
    }

    const report = {
      type: 'weekly',
      period: { from: startStr, to: endStr },
      generatedAt: new Date().toISOString(),
      stats,
      byInstrument,
      dailyBreakdown,
      trades: parsed
    };

    const filename = `weekly_${startStr}_${endStr}.json`;
    fs.writeFileSync(path.join(this.reportsDir, filename), JSON.stringify(report, null, 2));

    return report;
  }

  // ── CSV Export ──────────────────────────────────────────────────
  toCSV(closedPositions) {
    const headers = [
      'Date', 'Instrument', 'Signal', 'Type', 'Strike',
      'Entry', 'Exit', 'Lots', 'Qty', 'Deployed',
      'Mult', 'P&L %', 'P&L ₹', 'Exit Reason', 'Paper', 'EnteredAt', 'ExitAt'
    ];
    const rows = closedPositions.map(p => {
      const t = this._parsePos(p);
      return [
        t.exitAt ? this._istDate(t.exitAt) : '',
        t.instrument, t.signal, t.type, t.strike,
        t.entryPrice, t.exitPrice, t.lots, t.quantity, t.deployed,
        t.mult, t.pnlPct, t.pnlAbs, t.exitReason, t.paperMode ? 'Yes' : 'No',
        t.enteredAt, t.exitAt
      ].join(',');
    });
    return [headers.join(','), ...rows].join('\n');
  }

  // ── List saved reports ─────────────────────────────────────────
  listReports() {
    try {
      const files = fs.readdirSync(this.reportsDir).filter(f => f.endsWith('.json'));
      return files.map(f => {
        const stat = fs.statSync(path.join(this.reportsDir, f));
        return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
      }).sort((a, b) => b.modified.localeCompare(a.modified));
    } catch (_) { return []; }
  }
}

module.exports = ReportGenerator;
