require('./helpers/otelStub');
const test = require('node:test');
const assert = require('node:assert/strict');
const createBooking = require('../src/booking');

// Fake repo with the same (riderId, idempotencyKey) uniqueness the Mongo index gives.
function setup() {
  const rows = new Map();
  let n = 0;
  const started = [];
  const rides = {
    async createIdempotent({ riderId, idempotencyKey, ...rest }) {
      const k = `${riderId}|${idempotencyKey}`;
      if (rows.has(k)) return { ride: rows.get(k), created: false };
      const ride = { _id: String(++n).padStart(24, '0'), riderId, idempotencyKey, ...rest, status: 'REQUESTED' };
      rows.set(k, ride);
      return { ride, created: true };
    },
  };
  const store = { async create(s) { started.push(s.rideId); } };
  const runner = { run: async () => {} };
  const booking = createBooking({ rides, store, runner, redis: {}, events: {}, driver: {}, payment: {}, locks: {} });
  return { booking, started };
}
const body = { riderId: 'u1', pickup: { lng: 73.85, lat: 18.52 }, dropoff: { lng: 73.9, lat: 18.55 } };

test('same Idempotency-Key twice: one ride, one saga, second call flagged duplicate', async () => {
  const { booking, started } = setup();
  const a = await booking.requestRide({ ...body, idempotencyKey: 'k1' });
  const b = await booking.requestRide({ ...body, idempotencyKey: 'k1' });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(String(a.ride._id), String(b.ride._id));
  assert.equal(started.length, 1);
});

test('different keys make different rides', async () => {
  const { booking, started } = setup();
  await booking.requestRide({ ...body, idempotencyKey: 'k1' });
  await booking.requestRide({ ...body, idempotencyKey: 'k2' });
  assert.equal(started.length, 2);
});

test('same key from a DIFFERENT rider is a different ride', async () => {
  const { booking, started } = setup();
  await booking.requestRide({ ...body, idempotencyKey: 'k1' });
  await booking.requestRide({ ...body, riderId: 'u2', idempotencyKey: 'k1' });
  assert.equal(started.length, 2);
});

test('an invalid ride id is a clean 404', async () => {
  const { booking } = setup();
  await assert.rejects(booking.getRide('not-an-id'), (e) => e.status === 404);
});
