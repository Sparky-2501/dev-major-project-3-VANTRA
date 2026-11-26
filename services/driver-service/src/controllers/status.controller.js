const state = require('../driverState');
const logger = require('../common/logger');

module.exports = (redis) => ({
  // POST /drivers/status  { "online": true|false }
  async setStatus(req, res, next) {
    try {
      const online = req.body.online;
      if (typeof online !== 'boolean') {
        return res.status(400).json({ message: '"online" must be true or false' });
      }
      if (online) {
        await state.goOnline(redis, req.userId);
      } else if ((await state.goOffline(redis, req.userId)) === 'ON_RIDE') {
        return res.status(409).json({ message: 'Finish or cancel the current ride before going offline' });
      }
      logger.info('driver status', { driverId: req.userId, online });
      res.json(await state.getState(redis, req.userId));
    } catch (err) { next(err); }
  },

  // POST /drivers/location  { "lng": 73.85, "lat": 18.52 }   (lng FIRST, like GeoJSON)
  async updateLocation(req, res, next) {
    try {
      const lng = Number(req.body.lng);
      const lat = Number(req.body.lat);
      // Redis GEOADD rejects latitudes beyond +-85.05 and errors in a confusing way.
      if (!Number.isFinite(lng) || !Number.isFinite(lat) ||
          lng < -180 || lng > 180 || lat < -85 || lat > 85) {
        return res.status(400).json({ message: 'lng must be in [-180,180] and lat in [-85,85]' });
      }
      const added = await state.updateLocation(redis, req.userId, lng, lat);
      res.json({ ok: true, availableForMatching: added === 1 });
    } catch (err) { next(err); }
  },

  async getStatus(req, res, next) {
    try { res.json(await state.getState(redis, req.userId)); } catch (err) { next(err); }
  },
});
