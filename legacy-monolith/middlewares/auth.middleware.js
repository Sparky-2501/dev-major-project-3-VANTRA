const jwt = require('jsonwebtoken');
const userModel = require('../models/user.model');
const captainModel = require('../models/captain.model');
const tokenBlacklist = require('../services/tokenBlacklist.service');

// Single place that knows how a token is extracted, so login/logout/middleware
// can never disagree about it again (the old logout read `req.header`).
function extractToken(req) {
    return req.cookies?.token || req.headers.authorization?.split(' ')[1];
}
module.exports.extractToken = extractToken;

// One factory builds both middlewares. `role` is checked against the token's
// `role` claim: without it a rider's token and a driver's token are
// interchangeable, because both are signed with the same secret.
function makeAuth(role, model, reqKey) {
    return async (req, res, next) => {
        const token = extractToken(req);
        if (!token) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        if (decoded.role !== role) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        // Verify the signature first, so garbage tokens never cost a Redis call.
        try {
            if (await tokenBlacklist.isBlacklisted(token)) {
                return res.status(401).json({ message: 'Token is blacklisted' });
            }
        } catch (err) {
            // Fail CLOSED: if we cannot check revocation we refuse the request.
            // Failing open would let a logged-out token work during a Redis outage.
            console.error('Blacklist check failed:', err.message);
            return res.status(503).json({ message: 'Auth temporarily unavailable' });
        }

        // The token is signed with `_id` (see generateAuthToken in the models).
        const account = await model.findById(decoded._id);
        if (!account) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        req[reqKey] = account;
        req.token = token;
        return next();
    };
}

module.exports.authUser = makeAuth('user', userModel, 'user');
module.exports.authCaptain = makeAuth('captain', captainModel, 'captain');
