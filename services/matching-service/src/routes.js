const express = require('express');
const internalAuth = require('./common/internalAuth');
const requireDriver = require('./common/identity')('driver');
const keys = require('./common/keys');
const { HttpError } = require('./httpError');

module.exports = ({ booking, offers, redis }) => {
  const router = express.Router();
  const isCoord = (p) => p && Number.isFinite(Number(p.lng)) && Number.isFinite(Number(p.lat)) &&
    Math.abs(p.lng) <= 180 && Math.abs(p.lat) <= 85;

  // ====== internal: called by rider-service ======
  router.post('/internal/rides', internalAuth, async (req, res, next) => {
    try {
      const { riderId, pickup, dropoff } = req.body;
      const key = req.header('idempotency-key');
      if (!riderId || !key || !isCoord(pickup) || !isCoord(dropoff)) {
        return res.status(400).json({ message: 'riderId, Idempotency-Key, pickup and dropoff are required' });
      }
      const out = await booking.requestRide({
        riderId, idempotencyKey: key,
        pickup: { lng: Number(pickup.lng), lat: Number(pickup.lat) },
        dropoff: { lng: Number(dropoff.lng), lat: Number(dropoff.lat) },
      });
      // 202 = accepted, the saga continues in the background. 200 = duplicate key.
      res.status(out.duplicate ? 200 : 202).json({ duplicate: out.duplicate, ride: out.ride });
    } catch (err) { next(err); }
  });

  router.get('/internal/rides', internalAuth, async (req, res, next) => {
    try {
      if (!req.query.riderId) return res.status(400).json({ message: 'riderId is required' });
      res.json({ rides: await booking.listRides(String(req.query.riderId)) });
    } catch (err) { next(err); }
  });

  router.get('/internal/rides/:id', internalAuth, async (req, res, next) => {
    try { res.json(await booking.getRide(req.params.id)); } catch (err) { next(err); }
  });

  router.post('/internal/rides/:id/cancel', internalAuth, async (req, res, next) => {
    try {
      const out = await booking.cancelRide(req.params.id, String(req.body.riderId));
      res.status(out.status).json({ ride: out.ride, message: out.message });
    } catch (err) { next(err); }
  });

  // ====== driver-facing (the gateway has verified a DRIVER token) ======
  // Silenced drivers simulate an app that never answers (demo only).
  const silenced = async (driverId) =>
    process.env.DEMO_MODE === 'true' && (await redis.sismember(keys.DEMO_SILENT_DRIVERS, driverId)) === 1;

  router.get('/matching/offers/pending', internalAuth, requireDriver, async (req, res, next) => {
    try { res.json({ rideId: await offers.pendingFor(req.userId) }); } catch (err) { next(err); }
  });

  for (const [path, answer] of [['accept', 'accepted'], ['decline', 'declined']]) {
    router.post(`/matching/offers/:rideId/${path}`, internalAuth, requireDriver, async (req, res, next) => {
      try {
        if (await silenced(req.userId)) {
          return res.status(202).json({ ignored: true, note: 'demo: this driver is silenced' });
        }
        const ok = await offers.respond({ driverId: req.userId, rideId: req.params.rideId, answer });
        if (!ok) return res.status(409).json({ message: 'No active offer for you on this ride (expired or offered to someone else)' });
        res.json({ message: `Offer ${answer}` });
      } catch (err) { next(err); }
    });
  }

  router.post('/matching/rides/:rideId/start', internalAuth, requireDriver, async (req, res, next) => {
    try { res.json({ ride: await booking.startRide(req.params.rideId, req.userId) }); } catch (err) { next(err); }
  });
  router.post('/matching/rides/:rideId/complete', internalAuth, requireDriver, async (req, res, next) => {
    try { res.json({ ride: await booking.completeRide(req.params.rideId, req.userId) }); } catch (err) { next(err); }
  });

  // ====== demo toggle: a driver who never responds ======
  router.post('/internal/demo/silent-driver', internalAuth, async (req, res, next) => {
    try {
      if (process.env.DEMO_MODE !== 'true') return res.status(404).json({ message: 'Not found' });
      const { driverId, silent } = req.body;
      if (!driverId) return res.status(400).json({ message: 'driverId required' });
      if (silent === false) await redis.srem(keys.DEMO_SILENT_DRIVERS, driverId);
      else await redis.sadd(keys.DEMO_SILENT_DRIVERS, driverId);
      res.json({ silentDrivers: await redis.smembers(keys.DEMO_SILENT_DRIVERS) });
    } catch (err) { next(err); }
  });

  return router;
};
module.exports.HttpError = HttpError;
