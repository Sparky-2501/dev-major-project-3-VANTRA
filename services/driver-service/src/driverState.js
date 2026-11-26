const keys = require('./common/keys');

// Live driver state in Redis. Every multi-step change is a Lua script, because
// Redis runs a script atomically. Without that, a location ping arriving between
// "assign driver" and "remove from GEO set" could put a busy driver back in the
// available set, and two riders could end up with the same driver.

const HEARTBEAT_TTL_SEC = Number(process.env.HEARTBEAT_TTL_SEC || 30);

// KEYS: state, geo, heartbeat   ARGV: driverId, heartbeatTtl
const GO_ONLINE = `
redis.call('HSET', KEYS[1], 'online', '1')
redis.call('SET', KEYS[3], '1', 'EX', ARGV[2])
local lng = redis.call('HGET', KEYS[1], 'lng')
local lat = redis.call('HGET', KEYS[1], 'lat')
local ride = redis.call('HGET', KEYS[1], 'rideId')
if lng and lat and not ride then
  redis.call('GEOADD', KEYS[2], lng, lat, ARGV[1])
  return 1
end
return 0`;

// Cannot go offline mid-ride: the rider is waiting for this driver.
const GO_OFFLINE = `
if redis.call('HGET', KEYS[1], 'rideId') then return 'ON_RIDE' end
redis.call('HSET', KEYS[1], 'online', '0')
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[3])
return 'OK'`;

// ARGV: lng, lat, driverId, heartbeatTtl.  Always remember the position and
// refresh the heartbeat; only put the driver in the AVAILABLE set if online and free.
const UPDATE_LOCATION = `
redis.call('HSET', KEYS[1], 'lng', ARGV[1], 'lat', ARGV[2])
redis.call('SET', KEYS[3], '1', 'EX', ARGV[4])
local online = redis.call('HGET', KEYS[1], 'online')
local ride = redis.call('HGET', KEYS[1], 'rideId')
if online == '1' and not ride then
  redis.call('GEOADD', KEYS[2], ARGV[1], ARGV[2], ARGV[3])
  return 1
end
return 0`;

// ARGV: driverId, rideId. Idempotent for the same ride; refuses a different ride.
const ASSIGN = `
local online = redis.call('HGET', KEYS[1], 'online')
if online ~= '1' then return 'OFFLINE' end
local cur = redis.call('HGET', KEYS[1], 'rideId')
if cur and cur ~= ARGV[2] then return 'BUSY' end
redis.call('HSET', KEYS[1], 'rideId', ARGV[2])
redis.call('ZREM', KEYS[2], ARGV[1])
return 'OK'`;

// ARGV: driverId, rideId, heartbeatTtl. Only the ride that holds the driver may
// release; a stale compensation for an old ride must not free a driver that is
// already on a new ride. Re-adds to the GEO set only if still online and not stale.
const RELEASE = `
local cur = redis.call('HGET', KEYS[1], 'rideId')
if cur and cur ~= ARGV[2] then return 'NOT_HOLDER' end
redis.call('HDEL', KEYS[1], 'rideId')
local online = redis.call('HGET', KEYS[1], 'online')
local lng = redis.call('HGET', KEYS[1], 'lng')
local lat = redis.call('HGET', KEYS[1], 'lat')
if online == '1' and lng and lat and redis.call('EXISTS', KEYS[3]) == 1 then
  redis.call('GEOADD', KEYS[2], lng, lat, ARGV[1])
end
return 'OK'`;

const run = (redis, script, id, ...args) =>
  redis.eval(script, 3, keys.driverState(id), keys.GEO_AVAILABLE, keys.driverHeartbeat(id), ...args);

module.exports = {
  HEARTBEAT_TTL_SEC,
  goOnline: (redis, id) => run(redis, GO_ONLINE, id, id, HEARTBEAT_TTL_SEC),
  goOffline: (redis, id) => run(redis, GO_OFFLINE, id, id),
  updateLocation: (redis, id, lng, lat) => run(redis, UPDATE_LOCATION, id, lng, lat, id, HEARTBEAT_TTL_SEC),
  assign: (redis, id, rideId) => run(redis, ASSIGN, id, id, rideId),
  release: (redis, id, rideId) => run(redis, RELEASE, id, id, rideId, HEARTBEAT_TTL_SEC),

  async getState(redis, id) {
    const s = await redis.hgetall(keys.driverState(id));
    return {
      online: s.online === '1',
      location: s.lng ? { lng: Number(s.lng), lat: Number(s.lat) } : null,
      rideId: s.rideId || null,
      inAvailableSet: (await redis.zscore(keys.GEO_AVAILABLE, id)) !== null,
      heartbeatAlive: (await redis.exists(keys.driverHeartbeat(id))) === 1,
    };
  },

  // A GEO set is a sorted set, so members cannot have their own TTL. Instead each
  // driver has a heartbeat key with a TTL, and this sweep removes members whose
  // heartbeat expired (app killed, phone out of coverage). Several replicas may
  // sweep at once; ZREM of an already-removed member is harmless.
  async sweepStale(redis) {
    const members = await redis.zrange(keys.GEO_AVAILABLE, 0, -1);
    if (!members.length) return 0;
    const pipe = redis.pipeline();
    members.forEach((id) => pipe.exists(keys.driverHeartbeat(id)));
    const res = await pipe.exec();
    const stale = members.filter((id, i) => res[i][1] === 0);
    if (stale.length) await redis.zrem(keys.GEO_AVAILABLE, ...stale);
    return stale.length;
  },
};
