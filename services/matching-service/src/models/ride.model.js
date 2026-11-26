const mongoose = require('mongoose');
const { STATES } = require('../rideStateMachine');

// Explicit sub-schemas so these embedded objects do not get their own _id.
const point = new mongoose.Schema({ lng: { type: Number, required: true }, lat: { type: Number, required: true } }, { _id: false });
const historyEntry = new mongoose.Schema({ status: String, at: Date }, { _id: false });

const rideSchema = new mongoose.Schema({
  riderId: { type: String, required: true },
  driverId: String,
  pickup: point,
  dropoff: point,
  fare: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: STATES, default: 'REQUESTED' },
  cancelReason: String,
  idempotencyKey: { type: String, required: true },
  history: [historyEntry],
}, {
  timestamps: true,
  toJSON: { transform: (doc, ret) => { ret.id = String(ret._id); delete ret._id; delete ret.__v; return ret; } },
});

// The idempotency guarantee: the database refuses a second ride with the same key
// for the same rider, even if two identical requests arrive at the same instant.
rideSchema.index({ riderId: 1, idempotencyKey: 1 }, { unique: true });
rideSchema.index({ riderId: 1, createdAt: -1 });

module.exports = mongoose.model('Ride', rideSchema);
