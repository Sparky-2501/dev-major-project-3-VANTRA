const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Redis key with a TTL equal to the token's remaining life (same design as the
// Step 0 monolith). The rider/driver services WRITE it on logout; the gateway READS
// it on every request.
const keyFor = (token) => 'bl:' + crypto.createHash('sha256').update(token).digest('hex');

module.exports = (redis) => ({
  async blacklistToken(token) {
    const payload = jwt.decode(token);
    const ttl = payload && payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0;
    if (ttl <= 0) return; // already expired; EX 0 is a Redis error anyway
    await redis.set(keyFor(token), '1', 'EX', ttl);
  },
  async isBlacklisted(token) {
    return (await redis.exists(keyFor(token))) === 1;
  },
});
