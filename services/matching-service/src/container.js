const os = require('os');
const cfg = require('./config');
const rides = require('./rides.repo');
const sagaStore = require('./saga/mongoSagaStore');
const { createRunner } = require('./saga/runner');
const buildSteps = require('./saga/steps');
const createRecovery = require('./saga/recovery');
const keys = require('./common/keys');
const { publishEvent } = require('./common/events');

// Composition root: the ONE place where concrete pieces are wired together. Every
// other module receives its dependencies as arguments, which is what lets the
// tests run the saga with fakes.
module.exports = ({ redis }) => {
  const events = { publish: (type, data) => publishEvent(redis, type, data) };
  const locks = require('./locks')(redis);
  const geo = require('./geo')({ redis, cfg });
  const offers = require('./offers')({ redis, cfg, events });
  const driver = require('./clients/driverClient');
  const payment = require('./clients/paymentClient');

  const steps = buildSteps({ cfg, rides, events, geo, locks, offers, driver, payment });

  const runner = createRunner({
    store: sagaStore,
    steps,
    owner: `${os.hostname()}-${process.pid}`,
    leaseMs: cfg.leaseMs,
    maxCompensationRounds: cfg.maxCompensationRounds,
    isCancelRequested: async (rideId) => (await redis.exists(keys.rideCancelFlag(rideId))) === 1,
    // Compensation could not finish after several rounds: mark the ride FAILED so
    // it is visible and a human can look at it.
    onCompensationFailed: (saga) => rides.markFailed(saga.rideId, 'COMPENSATION_FAILED'),
  });

  const booking = require('./booking')({ rides, store: sagaStore, runner, redis, events, driver, payment, locks });
  const recovery = createRecovery({ store: sagaStore, runner, rides, cfg, bookingFromRide: booking.startSaga });

  return { booking, offers, recovery, runner };
};
