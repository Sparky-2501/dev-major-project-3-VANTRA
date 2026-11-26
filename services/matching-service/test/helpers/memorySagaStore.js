const MUTABLE = ['state', 'currentStep', 'completedSteps', 'context', 'stepLog', 'compensationLog', 'failure', 'compensationRounds'];
const clone = (o) => JSON.parse(JSON.stringify(o));

// Same contract as saga/mongoSagaStore.js, in memory, with an injectable clock.
module.exports = class MemorySagaStore {
  constructor(now = Date.now) { this.sagas = new Map(); this.now = now; }
  async create(f) {
    const s = { state: 'RUNNING', currentStep: null, completedSteps: [], context: {}, stepLog: [], compensationLog: [], failure: null, compensationRounds: 0, leaseOwner: null, leaseExpiresAt: 0, ...clone(f) };
    this.sagas.set(s.rideId, s);
    return clone(s);
  }
  async get(id) { const s = this.sagas.get(id); return s ? clone(s) : null; }
  async claim(id, owner, leaseMs) {
    const s = this.sagas.get(id);
    if (!s || !['RUNNING', 'COMPENSATING'].includes(s.state)) return null;
    if (s.leaseOwner && s.leaseOwner !== owner && s.leaseExpiresAt >= this.now()) return null;
    s.leaseOwner = owner; s.leaseExpiresAt = this.now() + leaseMs;
    return clone(s);
  }
  async save(saga) {
    const s = this.sagas.get(saga.rideId);
    if (!s || s.leaseOwner !== saga.leaseOwner) return false;
    MUTABLE.forEach((k) => { s[k] = clone(saga[k] === undefined ? null : saga[k]); });
    return true;
  }
  async renew(id, owner, leaseMs) {
    const s = this.sagas.get(id);
    if (!s || s.leaseOwner !== owner) return false;
    s.leaseExpiresAt = this.now() + leaseMs; return true;
  }
  async release(id, owner) { const s = this.sagas.get(id); if (s && s.leaseOwner === owner) { s.leaseOwner = null; s.leaseExpiresAt = 0; } }
  async listRecoverable() {
    return [...this.sagas.values()].filter((s) => ['RUNNING', 'COMPENSATING'].includes(s.state) && s.leaseExpiresAt < this.now()).map((s) => s.rideId);
  }
  async requestCompensation(id, failure) {
    const s = this.sagas.get(id);
    if (!s || s.state !== 'COMPLETED') return false;
    s.state = 'COMPENSATING'; s.failure = failure; s.leaseOwner = null; s.leaseExpiresAt = 0; return true;
  }
};
