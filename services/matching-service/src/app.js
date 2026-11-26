const express = require('express');
const { contextMiddleware } = require('./common/context');
const healthRouter = require('./common/health');
const { mongoIsUp } = require('./common/mongo');
const { breakerStates } = require('./common/breaker');

module.exports = ({ redis, booking, offers }) => {
  const app = express();
  app.use(contextMiddleware);
  app.use(express.json());
  app.use(healthRouter({
    service: 'matching-service',
    checks: { mongo: mongoIsUp, redis: async () => (await redis.ping()) === 'PONG' },
    getBreakers: breakerStates, // CLOSED / OPEN / HALF_OPEN per downstream
  }));
  app.use(require('./routes')({ booking, offers, redis }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  return app;
};
