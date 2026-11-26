const keys = require('./common/keys');

// One driver can be reserved by ONE ride at a time. The lock is a Redis key:
//   SET driver:lock:<driverId> <rideId> NX EX <ttl>
// NX = "only if it does not exist" and Redis executes it atomically, so when two
// rides race for the same driver exactly one SET succeeds. EX makes the lock
// expire by itself if the orchestrator dies, so a crash can never keep a driver
// locked forever.

// Only the owner may release/extend: compare the stored rideId first. Done in Lua
// because GET-then-DEL in the app would let a lock that expired and was taken by
// another ride be deleted by the old owner.
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
const EXTEND = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end`;

module.exports = (redis) => ({
  async acquire(driverId, rideId, ttlSec) {
    const key = keys.driverLock(driverId);
    if ((await redis.set(key, rideId, 'EX', ttlSec, 'NX')) === 'OK') return true;
    // Already ours (this saga is resuming after a crash)? Treat as acquired.
    if ((await redis.get(key)) === rideId) {
      await redis.expire(key, ttlSec);
      return true;
    }
    return false;
  },
  async extend(driverId, rideId, ttlSec) {
    return (await redis.eval(EXTEND, 1, keys.driverLock(driverId), rideId, ttlSec)) === 1;
  },
  // Idempotent: releasing a lock we do not hold is a no-op returning false.
  async release(driverId, rideId) {
    return (await redis.eval(RELEASE, 1, keys.driverLock(driverId), rideId)) === 1;
  },
});
