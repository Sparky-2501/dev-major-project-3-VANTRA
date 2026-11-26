const express = require('express');
const { body } = require('express-validator');
const requireDriver = require('./common/identity')('driver');
const internalAuth = require('./common/internalAuth');
const state = require('./driverState');
const keys = require('./common/keys');

module.exports = ({ redis, blacklist }) => {
  const auth = require('./controllers/auth.controller')(blacklist);
  const status = require('./controllers/status.controller')(redis);
  const router = express.Router();

  // ---- public (the gateway lets these through without a token) ----
  router.post('/drivers/register', internalAuth, [
    body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters'),
    body('fullname.lastname').optional().isLength({ min: 3 }),
    body('email').isEmail().withMessage('Invalid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('vehicle.color').isLength({ min: 3 }).withMessage('Vehicle color is required'),
    body('vehicle.plate').isLength({ min: 3 }).withMessage('Vehicle plate is required'),
    body('vehicle.capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
    body('vehicle.vehicleType').isIn(['car', 'auto', 'motorcycle']).withMessage('Invalid vehicle type'),
  ], auth.register);

  router.post('/drivers/login', internalAuth, [
    body('email').isEmail(),
    body('password').notEmpty(),
  ], auth.login);

  // ---- authenticated driver routes ----
  router.get('/drivers/profile', internalAuth, requireDriver, auth.profile);
  router.post('/drivers/logout', internalAuth, requireDriver, auth.logout);
  router.post('/drivers/status', internalAuth, requireDriver, status.setStatus);
  router.get('/drivers/status', internalAuth, requireDriver, status.getStatus);
  router.post('/drivers/location', internalAuth, requireDriver, status.updateLocation);

  // ---- internal: called by matching-service (never by clients) ----
  // Demo toggle: simulate this service being down for the saga demo.
  const outage = async (req, res, next) => {
    if (process.env.DEMO_MODE === 'true' && (await redis.get(keys.DEMO_DRIVER_OUTAGE)) === '1') {
      return res.status(503).json({ message: 'driver-service outage (demo toggle)' });
    }
    next();
  };

  router.post('/internal/drivers/:id/assign', internalAuth, outage, async (req, res, next) => {
    try {
      const result = await state.assign(redis, req.params.id, req.body.rideId);
      res.status(result === 'OK' ? 200 : 409).json({ status: result });
    } catch (err) { next(err); }
  });

  router.post('/internal/drivers/:id/release', internalAuth, outage, async (req, res, next) => {
    try {
      res.json({ status: await state.release(redis, req.params.id, req.body.rideId) });
    } catch (err) { next(err); }
  });

  // ---- demo toggles ----
  router.post('/internal/demo/outage', internalAuth, async (req, res, next) => {
    try {
      if (process.env.DEMO_MODE !== 'true') return res.status(404).json({ message: 'Not found' });
      const on = req.body.on === true;
      if (on) await redis.set(keys.DEMO_DRIVER_OUTAGE, '1'); else await redis.del(keys.DEMO_DRIVER_OUTAGE);
      res.json({ driverServiceOutage: on });
    } catch (err) { next(err); }
  });

  return router;
};
