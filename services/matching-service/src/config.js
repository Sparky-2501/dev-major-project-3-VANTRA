const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// Every tunable in one place. The saga/offers code receives this object, so tests
// can pass small values (a 1-second offer timeout) without touching env vars.
module.exports = {
  port: num(process.env.PORT, 3003),

  // N: seconds a driver has to accept before we try the next one.
  offerTimeoutSec: num(process.env.OFFER_TIMEOUT_SEC, 15),
  // M: how many drivers we offer to before giving up and compensating.
  maxOfferAttempts: num(process.env.MAX_OFFER_ATTEMPTS, 3),
  pollMs: 300,

  // Expanding search: try 3 km, then 5 km, then 10 km (only if the smaller found nobody).
  searchRadiiKm: [3, 5, 10],
  searchCount: 5,

  // After accept, the driver stays reserved for the ride; the TTL is a safety net
  // so a crashed system cannot lock a driver forever.
  rideLockTtlSec: 2 * 60 * 60,

  // Saga ownership: an orchestrator renews its lease; if it dies the lease
  // expires and another replica takes over.
  leaseMs: num(process.env.SAGA_LEASE_MS, 30000),
  sweepIntervalMs: num(process.env.SWEEP_INTERVAL_MS, 10000),
  orphanAgeMs: 60000,
  // How many sweep rounds a stuck compensation is retried before we flag it FAILED.
  maxCompensationRounds: num(process.env.MAX_COMPENSATION_ROUNDS, 5),

  driverServiceUrl: process.env.DRIVER_SERVICE_URL || 'http://driver-service:3002',
  paymentServiceUrl: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3004',
};
