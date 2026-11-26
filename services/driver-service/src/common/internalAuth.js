// GENERATED from /common/internalAuth.js by scripts/sync-common.js. Do not edit here.
const crypto = require('crypto');

// Services trust the headers the gateway sets (x-user-id ...). That is only safe
// if nobody except the gateway and other services can reach them, so every
// non-health route also requires this shared key. In Docker/K8s the services are
// additionally not published outside the private network; this is defence in depth.
module.exports = function internalAuth(req, res, next) {
  const sent = Buffer.from(String(req.headers['x-internal-key'] || ''));
  const expected = Buffer.from(String(process.env.INTERNAL_API_KEY || ''));
  const ok = sent.length === expected.length && expected.length > 0 &&
    crypto.timingSafeEqual(sent, expected);
  if (!ok) return res.status(403).json({ message: 'Forbidden: internal API only' });
  next();
};
