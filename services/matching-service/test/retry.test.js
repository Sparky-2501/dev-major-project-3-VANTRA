require('./helpers/otelStub');
const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetry } = require('../src/common/retry');

const noSleep = async () => {};

test('retries a failing call and then succeeds', async () => {
  let calls = 0;
  const out = await withRetry(async () => { if (++calls < 3) throw new Error('boom'); return 'ok'; }, { retries: 3, sleepFn: noSleep });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
});

test('gives up after the configured retries', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('boom'); }, { retries: 2, sleepFn: noSleep }));
  assert.equal(calls, 3); // 1 try + 2 retries
});

test('does not retry client errors (4xx) or an open breaker', async () => {
  let calls = 0;
  const e4 = Object.assign(new Error('bad'), { status: 409 });
  await assert.rejects(withRetry(async () => { calls++; throw e4; }, { retries: 3, sleepFn: noSleep }));
  assert.equal(calls, 1);
  calls = 0;
  const open = Object.assign(new Error('open'), { code: 'EOPENBREAKER' });
  await assert.rejects(withRetry(async () => { calls++; throw open; }, { retries: 3, sleepFn: noSleep }));
  assert.equal(calls, 1);
});

test('backoff grows exponentially (upper bound doubles per attempt)', async () => {
  const waits = [];
  await assert.rejects(withRetry(async () => { throw new Error('x'); }, { retries: 3, baseMs: 100, maxMs: 10000, sleepFn: async (ms) => waits.push(ms) }));
  // each wait is within [cap/2, cap] where cap = 100, 200, 400
  [100, 200, 400].forEach((cap, i) => assert.ok(waits[i] >= cap / 2 && waits[i] <= cap, `wait ${i}=${waits[i]}`));
});
