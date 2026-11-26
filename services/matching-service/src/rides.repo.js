const Ride = require('./models/ride.model');
const { canTransition, CANCELLABLE } = require('./rideStateMachine');

const push = (status) => ({ $push: { history: { status, at: new Date() } } });

module.exports = {
  // Insert, or return the existing ride when the (riderId, idempotencyKey) pair repeats.
  async createIdempotent({ riderId, pickup, dropoff, fare, idempotencyKey }) {
    try {
      const ride = await Ride.create({
        riderId, pickup, dropoff, fare, idempotencyKey,
        status: 'REQUESTED', history: [{ status: 'REQUESTED', at: new Date() }],
      });
      return { ride, created: true };
    } catch (err) {
      if (err.code !== 11000) throw err;
      return { ride: await Ride.findOne({ riderId, idempotencyKey }), created: false };
    }
  },

  get: (id) => Ride.findById(id),
  listByRider: (riderId) => Ride.find({ riderId }).sort({ createdAt: -1 }).limit(50),

  // Compare-and-set: succeeds only if the ride is STILL in one of `from`. Two
  // replicas can never both apply the same transition, and a stale actor cannot
  // overwrite a newer state. Returns the updated ride, or null.
  async transition(id, from, to, patch = {}) {
    for (const f of from) {
      if (!canTransition(f, to)) throw new Error(`illegal ride transition ${f} -> ${to}`);
    }
    return Ride.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { $set: { status: to, ...patch }, ...push(to) },
      { new: true });
  },

  // Idempotent cancel: returns the ride only if THIS call cancelled it.
  cancel: (id, reason) => Ride.findOneAndUpdate(
    { _id: id, status: { $in: CANCELLABLE } },
    { $set: { status: 'CANCELLED', cancelReason: reason }, ...push('CANCELLED') },
    { new: true }),

  markFailed: (id, reason) => Ride.findOneAndUpdate(
    { _id: id, status: { $nin: ['COMPLETED', 'CANCELLED', 'FAILED'] } },
    { $set: { status: 'FAILED', cancelReason: reason }, ...push('FAILED') },
    { new: true }),

  findStaleRequested: (olderThanMs, limit) =>
    Ride.find({ status: 'REQUESTED', createdAt: { $lt: new Date(olderThanMs) } }).limit(limit),
};
