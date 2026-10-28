/**
 * Exact-body contract for the existing health endpoints.
 * An HTTP 200 with a degraded body is NOT a passing readiness probe.
 * This never prints response bodies, URLs, credentials or private fields.
 */
import { readFileSync } from 'node:fs';
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
    if (!result.ok) {
      console.error(result.reason);
      process.exitCode = 1;
    }
  }
}
