const express = require('express');
const { contextMiddleware } = require('./common/context');
const healthRouter = require('./common/health');
const internalAuth = require('./common/internalAuth');
const keys = require('./common/keys');

module.exports = ({ redis }) => {
  const app = express();
  app.use(contextMiddleware);
  app.use(express.json());
  app.use(healthRouter({
    service: 'notification-service',
    checks: { redis: async () => (await redis.ping()) === 'PONG' },
  }));

  // The "log sink": last 200 notifications pushed. Mainly so scripts and tests can
  // check what was sent without opening a socket.   GET /internal/notifications?to=rider:<id>
  app.get('/internal/notifications', internalAuth, async (req, res, next) => {
    try {
      const rows = (await redis.lrange(keys.NOTIFY_RECENT, 0, 199)).map((r) => JSON.parse(r));
      res.json({ notifications: req.query.to ? rows.filter((r) => r.to === req.query.to) : rows });
    } catch (err) { next(err); }
  });

  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  return app;
};
