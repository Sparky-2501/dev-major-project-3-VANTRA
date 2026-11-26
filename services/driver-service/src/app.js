const express = require('express');
const cookieParser = require('cookie-parser');
const { contextMiddleware } = require('./common/context');
const healthRouter = require('./common/health');
const { mongoIsUp } = require('./common/mongo');

module.exports = ({ redis, blacklist }) => {
  const app = express();
  app.use(contextMiddleware);
  app.use(express.json());
  app.use(cookieParser());
  app.use(healthRouter({
    service: 'driver-service',
    checks: { mongo: mongoIsUp, redis: async () => (await redis.ping()) === 'PONG' },
  }));
  app.use(require('./routes')({ redis, blacklist }));
  // JSON errors, never an HTML stack trace.
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  return app;
};
