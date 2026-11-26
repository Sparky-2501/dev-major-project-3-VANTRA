// GENERATED from /common/env.js by scripts/sync-common.js. Do not edit here.
// Fail at startup, with the variable names, instead of failing later with a
// confusing "jwt secret undefined" in the middle of a request.
module.exports.requireEnv = (...names) => {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill them in (see README, "Environment").');
    process.exit(1);
  }
};
