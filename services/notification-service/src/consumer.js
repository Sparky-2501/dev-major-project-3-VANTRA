const keys = require('./common/keys');
const logger = require('./common/logger');
const { runInTraceparent, withSpan } = require('./common/spans');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [k1, v1, k2, v2] -> { k1: v1, k2: v2 }
const toObject = (arr) => {
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};

// Reads the stream through a CONSUMER GROUP:
//  - each event goes to ONE replica of notification-service (they share the work),
//  - an event stays "pending" until XACK, so a crash mid-handling does not lose it:
//    after minIdle another replica claims it with XAUTOCLAIM.
module.exports.startConsumer = async ({ redis, blockingRedis, consumerName, handle }) => {
  try {
    // '0' = also deliver events written before this group existed.
    await redis.xgroup('CREATE', keys.EVENTS_STREAM, keys.NOTIFY_GROUP, '0', 'MKSTREAM');
  } catch (err) {
    if (!String(err.message).includes('BUSYGROUP')) throw err; // group already exists: fine
  }

  async function processEntries(entries) {
    for (const [id, fields] of entries) {
      const f = toObject(fields);
      try {
        const evt = JSON.parse(f.payload);
        // Continue the producer's trace so the async hop appears in the same Jaeger trace.
        await runInTraceparent(evt.traceparent, () =>
          withSpan(`consume ${evt.type}`, { 'messaging.system': 'redis-streams', 'event.type': evt.type }, () => handle(evt)));
      } catch (err) {
        // Notifications are best-effort: log and move on rather than retrying a
        // poison message forever.
        logger.error('failed to handle event', { id, err: err.message });
      }
      await redis.xack(keys.EVENTS_STREAM, keys.NOTIFY_GROUP, id);
    }
  }

  let running = true;
  (async () => {
    while (running) {
      try {
        // 1) take over events another replica started and never acknowledged
        const claimed = await redis.xautoclaim(
          keys.EVENTS_STREAM, keys.NOTIFY_GROUP, consumerName, 30000, '0-0', 'COUNT', 20);
        if (claimed && claimed[1] && claimed[1].length) await processEntries(claimed[1]);

        // 2) wait up to 5s for new events
        const res = await blockingRedis.xreadgroup(
          'GROUP', keys.NOTIFY_GROUP, consumerName, 'COUNT', 20, 'BLOCK', 5000,
          'STREAMS', keys.EVENTS_STREAM, '>');
        if (res) await processEntries(res[0][1]);
      } catch (err) {
        logger.error('consumer loop error, retrying', { err: err.message });
        await sleep(1000);
      }
    }
  })();

  return { stop: () => { running = false; } };
};
