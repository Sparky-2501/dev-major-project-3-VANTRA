// Tiny helpers shared by the e2e tests and the demo script. Plain fetch, no libraries.
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

async function registerRider(tag = 'rider') {
  const email = `${tag}-${uid()}@t.com`;
  const r = await api('POST', '/api/riders/register', { body: { fullname: { firstname: 'Asha', lastname: 'Rao' }, email, password: 'secret123' } });
  if (r.status !== 201) throw new Error('rider register failed: ' + JSON.stringify(r));
  return { token: r.json.token, id: r.json.rider._id, email };
}

async function registerDriver(tag = 'driver') {
  const email = `${tag}-${uid()}@t.com`;
  const r = await api('POST', '/api/drivers/register', {
    body: { fullname: { firstname: 'Ravi', lastname: 'Kumar' }, email, password: 'secret123',
      vehicle: { color: 'white', plate: 'MH12AB' + Math.floor(1000 + Math.random() * 9000), capacity: 4, vehicleType: 'car' } },
  });
  if (r.status !== 201) throw new Error('driver register failed: ' + JSON.stringify(r));
  return { token: r.json.token, id: r.json.driver._id, email };
}

// Location first, then online: going online puts the driver in the GEO set using
// the last known location. Coordinates are (lng, lat).
async function goOnline(driver, lng, lat) {
  await api('POST', '/api/drivers/location', { token: driver.token, body: { lng, lat } });
  const r = await api('POST', '/api/drivers/status', { token: driver.token, body: { online: true } });
  if (r.status !== 200) throw new Error('go online failed: ' + JSON.stringify(r));
  return r.json;
}
const goOffline = (driver) => api('POST', '/api/drivers/status', { token: driver.token, body: { online: false } });

// A driver "app": polls for an offer and accepts it. Polls every 500 ms to stay
// well under the gateway rate limit.
function startDriverBot(driver) {
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        const p = await api('GET', '/api/matching/offers/pending', { token: driver.token });
        if (p.json && p.json.rideId) await api('POST', `/api/matching/offers/${p.json.rideId}/accept`, { token: driver.token });
      } catch (_) { /* ignore, keep polling */ }
      await sleep(500);
    }
  })();
  return () => { stopped = true; };
}

const requestRide = (rider, pickup, dropoff, key = 'k-' + uid()) =>
  api('POST', '/api/rides', { token: rider.token, headers: { 'Idempotency-Key': key }, body: { pickup, dropoff } });

async function waitForRide(rider, rideId, predicate, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = (await api('GET', `/api/rides/${rideId}`, { token: rider.token })).json;
    if (last && last.ride && predicate(last)) return last;
    await sleep(700);
  }
  throw new Error(`timed out waiting for ride ${rideId}; last = ${JSON.stringify(last && { status: last.ride && last.ride.status, saga: last.saga && last.saga.state })}`);
}

const isTerminal = (v) => ['COMPLETED', 'CANCELLED', 'FAILED'].includes(v.ride.status);
const setDemo = (service, path, body, token) => api('POST', `/api/demo/${service}/${path}`, { token, body });

async function waitFor(fn, timeoutMs = 8000, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(everyMs); }
  return null;
}

module.exports = { BASE, api, sleep, uid, registerRider, registerDriver, goOnline, goOffline, startDriverBot, requestRide, waitForRide, isTerminal, setDemo, waitFor };
