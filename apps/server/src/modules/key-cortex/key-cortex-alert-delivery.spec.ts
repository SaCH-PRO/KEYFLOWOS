/**
 * Alerts have to reach a person.
 *
 * The intuition layer logs ALERT_TRIGGERED BusinessEvents when it finds
 * something serious. That is the audit trail: durable, and invisible unless
 * somebody opens a panel. An alert nobody is told about is a log line with
 * ambition.
 *
 * A NotificationsAdapterService with createAlert() already existed and the
 * cognition layer never called it. These tests pin that it now does, and — more
 * importantly — that delivery failing can never cost us the detection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'key-cortex-intuition.service.ts'), 'utf8');

describe('alert delivery', () => {
  it('the intuition layer can reach the notification adapter', () => {
    expect(src).toMatch(/NotificationsAdapterService/);
  });

  it('is injected @Optional, so a module without notifications still boots', () => {
    // Detection must not depend on delivery being configured.
    expect(src).toMatch(/@Optional\(\)\s*private readonly notifications\?: NotificationsAdapterService/);
  });

  it('is APPENDED to the constructor, not spliced in', () => {
    const ctor = src.slice(src.indexOf('  constructor('));
    const body = ctor.slice(0, ctor.indexOf('\n  ) {'));
    const params = body
      .split('\n')
      .map((l) => /(?:private readonly )(\w+)\??:/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));

    expect(params.indexOf('notifications')).toBeGreaterThan(params.indexOf('aiUsage'));
  });

  it('delivers weak signals AND churn predictions', () => {
    const calls = src.match(/this\.deliver\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('still writes the BusinessEvent — delivery supplements the audit trail', () => {
    // The event log is the durable record; the notification is the interrupt.
    // Replacing one with the other would lose history.
    expect(src).toMatch(/this\.eventService\.logAlert\(/);
  });

  it('a delivery failure cannot break detection', () => {
    const fn = src.slice(src.indexOf('private async deliver('));
    const body = fn.slice(0, fn.indexOf('\n  /**'));

    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch \(error: unknown\)/);
    // Absent adapter is a silent no-op, not a crash.
    expect(body).toMatch(/if \(!this\.notifications\) return;/);
  });

  it('passes the entity through so a notification can link back', () => {
    const fn = src.slice(src.indexOf('private async deliver('));
    const body = fn.slice(0, fn.indexOf('\n  /**'));
    expect(body).toMatch(/entityType/);
    expect(body).toMatch(/entityId/);
  });

  it('only the signals that cleared the alert bar are delivered', () => {
    // deliver() sits inside the worthRaising loop, not the persist loop —
    // notifying on every weak signal would train the user to ignore them.
    const record = src.slice(src.indexOf('const worthRaising'));
    const block = record.slice(0, record.indexOf('\n    this.logger.log('));
    expect(block).toMatch(/this\.deliver\(/);
  });
});
