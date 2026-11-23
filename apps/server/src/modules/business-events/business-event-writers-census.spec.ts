/**
 * Codex #226 (RR-ERASURE-BUSINESS-EVENTS follow-up): every direct writer of
 * business_events outside BusinessEventService. A row about a contact written
 * after that contact was erased must not carry personal data, so a direct
 * writer either runs the shared write-time check (withoutForgottenPersonalData)
 * or is listed here with the reason it never writes a contact event. A new
 * direct writer fails this census until it is one or the other.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

/** Direct writers that never write a contact event (file -> number of writes -> why). */
const NOT_CONTACT_WRITERS: Record<string, { writes: number; why: string }> = {
  'modules/flow/flow-runner.service.ts': { writes: 1, why: "subject 'flow_run' (the run id)" },
  'modules/projects/project-revenue.listener.ts': { writes: 1, why: "subject 'project'; before/after a status, metadata invoice id and reason" },
  'modules/procurement/procurement.service.ts': { writes: 1, why: 'a procurement request decision, inside its transaction' },
  'modules/device/device.service.ts': { writes: 1, why: "createCapture: subject 'media_asset'; the card flow's contact event is guarded" },
};

/** Direct writers that run withoutForgottenPersonalData before their write (file -> number of guarded writes). */
const GUARDED_WRITERS: Record<string, number> = {
  'modules/business-events/business-event.service.ts': 2,
  'modules/key-cortex/adapters/analytics-adapter.service.ts': 1,
  'modules/key-cortex/key-cortex-event-bus.service.ts': 1,
  'modules/key-cortex/key-cortex-event.service.ts': 1,
  'modules/device/device.service.ts': 1,
};

const WRITE = /businessEvent['"]?\]?\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(|INSERT\s+INTO\s+"?business_events/gi;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('business_events direct writers census (Codex #226)', () => {
  const found: Record<string, number> = {};
  for (const file of sources(SRC)) {
    const n = (readFileSync(file, 'utf8').match(WRITE) ?? []).length;
    if (n > 0) found[path.relative(SRC, file).split(path.sep).join('/')] = n;
  }

  it('every direct writer is guarded or listed as never writing a contact event', () => {
    const expected: Record<string, number> = {};
    for (const [file, { writes }] of Object.entries(NOT_CONTACT_WRITERS)) expected[file] = (expected[file] ?? 0) + writes;
    for (const [file, writes] of Object.entries(GUARDED_WRITERS)) expected[file] = (expected[file] ?? 0) + writes;
    expect(found).toEqual(expected);
  });

  it('a guarded writer calls the shared check once per guarded write', () => {
    for (const [file, writes] of Object.entries(GUARDED_WRITERS)) {
      const text = readFileSync(path.join(SRC, file), 'utf8');
      // A call, not the declaration (`withoutForgottenPersonalData<T ...>(`).
      const calls = (text.match(/withoutForgottenPersonalData\(/g) ?? []).length;
      expect(calls, file).toBeGreaterThanOrEqual(writes);
    }
  });
});
