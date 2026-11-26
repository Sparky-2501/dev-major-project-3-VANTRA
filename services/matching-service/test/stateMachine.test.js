require('./helpers/otelStub');
const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, isTerminal, TRANSITIONS, CANCELLABLE } = require('../src/rideStateMachine');

test('the happy path is a legal chain', () => {
  const chain = ['REQUESTED', 'DRIVER_ASSIGNED', 'PAYMENT_AUTHORIZED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];
  for (let i = 0; i < chain.length - 1; i++) assert.ok(canTransition(chain[i], chain[i + 1]), `${chain[i]} -> ${chain[i + 1]}`);
});

test('illegal jumps are rejected', () => {
  assert.equal(canTransition('REQUESTED', 'CONFIRMED'), false);
  assert.equal(canTransition('COMPLETED', 'REQUESTED'), false);
  assert.equal(canTransition('CANCELLED', 'CONFIRMED'), false);
});

test('terminal states have no exits', () => {
  for (const s of ['COMPLETED', 'CANCELLED', 'FAILED']) assert.ok(isTerminal(s));
  assert.equal(Object.keys(TRANSITIONS).length, 8);
});

test('a rider can cancel before the trip starts, not during it', () => {
  assert.ok(CANCELLABLE.includes('CONFIRMED'));
  assert.ok(!CANCELLABLE.includes('IN_PROGRESS'));
});
