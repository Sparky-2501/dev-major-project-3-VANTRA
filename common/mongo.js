const mongoose = require('mongoose');
const logger = require('./logger');

// Keep retrying: with docker-compose or Kubernetes the service can start a few
// seconds before Mongo accepts connections, and crashing in a loop is noisier
// than waiting.
module.exports.connectMongo = async () => {
  for (;;) {
    try {
      await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
      logger.info('mongo connected');
      return;
    } catch (err) {
      logger.warn('mongo not ready, retrying', { err: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
};

module.exports.mongoIsUp = () => mongoose.connection.readyState === 1;
