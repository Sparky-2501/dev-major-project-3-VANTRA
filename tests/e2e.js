// End-to-end tests against the RUNNING stack (docker compose up, or Kubernetes with
// the gateway reachable at BASE_URL, default http://localhost:8080).
//
//   node tests/e2e.js              run everything
//   node tests/e2e.js payment      run only scenarios whose name contains "payment"
//
// Recommended in .env for the timeout scenario:  OFFER_TIMEOUT_SEC=5
// Each scenario uses a different city so drivers left over from a previous scenario
// are never within 10 km of the next one.
const L = require('./lib');
const assert = require('node:assert/strict');

const CITIES = {
  pune: { lng: 73.8567, lat: 18.5204 },
  mumbai: { lng: 72.8777, lat: 19.076 },
  delhi: { lng: 77.1025, lat: 28.7041 },
  bangalore: { lng: 77.5946, lat: 12.9716 },
  chennai: { lng: 80.2707, lat: 13.0827 },
  kolkata: { lng: 88.3639, lat: 22.5726 },
  hyderabad: { lng: 78.4867, lat: 17.385 },
  jaipur: { lng: 75.7873, lat: 26.9124 },
};
const near = (c, dLng = 0, dLat = 0) => ({ lng: c.lng + dLng, lat: c.lat + dLat });
const trip = (c) => ({ pickup: near(c), dropoff: near(c, 0.02, 0.02) });
const OFFER_WAIT_MS = (Number(process.env.OFFER_TIMEOUT_SEC || 15) * 3 + 30) * 1000;

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('happy path: register, online, request, matched, paid, confirmed, trip, completed', async () => {
  const c = CITIES.pune;
  const rider = await L.registerRider(); const driver = await L.registerDriver();
  await L.goOnline(driver, c.lng, c.lat);
  const stopBot = L.startDriverBot(driver);
  try {
    const r = await L.requestRide(rider, ...Object.values(trip(c)));
    assert.equal(r.status, 202, JSON.stringify(r.json));
    const rideId = r.json.ride.id;

    const v = await L.waitForRide(rider, rideId, (x) => x.ride.status === 'CONFIRMED');
    assert.equal(v.ride.driverId, driver.id);
    assert.equal(v.saga.state, 'COMPLETED');
    assert.deepEqual(v.saga.completedSteps, ['createRide', 'reserveDriver', 'authorizePayment', 'confirmRide']);

    assert.equal((await L.api('POST', `/api/matching/rides/${rideId}/start`, { token: driver.token })).status, 200);
    assert.equal((await L.api('POST', `/api/matching/rides/${rideId}/complete`, { token: driver.token })).status, 200);
    const done = await L.waitForRide(rider, rideId, (x) => x.ride.status === 'COMPLETED');
    assert.equal(done.ride.status, 'COMPLETED');

    const st = (await L.api('GET', '/api/drivers/status', { token: driver.token })).json;
    assert.equal(st.rideId, null, 'driver should be free again');
    assert.equal(st.inAvailableSet, true, 'driver should be back in the GEO set');

    // notification-service consumed the events asynchronously
    const sawCaptured = await L.waitFor(async () => {
      const n = (await L.api('GET', `/api/demo/notifications?to=rider:${rider.id}`, { token: rider.token })).json;
      return n && n.notifications.some((x) => x.type === 'payment.captured');
    }, 10000);
    assert.ok(sawCaptured, 'rider should have been notified of the captured payment');
  } finally { stopBot(); await L.goOffline(driver); }
});

scenario('payment fails: driver released, ride cancelled, compensation in reverse order', async () => {
  const c = CITIES.mumbai;
  const rider = await L.registerRider(); const driver = await L.registerDriver();
  await L.goOnline(driver, c.lng, c.lat);
  const stopBot = L.startDriverBot(driver);
  await L.setDemo('payment', 'fail-rate', { rate: 1 }, rider.token);
  try {
    const r = await L.requestRide(rider, ...Object.values(trip(c)));
    const v = await L.waitForRide(rider, r.json.ride.id, L.isTerminal);
    assert.equal(v.ride.status, 'CANCELLED');
    assert.equal(v.ride.cancelReason, 'PAYMENT_DECLINED');
    assert.equal(v.saga.state, 'COMPENSATED');
    assert.deepEqual(v.saga.compensationLog.map((e) => e.step), ['authorizePayment', 'reserveDriver', 'createRide']);
    const free = await L.waitFor(async () => {
      const st = (await L.api('GET', '/api/drivers/status', { token: driver.token })).json;
      return st.rideId === null && st.inAvailableSet;
    });
    assert.ok(free, 'driver should be released and available again');
  } finally { await L.setDemo('payment', 'fail-rate', { rate: 0 }, rider.token); stopBot(); await L.goOffline(driver); }
});

scenario('no drivers nearby: ride cancelled with NO_DRIVERS_AVAILABLE', async () => {
  const rider = await L.registerRider();
  const r = await L.requestRide(rider, ...Object.values(trip(CITIES.delhi)));
  const v = await L.waitForRide(rider, r.json.ride.id, L.isTerminal);
  assert.equal(v.ride.status, 'CANCELLED');
  assert.equal(v.saga.failure.reason, 'NO_DRIVERS_AVAILABLE');
});

