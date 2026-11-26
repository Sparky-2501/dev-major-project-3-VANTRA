const mongoose = require('mongoose');
const { Mixed } = mongoose.Schema.Types;

// The durable record of one ride's booking saga. This document IS the saga: if
// the process dies, another one reads it and knows exactly what is done.
const sagaSchema = new mongoose.Schema({
  rideId: { type: String, required: true, unique: true },
  state: {
    type: String,
    enum: ['RUNNING', 'COMPENSATING', 'COMPLETED', 'COMPENSATED', 'COMPENSATION_FAILED'],
    default: 'RUNNING',
  },
  currentStep: String,
  completedSteps: { type: [String], default: [] },
  context: { type: Mixed, default: {} },   // data steps share: driverId, triedDrivers, ...
  stepLog: { type: [Mixed], default: [] }, // { step, startedAt, endedAt }
  compensationLog: { type: [Mixed], default: [] }, // { step, ok, error?, at }
  failure: Mixed,                           // { step, reason, message, at }
  compensationRounds: { type: Number, default: 0 },
  leaseOwner: { type: String, default: null },
  leaseExpiresAt: { type: Number, default: 0 },
  traceparent: String,    // so a resumed saga continues the original Jaeger trace
  correlationId: String,
}, { timestamps: true, minimize: false });

sagaSchema.index({ state: 1, leaseExpiresAt: 1 }); // the sweeper's query

module.exports = mongoose.model('Saga', sagaSchema);
