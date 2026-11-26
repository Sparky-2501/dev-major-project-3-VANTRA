// The shared code imports @opentelemetry/api. In a normal checkout (npm install
// done) the real package is used and this file does nothing. Only when the package
// is not installed does it register a tiny no-op stand-in, so the pure-logic
// tests can still run offline.
const Module = require('module');
try {
  require.resolve('@opentelemetry/api');
} catch (_) {
  const span = { end() {}, recordException() {}, setStatus() {}, spanContext: () => ({ traceId: '0' }) };
  const api = {
    trace: { getTracer: () => ({ startActiveSpan: (n, o, fn) => fn(span) }), getActiveSpan: () => undefined },
    context: { active: () => ({}), with: (c, fn) => fn() },
    propagation: { inject() {}, extract: (c) => c },
    SpanStatusCode: { ERROR: 2 },
    ROOT_CONTEXT: {},
  };
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    return request === '@opentelemetry/api' ? api : orig.call(this, request, ...rest);
  };
}
