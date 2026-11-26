// Creates .env with fresh random secrets, only if .env does not exist yet.
//   node scripts/make-env.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const target = path.join(__dirname, '..', '.env');
if (fs.existsSync(target)) {
  console.log('.env already exists, not touching it.');
  process.exit(0);
}
const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
const secret = () => crypto.randomBytes(32).toString('hex');
const out = example
  .replace(/^JWT_SECRET=$/m, `JWT_SECRET=${secret()}`)
  .replace(/^INTERNAL_API_KEY=$/m, `INTERNAL_API_KEY=${secret()}`);
fs.writeFileSync(target, out, { mode: 0o600 });
console.log('.env created with random JWT_SECRET and INTERNAL_API_KEY.');
