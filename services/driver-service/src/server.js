require('./common/tracing'); // first, so http/express/mongodb/ioredis get instrumented
const { requireEnv } = require('./common/env');
requireEnv('MONGO_URL', 'REDIS_URL', 'JWT_SECRET', 'INTERNAL_API_KEY');

const logger = require('./common/logger');
const { createRedis } = require('./common/redis');
const { connectMongo } = require('./common/mongo');
const state = require('./driverState');

const redis = createRedis();
const blacklist = require('./common/blacklist')(redis);
const app = require('./app')({ redis, blacklist });

const port = process.env.PORT || 3002;
connectMongo().then(() => {
  app.listen(port, () => logger.info(`driver-service listening on ${port}`));
});

// Drop drivers who stopped sending location pings.
setInterval(() => {
  state.sweepStale(redis)
    .then((n) => n && logger.info('removed stale drivers from GEO set', { count: n }))
    .catch((err) => logger.warn('stale sweep failed', { err: err.message }));
}, 10000);
