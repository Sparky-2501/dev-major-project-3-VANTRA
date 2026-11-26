// GENERATED from /common/events.js by scripts/sync-common.js. Do not edit here.
const keys = require('./keys');
const logger = require('./logger');
const { getContext } = require('./context');
const { currentTraceparent } = require('./spans');

// Domain events go on a Redis STREAM, not Pub/Sub:
//  - Pub/Sub is fire-and-forget: a subscriber that is down misses the message.
//  - A Stream keeps entries, so notification-service can crash, restart and still
//    read what it missed, and consumer groups let several replicas share the work.

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('event publish timeout')), ms))]);

// Publishing NEVER throws and never waits long: a notification problem must not
// break or slow a ride booking. The cost is that an event can be lost if Redis is
// down at that exact moment; that is acceptable for notifications, and the ride
// state itself is in Mongo, not in the events.
async function publishEvent(redis, type, data) {
  try {
    const payload = JSON.stringify({
      type,
      data,
      // Lets the consumer continue the same Jaeger trace after the async hop.
      traceparent: currentTraceparent(),
      correlationId: getContext().correlationId,
      ts: Date.now(),
    });
    await withTimeout(
      redis.xadd(keys.EVENTS_STREAM, 'MAXLEN', '~', 10000, '*', 'type', type, 'payload', payload),
      500
    );
    return true;
  } catch (err) {
    logger.warn('event publish failed', { type, err: err.message });
    return false;
  }
}

module.exports = { publishEvent };
