const keys = require('./common/keys');
const { SagaError } = require('./saga/errors');

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The driver's answer is written with ONE Lua script that first checks the offer
// is still live. So "accept" and "offer expired" cannot both win: if the offer key
// is gone the accept is refused, and the driver is told so instead of being
// silently ignored.
//   KEYS[1] = driver:offer:<driverId>   KEYS[2] = offer:resp:<rideId>:<driverId>
//   ARGV[1] = rideId                    ARGV[2] = 'accepted' | 'declined'
const RESPOND = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[2], ARGV[2], 'EX', 60)
  return 1
end
return 0`;

// Offer state lives in Redis, not in memory. That is what lets the driver's accept
// request land on a DIFFERENT matching-service replica than the one running the
// saga: they communicate through Redis keys.
module.exports = ({ redis, cfg, events, sleep = realSleep, now = Date.now }) => ({
  async offerAndWait({ rideId, driverId, payload, isCancelRequested, ensureLease }) {
    const offerKey = keys.driverOffer(driverId);
    const respKey = keys.offerResponse(rideId, driverId);

    await redis.del(respKey);
    await redis.set(offerKey, rideId, 'EX', cfg.offerTimeoutSec);
    await events.publish('ride.offered', { ...payload, rideId, driverId, expiresInSec: cfg.offerTimeoutSec });

    let answer = null;
    try {
      const deadline = now() + cfg.offerTimeoutSec * 1000;
      while (now() < deadline) {
        ensureLease();
        if (await isCancelRequested()) throw new SagaError('CANCELLED_BY_RIDER', 'Rider cancelled while waiting for a driver');
        answer = await redis.get(respKey);
        if (answer) break;
        await sleep(cfg.pollMs);
      }
    } finally {
      // Revoke the offer FIRST, then read once more. A driver who accepted in the
      // last instant wrote the response before this DEL (the Lua check passed), so
      // the read below sees it. One who tries after the DEL is refused by the Lua
      // script. No accept can fall into the gap.
      await redis.del(offerKey);
    }
    if (!answer) answer = await redis.get(respKey);
    await redis.del(respKey);

    if (answer === 'accepted') return 'ACCEPTED';
    if (answer === 'declined') return 'DECLINED';
    return 'TIMEOUT';
  },

  // Called from the driver-facing endpoints. true = recorded, false = no live offer.
  async respond({ driverId, rideId, answer }) {
    const ok = await redis.eval(RESPOND, 2, keys.driverOffer(driverId), keys.offerResponse(rideId, driverId), rideId, answer);
    return ok === 1;
  },

  // Which ride is currently offered to this driver (lets a driver app or a test poll).
  pendingFor: (driverId) => redis.get(keys.driverOffer(driverId)),

  async clear(rideId, driverId) {
    await redis.del(keys.driverOffer(driverId), keys.offerResponse(rideId, driverId));
  },
});
