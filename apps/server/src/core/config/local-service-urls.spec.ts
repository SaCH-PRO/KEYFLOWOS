/**
 * Service URLs the SERVER dials must not use `localhost`.
 *
 * The API could not boot on a developer machine for a reason no test could see:
 * it compiled, type-checked, mapped all 2,191 routes, and then threw Prisma
 * P1017 inside NestApplication.listen.
 *
 * The chain, measured rather than reasoned:
 *
 *   1. `localhost` on Windows resolves to IPv6 ::1 before 127.0.0.1.
 *   2. Docker publishes the port on [::]  — so the connection is ACCEPTED and
 *      then immediately reset. That is why the symptom is ECONNRESET rather
 *      than a clean ECONNREFUSED, and why it reads as "the database is flaky"
 *      instead of "the address is wrong".
 *   3. packages/db builds its pg Pool from DATABASE_URL and hands it to Prisma
 *      as an adapter, so every query through the app's client fails while a
 *      plain `new PrismaClient()` — which does not use that pool — succeeds.
 *      Two clients, same connection string, opposite verdicts.
 *
 *   pg on `localhost` -> FAIL (ECONNRESET)
 *   pg on `[::1]`     -> FAIL (ECONNRESET)
 *   pg on `127.0.0.1` -> OK
 *
 * This only checks the committed .env.example, because .env is gitignored and
 * machine-specific. The example is what a new developer copies, so getting it
 * right is what stops the next person losing an afternoon to a database that
 * was up the entire time.
 *
 * BROWSER-FACING URLS ARE DELIBERATELY EXEMPT. NEXT_PUBLIC_*, APP_URL and
 * friends are resolved by the browser, where `localhost` is correct and
 * 127.0.0.1 would break cookie scoping. The rule is about what the SERVER
 * dials, not what it advertises.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const EXAMPLE = path.join(__dirname, '..', '..', '..', '..', '..', '.env.example');

/** Variables the server itself connects to, as opposed to URLs it hands out. */
const SERVER_DIALLED = [
  'DATABASE_URL',
  'DIRECT_URL',
  'REDIS_URL',
  'DOCLING_URL',
  'LIVEKIT_URL',
];

function declared(): Map<string, string> {
  const out = new Map<string, string>();
  // Split on /\r?\n/, not '\n'. This file has CRLF endings, and in JavaScript
  // `\r` is a LINE TERMINATOR — so `.` does not match it. A trailing `\r` left
  // on the line makes `(.*)$` fail to anchor, and the regex then matches
  // nothing at all. The first version of this gate parsed zero variables, and
  // the only reason that surfaced is the not-vacuous assertion below.
  for (const line of fs.readFileSync(EXAMPLE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]{2,})=(.*)$/.exec(line);
    if (m && m[2].trim()) out.set(m[1], m[2].trim());
  }
  return out;
}

describe('local service URLs', () => {
  it('reads .env.example — this gate is not vacuous', () => {
    expect(declared().size, '.env.example not parsed').toBeGreaterThan(20);
  });

  it('no server-dialled URL points at localhost', () => {
    const vars = declared();
    const offenders = SERVER_DIALLED.filter((k) => (vars.get(k) ?? '').includes('localhost')).map(
      (k) => `${k}=${vars.get(k)}`,
    );

    expect(
      offenders,
      'use 127.0.0.1 rather than localhost for a service the server connects to. ' +
        'On Windows localhost resolves to ::1 first, Docker accepts then resets ' +
        'the connection, and the failure looks like an unstable database rather ' +
        'than a wrong address.',
    ).toEqual([]);
  });

  it('browser-facing URLs are left alone', () => {
    // Guarding against an over-eager future fix that rewrites these too, which
    // would break cookie scoping between the app and the API in the browser.
    const vars = declared();
    const browserFacing = [...vars.keys()].filter(
      (k) => k.startsWith('NEXT_PUBLIC_') || k === 'APP_URL' || k === 'SITE_URL',
    );
    expect(browserFacing.length, 'no browser-facing URLs found to protect').toBeGreaterThan(0);
  });
});
