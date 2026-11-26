const express = require('express');
const cookieParser = require('cookie-parser');
const { body, header } = require('express-validator');
const { contextMiddleware } = require('./common/context');
const healthRouter = require('./common/health');
const { mongoIsUp } = require('./common/mongo');
const { breakerStates } = require('./common/breaker');
const internalAuth = require('./common/internalAuth');
const requireRider = require('./common/identity')('rider');

module.exports = ({ redis, blacklist }) => {
  const auth = require('./controllers/auth.controller')(blacklist);
  const rides = require('./controllers/ride.controller');

  const app = express();
  app.use(contextMiddleware);
  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter({
    service: 'rider-service',
    checks: { mongo: mongoIsUp, redis: async () => (await redis.ping()) === 'PONG' },
    getBreakers: breakerStates,
  }));

  // ---- public ----
  app.post('/riders/register', internalAuth, [
    body('fullname.firstname').isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),
    body('email').isEmail().withMessage('Invalid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ], auth.register);
  app.post('/riders/login', internalAuth, [
    body('email').isEmail(),
    body('password').notEmpty(),
  ], auth.login);

  // ---- authenticated rider ----
  app.get('/riders/profile', internalAuth, requireRider, auth.profile);
  app.post('/riders/logout', internalAuth, requireRider, auth.logout);

  const coord = (prefix) => [
    body(`${prefix}.lng`).isFloat({ min: -180, max: 180 }).withMessage(`${prefix}.lng must be -180..180`),
    body(`${prefix}.lat`).isFloat({ min: -85, max: 85 }).withMessage(`${prefix}.lat must be -85..85`),
  ];
  app.post('/rides', internalAuth, requireRider, [
    header('idempotency-key').notEmpty().withMessage('Idempotency-Key header is required'),
    ...coord('pickup'),
    ...coord('dropoff'),
  ], rides.requestRide);
  app.get('/rides', internalAuth, requireRider, rides.listRides);
  app.get('/rides/:id', internalAuth, requireRider, rides.getRide);
  app.post('/rides/:id/cancel', internalAuth, requireRider, rides.cancelRide);

  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  return app;
};
