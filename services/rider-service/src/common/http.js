// GENERATED from /common/http.js by scripts/sync-common.js. Do not edit here.
const { context, propagation } = require('@opentelemetry/api');
const { getContext } = require('./context');
const { withSpan } = require('./spans');

// One function for every service-to-service HTTP call.
//  - sends the internal key (so services reject direct outside calls),
//  - forwards x-correlation-id,
//  - injects the W3C traceparent header so the callee's spans join this trace,
//  - throws on network errors, timeouts and 5xx (these are what a breaker should
//    count), but RETURNS 4xx. A 404 or 409 is a valid answer, not an outage.
async function serviceRequest(service, method, url, { body, headers = {}, timeoutMs = 1500 } = {}) {
  return withSpan(`HTTP ${method} ${service}`, { 'peer.service': service, 'http.url': url }, async () => {
    const h = {
      'content-type': 'application/json',
      'x-internal-key': process.env.INTERNAL_API_KEY,
      ...headers,
    };
    const { correlationId } = getContext();
    if (correlationId) h['x-correlation-id'] = correlationId;
    propagation.inject(context.active(), h);

    const res = await fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON body */ }

    if (res.status >= 500) {
      const err = new Error(`${service} responded ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { status: res.status, data };
  });
}

module.exports = { serviceRequest };
