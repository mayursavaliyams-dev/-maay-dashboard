/**
 * AMIBROKER BRIDGE — Antigravity Pro
 * 
 * Two-way bridge between AmiBroker and the Antigravity trading server:
 *   1. AmiBroker → Server: Receive buy/sell orders from AFL via HTTP POST
 *   2. Server → AmiBroker: Serve live signals/data via HTTP GET for AFL polling
 * 
 * Endpoints:
 *   POST /api/amibroker/order    — AFL sends order here (auto-execute via Dhan/Kotak)
 *   GET  /api/amibroker/signal   — AFL polls for current signal
 *   GET  /api/amibroker/data     — AFL polls for SENSEX price/ORB/VWAP data
 *   GET  /api/amibroker/position — AFL polls for open position status
 *   POST /api/amibroker/webhook  — Generic webhook for AFL events
 *   GET  /api/amibroker/status   — Bridge status
 */

const fs = require('fs');
const path = require('path');

class AmiBrokerBridge {
  constructor(config = {}) {
    this.enabled = config.enabled ?? (process.env.AMIBROKER_BRIDGE === 'true');
    this.apiKey  = config.apiKey || process.env.AMIBROKER_API_KEY || 'antigravity';
    this.connected = false;
    this.autoTrade = config.autoTrade ?? (String(process.env.AMIBROKER_AUTO_TRADE || 'false').toLowerCase() === 'true');
    this.allowLive = config.allowLive ?? (String(process.env.AMIBROKER_ALLOW_LIVE || 'false').toLowerCase() === 'true');
    this.minConfidence = parseFloat(config.minConfidence || process.env.AMIBROKER_MIN_CONFIDENCE || 70);
    this.dedupeMs = Math.max(0, parseFloat(config.dedupeSeconds || process.env.AMIBROKER_DEDUPE_SECONDS || 30) * 1000);
    this.signalStoreEnabled = config.signalStoreEnabled ?? (String(process.env.AMIBROKER_SIGNAL_STORE || 'true').toLowerCase() !== 'false');
    const storeDir = config.signalStoreDir || process.env.AMIBROKER_SIGNAL_DIR || path.join('data', 'ami-signals');
    this.signalStoreDir = path.isAbsolute(storeDir) ? storeDir : path.join(__dirname, storeDir);
    // Signal lifecycle: a CALL/PUT single is "ACTIVE" for this many minutes after it
    // arrives, then it becomes EXPIRED. Expired signals are KEPT (never deleted) so the
    // saved feed stays intact — they just render greyed-out as EXPIRED. 0 = never expire.
    this.signalTtlMs = Math.max(0, parseFloat(config.signalTtlMinutes || process.env.AMIBROKER_SIGNAL_TTL_MIN || 30) * 60 * 1000);

    // Track incoming AFL signals
    this.lastAflSignal = null;
    this.lastAflOrder  = null;
    this.orderHistory  = [];
    this.signalHistory = [];
    this.lastSignalKey = null;
    this.lastSignalKeyAt = 0;

    // Stats
    this.stats = {
      ordersReceived: 0,
      signalsReceived: 0,
      signalsExecuted: 0,
      duplicateSignals: 0,
      ignoredSignals: 0,
      signalPolls: 0,
      lastOrderAt: null,
      lastSignalAt: null,
      lastExecutionAt: null,
      lastPollAt: null
    };

    this.loadTodaySignalHistory();
  }

  /**
   * Validate API key from request header or query param
   */
  authenticate(req) {
    const key = req.headers['x-api-key'] || req.query.key || req.body?.key;
    if (!this.apiKey || this.apiKey === 'antigravity') return true; // default = no auth
    return key === this.apiKey;
  }

  istDateString(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(d.getTime())) return this.istDateString(new Date());
    return new Date(d.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
  }

