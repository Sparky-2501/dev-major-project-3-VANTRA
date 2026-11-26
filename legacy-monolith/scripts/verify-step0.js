// Black-box check of Step 0: talks to a RUNNING server over HTTP.
//   Terminal 1:  npm start
//   Terminal 2:  npm run verify:step0          (BASE_URL=http://localhost:3000 by default)
// Needs Node 18+ (global fetch). Exits non-zero if any check fails.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const stamp = Date.now(); // unique emails so the script can be re-run
let failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  -> ' + JSON.stringify(extra) : ''}`);
  if (!cond) failed++;
}

(async () => {
  const rider = { fullname: { firstname: 'Asha', lastname: 'Rao' }, email: `rider${stamp}@t.com`, password: 'secret123' };
  const driver = {
    fullname: { firstname: 'Ravi', lastname: 'Kumar' }, email: `driver${stamp}@t.com`, password: 'secret123',
    vehicle: { color: 'white', plate: 'MH12AB1234', capacity: 4, vehicleType: 'car' },
  };

  // ---------- rider ----------
  let r = await call('POST', '/users/register', { body: rider });
  check('rider register -> 201 + token', r.status === 201 && !!r.json?.token, r);
  check('rider register does not leak password hash', r.json?.user && !('password' in r.json.user), r.json);

  r = await call('POST', '/users/register', { body: rider });
  check('rider duplicate register -> 400', r.status === 400, r);

  r = await call('POST', '/users/login', { body: { email: rider.email, password: 'wrongpass' } });
  check('rider wrong password -> 401', r.status === 401, r);

  r = await call('POST', '/users/login', { body: { email: rider.email, password: rider.password } });
  check('rider login -> 200 + token', r.status === 200 && !!r.json?.token, r);
  check('rider login does not leak password hash', r.json?.user && !('password' in r.json.user), r.json);
  const riderToken = r.json?.token;

  r = await call('GET', '/users/profile', { token: riderToken });
  check('rider profile -> 200', r.status === 200 && r.json?.user?.email === rider.email, r);

  r = await call('GET', '/users/logout', { token: riderToken });
  check('rider logout -> 200', r.status === 200, r);

  r = await call('GET', '/users/profile', { token: riderToken });
  check('rider profile after logout -> 401 (blacklisted)', r.status === 401, r);

  // ---------- driver ----------
  r = await call('POST', '/captains/register', { body: driver });
  check('driver register -> 201 + token', r.status === 201 && !!r.json?.token, r);
  check('driver register saved vehicle', r.json?.captain?.vehicle?.plate === 'MH12AB1234', r.json);
  check('driver register does not leak password hash', r.json?.captain && !('password' in r.json.captain), r.json);

  r = await call('POST', '/captains/register', { body: driver });
  check('driver duplicate register -> 400', r.status === 400, r);

  r = await call('POST', '/captains/login', { body: { email: driver.email, password: 'wrongpass' } });
  check('driver wrong password -> 401', r.status === 401, r);

  r = await call('POST', '/captains/login', { body: { email: driver.email, password: driver.password } });
  check('driver login -> 200 + token', r.status === 200 && !!r.json?.token, r);
  check('driver login does not leak password hash', r.json?.captain && !('password' in r.json.captain), r.json);
  const driverToken = r.json?.token;

  r = await call('GET', '/captains/profile', { token: driverToken });
  check('driver profile -> 200', r.status === 200 && r.json?.captain?.email === driver.email, r);

  // Cross-role: a driver token must not open rider routes, and the reverse.
  r = await call('GET', '/users/profile', { token: driverToken });
  check('driver token on rider route -> 401', r.status === 401, r);

  r = await call('POST', '/captains/logout', { token: driverToken });
  check('driver logout -> 200', r.status === 200, r);

  r = await call('GET', '/captains/profile', { token: driverToken });
  check('driver profile after logout -> 401 (blacklisted)', r.status === 401, r);

  r = await call('GET', '/captains/profile');
  check('driver profile without token -> 401', r.status === 401, r);

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Step 0 checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Script crashed (is the server running?):', e.message); process.exit(2); });
