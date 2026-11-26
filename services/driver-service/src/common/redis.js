// GENERATED from /common/redis.js by scripts/sync-common.js. Do not edit here.
const Redis = require('ioredis');
const logger = require('./logger');

// `blocking: true` is for a connection that sits in XREADGROUP BLOCK. It must not
// share a connection with normal commands, because a blocked connection cannot
// serve anything else.
module.exports.createRedis = ({ blocking = false } = {}) => {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    // Normal commands fail fast while Redis is down instead of queueing forever,
    // so an outage surfaces as quick errors that breakers/fallbacks can handle.
    maxRetriesPerRequest: blocking ? null : 2,
  });
  redis.on('error', (err) => logger.error('redis error', { err: err.message }));
  return redis;
};
