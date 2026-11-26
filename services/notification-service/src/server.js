require('./common/tracing'); // first, so http/express/ioredis get instrumented
const http = require('http');
const os = require('os');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { requireEnv } = require('./common/env');
requireEnv('REDIS_URL', 'JWT_SECRET', 'INTERNAL_API_KEY');

const logger = require('./common/logger');
const keys = require('./common/keys');
const { createRedis } = require('./common/redis');
const { startConsumer } = require('./consumer');
const { messagesFor } = require('./messages');

const redis = createRedis();
const blockingRedis = createRedis({ blocking: true });
const server = http.createServer(require('./app')({ redis }));

// Socket.IO: a client connects with { auth: { token } }. We verify the JWT here
// (the gateway only proxies the connection) and put the socket in a private room
// named rider:<id> or driver:<id>, so pushing to one user is io.to(room).emit().
const io = new Server(server, { cors: { origin: '*' } });
io.use((socket, next) => {
  try {
    const p = jwt.verify(socket.handshake.auth && socket.handshake.auth.token, process.env.JWT_SECRET);
    socket.data.room = `${p.role}:${p._id}`;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => socket.join(socket.data.room));

async function handle(evt) {
  for (const m of messagesFor(evt.type, evt.data)) {
    io.to(m.to).emit('notification', { type: evt.type, text: m.text, rideId: evt.data.rideId });
    // Log sink: structured log line + a capped Redis list.
    logger.info('notification', { to: m.to, type: evt.type, text: m.text, rideId: evt.data.rideId });
    await redis.lpush(keys.NOTIFY_RECENT, JSON.stringify({ to: m.to, type: evt.type, text: m.text, rideId: evt.data.rideId, ts: Date.now() }));
    await redis.ltrim(keys.NOTIFY_RECENT, 0, 199);
  }
}

// hostname is unique per container/pod, so each replica is a distinct consumer.
startConsumer({ redis, blockingRedis, consumerName: os.hostname(), handle })
  .catch((err) => { logger.error('consumer failed to start', { err: err.message }); process.exit(1); });

const port = process.env.PORT || 3005;
server.listen(port, () => logger.info(`notification-service listening on ${port}`));
