/**
 * Exact-body contract for the existing health endpoints (V1-20-SEC-VERIFY-UP,
 * port of #188; called by scripts/verify-up.sh for every JSON probe).
 * An HTTP 200 with a degraded body is NOT a passing readiness probe.
 * This never prints response bodies, URLs, credentials or private fields.
 *
 * CLI: `node verify-up-body.mjs <probe> <body-file>`. A healthy body prints
 * exactly `valid_health_body` on stdout and exits 0; anything else prints one
 * fixed reason token on stderr and exits non-zero. verify-up.sh requires the
 * stdout token, so a run that checks nothing can never read as a pass.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKS = Object.freeze({
  'api.healthz': (body) => body.status === 'ok',
  'api.readyz': (body) => body.status === 'ready' && body.db?.ok === true,
  'web.healthz': (body) => body.status === 'ok' && body.apiReachable === true && body.env === 'ok',
});

export function verifyHealthBody(label, raw) {
  const validate = CHECKS[label];
  if (!validate) return { ok: false, reason: 'unknown_probe' };
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'not_an_object' };
  }
  return validate(body)
    ? { ok: true, reason: 'valid_health_body' }
    : { ok: false, reason: 'health_body_unhealthy' };
}

// Node gives the main module's import.meta.url as a real path, while argv[1]
// keeps any symlink in the path it was started with (a deploy `current ->
// releases/N` checkout, /tmp on macOS). Compare real paths on both sides.
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  const [label, file] = process.argv.slice(2);
  if (!label || !file) {
    console.error('health_verifier_usage_error');
    process.exitCode = 2;
  } else {
    let result;
    try {
      result = verifyHealthBody(label, readFileSync(file, 'utf8'));
    } catch {
      result = { ok: false, reason: 'body_unreadable' };
    }
    if (result.ok) {
      process.stdout.write(result.reason + '\n');
    } else {
      process.stderr.write(result.reason + '\n');
      process.exitCode = 1;
    }
  }
}
