const { serviceRequest } = require('../common/http');
const { withRetry } = require('../common/retry');
const { createBreaker, callThrough } = require('../common/breaker');
const cfg = require('../config');

// matching -> payment-service. Every operation is idempotent per ride on the
// payment side, so all of them may be retried.
const call = (method, path, body) =>
  withRetry(
    () => serviceRequest('payment-service', method, cfg.paymentServiceUrl + path, { body, timeoutMs: 1500 }),
    { retries: 2, baseMs: 150 });

const breaker = createBreaker('matching->payment', call);

// Returns the payment document; throws on infrastructure failure (5xx, timeout,
// breaker open) AND on unexpected 4xx.
async function pay(method, path, body) {
  const r = await callThrough(breaker, method, path, body);
  if (r.status >= 400) {
    const err = new Error(`payment-service ${r.status}: ${r.data && r.data.message}`);
    err.status = r.status;
    throw err;
  }
  return r.data.payment;
}

module.exports = {
  authorize: (body) => pay('POST', '/internal/payments/authorize', body),
  capture: (rideId) => pay('POST', `/internal/payments/${rideId}/capture`),
  void: (rideId) => pay('POST', `/internal/payments/${rideId}/void`),
  refund: (rideId) => pay('POST', `/internal/payments/${rideId}/refund`),
};
