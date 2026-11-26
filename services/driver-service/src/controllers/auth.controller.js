const { validationResult } = require('express-validator');
const Driver = require('../models/driver.model');
const logger = require('../common/logger');

module.exports = (blacklist) => ({
  async register(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { fullname, email, password, vehicle } = req.body;
      if (await Driver.findOne({ email })) {
        return res.status(400).json({ message: 'Driver already exists' });
      }
      const driver = await Driver.create({
        fullname,
        email,
        password: await Driver.hashPassword(password),
        vehicle,
      });
      logger.info('driver registered', { driverId: String(driver._id) });
      res.status(201).json({ token: driver.generateAuthToken(), driver });
    } catch (err) { next(err); }
  },

  async login(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;
      const driver = await Driver.findOne({ email }).select('+password');
      // Same answer for unknown email and wrong password: do not reveal which exist.
      if (!driver || !(await driver.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      const token = driver.generateAuthToken();
      res.cookie('token', token, { httpOnly: true });
      res.status(200).json({ token, driver });
    } catch (err) { next(err); }
  },

  async profile(req, res, next) {
    try {
      const driver = await Driver.findById(req.userId);
      if (!driver) return res.status(404).json({ message: 'Driver not found' });
      res.json({ driver });
    } catch (err) { next(err); }
  },

  async logout(req, res, next) {
    try {
      // x-auth-token was set by the gateway after it verified the token.
      await blacklist.blacklistToken(req.headers['x-auth-token']);
      res.clearCookie('token');
      res.json({ message: 'Logged out successfully' });
    } catch (err) { next(err); }
  },
});
