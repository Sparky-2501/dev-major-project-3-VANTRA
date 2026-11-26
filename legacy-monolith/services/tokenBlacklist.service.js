const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const redis = require('../db/redis');

// Why Redis instead of the old Mongo TTL collection:
//  - A blacklist is read on EVERY authenticated request, so it should be a
//    sub-millisecond key lookup, not a Mongo query.
//  - Mongo's TTL was a fixed 24h for every token. Here each key lives exactly as
//    long as the token itself would still be valid, so the list never holds a
//    token that has already expired on its own.

// We store a SHA-256 of the token, not the token. Keys stay short and a Redis
// dump does not contain usable JWTs.
const keyFor = (token) =>
    'bl:' + crypto.createHash('sha256').update(token).digest('hex');

// Seconds until the token expires by itself. Uses decode (not verify) because the
// caller has already verified the signature.
function remainingLifetimeSeconds(token) {
    const payload = jwt.decode(token);
    if (!payload || !payload.exp) return 0;
    return payload.exp - Math.floor(Date.now() / 1000);
}

module.exports.remainingLifetimeSeconds = remainingLifetimeSeconds;

module.exports.blacklistToken = async (token) => {
    const ttl = remainingLifetimeSeconds(token);
    // Already expired: nothing to revoke, and EX 0 is an error in Redis.
    if (ttl <= 0) return;
    await redis.set(keyFor(token), '1', 'EX', ttl);
};

module.exports.isBlacklisted = async (token) => {
    return (await redis.exists(keyFor(token))) === 1;
};
