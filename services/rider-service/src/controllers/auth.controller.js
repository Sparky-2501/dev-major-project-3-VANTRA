const { validationResult } = require('express-validator');
const Rider = require('../models/rider.model');
const logger = require('../common/logger');

module.exports = (blacklist) => ({
  async register(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { fullname, email, password } = req.body;
      if (await Rider.findOne({ email })) {
        return res.status(400).json({ message: 'Rider already exists' });
      }
      const rider = await Rider.create({
        fullname,
        email,
        password: await Rider.hashPassword(password),
      });
      logger.info('rider registered', { riderId: String(rider._id) });
      res.status(201).json({ token: rider.generateAuthToken(), rider });
    } catch (err) { next(err); }
  },

  async login(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;
      const rider = await Rider.findOne({ email }).select('+password');
      // Same answer for unknown email and wrong password: do not reveal which exist.
      if (!rider || !(await rider.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      const token = rider.generateAuthToken();
      res.cookie('token', token, { httpOnly: true });
      res.status(200).json({ token, rider });
    } catch (err) { next(err); }
  },

  async profile(req, res, next) {
    try {
      const rider = await Rider.findById(req.userId);
      if (!rider) return res.status(404).json({ message: 'Rider not found' });
      res.json({ rider });
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
