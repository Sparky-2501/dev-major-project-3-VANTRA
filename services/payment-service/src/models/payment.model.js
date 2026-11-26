const mongoose = require('mongoose');

const historyEntry = new mongoose.Schema({ status: String, at: Date }, { _id: false });

// One payment per ride. The UNIQUE index on rideId IS the idempotency guarantee:
// no matter how many times authorize is retried or duplicated, the database can
// hold only one payment for a ride.
const paymentSchema = new mongoose.Schema({
  rideId: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: {
    type: String,
    enum: ['AUTHORIZED', 'DECLINED', 'CAPTURED', 'VOIDED', 'REFUNDED'],
    required: true,
  },
  idempotencyKey: String,
  history: [historyEntry],
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
