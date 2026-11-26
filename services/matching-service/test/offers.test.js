require('./helpers/otelStub');
const test = require('node:test');
const assert = require('node:assert/strict');
const FakeRedis = require('./helpers/fakeRedis');
const createOffers = require('../src/offers');

function setup(onPoll) {
  const redis = new FakeRedis();
  let t = 0;
  const offers = createOffers({
    redis, cfg: { offerTimeoutSec: 1, pollMs: 100 }, events: { publish: async () => {} },
    now: () => t,
    sleep: async (ms) => { t += ms; if (onPoll) await onPoll(redis, offers, t); }, // simulated clock: no real waiting
  });
  const args = { rideId: 'r1', driverId: 'd1', payload: {}, isCancelRequested: async () => false, ensureLease() {} };
  return { redis, offers, args };
}

test('nobody answers -> TIMEOUT, and the offer is revoked', async () => {
  const { redis, offers, args } = setup();
  assert.equal(await offers.offerAndWait(args), 'TIMEOUT');
  assert.equal(await redis.get('driver:offer:d1'), null);
});

test('driver accepts during the wait -> ACCEPTED', async () => {
  const { offers, args } = setup(async (r, o, t) => { if (t === 200) await o.respond({ driverId: 'd1', rideId: 'r1', answer: 'accepted' }); });
  assert.equal(await offers.offerAndWait(args), 'ACCEPTED');
});

test('driver declines -> DECLINED', async () => {
  const { offers, args } = setup(async (r, o, t) => { if (t === 100) await o.respond({ driverId: 'd1', rideId: 'r1', answer: 'declined' }); });
  assert.equal(await offers.offerAndWait(args), 'DECLINED');
});

test('an accept that arrives AFTER the offer expired is refused, not silently lost', async () => {
  const { offers, args } = setup();
  await offers.offerAndWait(args);                                  // times out, offer revoked
  assert.equal(await offers.respond({ driverId: 'd1', rideId: 'r1', answer: 'accepted' }), false);
});

test('a driver cannot answer an offer made to someone else', async () => {
  const { redis, offers } = setup();
  await redis.set('driver:offer:d1', 'r1');
  assert.equal(await offers.respond({ driverId: 'd2', rideId: 'r1', answer: 'accepted' }), false);
});

test('rider cancel while waiting aborts the offer', async () => {
  const { redis, offers, args } = setup();
  await assert.rejects(offers.offerAndWait({ ...args, isCancelRequested: async () => true }), (e) => e.reason === 'CANCELLED_BY_RIDER');
  assert.equal(await redis.get('driver:offer:d1'), null);
});
