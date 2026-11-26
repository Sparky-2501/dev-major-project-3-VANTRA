const { SagaError } = require('./errors');

// The four booking steps. Each has an action and a compensation.
// Rule for every compensation: IDEMPOTENT (safe to run twice, safe to run for work
// that never happened), because the runner retries them and may re-run them after a crash.
//
// deps: { cfg, rides, events, geo, locks, offers, driver, payment }
module.exports = function buildSteps(d) {
  const { cfg, rides, events } = d;

  // Move the ride from -> to, but tolerate "already there": after a crash between
  // "update ride" and "record step as done" the step runs again, and it must not
  // fail just because it already did its work.
  async function ensureStatus(rideId, from, to, patch) {
    const moved = await rides.transition(rideId, [from], to, patch);
    if (moved) return;
    const current = await rides.get(rideId);
    if (!current || current.status !== to) {
      throw new SagaError('RIDE_STATE_CHANGED', `ride is ${current && current.status}, expected ${from}`);
    }
  }

  // ---- 1. createRide -------------------------------------------------------
  const createRide = {
    name: 'createRide',
    // The ride row was inserted by the HTTP handler (so the caller gets a rideId
    // at once and a UNIQUE index enforces the idempotency key). This step is the
    // checkpoint plus the "ride.requested" announcement.
    async action(ctx) {
      await events.publish('ride.requested', {
        rideId: ctx.rideId, riderId: ctx.riderId, pickup: ctx.pickup, dropoff: ctx.dropoff, fare: ctx.fare,
      });
    },
    // Runs LAST when compensating, so by then the driver and payment are undone.
    async compensate(ctx, saga) {
      const reason = (saga.failure && saga.failure.reason) || 'CANCELLED';
      const cancelled = await rides.cancel(ctx.rideId, reason); // null if already terminal
      // Publish only if WE changed it, so a re-run does not notify twice.
      if (cancelled) {
        await events.publish('ride.cancelled', {
          rideId: ctx.rideId, riderId: ctx.riderId, driverId: ctx.driverId || null, reason,
        });
      }
    },
  };

  // ---- 2. reserveDriver ----------------------------------------------------
  const reserveDriver = {
    name: 'reserveDriver',
    async action(ctx, h) {
      ctx.triedDrivers = ctx.triedDrivers || [];
      ctx.assignAttempted = ctx.assignAttempted || [];
      ctx.offersMade = ctx.offersMade || 0;

      // Resuming after a crash.
      if (ctx.driverId) { // we got as far as assigning a driver
        const r = await rides.get(ctx.rideId);
        if (r && r.status === 'REQUESTED') await rides.transition(ctx.rideId, ['REQUESTED'], 'DRIVER_ASSIGNED', { driverId: ctx.driverId });
        return;
      }
      if (ctx.lockedDriverId) { // an offer was in flight; abandon it and free that driver
        await d.locks.release(ctx.lockedDriverId, ctx.rideId);
        await d.offers.clear(ctx.rideId, ctx.lockedDriverId);
        ctx.lockedDriverId = null;
        await h.persist();
      }

      while (ctx.offersMade < cfg.maxOfferAttempts) {
        h.ensureLease();
        if (await h.isCancelRequested()) throw new SagaError('CANCELLED_BY_RIDER', 'Rider cancelled');

        // Nearest first, skipping drivers already offered this ride.
        const candidates = await d.geo.findNearby(ctx.pickup, ctx.triedDrivers);
        if (!candidates.length) break;
        const cand = candidates[0];
        ctx.triedDrivers.push(cand.driverId);

        // Atomic reservation: if another ride holds this driver, move on to the
        // next candidate. This is what makes "two riders, one driver" safe.
        if (!(await d.locks.acquire(cand.driverId, ctx.rideId, cfg.offerTimeoutSec + 30))) {
          await h.persist();
          continue; // not counted as an offer: the driver was never contacted
        }
        ctx.lockedDriverId = cand.driverId;
        ctx.offersMade += 1;
        await h.persist(); // persisted BEFORE the slow wait, so a crash can still release it

        const answer = await d.offers.offerAndWait({
          rideId: ctx.rideId, driverId: cand.driverId,
          payload: { riderId: ctx.riderId, pickup: ctx.pickup, dropoff: ctx.dropoff, fare: ctx.fare, distanceKm: Number(cand.distanceKm.toFixed(2)) },
          isCancelRequested: h.isCancelRequested, ensureLease: h.ensureLease,
        });

        if (answer === 'ACCEPTED') {
          ctx.assignAttempted.push(cand.driverId);
          await h.persist(); // from here on, compensation must also call driver-service release
          // If driver-service is down this THROWS: the saga fails and compensates.
          const res = await d.driver.assign(cand.driverId, ctx.rideId);
          if (res.status === 'OK') {
            await d.locks.extend(cand.driverId, ctx.rideId, cfg.rideLockTtlSec);
            ctx.driverId = cand.driverId;
            ctx.lockedDriverId = null; // now tracked as the assigned driver
            await ensureStatus(ctx.rideId, 'REQUESTED', 'DRIVER_ASSIGNED', { driverId: cand.driverId });
            await events.publish('driver.assigned', { rideId: ctx.rideId, riderId: ctx.riderId, driverId: cand.driverId });
            return;
          }
          // BUSY / OFFLINE: the driver changed state between accept and assign.
        }

        // DECLINED, TIMEOUT or assign refused: free this driver, try the next one.
        await d.locks.release(cand.driverId, ctx.rideId);
        ctx.lockedDriverId = null;
        await h.persist();
      }
      throw new SagaError('NO_DRIVERS_AVAILABLE', 'No driver accepted the ride');
    },

    async compensate(ctx) {
      const ids = [...new Set([ctx.driverId, ctx.lockedDriverId].filter(Boolean))];
      for (const id of ids) {
        // Tell driver-service only if we ever asked it to assign this driver.
        // Release is a no-op there unless THIS ride holds the driver.
        if ((ctx.assignAttempted || []).includes(id)) await d.driver.release(id, ctx.rideId);
        await d.locks.release(id, ctx.rideId); // owner-checked delete
        await d.offers.clear(ctx.rideId, id);
      }
    },
  };

  // ---- 3. authorizePayment -------------------------------------------------
  const authorizePayment = {
    name: 'authorizePayment',
    async action(ctx) {
      let payment;
      try {
        payment = await d.payment.authorize({
          rideId: ctx.rideId, amount: ctx.fare, idempotencyKey: `ride:${ctx.rideId}:authorize`,
        });
      } catch (err) {
        // timeout, 5xx, or breaker open
        throw new SagaError('PAYMENT_UNAVAILABLE', err.message);
      }
      if (payment.status === 'DECLINED') throw new SagaError('PAYMENT_DECLINED', 'Payment was declined');
      if (payment.status !== 'AUTHORIZED') throw new SagaError(`PAYMENT_${payment.status}`, `Payment is ${payment.status}`);
      await ensureStatus(ctx.rideId, 'DRIVER_ASSIGNED', 'PAYMENT_AUTHORIZED');
    },
    // Void the authorization; if it was already captured, refund instead.
    async compensate(ctx) {
      const p = await d.payment.void(ctx.rideId);
      if (p.status === 'CAPTURED') await d.payment.refund(ctx.rideId);
    },
  };

  // ---- 4. confirmRide ------------------------------------------------------
  const confirmRide = {
    name: 'confirmRide',
    async action(ctx) {
      await ensureStatus(ctx.rideId, 'PAYMENT_AUTHORIZED', 'CONFIRMED');
      await events.publish('ride.confirmed', { rideId: ctx.rideId, riderId: ctx.riderId, driverId: ctx.driverId });
    },
    // Nothing external to undo: it only wrote a status and published an event.
    // Voiding payment, releasing the driver and cancelling the ride are done by the
    // compensations of steps 3, 2 and 1, which run right after this one.
    async compensate() {},
  };

  return [createRide, reserveDriver, authorizePayment, confirmRide];
};
