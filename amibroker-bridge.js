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

class AmiBrokerBridge {
  constructor(config = {}) {
    this.enabled = config.enabled ?? (process.env.AMIBROKER_BRIDGE === 'true');
    this.apiKey  = config.apiKey || process.env.AMIBROKER_API_KEY || 'antigravity';
    this.connected = false;

    // Track incoming AFL signals
    this.lastAflSignal = null;
    this.lastAflOrder  = null;
    this.orderHistory  = [];

    // Stats
    this.stats = {
      ordersReceived: 0,
      signalPolls: 0,
      lastOrderAt: null,
      lastPollAt: null
    };
  }

  /**
   * Validate API key from request header or query param
   */
  authenticate(req) {
    const key = req.headers['x-api-key'] || req.query.key || req.body?.key;
    if (!this.apiKey || this.apiKey === 'antigravity') return true; // default = no auth
    return key === this.apiKey;
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
    app.post('/api/amibroker/webhook', (req, res) => {
      if (!self.authenticate(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });

      const { event, data, message } = req.body;
      console.log(`[amibroker] Webhook: ${event} — ${message || JSON.stringify(data)}`);

      self.lastAflSignal = { event, data, message, receivedAt: new Date().toISOString() };

      res.json({ ok: true, received: event });
    });

    // ── GET /api/amibroker/status ────────────────────────────
    app.get('/api/amibroker/status', (req, res) => {
      res.json({
        enabled: self.enabled,
        stats: self.stats,
        lastOrder: self.lastAflOrder,
        lastSignal: self.lastAflSignal,
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
      lastOrder: this.lastAflOrder
    };
  }
}

module.exports = AmiBrokerBridge;
