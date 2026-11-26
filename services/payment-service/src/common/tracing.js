// GENERATED from /common/tracing.js by scripts/sync-common.js. Do not edit here.
// MUST be the first require of a service's server.js: OpenTelemetry patches the
// http, express, mongodb and ioredis modules at require time, so anything loaded
// before this file is not traced.
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

if (process.env.OTEL_ENABLED !== 'false') {
  // Docker/K8s set OTEL_NODE_ENABLED_INSTRUMENTATIONS=http,express,mongodb,ioredis
  // so only those four are active; that variable is read by the auto package.
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  const sdk = new NodeSDK({
    serviceName: process.env.SERVICE_NAME || 'unknown',
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  // Flush buffered spans on shutdown, otherwise the last requests never reach Jaeger.
  process.on('SIGTERM', () => sdk.shutdown().finally(() => process.exit(0)));
}
