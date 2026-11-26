const Redis = require('ioredis');

// One shared connection per process. ioredis reconnects on its own, so a Redis
// restart does not require restarting the API.
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    // Fail a command quickly instead of queueing it forever while Redis is down.
    // Without this, a Redis outage would make every login hang rather than error.
    maxRetriesPerRequest: 2,
});

redis.on('error', (err) => console.error('Redis error:', err.message));

module.exports = redis;
