const Saga = require('../models/saga.model');

// Fields the runner mutates. Everything else (rideId, createdAt, traceparent) is
// written once at creation.
const MUTABLE = ['state', 'currentStep', 'completedSteps', 'context', 'stepLog',
  'compensationLog', 'failure', 'compensationRounds'];

const plain = (doc) => (doc ? doc.toObject({ minimize: false }) : null);

module.exports = {
  create: async (fields) => plain(await Saga.create(fields)),
  get: async (rideId) => plain(await Saga.findOne({ rideId })),

  // Atomic take-over: succeeds only if the saga is unfinished AND nobody holds a
  // live lease (or we already hold it). Two replicas calling this at once: one wins.
  async claim(rideId, owner, leaseMs, now = Date.now()) {
    const doc = await Saga.findOneAndUpdate(
      {
        rideId,
        state: { $in: ['RUNNING', 'COMPENSATING'] },
        $or: [{ leaseExpiresAt: { $lt: now } }, { leaseOwner: owner }, { leaseOwner: null }],
      },
      { $set: { leaseOwner: owner, leaseExpiresAt: now + leaseMs } },
      { new: true });
    return plain(doc);
  },

  // Write only while we still own the lease (fencing).
  async save(saga) {
    const $set = {};
    MUTABLE.forEach((k) => { $set[k] = saga[k]; });
    const res = await Saga.updateOne({ rideId: saga.rideId, leaseOwner: saga.leaseOwner }, { $set });
    return res.matchedCount === 1;
  },

  async renew(rideId, owner, leaseMs) {
    const res = await Saga.updateOne({ rideId, leaseOwner: owner }, { $set: { leaseExpiresAt: Date.now() + leaseMs } });
    return res.matchedCount === 1;
  },

  release: (rideId, owner) =>
    Saga.updateOne({ rideId, leaseOwner: owner }, { $set: { leaseOwner: null, leaseExpiresAt: 0 } }),

  // Unfinished sagas whose owner stopped renewing: the orchestrator crashed.
  async listRecoverable(now = Date.now(), limit = 10) {
    const docs = await Saga.find({ state: { $in: ['RUNNING', 'COMPENSATING'] }, leaseExpiresAt: { $lt: now } })
      .limit(limit).select('rideId');
    return docs.map((d) => d.rideId);
  },

  // COMPLETED -> COMPENSATING (used to cancel an already confirmed ride).
  async requestCompensation(rideId, failure) {
    const res = await Saga.updateOne(
      { rideId, state: 'COMPLETED' },
      { $set: { state: 'COMPENSATING', failure, leaseOwner: null, leaseExpiresAt: 0 } });
    return res.modifiedCount === 1;
  },
};
