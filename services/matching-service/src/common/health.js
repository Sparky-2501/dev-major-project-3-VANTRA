// GENERATED from /common/health.js by scripts/sync-common.js. Do not edit here.
const express = require('express');

// GET /health is used by Docker healthchecks and by Kubernetes liveness AND
// readiness probes. It returns 503 when a hard dependency is down, so a pod that
// cannot reach Mongo/Redis is taken out of the Service's rotation.
// `getBreakers` is passed in so services without breakers do not need opossum.
module.exports = ({ service, checks = {}, getBreakers = () => ({}) }) => {
  const router = express.Router();
  router.get('/health', async (req, res) => {
    const results = {};
    let healthy = true;
    for (const [name, fn] of Object.entries(checks)) {
      try {
        results[name] = (await Promise.race([
          Promise.resolve(fn()),
          new Promise((r) => setTimeout(() => r(false), 1000)),
        ])) ? 'up' : 'down';
      } catch (_) {
        results[name] = 'down';
      }
      if (results[name] !== 'up') healthy = false;
    }
    res.status(healthy ? 200 : 503).json({
      service,
      status: healthy ? 'ok' : 'degraded',
      uptimeSec: Math.round(process.uptime()),
      checks: results,
      breakers: getBreakers(),
    });
  });
  return router;
};
