const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

// Per-request data (correlation id, caller id) that every log line and every
// outgoing HTTP call needs, without threading it through every function argument.
const als = new AsyncLocalStorage();

const getContext = () => als.getStore() || {};
const runWithContext = (ctx, fn) => als.run(ctx, fn);

// The gateway creates x-correlation-id; services reuse it, or make one if they
// are called directly (for example in a test).
function contextMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('x-correlation-id', correlationId);
  als.run(
    {
      correlationId,
      userId: req.headers['x-user-id'],
      userRole: req.headers['x-user-role'],
    },
    next
  );
}

module.exports = { getContext, runWithContext, contextMiddleware };
