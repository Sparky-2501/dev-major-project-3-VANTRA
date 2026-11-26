const keys = require('./common/keys');

// Finds available drivers near a point with Redis GEOSEARCH:
//   GEOSEARCH drivers:available FROMLONLAT <lng> <lat> BYRADIUS <r> km ASC COUNT <n> WITHDIST
// ASC = nearest first. The radius EXPANDS (3 -> 5 -> 10 km) only if the smaller
// circle had nobody, so a busy city is answered from the cheap small search.
module.exports = ({ redis, cfg }) => ({
  async findNearby(point, excludeIds = []) {
    for (const radiusKm of cfg.searchRadiiKm) {
      // Ask for extra results to cover the drivers we will filter out below
      // (already offered this ride), otherwise a nearer-but-tried driver could
      // hide a farther untried one behind COUNT.
      const raw = await redis.call(
        'GEOSEARCH', keys.GEO_AVAILABLE,
        'FROMLONLAT', point.lng, point.lat,
        'BYRADIUS', radiusKm, 'km',
        'ASC', 'COUNT', cfg.searchCount + excludeIds.length, 'WITHDIST'
      );
      let found = raw
        .map(([driverId, dist]) => ({ driverId, distanceKm: Number(dist), radiusKm }))
        .filter((c) => !excludeIds.includes(c.driverId));
      if (!found.length) continue;

      // Second line of defence against stale drivers: the periodic sweep in
      // driver-service removes them, but between sweeps we also skip anyone whose
      // heartbeat key has already expired.
      const pipe = redis.pipeline();
      found.forEach((c) => pipe.exists(keys.driverHeartbeat(c.driverId)));
      const alive = await pipe.exec();
      found = found.filter((c, i) => alive[i][1] === 1);
      if (found.length) return found.slice(0, cfg.searchCount);
    }
    return [];
  },
});
