// Load test of the booking endpoint (POST /api/rides) through the gateway.
//
//   cd tests && npm install && cd ..
//   node tests/load/booking.js            (defaults: 20 connections, 20 seconds)
//   CONNECTIONS=50 DURATION=30 node tests/load/booking.js
//
// IMPORTANT before running:
//  1. The gateway rate-limits per IP (RATE_LIMIT_PER_MIN, default 600). A load test
//     from one machine hits that at once and you would measure the limiter, not the
//     system. Set RATE_LIMIT_PER_MIN=1000000 in .env and recreate the stack.
//  2. What is measured: the time to ACCEPT a booking (gateway -> rider-service ->
//     matching-service -> insert ride + saga -> 202). The saga itself then runs in the
//     background; with no drivers online it ends quickly in NO_DRIVERS_AVAILABLE.
//     This is NOT the time until a driver is matched.
//  3. The numbers depend entirely on YOUR machine. Copy the output into the README
//     table as it is, with your hardware; never reuse someone else's numbers.
const autocannon = require('autocannon');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { registerRider, BASE } = require('../lib');

(async () => {
  const rider = await registerRider('load');
  const connections = Number(process.env.CONNECTIONS || 20);
  const duration = Number(process.env.DURATION || 20);

  const result = await autocannon({
    url: BASE,
    connections,
    duration,
    requests: [{
      method: 'POST',
      path: '/api/rides',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${rider.token}` },
      body: JSON.stringify({ pickup: { lng: 73.8567, lat: 18.5204 }, dropoff: { lng: 73.8767, lat: 18.5404 } }),
      // A NEW idempotency key per request, otherwise every request after the first
      // would just be a (cheap) duplicate hit.
      setupRequest: (req) => { req.headers['idempotency-key'] = crypto.randomUUID(); return req; },
    }],
  });

  const summary = {
    when: new Date().toISOString(),
    connections, durationSec: duration,
    requestsTotal: result.requests.total,
    requestsPerSec: result.requests.average,
    latencyMs: { avg: result.latency.average, p50: result.latency.p50, p97_5: result.latency.p97_5, p99: result.latency.p99, max: result.latency.max },
    status2xx: result['2xx'], non2xx: result.non2xx, errors: result.errors, timeouts: result.timeouts,
    note: 'accept-time of POST /api/rides, not time-to-match',
  };
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(__dirname, 'last-result.json'), JSON.stringify(summary, null, 2));
  console.log('\nSaved to tests/load/last-result.json. Paste your own numbers into README.md ("Load test").');
  if (summary.non2xx > 0) console.log(`WARNING: ${summary.non2xx} non-2xx responses. Check for 429 (rate limit) before trusting these numbers.`);
})();
