const express = require('express');
const cookieParser = require('cookie-parser');
const httpProxy = require('http-proxy');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { contextMiddleware, getContext } = require('./common/context');
const healthRouter = require('./common/health');
const logger = require('./common/logger');
const { routes, urls } = require('./routes');

module.exports = ({ redis, blacklist }) => {
  const app = express();
  // Behind nginx / a K8s Ingress the real client IP is in X-Forwarded-For. This
  // number is how many proxy hops to trust; 0 when clients connect directly.
  // Setting it wrong lets clients fake their IP and dodge the rate limit.
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
  app.disable('x-powered-by');

  // Correlation id: created here (or kept if the client sent one), echoed in the
  // response, forwarded to every service, and stamped on every log line.
  app.use(contextMiddleware);
  app.use(cookieParser());

  // Never trust identity headers from outside. Strip them, then set our own.
  app.use((req, res, next) => {
    for (const h of ['x-user-id', 'x-user-role', 'x-internal-key', 'x-auth-token']) delete req.headers[h];
    next();
  });

  app.use(healthRouter({
    service: 'api-gateway',
    checks: { redis: async () => (await redis.ping()) === 'PONG' },
  }));

  // Rate limit (counters live in Redis, so ALL gateway replicas share one count;
  // an in-memory limiter would let a client get N x the limit with N replicas).
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_PER_MIN || 120),
    standardHeaders: true,
    legacyHeaders: false,
    // If Redis is down, let traffic through rather than turning a Redis outage into
    // a full API outage. Auth already fails closed; rate limiting fails open.
    passOnStoreError: true,
    store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: 'rl:' }),
    handler: (req, res) => res.status(429).json({ message: 'Too many requests, slow down' }),
  }));

  const proxy = httpProxy.createProxyServer({ changeOrigin: true, xfwd: true });
  proxy.on('error', (err, req, res) => {
    logger.error('proxy error', { err: err.message, url: req.url });
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.status(502).json({ message: 'Upstream service unavailable' });
    }
  });

  const authFor = require('./auth')(blacklist);
  for (const route of routes) {
    app.use(route.prefix, (req, res, next) => {
      if (route.demo && process.env.DEMO_MODE !== 'true') return res.status(404).json({ message: 'Not found' });
      next();
    }, authFor(route), (req, res) => {
      // Express removed the prefix from req.url; put the target's path in front.
      req.url = route.rewrite + (req.url === '/' ? '' : req.url);
      req.headers['x-internal-key'] = process.env.INTERNAL_API_KEY;
      req.headers['x-correlation-id'] = getContext().correlationId;
      proxy.web(req, res, { target: route.target });
    });
  }

  // Socket.IO polling transport. The socket itself authenticates in
  // notification-service; the gateway only forwards bytes.
  app.use('/socket.io', (req, res) => {
    req.url = '/socket.io' + req.url;
    proxy.web(req, res, { target: urls.notification });
  });

  // Aggregated health of every service, for demos: shows each service's breaker
  // states in one call. With 2 replicas you see whichever replica answered.
  app.get('/status', async (req, res) => {
    if (process.env.DEMO_MODE !== 'true') return res.status(404).json({ message: 'Not found' });
    const entries = await Promise.all(Object.entries(urls).map(async ([name, base]) => {
      try {
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
        return [name, await r.json()];
      } catch (err) {
        return [name, { status: 'unreachable', error: err.message }];
      }
    }));
    res.json(Object.fromEntries(entries));
  });

  app.use((req, res) => res.status(404).json({ message: 'Route not found' }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));

  app.locals.proxy = proxy;
  return app;
};
