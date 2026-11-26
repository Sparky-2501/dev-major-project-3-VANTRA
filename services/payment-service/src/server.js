require('./common/tracing'); // first, so http/express/mongodb/ioredis get instrumented
const { requireEnv } = require('./common/env');
requireEnv('MONGO_URL', 'REDIS_URL', 'INTERNAL_API_KEY');

const logger = require('./common/logger');
const { createRedis } = require('./common/redis');
const { connectMongo } = require('./common/mongo');

const redis = createRedis();
const app = require('./app')({ redis });
const port = process.env.PORT || 3004;
connectMongo().then(() => app.listen(port, () => logger.info(`payment-service listening on ${port}`)));
