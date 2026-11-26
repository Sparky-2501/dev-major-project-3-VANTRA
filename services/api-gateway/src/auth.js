const jwt = require('jsonwebtoken');
const logger = require('./common/logger');

// Verifies the JWT ONCE, here, and tells the services who the caller is via
// headers. Services never see or re-verify the token except to blacklist it on logout.
module.exports = (blacklist) => (route) => async (req, res, next) => {
  // req.url is the part AFTER the mount prefix, e.g. "/login?x=1"
  const subPath = req.path;
  if (route.public && req.method === 'POST' && route.public.includes(subPath)) return next();

  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  if (route.role !== 'any' && payload.role !== route.role) {
    return res.status(403).json({ message: `This endpoint is for ${route.role}s only` });
  }

  try {
    if (await blacklist.isBlacklisted(token)) {
      return res.status(401).json({ message: 'Token is blacklisted' });
    }
  } catch (err) {
    // Fail CLOSED: if revocation cannot be checked, do not let the request in.
    logger.error('blacklist check failed', { err: err.message });
    return res.status(503).json({ message: 'Auth temporarily unavailable' });
  }

  // These are set by the gateway only. Any client-supplied copies were deleted
  // earlier in app.js, otherwise a caller could impersonate anyone with a header.
  req.headers['x-user-id'] = String(payload._id);
  req.headers['x-user-role'] = payload.role;
  req.headers['x-auth-token'] = token;
  next();
};
