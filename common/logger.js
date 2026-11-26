const { trace } = require('@opentelemetry/api');
const { getContext } = require('./context');

const SERVICE = process.env.SERVICE_NAME || 'unknown';

// One JSON object per line. The correlationId (set at the gateway) and traceId
// let you grep one ride's logs across all six services.
function write(level, msg, extra) {
  const span = trace.getActiveSpan && trace.getActiveSpan();
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: SERVICE,
      msg,
      correlationId: getContext().correlationId,
      traceId: span ? span.spanContext().traceId : undefined,
      ...extra,
    })
  );
}

module.exports = {
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
};
