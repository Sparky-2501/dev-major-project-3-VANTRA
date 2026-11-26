const { serviceRequest } = require('./common/http');
const { withRetry } = require('./common/retry');
const { createBreaker, callThrough } = require('./common/breaker');

const MATCHING_URL = process.env.MATCHING_SERVICE_URL || 'http://matching-service:3003';

// rider -> matching. Two breakers, because the two kinds of call degrade differently:
//   book (create/get/cancel one ride): no sensible fallback. We tell the rider "try again" (503). Retrying the
//         POST is safe ONLY because every booking carries an Idempotency-Key.
//   read (history list only): ride history can degrade gracefully to an empty list flagged degraded.
const call = (method, path, body, headers) =>
  withRetry(
    () => serviceRequest('matching-service', method, MATCHING_URL + path, { body, headers, timeoutMs: 1500 }),
    { retries: 2, baseMs: 150 }
  );

const bookBreaker = createBreaker('rider->matching:book', call);
const readBreaker = createBreaker('rider->matching:read', call, {
  fallback: () => ({ status: 200, data: { rides: [], degraded: true } }),
});

module.exports = {
  createRide: ({ riderId, pickup, dropoff, idempotencyKey }) =>
    callThrough(bookBreaker, 'POST', '/internal/rides', { riderId, pickup, dropoff }, { 'idempotency-key': idempotencyKey }),
  listRides: (riderId) =>
    readBreaker.fire('GET', `/internal/rides?riderId=${encodeURIComponent(riderId)}`),
  getRide: (rideId) => callThrough(bookBreaker, 'GET', `/internal/rides/${encodeURIComponent(rideId)}`),
  cancelRide: (rideId, riderId) =>
    callThrough(bookBreaker, 'POST', `/internal/rides/${encodeURIComponent(rideId)}/cancel`, { riderId }),
};
