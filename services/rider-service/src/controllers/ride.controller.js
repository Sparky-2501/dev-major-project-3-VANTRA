const { validationResult } = require('express-validator');
const matching = require('../matchingClient');
const logger = require('../common/logger');

// 503 + Retry-After is the honest answer when the booking path is down; the rider
// can safely retry with the SAME Idempotency-Key.
const unavailable = (res, err) => {
  logger.warn('matching unavailable', { err: err.message, code: err.code });
  res.set('Retry-After', '10');
  return res.status(503).json({
    message: 'Booking is temporarily unavailable. Retry with the same Idempotency-Key.',
    reason: err.code || 'MATCHING_UNAVAILABLE',
  });
};

module.exports = {
  // POST /rides   headers: Idempotency-Key   body: { pickup:{lng,lat}, dropoff:{lng,lat} }
  async requestRide(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { pickup, dropoff } = req.body;
      const out = await matching.createRide({
        riderId: req.userId,
        pickup: { lng: Number(pickup.lng), lat: Number(pickup.lat) },
        dropoff: { lng: Number(dropoff.lng), lat: Number(dropoff.lat) },
        idempotencyKey: req.header('idempotency-key'),
      }).catch((err) => (err.code === 'DEPENDENCY_UNAVAILABLE' || err.status >= 500 ? { failed: err } : Promise.reject(err)));
      if (out.failed) return unavailable(res, out.failed);
      res.status(out.status).json(out.data);
    } catch (err) { next(err); }
  },

  // GET /rides  (ride history)
  async listRides(req, res, next) {
    try {
      const out = await matching.listRides(req.userId);
      res.status(out.status).json(out.data);
    } catch (err) { next(err); }
  },

  // GET /rides/:id  (ride + saga progress, so you can watch a compensation happen)
  async getRide(req, res, next) {
    try {
      const out = await matching.getRide(req.params.id).catch((err) =>
        (err.code === 'DEPENDENCY_UNAVAILABLE' || err.status >= 500 ? { failed: err } : Promise.reject(err)));
      if (out.failed) return unavailable(res, out.failed);
      // Ownership is checked here: a rider must not read someone else's ride.
      if (out.status !== 200 || String(out.data.ride.riderId) !== req.userId) {
        return res.status(404).json({ message: 'Ride not found' });
      }
      res.json(out.data);
    } catch (err) { next(err); }
  },

  async cancelRide(req, res, next) {
    try {
      const out = await matching.cancelRide(req.params.id, req.userId).catch((err) =>
        (err.code === 'DEPENDENCY_UNAVAILABLE' || err.status >= 500 ? { failed: err } : Promise.reject(err)));
      if (out.failed) return unavailable(res, out.failed);
      res.status(out.status).json(out.data);
    } catch (err) { next(err); }
  },
};
