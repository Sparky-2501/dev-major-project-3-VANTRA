const Payment = require('./models/payment.model');
const keys = require('./common/keys');
const { publishEvent } = require('./common/events');
const logger = require('./common/logger');

// Simulated payment gateway. All operations are idempotent: calling them twice
// gives the same answer and never charges twice. That is what makes it safe for
// matching-service to retry them and to run compensations more than once.

module.exports = (redis) => {
  // Failure rate for demos: runtime value in Redis (set via the demo endpoint,
  // seen by every replica) wins over the PAYMENT_FAILURE_RATE env default.
  async function failureRate() {
    if (process.env.DEMO_MODE === 'true') {
      const v = await redis.get(keys.DEMO_PAYMENT_FAIL_RATE);
      if (v !== null) return Number(v);
    }
    return Number(process.env.PAYMENT_FAILURE_RATE || 0);
  }

  const move = (payment, status) => {
    payment.status = status;
    payment.history.push({ status, at: new Date() });
    return payment.save();
  };

  async function create(rideId, amount, status, idempotencyKey) {
    try {
      return await Payment.create({
        rideId, amount, status, idempotencyKey,
        history: [{ status, at: new Date() }],
      });
    } catch (err) {
      // Two concurrent calls raced; the unique index let one win. Return the winner.
      if (err.code === 11000) return Payment.findOne({ rideId });
      throw err;
    }
  }

  return {
    async authorize({ rideId, amount, idempotencyKey }) {
      // Same ride again -> same stored answer (AUTHORIZED, DECLINED or VOIDED).
      const existing = await Payment.findOne({ rideId });
      if (existing) return existing;
      const declined = Math.random() < (await failureRate());
      logger.info('authorize', { rideId, amount, declined });
      return create(rideId, amount, declined ? 'DECLINED' : 'AUTHORIZED', idempotencyKey);
    },

    async capture(rideId) {
      const p = await Payment.findOne({ rideId });
      if (!p) return { notFound: true };
      if (p.status === 'CAPTURED') return p;              // already done: idempotent
      if (p.status !== 'AUTHORIZED') return { conflict: p };
      await move(p, 'CAPTURED');
      await publishEvent(redis, 'payment.captured', { rideId, amount: p.amount, currency: p.currency });
      return p;
    },

    // If the payment does not exist yet we write a VOIDED record. Reason: matching
    // may time out on authorize, run compensation, call void, and only THEN the
    // slow authorize lands. With the tombstone, that late authorize finds VOIDED
    // and returns it instead of creating a live authorization nobody will ever void.
    async void(rideId) {
      const p = await Payment.findOne({ rideId });
      if (!p) return create(rideId, 0, 'VOIDED', `void:${rideId}`);
      if (p.status === 'AUTHORIZED') { await move(p, 'VOIDED'); return p; }
      return p; // VOIDED/DECLINED/REFUNDED: nothing to do. CAPTURED: caller must refund.
    },

    async refund(rideId) {
      const p = await Payment.findOne({ rideId });
      if (!p) return { notFound: true };
      if (p.status === 'REFUNDED') return p;
      if (p.status !== 'CAPTURED') return { conflict: p };
      await move(p, 'REFUNDED');
      return p;
    },

    get: (rideId) => Payment.findOne({ rideId }),
  };
};
