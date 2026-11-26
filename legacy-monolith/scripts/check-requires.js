// Offline sanity check: every relative require() must point at a file that exists.
// This is the bug class that broke the original auth middleware
// (require('../models/blacklist.model') when the file had another name).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', 'scripts']);
let bad = 0, files = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) check(full);
  }
}

function check(file) {
  files++;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    const ok = [target, target + '.js', path.join(target, 'index.js')].some(
      (p) => fs.existsSync(p) && fs.statSync(p).isFile()
    );
    if (!ok) {
      bad++;
      console.log(`MISSING  ${path.relative(root, file)} -> ${m[1]}`);
    }
  }
}

walk(root);
console.log(`${files} files scanned, ${bad} broken relative requires`);
process.exit(bad ? 1 : 0);
