const logger = require('../common/logger');

// Background sweeper, run by EVERY matching-service replica. It makes the saga
// "crash-safe": if a replica dies mid-saga, its lease expires and another replica
// finishes (or compensates) the ride. runner.run() claims atomically, so two
// replicas sweeping at once cannot both run the same saga.
module.exports = ({ store, runner, rides, cfg, bookingFromRide }) => {
  let busy = false;

  async function sweepOnce() {
    // 1) sagas whose orchestrator stopped renewing its lease
    const ids = await store.listRecoverable(Date.now(), 10);
    await Promise.allSettled(ids.map((id) => {
      logger.info('resuming saga', { rideId: id });
      return runner.run(id);
    }));

    // 2) crash between "insert ride" and "insert saga": the ride exists but has no
    //    saga and nobody would ever process it.
    const orphans = await rides.findStaleRequested(Date.now() - cfg.orphanAgeMs, 10);
    for (const ride of orphans) {
      if (await store.get(String(ride._id))) continue;
      logger.warn('orphan ride, creating saga', { rideId: String(ride._id) });
      await bookingFromRide(ride);
    }
  }

  return {
    sweepOnce,
    start() {
      const timer = setInterval(async () => {
        if (busy) return; // do not stack sweeps if one is slow
        busy = true;
        try { await sweepOnce(); } catch (err) { logger.error('sweep failed', { err: err.message }); } finally { busy = false; }
      }, cfg.sweepIntervalMs);
      return () => clearInterval(timer);
    },
  };
};
