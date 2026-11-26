const makeWorld = require('./helpers/world');
const test = require('node:test');
const assert = require('node:assert/strict');

test('happy path: all four steps complete and the ride is CONFIRMED', async () => {
  const w = makeWorld();
  await w.newRide('r1');
  const res = await w.makeRunner().run('r1');
  const saga = await w.store.get('r1');
  assert.equal(res.state, 'COMPLETED');
  assert.deepEqual(saga.completedSteps, ['createRide', 'reserveDriver', 'authorizePayment', 'confirmRide']);
  assert.equal(w.rideDocs.get('r1').status, 'CONFIRMED');
  assert.equal(w.rideDocs.get('r1').driverId, 'd1');          // nearest driver
  assert.deepEqual(w.events.map((e) => e.type), ['ride.requested', 'driver.assigned', 'ride.confirmed']);
});

test('payment declined: compensates in REVERSE order, driver released, ride cancelled', async () => {
  const w = makeWorld({ paymentStatus: 'DECLINED' });
  await w.newRide('r1');
  await w.makeRunner().run('r1');
  const saga = await w.store.get('r1');
  assert.equal(saga.state, 'COMPENSATED');
  assert.equal(saga.failure.reason, 'PAYMENT_DECLINED');
  // newest first: the failed step, then reserveDriver, then createRide
  assert.deepEqual(saga.compensationLog.map((e) => e.step), ['authorizePayment', 'reserveDriver', 'createRide']);
  assert.ok(saga.compensationLog.every((e) => e.ok));
  assert.equal(w.rideDocs.get('r1').status, 'CANCELLED');
  assert.equal(w.rideDocs.get('r1').cancelReason, 'PAYMENT_DECLINED');
  assert.deepEqual(w.calls.release, ['d1']);                   // driver-service told to free the driver
  assert.equal(await w.redis.get('driver:lock:d1'), null);     // and the Redis lock is gone
  assert.ok(w.events.some((e) => e.type === 'ride.cancelled'));
});

test('payment service unreachable: saga compensates with PAYMENT_UNAVAILABLE', async () => {
  const w = makeWorld();
  w.paymentThrows = true;
  await w.newRide('r1');
  await w.makeRunner().run('r1');
  const saga = await w.store.get('r1');
  assert.equal(saga.state, 'COMPENSATED');
  assert.equal(saga.failure.reason, 'PAYMENT_UNAVAILABLE');
  assert.equal(w.rideDocs.get('r1').status, 'CANCELLED');
});

test('no drivers nearby: ride cancelled, no driver-service release needed', async () => {
  const w = makeWorld({ drivers: [] });
  await w.newRide('r1');
  await w.makeRunner().run('r1');
  const saga = await w.store.get('r1');
  assert.equal(saga.failure.reason, 'NO_DRIVERS_AVAILABLE');
  assert.equal(saga.state, 'COMPENSATED');
  assert.equal(w.rideDocs.get('r1').status, 'CANCELLED');
  assert.deepEqual(w.calls.release, []);
});

test('driver times out: next nearest driver gets the ride, first lock released', async () => {
  const w = makeWorld({ drivers: ['d1', 'd2'], answers: { d1: 'TIMEOUT', d2: 'ACCEPTED' } });
  await w.newRide('r1');
  await w.makeRunner().run('r1');
  assert.equal(w.rideDocs.get('r1').status, 'CONFIRMED');
  assert.equal(w.rideDocs.get('r1').driverId, 'd2');
  assert.equal(await w.redis.get('driver:lock:d1'), null);     // d1 freed for other rides
  assert.equal(await w.redis.get('driver:lock:d2'), 'r1');     // d2 held by this ride
  assert.deepEqual(w.log.filter((l) => l.startsWith('offer:')), ['offer:d1', 'offer:d2']);
});

test('after M attempts without an accept, the saga compensates', async () => {
  const w = makeWorld({ drivers: ['d1', 'd2', 'd3', 'd4'], answers: { d1: 'TIMEOUT', d2: 'DECLINED', d3: 'TIMEOUT', d4: 'ACCEPTED' } });
  await w.newRide('r1');
  await w.makeRunner().run('r1');
  assert.deepEqual(w.log.filter((l) => l.startsWith('offer:')), ['offer:d1', 'offer:d2', 'offer:d3']); // M = 3, d4 never asked
  assert.equal(w.rideDocs.get('r1').status, 'CANCELLED');
  for (const d of ['d1', 'd2', 'd3', 'd4']) assert.equal(await w.redis.get(`driver:lock:${d}`), null);
});

