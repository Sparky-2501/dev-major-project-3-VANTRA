// Copies the shared helper files from /common into each service's src/common.
//
// Why copy instead of importing a shared package: each service must build and
// deploy on its own (own package.json, own Dockerfile, own image). A shared
// import would couple their release cycles. The price is duplication, so edit
// the file in /common and run `node scripts/sync-common.js`; never edit the copies.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const base = ['context', 'logger', 'spans', 'tracing', 'redis', 'env', 'keys', 'health'];
const plan = {
  'api-gateway': [...base, 'blacklist'],
  'rider-service': [...base, 'mongo', 'blacklist', 'breaker', 'retry', 'http', 'internalAuth', 'identity'],
  'driver-service': [...base, 'mongo', 'blacklist', 'internalAuth', 'identity'],
  'matching-service': [...base, 'mongo', 'breaker', 'retry', 'http', 'internalAuth', 'identity', 'events'],
  'payment-service': [...base, 'mongo', 'internalAuth', 'events'],
  'notification-service': [...base, 'internalAuth'],
};

for (const [service, files] of Object.entries(plan)) {
  const dest = path.join(root, 'services', service, 'src', 'common');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) {
    const body = fs.readFileSync(path.join(root, 'common', `${f}.js`), 'utf8');
    fs.writeFileSync(
      path.join(dest, `${f}.js`),
      `// GENERATED from /common/${f}.js by scripts/sync-common.js. Do not edit here.\n${body}`
    );
  }
  console.log(`${service}: ${files.length} files`);
}
