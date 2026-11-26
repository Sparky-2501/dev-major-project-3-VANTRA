const { serviceRequest } = require('../common/http');
const { withRetry } = require('../common/retry');
const { createBreaker, callThrough } = require('../common/breaker');
const cfg = require('../config');

// matching -> driver-service. Assign and release are both idempotent on the other
// side (Lua scripts keyed by rideId), so retrying them is safe.
const call = (method, path, body) =>
  withRetry(
    () => serviceRequest('driver-service', method, cfg.driverServiceUrl + path, { body, timeoutMs: 1500 }),
    { retries: 2, baseMs: 150 });

const breaker = createBreaker('matching->driver', call);

module.exports = {
  // -> { status: 'OK' | 'BUSY' | 'OFFLINE' }. THROWS if driver-service is down.
  assign: async (driverId, rideId) =>
    (await callThrough(breaker, 'POST', `/internal/drivers/${driverId}/assign`, { rideId })).data,
  release: async (driverId, rideId) =>
    (await callThrough(breaker, 'POST', `/internal/drivers/${driverId}/release`, { rideId })).data,
};
