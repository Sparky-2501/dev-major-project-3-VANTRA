// A business failure inside a saga step. `reason` is a stable code that ends up in
// the saga's failure record and the ride's cancelReason (NO_DRIVERS_AVAILABLE,
// PAYMENT_DECLINED, ...).
class SagaError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

// This orchestrator no longer owns the saga (another replica took over because our
// lease expired). We must stop immediately and touch nothing.
class LeaseLostError extends Error {
  constructor() {
    super('saga lease lost');
  }
}

module.exports = { SagaError, LeaseLostError };
