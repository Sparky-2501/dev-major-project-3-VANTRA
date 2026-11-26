require('./otelStub');
const FakeRedis = require('./fakeRedis');
const MemorySagaStore = require('./memorySagaStore');
const { createRunner } = require('../../src/saga/runner');
const buildSteps = require('../../src/saga/steps');
const { canTransition, CANCELLABLE } = require('../../src/rideStateMachine');

const cfg = {
  offerTimeoutSec: 1, maxOfferAttempts: 3, pollMs: 1, searchRadiiKm: [3], searchCount: 5, rideLockTtlSec: 100, leaseMs: 1000,
};

// Builds a complete saga "world" with fake edges (Mongo ride repo, geo, offers,
// driver-service, payment-service, events) around the REAL runner, steps and locks.
module.exports = function makeWorld(opts = {}) {
  const redis = new FakeRedis();
  const locks = require('../../src/locks')(redis);
  const store = new MemorySagaStore(opts.now);
  const log = [];            // ordered record of side effects, to assert ordering
  const events = [];
  const rideDocs = new Map();

  const rides = {
    async create(id, extra = {}) { rideDocs.set(id, { _id: id, status: 'REQUESTED', riderId: 'rider-' + id, ...extra }); },
    async get(id) { return rideDocs.get(id) || null; },
    async transition(id, from, to, patch = {}) {
      from.forEach((f) => { if (!canTransition(f, to)) throw new Error(`illegal ${f}->${to}`); });
      const r = rideDocs.get(id);
      if (!r || !from.includes(r.status)) return null;
      Object.assign(r, patch, { status: to }); log.push(`ride:${to}`); return r;
    },
    async cancel(id, reason) {
      const r = rideDocs.get(id);
      if (!r || !CANCELLABLE.includes(r.status)) return null;
      r.status = 'CANCELLED'; r.cancelReason = reason; log.push('ride:CANCELLED'); return r;
    },
    async markFailed(id, reason) { const r = rideDocs.get(id); r.status = 'FAILED'; r.cancelReason = reason; return r; },
  };

  const world = {
    redis, locks, store, rides, log, events, rideDocs, cfg,
    drivers: opts.drivers || ['d1', 'd2'],            // nearest first
    answers: opts.answers || {},                      // driverId -> 'ACCEPTED' | 'DECLINED' | 'TIMEOUT'
    paymentStatus: opts.paymentStatus || 'AUTHORIZED',
    failures: { release: 0, void: 0, ...(opts.failures || {}) }, // number of times to fail before succeeding
    calls: { assign: [], release: [], authorize: 0, void: 0, refund: 0 },
    cancelFlags: new Set(),
  };

  const geo = {
    async findNearby(point, exclude = []) {
      return world.drivers.filter((id) => !exclude.includes(id)).map((driverId, i) => ({ driverId, distanceKm: 1 + i }));
    },
  };
  const offers = {
    async offerAndWait({ driverId }) { log.push(`offer:${driverId}`); return world.answers[driverId] || 'ACCEPTED'; },
    async clear() {},
  };
  const driver = {
    async assign(id, rideId) { world.calls.assign.push(id); log.push(`assign:${id}`); if (world.assignThrows) throw new Error('driver-service down'); return { status: 'OK' }; },
    async release(id, rideId) {
      world.calls.release.push(id); log.push(`driver-release:${id}`);
      if (world.failures.release-- > 0) throw new Error('driver-service down');
      return { status: 'OK' };
    },
  };
  const payment = {
    async authorize() { world.calls.authorize++; if (world.paymentThrows) throw new Error('payment down'); return { status: world.paymentStatus }; },
    async void() { world.calls.void++; log.push('payment-void'); return { status: 'VOIDED' }; },
    async refund() { world.calls.refund++; return { status: 'REFUNDED' }; },
  };
  const evts = { async publish(type, data) { events.push({ type, data }); } };

  world.steps = buildSteps({ cfg, rides, events: evts, geo, locks, offers, driver, payment });
  world.makeRunner = (owner = 'A', extra = {}) => createRunner({
    store, steps: world.steps, owner, leaseMs: 1000, retryOpts: { sleepFn: async () => {}, retries: 1 },
    isCancelRequested: async (id) => world.cancelFlags.has(id),
    onCompensationFailed: (s) => rides.markFailed(s.rideId, 'COMPENSATION_FAILED'),
    ...extra,
  });
  world.newRide = async (id) => {
    await rides.create(id);
    await store.create({ rideId: id, context: { rideId: id, riderId: 'rider-' + id, pickup: { lng: 0, lat: 0 }, dropoff: { lng: 0.01, lat: 0.01 }, fare: 100, triedDrivers: [], assignAttempted: [], offersMade: 0 } });
  };
  return world;
};
