/**
 * ORB — Opening Range Breakout. The original v1 strategy, re-exported here so
 * it lives in the registry alongside the others. Logic stays in ../strategy-orb.js
 * (also imported directly by the live server's updateSignal for parity).
 */

const { signalAt } = require('../strategy-orb');

module.exports = { name: 'orb', signalAt };
