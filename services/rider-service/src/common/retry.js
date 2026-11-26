// GENERATED from /common/retry.js by scripts/sync-common.js. Do not edit here.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Do not retry when retrying cannot help: a client error (4xx) will fail the same
// way again, and an open breaker means "stop calling", which is its whole point.
const defaultShouldRetry = (err) =>
  err.code !== 'EOPENBREAKER' && !(err.status >= 400 && err.status < 500);

// Exponential backoff with jitter. Jitter matters: without it, every caller that
// failed at the same moment retries at the same moment and hits the recovering
// service as one spike (a "thundering herd").
//
// ONLY wrap calls that are safe to repeat: GETs, and POSTs that carry an
// idempotency key (payment authorize/void/capture, driver assign/release,
// ride booking). Never wrap something like "charge the card" without a key.
async function withRetry(fn, opts = {}) {
  const {
    retries = 2,
    baseMs = 150,
    maxMs = 2000,
    shouldRetry = defaultShouldRetry,
    sleepFn = sleep, // injectable so tests do not really wait
  } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const cap = Math.min(maxMs, baseMs * 2 ** attempt);
      await sleepFn(cap / 2 + Math.random() * (cap / 2));
    }
  }
}

module.exports = { withRetry, sleep };
