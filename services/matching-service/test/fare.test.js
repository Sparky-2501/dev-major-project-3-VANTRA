require('./helpers/otelStub');
const test = require('node:test');
const assert = require('node:assert/strict');
const { distanceKm, computeFare } = require('../src/fare');

test('distance: 1 degree of latitude is about 111 km', () => {
  const d = distanceKm({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
  assert.ok(d > 110 && d < 112, `got ${d}`);
});
test('fare is deterministic and has a minimum', () => {
  const a = { lng: 73.85, lat: 18.52 }, b = { lng: 73.86, lat: 18.53 };
  assert.equal(computeFare(a, b), computeFare(a, b));
  assert.equal(computeFare(a, a), 50);
});
