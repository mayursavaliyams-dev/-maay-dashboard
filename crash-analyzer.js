/**
 * CRASH LOG ANALYZER — Parse and analyze crash.log for patterns & alerts
 *
 * Crash Guard logs all unhandled exceptions + rejections to data/crash.log.
 * This module parses that log, groups errors, and flags recurring issues.
 *
 * Usage:
 *   const analyzer = require('./crash-analyzer.js');
 *   console.log(analyzer.report());  // summary of crashes
 */

const fs = require('fs');
const path = require('path');

class CrashAnalyzer {
  constructor() {
    this.logFile = path.join(__dirname, 'data', 'crash.log');
  }

  /**
   * Parse the crash log and return structured data
   */
  _parseLogs() {
    if (!fs.existsSync(this.logFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.logFile, 'utf8');
      const blocks = content.split(/\n(?=\[)/);  // split on timestamp lines
      
      const crashes = [];
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        const match = lines[0]?.match(/\[(\d{4}-\d{2}-\d{2}T[\d:]+Z)\] (\w+)/);
        if (!match) continue;

        const timestamp = match[1];
        const kind = match[2];
        const message = lines.slice(1).join('\n').trim();
        
        // Extract error type from message (first line usually)
        const errorLine = message.split('\n')[0];
        const errorType = this._extractErrorType(errorLine);

        crashes.push({
          timestamp,
          kind,
          errorType,
          message,
          fullBlock: block
        });
      }
      return crashes;
    } catch (err) {
      return [];
    }
  }

  _extractErrorType(line) {
    // Try to extract a standard error name (e.g., "TypeError:", "ECONNREFUSED", etc.)
    const match = line.match(/(\w+(?:Error|Exception|Timeout|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH))/i);
    return match ? match[1] : 'Unknown';
  }

  /**
   * Get crashes from the last N hours
   */
  crashesInLastHours(hours = 24) {
    const crashes = this._parseLogs();
    const now = Date.now();
    const cutoff = now - (hours * 60 * 60 * 1000);
    
    return crashes.filter(c => {
      try {
        const t = new Date(c.timestamp).getTime();
        return t >= cutoff;
      } catch {
        return false;
      }
    });
  }

  /**
   * Count crashes by type
   */
  crashesByType(hours = 24) {
    const crashes = this.crashesInLastHours(hours);
    const counts = {};
    
    for (const c of crashes) {
      const type = c.errorType;
      counts[type] = (counts[type] || 0) + 1;
    }
    
    return Object.entries(counts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get a summary report
   */
  report(hours = 24) {
    const crashes = this.crashesInLastHours(hours);
    const byType = this.crashesByType(hours);
    
    // Flag if crashes are exceeding safe thresholds
    const alerts = [];
    if (crashes.length > 10) {
      alerts.push({
        severity: 'warn',
        message: `High crash rate: ${crashes.length} crashes in ${hours}h (threshold: 10)`
      });
    }
    
    // Check for recurring error types
    for (const { type, count } of byType) {
      if (count >= 3) {
        alerts.push({
          severity: 'warn',
          message: `Recurring error: ${type} happened ${count} times`
        });
      }
    }
    
    // Check for crashes in the last hour (immediate problem)
    const recentCrashes = this.crashesInLastHours(1);
    if (recentCrashes.length >= 2) {
      alerts.push({
        severity: 'critical',
        message: `⛔ CRITICAL: ${recentCrashes.length} crashes in the last hour. Investigate immediately.`
      });
    }

    return {
      total: crashes.length,
      hours,
      byType,
      recent: crashes.slice(-5).reverse(),  // last 5 crashes
      alerts,
      healthScore: Math.max(0, 100 - (crashes.length * 5) - (alerts.length * 20))
    };
  }

  /**
   * Get detailed info for a specific crash
   */
  getCrashDetails(index) {
    const crashes = this._parseLogs();
    if (index < 0 || index >= crashes.length) {
      return null;
    }
    return crashes[crashes.length - 1 - index];  // return in reverse order
  }

  /**
   * Clear crash log (use with caution)
   */
  clearLog() {
    try {
      fs.writeFileSync(this.logFile, '');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = CrashAnalyzer;
