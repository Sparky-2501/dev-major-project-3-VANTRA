const {
  trace, context, propagation, SpanStatusCode, ROOT_CONTEXT,
} = require('@opentelemetry/api');

const tracer = trace.getTracer('vantra');

// Run fn inside a custom span. Used for every saga step so the Jaeger trace shows
// "reserveDriver", "authorizePayment"... as named bars, not just raw HTTP calls.
async function withSpan(name, attributes, fn) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// W3C trace context as a plain string, so it can be stored in Mongo or put in a
// Redis event. This is how an async hop stays inside the same trace.
function currentTraceparent() {
  const carrier = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

// Continue a trace from a stored traceparent (used when a saga resumes in the
// background, or when a Redis event is consumed).
function runInTraceparent(traceparent, fn) {
  const ctx = traceparent
    ? propagation.extract(ROOT_CONTEXT, { traceparent })
    : context.active();
  return context.with(ctx, fn);
}

module.exports = { withSpan, currentTraceparent, runInTraceparent };
