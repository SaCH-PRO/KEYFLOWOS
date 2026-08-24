import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorRegistry, errorRegistry } from './error-registry';

/**
 * The registry exists so that a failure in production leaves a trace. The
 * assertions below are about the three ways such a thing normally becomes
 * useless or harmful rather than about "does it store an error":
 *
 *   - it must be BOUNDED, or a tight failure loop OOMs the process it observes
 *   - it must be REDACTED, or it becomes a place secrets accumulate behind one
 *     authenticated route
 *   - it must be SILENT, or the error reporter becomes a second error source —
 *     and it is called from inside runGuarded, whose whole purpose is that
 *     nothing escapes it
 */

describe('ErrorRegistry: bounded', () => {
  let reg: ErrorRegistry;
  beforeEach(() => { reg = new ErrorRegistry(); });

  it('collapses repeats of the same failure into one counted entry', () => {
    // A job failing every 60s for a day must not evict everything else.
    for (let i = 0; i < 500; i++) reg.record('background', 'NightlyJob', new Error('db down'));
    const snap = reg.snapshot();
    expect(snap.distinct).toBe(1);
    expect(snap.total).toBe(500);
    expect(snap.entries[0].count).toBe(500);
  });

  it('caps distinct signatures instead of growing without bound', () => {
    for (let i = 0; i < 1000; i++) reg.record('http', `GET /r/${i}`, new Error('boom'));
    const snap = reg.snapshot(1000);
    expect(snap.distinct).toBeLessThanOrEqual(200);
    expect(snap.dropped).toBeGreaterThan(0);
    // Total still counts what was dropped, so the number is not silently wrong.
    expect(snap.total).toBe(1000);
  });

  it('keeps the earliest history rather than letting a noisy new failure flush it', () => {
    reg.record('background', 'FirstJob', new Error('the original cause'));
    for (let i = 0; i < 1000; i++) reg.record('http', `GET /r/${i}`, new Error('noise'));
    const found = reg.snapshot(1000).entries.find((e) => e.label === 'FirstJob');
    expect(found, 'the entry that explains the incident was evicted by noise').toBeDefined();
  });

  it('honours the snapshot limit and orders most-recent-first', async () => {
    reg.record('background', 'older', new Error('a'));
    await new Promise((r) => setTimeout(r, 5));
    reg.record('background', 'newer', new Error('b'));
    const snap = reg.snapshot(1);
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0].label).toBe('newer');
  });

  it('truncates a very long message', () => {
    reg.record('other', 'huge', new Error('x'.repeat(5000)));
    expect(reg.snapshot().entries[0].message.length).toBeLessThanOrEqual(300);
  });
});

describe('ErrorRegistry: redacted', () => {
  let reg: ErrorRegistry;
  beforeEach(() => { reg = new ErrorRegistry(); });

  // Each of these is a shape that genuinely turns up inside an error message
  // here: a Prisma connection string, a bearer token echoed from a failed
  // upstream call, a JWT, a key printed in a config dump.
  it.each([
    ['postgres URL', 'connect ECONNREFUSED postgresql://kf:s3cretpw@db.internal:5432/keyflow', 's3cretpw'],
    ['bearer token', 'upstream said 401 for Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef', 'abcdef'],
    ['api key kv', 'bad config: api_key=sk-live-9f8e7d6c5b4a3210', 'sk-live-9f8e7d6c5b4a3210'],
    ['password kv', 'auth failed with password: hunter2hunter2', 'hunter2hunter2'],
  ])('strips a %s', (_name, message, secret) => {
    reg.record('http', 'POST /x', new Error(message));
    const stored = reg.snapshot().entries[0].message;
    expect(stored, `the secret survived into the registry: ${stored}`).not.toContain(secret);
  });

  it('keeps enough of the message to be diagnostic', () => {
    reg.record('http', 'POST /x', new Error('connect ECONNREFUSED postgresql://kf:pw@db:5432/x'));
    const stored = reg.snapshot().entries[0].message;
    // Redaction that removes the whole message would be "safe" and useless.
    expect(stored).toContain('ECONNREFUSED');
    expect(stored).toContain('db:5432');
  });
});

describe('ErrorRegistry: silent', () => {
  let reg: ErrorRegistry;
  beforeEach(() => { reg = new ErrorRegistry(); });

  it.each([
    ['a non-Error throw', 'just a string'],
    ['null', null],
    ['undefined', undefined],
    ['an object with a throwing message getter', new Proxy({}, { get() { throw new Error('nope'); } })],
  ])('never throws on %s', (_name, value) => {
    expect(() => reg.record('other', 'weird', value)).not.toThrow();
  });

  it('records an Error whose stack is missing', () => {
    const e = new Error('no stack here');
    delete (e as { stack?: string }).stack;
    expect(() => reg.record('other', 'nostack', e)).not.toThrow();
    expect(reg.snapshot().entries[0].message).toContain('no stack here');
  });
});

describe('ErrorRegistry: snapshot shape', () => {
  it('counts per source so the caller can tell HTTP from background', () => {
    const reg = new ErrorRegistry();
    reg.record('http', 'GET /a', new Error('x'));
    reg.record('background', 'JobA', new Error('y'));
    reg.record('background', 'JobB', new Error('z'));
    const snap = reg.snapshot();
    expect(snap.bySource.http).toBe(1);
    expect(snap.bySource.background).toBe(2);
    expect(snap.bySource.boot).toBe(0);
  });

  it('reports an empty registry without inventing entries', () => {
    const snap = new ErrorRegistry().snapshot();
    expect(snap.distinct).toBe(0);
    expect(snap.total).toBe(0);
    expect(snap.entries).toEqual([]);
  });

  it('exposes a process-wide singleton for the non-DI reporters', () => {
    // runGuarded is a plain function and the exception filter is constructed
    // outside the DI container; neither can inject a provider.
    expect(errorRegistry).toBeInstanceOf(ErrorRegistry);
  });
});