  istTimeString(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(d.getTime())) return '';
    return new Date(d.getTime() + 330 * 60 * 1000).toISOString().slice(11, 19);
  }

  normalizeStoreDate(date) {
    const s = String(date || this.istDateString()).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : this.istDateString();
  }

  signalStoreFile(date = this.istDateString()) {
    return path.join(this.signalStoreDir, `ami-signals-${this.normalizeStoreDate(date)}.jsonl`);
  }

  ensureSignalStoreDir() {
    if (!this.signalStoreEnabled) return false;
    fs.mkdirSync(this.signalStoreDir, { recursive: true });
    return true;
  }

  makeSignalRecord(signal, event, execution, receivedAt) {
    const receivedDate = new Date(receivedAt);
    const date = this.istDateString(receivedDate);
    const time = this.istTimeString(receivedDate);
    const recMs = receivedDate.getTime();
    const isEntry = signal.signal === 'CALL' || signal.signal === 'PUT';
    // Stamp an absolute expiry on entry singles so the lifecycle is reproducible even
    // after a restart or if the TTL setting later changes. EXIT events don't expire.
    const expiresAt = (isEntry && this.signalTtlMs > 0 && Number.isFinite(recMs))
      ? new Date(recMs + this.signalTtlMs).toISOString()
      : null;
    return {
      id: `${receivedAt}|${this.signalKey(signal)}`,
      date,
      time,
      ...signal,
      event,
      execution,
      receivedAt,
      expiresAt,
      ttlMin: this.signalTtlMs > 0 ? Math.round(this.signalTtlMs / 60000) : 0
    };
  }

  // Current lifecycle of a stored signal: 'ACTIVE' | 'EXPIRED' | 'EXIT'.
  // Computed on read so an active single auto-flips to EXPIRED once its window passes —
  // the record itself is never mutated or removed.
  lifecycleOf(signal, now = Date.now()) {
    if (!signal) return 'ACTIVE';
    if (String(signal.action || '').toUpperCase() === 'EXIT') return 'EXIT';
    let exp = signal.expiresAt ? new Date(signal.expiresAt).getTime() : NaN;
    if (!Number.isFinite(exp) && this.signalTtlMs > 0 && signal.receivedAt) {
      const r = new Date(signal.receivedAt).getTime();
      if (Number.isFinite(r)) exp = r + this.signalTtlMs;
    }
    if (Number.isFinite(exp) && now > exp) return 'EXPIRED';
    return 'ACTIVE';
  }

  appendStoredSignal(record) {
    if (!this.signalStoreEnabled || !record) return false;
    try {
      this.ensureSignalStoreDir();
      fs.appendFileSync(this.signalStoreFile(record.date), `${JSON.stringify(record)}\n`, 'utf8');
      return true;
    } catch (err) {
      console.warn(`[amibroker] signal store write failed: ${err.message}`);
      return false;
    }
  }

  readStoredSignals(date = this.istDateString()) {
    if (!this.signalStoreEnabled) return [];
    try {
      const file = this.signalStoreFile(date);
      if (!fs.existsSync(file)) return [];
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      const signals = [];
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item && typeof item === 'object') signals.push(item);
        } catch (_) {
          // Ignore partial/corrupt lines so one bad write never breaks the panel.
        }
      }
      return signals;
    } catch (err) {
      console.warn(`[amibroker] signal store read failed: ${err.message}`);
      return [];
    }
  }

  loadTodaySignalHistory() {
    const signals = this.readStoredSignals(this.istDateString());
    if (!signals.length) return;
    this.signalHistory = signals.slice(-300);
    const last = this.signalHistory[this.signalHistory.length - 1];
    this.lastAflSignal = {
      event: last.event || (last.action === 'EXIT' ? 'EXIT' : 'SIGNAL'),
      data: last,
      duplicate: false,
      receivedAt: last.receivedAt,
      execution: last.execution || null
    };
    this.stats.lastSignalAt = last.receivedAt || null;
  }

  parseTimeMinutes(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    const m = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return fallback;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    return hour * 60 + minute;
  }

  signalIstMinutes(signal) {
    if (signal?.time && /^\d{1,2}:\d{2}/.test(String(signal.time))) {
      return this.parseTimeMinutes(signal.time);
    }
    const d = new Date(signal?.receivedAt || 0);
    if (!Number.isFinite(d.getTime())) return null;
    const ist = new Date(d.getTime() + 330 * 60 * 1000);
    return ist.getUTCHours() * 60 + ist.getUTCMinutes();
  }

  filterSignals(signals, opts = {}) {
    const inst = String(opts.inst || opts.instrument || '').toUpperCase();
    const date = opts.date ? this.normalizeStoreDate(opts.date) : '';
    const fromMin = this.parseTimeMinutes(opts.from, null);
    const toMin = this.parseTimeMinutes(opts.to, null);
    return (signals || []).filter(s => {
      if (inst && String(s.instrument || '').toUpperCase() !== inst) return false;
      if (date) {
        const sigDate = s.date || this.istDateString(new Date(s.receivedAt || 0));
        if (sigDate !== date) return false;
      }
      const mins = this.signalIstMinutes(s);
      if (fromMin !== null && mins !== null && mins < fromMin) return false;
      if (toMin !== null && mins !== null && mins > toMin) return false;
      return true;
    });
  }

  signalsForQuery(query = {}) {
    const date = query.date ? this.normalizeStoreDate(query.date) : '';
    const source = date ? this.readStoredSignals(date) : (this.signalHistory || []);
    const filtered = this.filterSignals(source, {
      inst: query.inst || query.instrument,
      date,
      from: query.from,
      to: query.to
    });
    const limit = Math.max(1, Math.min(2000, parseInt(query.limit, 10) || 80));
    const now = Date.now();
    const active = filtered.filter(s => this.lifecycleOf(s, now) === 'ACTIVE').length;
    return {
      date: date || null,
      // newest-first, each tagged with its live lifecycle (ACTIVE/EXPIRED/EXIT)
      signals: filtered.slice(-limit).reverse().map(s => ({ ...s, lifecycle: this.lifecycleOf(s, now) })),
      total: filtered.length,
      active,
      ttlMin: this.signalTtlMs > 0 ? Math.round(this.signalTtlMs / 60000) : 0
    };
  }

  signalReplayBacktest(query = {}) {
    const date = this.normalizeStoreDate(query.date);
    const inst = String(query.inst || query.instrument || '').toUpperCase();
    const from = query.from || '09:30';
    const to = query.to || '15:30';
    const lotSize = Math.max(1, parseInt(query.lotSize, 10) || 1);
    const modeInput = String(query.mode || '').toLowerCase();

    let signals = this.filterSignals(this.readStoredSignals(date), { inst, date, from, to })
      .filter(s => {
        const sig = String(s.signal || '').toUpperCase();
        return sig === 'CALL' || sig === 'PUT' || sig === 'EXIT' || s.action === 'EXIT';
      })
      .sort((a, b) => new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0));

    const hasPremium = signals.some(s => Number(s.premium || s.optionPrice || 0) > 0);
    const priceField = modeInput === 'spot'
      ? 'price'
      : (modeInput === 'option' || hasPremium ? 'premium' : 'price');
    const priceOf = s => {
      if (!s) return 0;
      return Number(priceField === 'premium'
        ? (s.premium || s.optionPrice || s.optionPremium || 0)
        : (s.price || 0));
    };

    const trades = [];
    let open = null;
    let skippedSignals = 0;

    const closeOpen = (signal, reason) => {
      if (!open) return;
      const exitPrice = priceOf(signal);
      if (!(exitPrice > 0)) {
        trades.push({ ...open, status: 'OPEN', exitReason: 'missing_exit_price' });
        open = null;
        return;
      }
      const pnlPoints = open.side === 'CALL'
        ? exitPrice - open.entryPrice
        : open.entryPrice - exitPrice;
      trades.push({
        ...open,
        status: 'CLOSED',
        exitAt: signal.receivedAt || null,
        exitTime: signal.time || this.istTimeString(new Date(signal.receivedAt || 0)),
        exitSignal: signal.signal || signal.action || '',
        exitPrice,
        exitReason: reason,
        pnlPoints: +pnlPoints.toFixed(2),
        pnlValue: +(pnlPoints * lotSize).toFixed(2)
      });
      open = null;
    };

    for (const s of signals) {
      const sig = String(s.signal || '').toUpperCase();
      const action = String(s.action || '').toUpperCase();
      if (action === 'EXIT' || sig === 'EXIT') {
        if (open) closeOpen(s, 'exit_signal');
        else skippedSignals++;
        continue;
      }

      if (sig !== 'CALL' && sig !== 'PUT') continue;
      const entryPrice = priceOf(s);
      if (!(entryPrice > 0)) {
        skippedSignals++;
        continue;
      }

      if (open) {
        if (open.side === sig && Number(open.strike || 0) === Number(s.strike || 0)) {
          skippedSignals++;
          continue;
        }
        closeOpen(s, `reverse_to_${sig}`);
      }

      open = {
        side: sig,
        instrument: s.instrument || inst || 'ALL',
        strike: Number(s.strike || 0),
        entryAt: s.receivedAt || null,
        entryTime: s.time || this.istTimeString(new Date(s.receivedAt || 0)),
        entryPrice,
        conf: Number(s.conf || 0),
        source: s.source || '',
        barId: s.barId || ''
      };
    }

    if (open) trades.push({ ...open, status: 'OPEN', exitReason: 'still_open' });

    const closed = trades.filter(t => t.status === 'CLOSED' && Number.isFinite(Number(t.pnlPoints)));
    const totalPoints = closed.reduce((sum, t) => sum + Number(t.pnlPoints || 0), 0);
    const totalValue = closed.reduce((sum, t) => sum + Number(t.pnlValue || 0), 0);
    const wins = closed.filter(t => Number(t.pnlPoints || 0) > 0).length;
    const losses = closed.filter(t => Number(t.pnlPoints || 0) < 0).length;

    return {
      ok: true,
      date,
      instrument: inst || 'ALL',
      window: { from, to },
      mode: priceField === 'premium' ? 'option_premium' : 'spot_points',
      note: priceField === 'premium'
        ? 'Uses premium/optionPrice from AmiBroker payload when available.'
        : 'Uses AFL price field as signal-to-signal spot replay; send premium/optionPrice for option P&L.',
      signalCount: signals.length,
      skippedSignals,
      tradeCount: trades.length,
      closedTrades: closed.length,
      summary: {
        totalPoints: +totalPoints.toFixed(2),
        totalValue: +totalValue.toFixed(2),
        wins,
        losses,
        winRate: closed.length ? +((wins / closed.length) * 100).toFixed(1) : 0,
        avgPoints: closed.length ? +(totalPoints / closed.length).toFixed(2) : 0
      },
      trades
    };
  }

  normalizeSignal(input = {}, source = 'amibroker') {
    const raw = input || {};
    const event = String(raw.event || raw.action || '').toUpperCase();
    let signal = String(raw.signal || raw.sig || raw.side || raw.direction || '').toUpperCase();
    if (!signal && ['CALL', 'PUT', 'WAIT', 'EXIT'].includes(event)) signal = event;
    if (signal === 'CE' || signal === 'BUY_CALL' || signal === 'LONG_CALL') signal = 'CALL';
    if (signal === 'PE' || signal === 'BUY_PUT' || signal === 'LONG_PUT') signal = 'PUT';

    const symbolText = String(raw.instrument || raw.inst || raw.symbol || '').toUpperCase();
    let instrument = String(raw.instrument || raw.inst || '').toUpperCase();
    if (!instrument) {
      if (symbolText.includes('BANKNIFTY')) instrument = 'BANKNIFTY';
      else if (symbolText.includes('SENSEX')) instrument = 'SENSEX';
      else if (symbolText.includes('NIFTY')) instrument = 'NIFTY';
      else instrument = 'NIFTY';
    }
    if (!['NIFTY', 'SENSEX', 'BANKNIFTY'].includes(instrument)) instrument = 'NIFTY';

    const action = (event === 'EXIT' || event === 'SELL' || event === 'CLOSE' || signal === 'EXIT')
      ? 'EXIT'
      : 'SIGNAL';

    const conf = parseFloat(raw.confidence ?? raw.conf ?? raw.score ?? 0) || 0;
    const strike = parseInt(raw.strike ?? raw.suggestedStrike ?? 0, 10) || 0;
    const price = parseFloat(raw.price ?? raw.ltp ?? raw.entry ?? raw.close ?? 0) || 0;
    const premium = parseFloat(raw.premium ?? raw.optionPrice ?? raw.optionPremium ?? raw.entryPremium ?? 0) || 0;
    const target = parseFloat(raw.target ?? raw.targetMult ?? raw.targetMultiplier ?? 0) || 0;
    const barId = String(raw.barId || raw.bar || raw.barTime || raw.time || raw.timestamp || '');

    return {
      signal,
      action,
      instrument,
      strike,
      conf,
      price,
      premium,
      target,
      reason: raw.reason || raw.message || source,
      strategy: raw.strategy || raw.system || 'AmiBroker',
      timeframe: raw.timeframe || raw.tf || '',
      barId,
      source
    };
  }

  signalKey(sig) {
    return [
      sig.instrument,
      sig.action,
      sig.signal,
      sig.strike || 0,
      sig.barId || ''
    ].join('|');
  }

  async handleIncomingSignal(input, deps, source = 'amibroker') {
    const signal = this.normalizeSignal(input, source);
    const validEntry = signal.signal === 'CALL' || signal.signal === 'PUT';
    const valid = validEntry || signal.signal === 'WAIT' || signal.action === 'EXIT';

    if (!valid) {
      this.stats.ignoredSignals++;
      return { ok: false, ignored: true, reason: 'invalid_signal', signal };
    }

    const now = Date.now();
    const key = this.signalKey(signal);
    const duplicate = validEntry
      && this.lastSignalKey === key
      && this.dedupeMs > 0
      && (now - this.lastSignalKeyAt) < this.dedupeMs;

    this.stats.signalsReceived++;
    this.stats.lastSignalAt = new Date(now).toISOString();

    this.lastAflSignal = {
      event: signal.action === 'EXIT' ? 'EXIT' : 'SIGNAL',
      data: signal,
      duplicate,
      receivedAt: this.stats.lastSignalAt
    };

    let execution = { status: this.autoTrade ? 'READY' : 'DISABLED' };

    if (duplicate) {
      this.stats.duplicateSignals++;
      execution = { status: 'SKIPPED', reason: 'duplicate_signal' };
    } else if (validEntry) {
      this.lastSignalKey = key;
      this.lastSignalKeyAt = now;

      if (this.autoTrade) {
        if (signal.conf < this.minConfidence) {
          execution = { status: 'SKIPPED', reason: 'confidence_below_min', minConfidence: this.minConfidence };
        } else if (typeof deps.executeAmiSignal === 'function') {
          try {
            const result = await deps.executeAmiSignal(signal, { allowLive: this.allowLive });
            execution = { status: result?.ok ? 'EXECUTED' : 'REJECTED', result };
            if (result?.ok) {
              this.stats.signalsExecuted++;
              this.stats.lastExecutionAt = new Date().toISOString();
            }
          } catch (err) {
            execution = { status: 'ERROR', error: err.message };
          }
        } else {
          execution = { status: 'NO_EXECUTOR' };
        }
      }
    } else if (signal.action === 'EXIT' && this.autoTrade) {
      if (typeof deps.exitAmiPosition === 'function') {
        try {
          const result = await deps.exitAmiPosition(signal, { allowLive: this.allowLive });
          execution = { status: result?.ok ? 'EXITED' : 'REJECTED', result };
        } catch (err) {
          execution = { status: 'ERROR', error: err.message };
        }
      } else {
        execution = { status: 'NO_EXIT_EXECUTOR' };
      }
    }

    this.lastAflSignal.execution = execution;
    if ((validEntry || signal.action === 'EXIT') && !duplicate) {
      const record = this.makeSignalRecord(signal, this.lastAflSignal.event, execution, this.lastAflSignal.receivedAt);
      this.signalHistory.push(record);
      this.appendStoredSignal(record);
      if (this.signalHistory.length > 500) {
        this.signalHistory = this.signalHistory.slice(-300);
      }
    }
    console.log(`[amibroker] Signal ${signal.instrument} ${signal.signal} strike=${signal.strike || '-'} conf=${signal.conf} duplicate=${duplicate} exec=${execution.status}`);

    return { ok: true, signal, duplicate, execution };
  }

  /**
   * Register all AmiBroker bridge routes on an Express app.
   * Called from server.js
   * 
   * @param {object} app - Express app
   * @param {object} deps - Dependencies { getLivePrice, live, openPosition, currentSignal, ... }
   */
  registerRoutes(app, deps) {
    const self = this;

    // ── GET /api/amibroker/signal ─────────────────────────────
    // AFL polls this to get current Antigravity signal
    // Response is a simple pipe-delimited string for easy AFL parsing
    app.get('/api/amibroker/signal', (req, res) => {
      if (!self.authenticate(req)) return res.status(401).send('UNAUTHORIZED');

      self.stats.signalPolls++;
      self.stats.lastPollAt = new Date().toISOString();

      const signal = deps.getCurrentSignal();
      const conf   = deps.getConfidence();
      const strike = deps.getSuggestedStrike();
      const target = deps.getTargetMultiplier();

      // AFL-friendly pipe-delimited response:
      // SIGNAL|CONFIDENCE|STRIKE|TARGET|PRICE|TIME
      const price = deps.getLastPrice ? deps.getLastPrice() : 0;
      const time  = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

      res.type('text/plain').send(
        `${signal}|${conf}|${strike}|${target}|${price}|${time}`
      );
    });

    // ── GET /api/amibroker/data ──────────────────────────────
    // AFL polls this for live market data
    // JSON signal intake from AmiBroker/OLE/webhook tools.
    app.post('/api/amibroker/signal', async (req, res) => {
      if (!self.authenticate(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
      const result = await self.handleIncomingSignal(req.body || {}, deps, 'post-signal');
      res.json(result);
    });

    app.get('/api/amibroker/data', async (req, res) => {
      if (!self.authenticate(req)) return res.status(401).send('UNAUTHORIZED');

      try {
        const data = deps.getMarketData();
        // AFL-friendly: PRICE|ORB_HIGH|ORB_LOW|VWAP|VOLUME|SIGNAL|CONFIDENCE
        res.type('text/plain').send(
          `${data.price}|${data.orbHigh}|${data.orbLow}|${data.vwap}|${data.volume || 0}|${data.signal}|${data.confidence}`
        );
      } catch (e) {
        res.status(500).send(`ERROR|${e.message}`);
      }
    });

    // ── GET /api/amibroker/position ──────────────────────────
    // AFL polls for open position status
    app.get('/api/amibroker/position', (req, res) => {
      if (!self.authenticate(req)) return res.status(401).send('UNAUTHORIZED');

      const pos = deps.getOpenPosition();
      if (!pos) {
        res.type('text/plain').send('NONE|0|0|0|0|CLOSED');
        return;
      }

      const mult = pos.currentPrice / pos.entryPrice;
      const pnl  = ((mult - 1) * 100).toFixed(1);

      // TYPE|STRIKE|ENTRY|CURRENT|MULT|STATUS
      res.type('text/plain').send(
        `${pos.type}|${pos.strike}|${pos.entryPrice}|${pos.currentPrice}|${mult.toFixed(3)}|${pos.status}`
      );
    });

    // ── POST /api/amibroker/order ────────────────────────────
    // AFL sends orders here for execution via Dhan/Kotak
    app.post('/api/amibroker/order', async (req, res) => {
      if (!self.authenticate(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });

      const { action, symbol, strike, price, quantity, orderType } = req.body;
      
      if (!action || !symbol) {
        return res.status(400).json({ error: 'action and symbol required' });
      }

      self.stats.ordersReceived++;
      self.stats.lastOrderAt = new Date().toISOString();

      const order = {
        action: action.toUpperCase(), // BUY, SELL
        symbol,
        strike: strike || null,
        price: parseFloat(price) || 0,
        quantity: parseInt(quantity) || 1,
        orderType: (orderType || 'MARKET').toUpperCase(),
        receivedAt: new Date().toISOString(),
        source: 'amibroker'
      };

      self.lastAflOrder = order;
      self.orderHistory.push(order);

      // Keep history manageable
      if (self.orderHistory.length > 100) self.orderHistory = self.orderHistory.slice(-50);

      console.log(`[amibroker] Order received: ${order.action} ${order.symbol} ${order.strike || ''} @ ${order.price} qty:${order.quantity}`);

      // Execute via live connector if in live mode
      let result = { status: 'RECEIVED', orderId: `AMI-${Date.now()}` };
      
      if (deps.getTradeMode() === 'live' && deps.liveConnector) {
        try {
          const liveResult = await deps.liveConnector.placeOrder({
            transactionType: order.action === 'BUY' ? 'BUY' : 'SELL',
            exchangeSegment: 'BFO',
            productType: 'INTRADAY',
            orderType: order.orderType,
            securityId: order.symbol,
            quantity: order.quantity,
            price: order.orderType === 'LIMIT' ? order.price : 0
          });
          result = { status: liveResult.status || 'SENT', orderId: liveResult.orderId, raw: liveResult };
          console.log(`[amibroker] Order executed:`, result.status, result.orderId);
        } catch (e) {
          result = { status: 'ERROR', error: e.message };
          console.error(`[amibroker] Order execution failed:`, e.message);
        }
      } else {
        console.log(`[amibroker] Paper mode — order logged but not executed`);
        result.status = 'PAPER';
      }

      res.json({ ok: true, order, result });
    });

    // ── POST /api/amibroker/webhook ─────────────────────────
    // Generic webhook for AFL events (chart alerts, scan results, etc.)
    app.post('/api/amibroker/webhook', async (req, res) => {
      if (!self.authenticate(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });

      const body = req.body || {};
      const result = await self.handleIncomingSignal(body.data || body, deps, 'webhook');
      return res.json(result);
      /*
      console.log(`[amibroker] Webhook: ${event || body.signal} — ${message || JSON.stringify(body)}`);
      */

    });

    // ── GET /api/amibroker/push-signal ──────────────────────
    // AFL calls this via GetRawData (GET + query params) to push a new signal
    app.get('/api/amibroker/push-signal', async (req, res) => {
      if (!self.authenticate(req)) return res.status(401).send('UNAUTHORIZED');
      const result = await self.handleIncomingSignal(req.query || {}, deps, 'push-signal');
      if (!result.ok) return res.type('text/plain').send(`IGNORED|${result.reason || 'invalid'}`);
      return res.type('text/plain').send(`OK|${result.signal.signal}|${result.execution.status}`);
    });

    // ── GET /api/amibroker/last-signal ──────────────────────
    // Returns the last AFL-pushed signal as JSON (for signal-heatmap page)
    app.get('/api/amibroker/last-signal', (req, res) => {
      const s = self.lastAflSignal;
      if (!s || !s.data) {
        return res.json({ signal: 'WAIT', instrument: 'NIFTY', strike: 0, conf: 0, price: 0, target: 0, time: null });
      }
      const d = s.data;
      res.json({
        signal    : s.event === 'SIGNAL' ? (d.signal || 'WAIT') : 'WAIT',
        instrument: d.instrument || 'NIFTY',
        strike    : d.strike     || 0,
        conf      : d.conf       || 0,
        price     : d.price      || 0,
        target    : d.target     || 0,
        reason    : d.reason     || '',
        source    : d.source     || 'amibroker',
        duplicate : !!s.duplicate,
        execution : s.execution  || null,
        time      : s.receivedAt || null
      });
    });

    // ── GET /api/amibroker/reset-signal ─────────────────────
    // Clears last signal so next identical signal is treated as new
    app.get('/api/amibroker/signals', (req, res) => {
      const inst = String(req.query.inst || req.query.instrument || '').toUpperCase();
      const result = self.signalsForQuery(req.query || {});
      res.json({
        ok: true,
        instrument: inst || 'ALL',
        date: result.date,
        count: result.signals.length,
        total: result.total,
        active: result.active,
        expired: Math.max(0, result.total - (result.active || 0)),
        ttlMin: result.ttlMin,
        signals: result.signals
      });
    });

    app.get('/api/amibroker/backtest', (req, res) => {
      res.json(self.signalReplayBacktest(req.query || {}));
    });

    app.get('/api/amibroker/reset-signal', (req, res) => {
      self.lastAflSignal = null;
      self.signalHistory = [];
      self.lastSignalKey = null;
      self.lastSignalKeyAt = 0;
      res.send('RESET');
    });

    // ── GET /api/amibroker/status ────────────────────────────
    app.get('/api/amibroker/status', (req, res) => {
      res.json({
        enabled: self.enabled,
        autoTrade: self.autoTrade,
        allowLive: self.allowLive,
        minConfidence: self.minConfidence,
        dedupeSeconds: self.dedupeMs / 1000,
        stats: self.stats,
        lastOrder: self.lastAflOrder,
        lastSignal: self.lastAflSignal,
        signalStoreEnabled: self.signalStoreEnabled,
        signalStoreDir: self.signalStoreDir,
        todaySignalFile: self.signalStoreFile(self.istDateString()),
        signalHistoryCount: self.signalHistory.length,
        orderHistoryCount: self.orderHistory.length
      });
    });

    self.connected = true;
    console.log('[amibroker] Bridge routes registered');
  }

  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.connected,
      stats: this.stats,
      autoTrade: this.autoTrade,
      allowLive: this.allowLive,
      minConfidence: this.minConfidence,
      lastOrder: this.lastAflOrder,
      lastSignal: this.lastAflSignal,
      signalStoreEnabled: this.signalStoreEnabled,
      signalStoreDir: this.signalStoreDir
    };
  }
}

module.exports = AmiBrokerBridge;
