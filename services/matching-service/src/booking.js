const { computeFare } = require('./fare');
const { HttpError } = require('./httpError');
const { isTerminal } = require('./rideStateMachine');
const { currentTraceparent } = require('./common/spans');
const { getContext } = require('./common/context');
const keys = require('./common/keys');
const logger = require('./common/logger');

// Use-cases behind the HTTP routes. d = { rides, store, runner, redis, events, driver, payment, locks }
module.exports = (d) => {
  async function startSaga(ride) {
    const rideId = String(ride._id);
    await d.store.create({
      rideId,
      context: {
        rideId, riderId: ride.riderId, pickup: ride.pickup, dropoff: ride.dropoff, fare: ride.fare,
        triedDrivers: [], assignAttempted: [], offersMade: 0,
      },
      traceparent: currentTraceparent(),
      correlationId: getContext().correlationId,
    });
    // Run in the background and answer the HTTP request immediately: a booking can
    // wait many seconds for a driver. The saga state is in Mongo, so the caller
    // polls GET /rides/:id. setImmediate keeps the request's trace/correlation context.
    setImmediate(() => d.runner.run(rideId).catch((err) =>
      logger.error('saga run crashed', { rideId, err: err.message })));
  }

  // A Mongo ObjectId is 24 hex characters. Checked here so a bad id gives a clean 404, not a Mongoose CastError (500).
  const validId = (id) => /^[a-f0-9]{24}$/i.test(String(id));
  const sagaView = (s) => s && {
    state: s.state, currentStep: s.currentStep, completedSteps: s.completedSteps,
    failure: s.failure || null, compensationLog: s.compensationLog, stepLog: s.stepLog,
  };

  return {
    startSaga,

    async requestRide({ riderId, pickup, dropoff, idempotencyKey }) {
      const fare = computeFare(pickup, dropoff);
      const { ride, created } = await d.rides.createIdempotent({ riderId, pickup, dropoff, fare, idempotencyKey });
      // Same key again: return the ride we already have, do NOT start a 2nd saga.
      if (!created) return { duplicate: true, ride };
      await startSaga(ride);
      return { duplicate: false, ride };
    },

    async getRide(rideId) {
      if (!validId(rideId)) throw new HttpError(404, 'Ride not found');
      const ride = await d.rides.get(rideId);
      if (!ride) throw new HttpError(404, 'Ride not found');
      return { ride, saga: sagaView(await d.store.get(rideId)) };
    },

    listRides: (riderId) => d.rides.listByRider(riderId),

    async cancelRide(rideId, riderId) {
      if (!validId(rideId)) throw new HttpError(404, 'Ride not found');
      const ride = await d.rides.get(rideId);
      if (!ride || ride.riderId !== riderId) throw new HttpError(404, 'Ride not found');
      if (isTerminal(ride.status)) throw new HttpError(409, `Ride is already ${ride.status}`);
      if (ride.status === 'IN_PROGRESS') throw new HttpError(409, 'Cannot cancel a ride in progress');

      const saga = await d.store.get(rideId);
      if (saga && saga.state === 'COMPLETED') {
        // Booking finished (ride CONFIRMED): undo it by running the compensations.
        if (await d.runner.requestCompensation(rideId, 'CANCELLED_BY_RIDER')) await d.runner.run(rideId);
        const after = await d.rides.get(rideId);
        return { status: after.status === 'CANCELLED' ? 200 : 202, ride: after };
      }
      // Saga still running (maybe on another replica): leave a flag it checks
      // between steps and while waiting for a driver.
      await d.redis.set(keys.rideCancelFlag(rideId), '1', 'EX', 3600);
      return { status: 202, ride, message: 'Cancellation requested' };
    },

    async startRide(rideId, driverId) {
      const ride = await mustBeDriversRide(rideId, driverId);
      if (ride.status === 'IN_PROGRESS') return ride; // idempotent
      const moved = await d.rides.transition(rideId, ['CONFIRMED'], 'IN_PROGRESS');
      if (!moved) throw new HttpError(409, `Ride is ${ride.status}, expected CONFIRMED`);
      return moved;
    },

    async completeRide(rideId, driverId) {
      let ride = await mustBeDriversRide(rideId, driverId);
      if (ride.status !== 'COMPLETED') {
        if (ride.status !== 'IN_PROGRESS') throw new HttpError(409, `Ride is ${ride.status}, expected IN_PROGRESS`);
        // Capture BEFORE marking completed. If capture fails the ride stays
        // IN_PROGRESS and the driver can simply call complete again (capture is idempotent).
        try { await d.payment.capture(rideId); } catch (err) {
          throw new HttpError(502, `Payment capture failed, ride not completed: ${err.message}`);
        }
        const moved = await d.rides.transition(rideId, ['IN_PROGRESS'], 'COMPLETED');
        if (moved) {
          ride = moved;
          await d.events.publish('ride.completed', { rideId, riderId: ride.riderId, driverId, fare: ride.fare });
        }
      }
      // Free the driver. Also runs on a repeat call, so a failure here is retryable.
      try {
        await d.driver.release(driverId, rideId);
        await d.locks.release(driverId, rideId);
      } catch (err) {
        throw new HttpError(502, `Ride completed but releasing the driver failed, call complete again: ${err.message}`);
      }
      return ride;
    },
  };

  async function mustBeDriversRide(rideId, driverId) {
    if (!validId(rideId)) throw new HttpError(404, 'Ride not found');
    const ride = await d.rides.get(rideId);
    if (!ride || ride.driverId !== driverId) throw new HttpError(404, 'Ride not found for this driver');
    return ride;
  }
};
