// Demo: kill payment-service and watch (1) the circuit breaker open and (2) the
// saga compensate. Run from the repo root with the stack up (docker compose).
//   node scripts/demo-payment-down.js
// Needs: docker compose, the gateway on http://localhost:8080, DEMO_MODE=true.
const { execSync } = require('child_process');
const L = require('../tests/lib');

const sh = (cmd) => { console.log(`\n$ ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };
const banner = (t) => console.log(`\n=== ${t} ===`);

async function matchingPaymentBreaker(token) {
  // /status asks one matching-service replica (there are 2), so poll a few times
  // and report every state seen; each replica has its own breaker.
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const s = (await L.api('GET', '/status', { token })).json;
    const b = s && s['matching'] && s['matching'].breakers && s['matching'].breakers['matching->payment'];
    if (b) seen.add(`${b.state} (fires=${b.fires} failures=${b.failures} rejects=${b.rejects})`);
  }
  return [...seen];
}

async function book(rider, c, label) {
  const r = await L.requestRide(rider, { lng: c.lng, lat: c.lat }, { lng: c.lng + 0.02, lat: c.lat + 0.02 });
  const v = await L.waitForRide(rider, r.json.ride.id, (x) => x.ride.status === 'CONFIRMED' || L.isTerminal(x), 60000);
  console.log(`${label}: ride ${v.ride.status} (${v.ride.cancelReason || 'no reason'})`);
  console.log(`   compensation log: ${v.saga.compensationLog.map((e) => e.step + (e.ok ? ' ok' : ' FAILED')).join(' -> ') || '(none)'}`);
  return v;
}

(async () => {
  const c = { lng: 74.1240, lat: 15.2993 }; // Goa: away from the e2e cities
  const rider = await L.registerRider('demo'); const driver = await L.registerDriver('demo');
  await L.goOnline(driver, c.lng, c.lat);
  const stop = L.startDriverBot(driver);

  try {
    banner('1. Healthy: one booking succeeds');
    const ok = await L.requestRide(rider, c, { lng: c.lng + 0.02, lat: c.lat + 0.02 });
    await L.waitForRide(rider, ok.json.ride.id, (v) => v.ride.status === 'CONFIRMED');
    console.log('ride CONFIRMED. Breaker states:', await matchingPaymentBreaker(rider.token));
    await L.api('POST', `/api/rides/${ok.json.ride.id}/cancel`, { token: rider.token }); // free the driver
    await L.sleep(2000);

    banner('2. Kill payment-service');
    sh('docker compose stop payment-service');

    banner('3. Book while payment is down: each saga must compensate');
    for (let i = 1; i <= 4; i++) { await book(rider, c, `booking ${i}`); await L.sleep(1000); }
    console.log('\nBreaker states now:', await matchingPaymentBreaker(rider.token));
    console.log('(OPEN = calls fail instantly without waiting for a timeout)');

    banner('4. Bring payment-service back');
    sh('docker compose start payment-service');
    console.log('waiting 25 s: service boot + breaker reset timeout (10 s) -> HALF_OPEN -> CLOSED ...');
    await L.sleep(25000);
    await book(rider, c, 'booking after recovery');
    console.log('Breaker states after recovery:', await matchingPaymentBreaker(rider.token));
  } finally {
    stop(); await L.goOffline(driver);
    try { execSync('docker compose start payment-service', { stdio: 'ignore' }); } catch (_) {}
  }
})().catch((e) => { console.error('demo failed:', e.message); process.exit(1); });
