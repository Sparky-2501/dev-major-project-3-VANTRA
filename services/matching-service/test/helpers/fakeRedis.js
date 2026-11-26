// Minimal in-memory stand-in for the few Redis commands the locks/offers code
// uses. It is NOT Redis: it proves OUR logic (who may lock, order of operations),
// not Redis's atomicity. The real-Redis check is tests/e2e.js.
module.exports = class FakeRedis {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async set(k, v, ...opts) {
    if (opts.includes('NX') && this.m.has(k)) return null;
    this.m.set(k, String(v));
    return 'OK';
  }
  async del(...ks) { let n = 0; ks.flat().forEach((k) => { if (this.m.delete(k)) n++; }); return n; }
  async exists(k) { return this.m.has(k) ? 1 : 0; }
  async expire() { return 1; }
  // Emulates the exact Lua scripts used by locks.js and offers.js.
  async eval(script, nKeys, ...args) {
    const keys = args.slice(0, nKeys);
    const argv = args.slice(nKeys).map(String);
    if (script.includes("'DEL'")) return this.m.get(keys[0]) === argv[0] ? (this.m.delete(keys[0]), 1) : 0;       // lock release
    if (script.includes("'EXPIRE'")) return this.m.get(keys[0]) === argv[0] ? 1 : 0;                              // lock extend
    if (script.includes("'SET', KEYS[2]")) {                                                                       // offer respond
      if (this.m.get(keys[0]) === argv[0]) { this.m.set(keys[1], argv[1]); return 1; }
      return 0;
    }
    throw new Error('FakeRedis.eval: unknown script');
  }
};
