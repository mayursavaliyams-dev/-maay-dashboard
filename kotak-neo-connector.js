/**
 * Stub — the real Kotak Neo connector module isn't present in this repo.
 * Server.js still imports it for `instanceof` checks; instantiation would
 * indicate the user set LIVE_CONNECTOR=kotak (or KOTAK_CONSUMER_KEY) by
 * mistake. Throw with a clear message instead of crashing on a missing file.
 */
class KotakNeoConnector {
  constructor() {
    throw new Error(
      'Kotak Neo connector is not installed in this build. ' +
      'Use LIVE_CONNECTOR=dhan and unset KOTAK_CONSUMER_KEY in .env.'
    );
  }
}

module.exports = KotakNeoConnector;
 