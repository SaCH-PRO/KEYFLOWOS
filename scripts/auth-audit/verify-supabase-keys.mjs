// Checks that SUPABASE_JWT_SECRET, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY belong to the same project and to each other.
//
//   node scripts/auth-audit/verify-supabase-keys.mjs
//
// Supabase signs the anon and service_role keys WITH the JWT secret, so the
// three can be cross-validated offline — no network, no Supabase call. That
// matters because the usual failure here is silent: a wrong JWT secret does not
// break auth, it just makes every request fall back to a network round-trip.
//
// Prints roles, project ref, expiry and a verdict. NEVER prints a key.
import crypto from 'node:crypto';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const secret = env.SUPABASE_JWT_SECRET;
if (!secret) {
  console.error('SUPABASE_JWT_SECRET is not set — nothing to verify against.');
  process.exit(1);
}

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
function verify(jwt, key) {
  const [h, b, sig] = jwt.split('.');
  const expected = crypto.createHmac('sha256', key).update(`${h}.${b}`).digest('base64url');
  // Length-mismatched buffers make timingSafeEqual throw rather than return false.
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

let allOk = true;
for (const name of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  const jwt = env[name];
  if (!jwt) { console.log(`${name.padEnd(26)} MISSING`); allOk = false; continue; }
  if (jwt.split('.').length !== 3) { console.log(`${name.padEnd(26)} not a JWT`); allOk = false; continue; }
  let c;
  try { c = claims(jwt); } catch { console.log(`${name.padEnd(26)} unreadable payload`); allOk = false; continue; }
  const ok = verify(jwt, secret);
  if (!ok) allOk = false;
  const exp = c.exp ? new Date(c.exp * 1000).toISOString().slice(0, 10) : 'none';
  console.log(
    `${name.padEnd(26)} role=${String(c.role).padEnd(13)} ref=${c.ref ?? '?'}  expires=${exp}  ` +
    `signature verifies: ${ok ? 'YES' : 'NO'}`,
  );
}

console.log(
  allOk
    ? '\nAll keys verify against SUPABASE_JWT_SECRET — same project, consistent.'
    : '\nAt least one key does NOT verify. A wrong JWT secret does not break auth; it silently forces every request to round-trip to Supabase.',
);
process.exit(allOk ? 0 : 1);
