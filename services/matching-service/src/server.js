require('./common/tracing'); // first, so http/express/mongodb/ioredis get instrumented
const { requireEnv } = require('./common/env');
requireEnv('MONGO_URL', 'REDIS_URL', 'INTERNAL_API_KEY');

const logger = require('./common/logger');
const cfg = require('./config');
const { createRedis } = require('./common/redis');
const { connectMongo } = require('./common/mongo');

const redis = createRedis();
const { booking, offers, recovery } = require('./container')({ redis });
const app = require('./app')({ redis, booking, offers });

connectMongo().then(() => {
  app.listen(cfg.port, () => logger.info(`matching-service listening on ${cfg.port}`));
  recovery.start(); // resume sagas whose orchestrator crashed
});
