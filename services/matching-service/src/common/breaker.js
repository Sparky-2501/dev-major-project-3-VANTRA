// GENERATED from /common/breaker.js by scripts/sync-common.js. Do not edit here.
const CircuitBreaker = require('opossum');
const logger = require('./logger');

// All breakers in this process, so /health can report their state.
const registry = new Map();

// What the caller gets when the call failed OR the circuit is open. Callers must
// check for it with callThrough() below.
const UNAVAILABLE = { unavailable: true };

// Why a breaker at all: if payment-service is down, every booking would otherwise
// wait for a full timeout before failing, tying up sockets and making a small
// outage a big one. After enough failures the breaker "opens" and fails calls
// instantly; after resetTimeout it lets one trial call through (HALF_OPEN).
//
// Retries are done INSIDE the action (see http callers), so one breaker "call" is
// one logical operation, and an open breaker is never retried into.
function createBreaker(name, action, options = {}) {
  const { fallback, ...rest } = options;
  const breaker = new CircuitBreaker(action, {
    name,
    // Must be longer than retries x per-attempt timeout of the wrapped action.
    timeout: Number(process.env.BREAKER_TIMEOUT_MS || 6000),
    // Open when >= 50% of calls in the rolling window failed...
    errorThresholdPercentage: Number(process.env.BREAKER_ERROR_PCT || 50),
    // ...but only once at least 3 calls were seen, so one bad call cannot open it.
    volumeThreshold: Number(process.env.BREAKER_VOLUME || 3),
    rollingCountTimeout: 10000,
    // How long to stay OPEN before trying a single HALF_OPEN call.
    resetTimeout: Number(process.env.BREAKER_RESET_MS || 10000),
    ...rest,
  });

  breaker.fallback(fallback || (() => UNAVAILABLE));

  breaker.on('open', () => logger.warn('breaker OPEN', { breaker: name }));
  breaker.on('halfOpen', () => logger.warn('breaker HALF_OPEN', { breaker: name }));
  breaker.on('close', () => logger.info('breaker CLOSED', { breaker: name }));

  registry.set(name, breaker);
  return breaker;
}

const stateOf = (b) => (b.opened ? 'OPEN' : b.halfOpen ? 'HALF_OPEN' : 'CLOSED');

function breakerStates() {
  const out = {};
  for (const [name, b] of registry) {
    const s = b.stats;
    out[name] = {
      state: stateOf(b),
      fires: s.fires, successes: s.successes, failures: s.failures,
      rejects: s.rejects, timeouts: s.timeouts, fallbacks: s.fallbacks,
    };
  }
  return out;
}

// Fire and turn the "unavailable" marker into a real error, so business code can
// use try/catch normally (the saga turns it into a compensation).
async function callThrough(breaker, ...args) {
  const result = await breaker.fire(...args);
  if (result === UNAVAILABLE) {
    const err = new Error(`${breaker.name} unavailable (breaker ${stateOf(breaker)})`);
    err.code = 'DEPENDENCY_UNAVAILABLE';
    err.reason = 'DEPENDENCY_UNAVAILABLE';
    throw err;
  }
  return result;
}

module.exports = { createBreaker, breakerStates, callThrough, UNAVAILABLE };
