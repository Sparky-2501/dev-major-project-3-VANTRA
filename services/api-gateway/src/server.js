require('./common/tracing'); // first, so http/express/ioredis get instrumented
const http = require('http');
const { requireEnv } = require('./common/env');
requireEnv('REDIS_URL', 'JWT_SECRET', 'INTERNAL_API_KEY');

const logger = require('./common/logger');
const { createRedis } = require('./common/redis');
const { urls } = require('./routes');

const redis = createRedis();
const app = require('./app')({ redis, blacklist: require('./common/blacklist')(redis) });
const server = http.createServer(app);

// WebSocket upgrade for Socket.IO (the polling transport goes through app above).
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/socket.io')) app.locals.proxy.ws(req, socket, head, { target: urls.notification });
  else socket.destroy();
});

const port = process.env.PORT || 8080;
server.listen(port, () => logger.info(`api-gateway listening on ${port}`));
