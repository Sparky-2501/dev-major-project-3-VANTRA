const express = require('express');
const { contextMiddleware } = require('./common/context');
const healthRouter = require('./common/health');
const { mongoIsUp } = require('./common/mongo');
const internalAuth = require('./common/internalAuth');
const keys = require('./common/keys');

module.exports = ({ redis }) => {
  const pay = require('./paymentService')(redis);
  const app = express();
  app.use(contextMiddleware);
  app.use(express.json());

  app.use(healthRouter({
    service: 'payment-service',
    checks: { mongo: mongoIsUp, redis: async () => (await redis.ping()) === 'PONG' },
  }));

  // Every response has the same shape: { payment }. A DECLINED card is a normal
  // 200 answer, not an HTTP error: breakers must only see infrastructure failures.
  app.post('/internal/payments/authorize', internalAuth, async (req, res, next) => {
    try {
      const { rideId, amount, idempotencyKey } = req.body;
      if (!rideId || !(amount > 0)) return res.status(400).json({ message: 'rideId and amount > 0 required' });
      res.json({ payment: await pay.authorize({ rideId, amount, idempotencyKey }) });
    } catch (err) { next(err); }
  });

  const outcome = (res, r) => {
    if (r.notFound) return res.status(404).json({ message: 'No payment for this ride' });
    if (r.conflict) return res.status(409).json({ message: 'Payment is in the wrong state', payment: r.conflict });
    return res.json({ payment: r });
  };
  app.post('/internal/payments/:rideId/capture', internalAuth, async (req, res, next) => {
    try { outcome(res, await pay.capture(req.params.rideId)); } catch (err) { next(err); }
  });
  app.post('/internal/payments/:rideId/refund', internalAuth, async (req, res, next) => {
    try { outcome(res, await pay.refund(req.params.rideId)); } catch (err) { next(err); }
  });
  app.post('/internal/payments/:rideId/void', internalAuth, async (req, res, next) => {
    try { res.json({ payment: await pay.void(req.params.rideId) }); } catch (err) { next(err); }
  });
  app.get('/internal/payments/:rideId', internalAuth, async (req, res, next) => {
    try {
      const p = await pay.get(req.params.rideId);
      return p ? res.json({ payment: p }) : res.status(404).json({ message: 'No payment for this ride' });
    } catch (err) { next(err); }
  });

  // Demo: make a share of authorizations fail. 0 = never, 1 = always.
  app.post('/internal/demo/fail-rate', internalAuth, async (req, res, next) => {
    try {
      if (process.env.DEMO_MODE !== 'true') return res.status(404).json({ message: 'Not found' });
      const rate = Number(req.body.rate);
      if (!(rate >= 0 && rate <= 1)) return res.status(400).json({ message: 'rate must be between 0 and 1' });
      await redis.set(keys.DEMO_PAYMENT_FAIL_RATE, String(rate));
      res.json({ paymentFailureRate: rate });
    } catch (err) { next(err); }
  });

  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  return app;
};