test('two riders competing for ONE driver: exactly one wins', async () => {
  const w = makeWorld({ drivers: ['d1'] });
  await w.newRide('rA');
  await w.newRide('rB');
  await Promise.all([w.makeRunner('A').run('rA'), w.makeRunner('B').run('rB')]);
  const statuses = [w.rideDocs.get('rA').status, w.rideDocs.get('rB').status].sort();
  assert.deepEqual(statuses, ['CANCELLED', 'CONFIRMED']);
  const winner = [...w.rideDocs.values()].find((r) => r.status === 'CONFIRMED');
  assert.equal(winner.driverId, 'd1');
  assert.equal(w.calls.assign.length, 1);                      // driver-service was asked to assign only once
});

test('driver-service outage after accept: saga fails, compensation retried until it works', async () => {
  const w = makeWorld({ failures: { release: 100 } });
  w.assignThrows = true;
  await w.newRide('r1');
  const runner = w.makeRunner('A', { maxCompensationRounds: 3 });
  await runner.run('r1');
  let saga = await w.store.get('r1');
  assert.equal(saga.failure.reason, 'STEP_ERROR');
  assert.equal(saga.state, 'COMPENSATING');                     // stuck: driver-service release keeps failing
  assert.equal(w.rideDocs.get('r1').status, 'REQUESTED');       // reverse order: ride NOT cancelled before the driver is freed
  assert.ok(saga.compensationLog.some((e) => !e.ok));

  w.failures.release = 0;                                       // driver-service comes back
  await runner.run('r1');                                       // what the sweeper does
  saga = await w.store.get('r1');
  assert.equal(saga.state, 'COMPENSATED');
  assert.equal(w.rideDocs.get('r1').status, 'CANCELLED');
});

test('compensation that never succeeds ends as COMPENSATION_FAILED and ride FAILED', async () => {
  const w = makeWorld({ failures: { release: 1000 } });
  w.assignThrows = true;
  await w.newRide('r1');
  const runner = w.makeRunner('A', { maxCompensationRounds: 2 });
  await runner.run('r1');
  await runner.run('r1');
  assert.equal((await w.store.get('r1')).state, 'COMPENSATION_FAILED');
  assert.equal(w.rideDocs.get('r1').status, 'FAILED');
});

test('compensations are idempotent: re-running a finished compensation does nothing', async () => {
  const w = makeWorld({ paymentStatus: 'DECLINED' });
  await w.newRide('r1');
  const runner = w.makeRunner();
  await runner.run('r1');
  const before = { void: w.calls.void, release: w.calls.release.length, events: w.events.length };
  // force the saga back to COMPENSATING with a full log, as after a crash
  w.store.sagas.get('r1').state = 'COMPENSATING';
  await runner.run('r1');
  assert.deepEqual({ void: w.calls.void, release: w.calls.release.length, events: w.events.length }, before);
  assert.equal((await w.store.get('r1')).state, 'COMPENSATED');
});

test('crash recovery: a second orchestrator resumes where the first died', async () => {
  let t = 1000;
  const w = makeWorld({ now: () => t });
  await w.newRide('r1');
  // Orchestrator "dead" finished createRide, then crashed holding the lease.
  const s = w.store.sagas.get('r1');
  s.completedSteps = ['createRide']; s.currentStep = 'createRide';
  s.leaseOwner = 'dead'; s.leaseExpiresAt = t + 500;

  const b = w.makeRunner('B');
  assert.equal((await b.run('r1')).claimed, false);             // lease still live: B must not touch it
  t += 1000;                                                    // lease expires
  assert.deepEqual(await w.store.listRecoverable(), ['r1']);    // sweeper would find it
  const res = await b.run('r1');
  assert.equal(res.state, 'COMPLETED');
  assert.equal(w.events.filter((e) => e.type === 'ride.requested').length, 0); // createRide was NOT redone
  assert.equal(w.rideDocs.get('r1').status, 'CONFIRMED');
});

test('rider cancels while the saga is running: it compensates with CANCELLED_BY_RIDER', async () => {
  const w = makeWorld();
  await w.newRide('r1');
  w.cancelFlags.add('r1');
  await w.makeRunner().run('r1');
  const saga = await w.store.get('r1');
  assert.equal(saga.failure.reason, 'CANCELLED_BY_RIDER');
  assert.equal(w.rideDocs.get('r1').status, 'CANCELLED');
});

test('cancelling a CONFIRMED ride compensates the finished saga (void payment, free driver)', async () => {
  const w = makeWorld();
  await w.newRide('r1');
  const runner = w.makeRunner();
  await runner.run('r1');
  assert.equal(w.rideDocs.get('r1').status, 'CONFIRMED');
  assert.equal(await runner.requestCompensation('r1', 'CANCELLED_BY_RIDER'), true);
  await runner.run('r1');
  assert.equal(w.rideDocs.get('r1').status, 'CANCELLED');
  assert.equal(w.calls.void, 1);
  assert.deepEqual(w.calls.release, ['d1']);
  assert.equal(await w.redis.get('driver:lock:d1'), null);
});
