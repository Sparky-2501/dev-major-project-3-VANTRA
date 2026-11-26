const test = require('node:test');
const assert = require('node:assert/strict');
const { messagesFor } = require('../src/messages');

test('ride.offered goes to the driver only', () => {
  const m = messagesFor('ride.offered', { riderId: 'r', driverId: 'd', distanceKm: 1.2, expiresInSec: 15 });
  assert.deepEqual(m.map((x) => x.to), ['driver:d']);
});
test('ride.confirmed goes to both', () => {
  const m = messagesFor('ride.confirmed', { riderId: 'r', driverId: 'd' });
  assert.deepEqual(m.map((x) => x.to).sort(), ['driver:d', 'rider:r']);
});
test('ride.cancelled before any driver: only the rider is told', () => {
  const m = messagesFor('ride.cancelled', { riderId: 'r', driverId: null, reason: 'NO_DRIVERS_AVAILABLE' });
  assert.deepEqual(m.map((x) => x.to), ['rider:r']);
  assert.match(m[0].text, /NO_DRIVERS_AVAILABLE/);
});
test('unknown event types are ignored', () => {
  assert.deepEqual(messagesFor('something.new', { riderId: 'r' }), []);
});
