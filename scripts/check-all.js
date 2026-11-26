// Offline checks that need no npm install and no running services:
//   1. every .js file parses (node --check)
//   2. every relative require() points at a file that exists
//   3. every package required is declared in THAT service's package.json
//   4. the copies in services/*/src/common match /common (nobody edited a copy)
// Run:  node scripts/check-all.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const builtins = new Set(require('module').builtinModules);

const root = path.join(__dirname, '..');
let problems = 0;
const fail = (m) => { problems++; console.log('FAIL  ' + m); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'legacy-monolith'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else if (e.name.endsWith('.js')) out.push(f);
  }
  return out;
}

const pkgFor = (file) => {
  let d = path.dirname(file);
  // Stop below the repo root: the root package.json only holds convenience scripts,
  // and /common (source of the copies) deliberately has no dependencies of its own.
  while (d !== root && d.startsWith(root)) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    d = path.dirname(d);
  }
  return null;
};

const files = walk(root);
for (const f of files) {
  const rel = path.relative(root, f);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { fail(`syntax ${rel}: ${e.stderr}`); continue; }

  const src = fs.readFileSync(f, 'utf8');
  const pkgDir = pkgFor(f);
  const declared = pkgDir ? (() => { const p = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'))); return { ...p.dependencies, ...p.devDependencies }; })() : {};
  // Lua/other strings never contain require( so a regex is enough here.
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const req = m[1];
    if (req.startsWith('.')) {
      const t = path.resolve(path.dirname(f), req);
      if (![t, t + '.js', path.join(t, 'index.js')].some((p) => fs.existsSync(p) && fs.statSync(p).isFile())) fail(`missing file  ${rel} -> ${req}`);
    } else if (pkgDir && !req.startsWith('node:') && !builtins.has(req.split('/')[0])) {
      const name = req.startsWith('@') ? req.split('/').slice(0, 2).join('/') : req.split('/')[0];
      if (!(name in declared)) fail(`undeclared dependency  ${rel} requires "${name}" but ${path.relative(root, pkgDir)}/package.json does not list it`);
    }
  }
}

// copies vs source
for (const svc of fs.readdirSync(path.join(root, 'services'))) {
  const dir = path.join(root, 'services', svc, 'src', 'common');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const copy = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(1).join('\n');
    if (copy !== fs.readFileSync(path.join(root, 'common', f), 'utf8')) fail(`common copy out of date: services/${svc}/src/common/${f} (run node scripts/sync-common.js)`);
  }
}

console.log(`${files.length} files checked, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