scenario('driver timeout then fallback: nearest driver never answers, next nearest gets it', async () => {
  const c = CITIES.bangalore;
  const rider = await L.registerRider();
  const nearDriver = await L.registerDriver('near'); const farDriver = await L.registerDriver('far');
  await L.goOnline(nearDriver, c.lng + 0.001, c.lat);  // ~100 m away
  await L.goOnline(farDriver, c.lng + 0.01, c.lat);    // ~1 km away
  await L.setDemo('matching', 'silent-driver', { driverId: nearDriver.id, silent: true }, rider.token);
  const stop1 = L.startDriverBot(nearDriver); const stop2 = L.startDriverBot(farDriver);
  try {
    const r = await L.requestRide(rider, ...Object.values(trip(c)));
    const v = await L.waitForRide(rider, r.json.ride.id, (x) => x.ride.status === 'CONFIRMED', OFFER_WAIT_MS);
    assert.equal(v.ride.driverId, farDriver.id, 'ride should fall back to the second driver');
    const st = (await L.api('GET', '/api/drivers/status', { token: nearDriver.token })).json;
    assert.equal(st.rideId, null, 'the silent driver must not be left reserved');
  } finally {
    await L.setDemo('matching', 'silent-driver', { driverId: nearDriver.id, silent: false }, rider.token);
    stop1(); stop2(); await L.goOffline(nearDriver); await L.goOffline(farDriver);
  }
});

scenario('duplicate request with the same Idempotency-Key creates ONE ride', async () => {
  const rider = await L.registerRider();
  const t = trip(CITIES.chennai);
  const key = 'same-key-' + L.uid();
  const [a, b] = await Promise.all([L.requestRide(rider, t.pickup, t.dropoff, key), L.requestRide(rider, t.pickup, t.dropoff, key)]);
  assert.ok([200, 202].includes(a.status) && [200, 202].includes(b.status), `${a.status} ${b.status}`);
  assert.equal(a.json.ride.id, b.json.ride.id, 'both calls must return the same ride');
  const again = await L.requestRide(rider, t.pickup, t.dropoff, key);
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
  const list = (await L.api('GET', '/api/rides', { token: rider.token })).json.rides;
  assert.equal(list.length, 1, 'ride history must contain exactly one ride');
});

scenario('two riders compete for ONE driver: exactly one wins', async () => {
  const c = CITIES.kolkata;
  const r1 = await L.registerRider('a'); const r2 = await L.registerRider('b');
  const driver = await L.registerDriver();
  await L.goOnline(driver, c.lng, c.lat);
  const stopBot = L.startDriverBot(driver);
  try {
    const [x, y] = await Promise.all([
      L.requestRide(r1, ...Object.values(trip(c))), L.requestRide(r2, ...Object.values(trip(c))),
    ]);
    const [v1, v2] = await Promise.all([
      L.waitForRide(r1, x.json.ride.id, (v) => v.ride.status === 'CONFIRMED' || L.isTerminal(v), OFFER_WAIT_MS),
      L.waitForRide(r2, y.json.ride.id, (v) => v.ride.status === 'CONFIRMED' || L.isTerminal(v), OFFER_WAIT_MS),
    ]);
    const statuses = [v1.ride.status, v2.ride.status].sort();
    assert.deepEqual(statuses, ['CANCELLED', 'CONFIRMED'], `got ${statuses}`);
    const winner = [v1, v2].find((v) => v.ride.status === 'CONFIRMED');
    assert.equal(winner.ride.driverId, driver.id);
  } finally { stopBot(); await L.goOffline(driver); }
});

scenario('driver-service outage: saga cannot finish compensation until it recovers', async () => {
  const c = CITIES.hyderabad;
  const rider = await L.registerRider(); const driver = await L.registerDriver();
  await L.goOnline(driver, c.lng, c.lat);
  const stopBot = L.startDriverBot(driver);
  await L.setDemo('driver', 'outage', { on: true }, rider.token);
  try {
    const r = await L.requestRide(rider, ...Object.values(trip(c)));
    // The driver accepts, but assigning fails (503). Compensation must also reach
    // driver-service, so it is stuck in COMPENSATING and the ride is not yet CANCELLED.
    const stuck = await L.waitForRide(rider, r.json.ride.id, (v) => v.saga && v.saga.state === 'COMPENSATING' && v.saga.compensationLog.some((e) => !e.ok), OFFER_WAIT_MS);
    assert.notEqual(stuck.ride.status, 'CANCELLED');
    await L.setDemo('driver', 'outage', { on: false }, rider.token);
    const fin = await L.waitForRide(rider, r.json.ride.id, L.isTerminal, 90000);
    assert.equal(fin.ride.status, 'CANCELLED');
    assert.equal(fin.saga.state, 'COMPENSATED');
  } finally { await L.setDemo('driver', 'outage', { on: false }, rider.token); stopBot(); await L.goOffline(driver); }
});

(async () => {
  const only = process.argv[2];
  const picked = scenarios.filter((s) => !only || s.name.includes(only));
  let failed = 0;
  const health = await L.api('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) { console.error(`Gateway not reachable at ${L.BASE}. Is the stack up?`); process.exit(2); }
  for (const s of picked) {
    const t0 = Date.now();
    try { await s.fn(); console.log(`PASS  ${s.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
    catch (e) { failed++; console.log(`FAIL  ${s.name}\n      ${e.message}`); }
  }
  console.log(failed ? `\n${failed} of ${picked.length} scenario(s) FAILED` : `\nAll ${picked.length} scenario(s) passed`);
  process.exit(failed ? 1 : 0);
})();
