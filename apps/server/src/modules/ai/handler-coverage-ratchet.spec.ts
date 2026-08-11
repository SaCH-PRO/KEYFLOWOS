/**
 * How much of the orchestrator is spoken for by a test — as a number that can
 * only go up.
 *
 * WHY THIS EXISTS
 *
 * docs/audits/KEY_EFFECTIVENESS_RATING.md lists, as its third
 * highest-leverage fix: "Test the 6,586-line orchestrator god-service — it IS
 * the product and has zero dedicated tests."
 *
 * The first half is right and the second half is not, and the difference
 * matters because "zero" is unactionable while a percentage is a backlog.
 * Measured at the time this file was written: no spec is NAMED for the
 * orchestrator, but 28 specs exercise it, and of its 282 handler cases 115 are
 * named in at least one spec. So the honest statement is 41%, not zero.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 *
 * It counts handler names that appear in ANY spec file. That is a deliberately
 * weak proxy: a tool named in a list assertion counts, even though nothing
 * calls its handler. So this number is an UPPER BOUND on real coverage, and it
 * is stated that way rather than dressed up.
 *
 * A weak measure that ratchets is still worth more than a strong measure nobody
 * runs. The floor below can only be raised, so the untested tail can shrink and
 * cannot silently grow back — which is the property the rating's "zero" was
 * reaching for.
 *
 * WHEN THIS FAILS
 *
 * Adding a tool without any spec mentioning it drops the percentage below the
 * floor and this fails, naming the handlers with no spec at all. Either write
 * the test or raise the tool's coverage some other way — but the number does
 * not quietly slide.
 *
 * Raising FLOOR_PCT when coverage improves is expected and encouraged. Lowering
 * it requires saying why, in the commit that does it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = join(__dirname, '..', '..', '..');

/**
 * Measured 2026-08-11 at 41% (115 of 282 handler cases named in some spec).
 * Set two points below to absorb ordinary churn — a tool added with its spec in
 * the same commit should never trip this, but a batch added without one will.
 */
const FLOOR_PCT = 39;

function specFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(specFiles(p));
    else if (/\.(spec|test)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function handlerNames(): string[] {
  const orch = readFileSync(join(SERVER, 'src', 'modules', 'ai', 'flow-orchestrator.service.ts'), 'utf8');
  const region = orch.slice(orch.indexOf('executeToolAction'));
  return [...new Set([...region.matchAll(/^\s*case '([a-z0-9_]+)':/gm)].map((m) => m[1]))].sort();
}

describe('orchestrator handler coverage', () => {
  const handlers = handlerNames();
  const blob = [...specFiles(join(SERVER, 'src')), ...specFiles(join(SERVER, 'test'))]
    .filter((f) => !f.endsWith('handler-coverage-ratchet.spec.ts'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  it('finds the handlers at all', () => {
    // Without this the ratchet passes trivially the day someone renames
    // executeToolAction — 0 of 0 is 100%, and the gate would congratulate it.
    expect(
      handlers.length,
      'no handler cases found — the scan broke and this gate is measuring nothing',
    ).toBeGreaterThan(200);
  });

  it('finds the specs at all', () => {
    expect(blob.length, 'no spec files were read — the gate is measuring nothing').toBeGreaterThan(100_000);
  });

  it(`at least ${FLOOR_PCT}% of handlers are named in a spec`, () => {
    const named = handlers.filter((h) => blob.includes(`'${h}'`) || blob.includes(`"${h}"`));
    const pct = Math.round((100 * named.length) / handlers.length);
    const orphans = handlers.filter((h) => !named.includes(h));

    expect(
      pct,
      `handler coverage fell to ${pct}% (${named.length}/${handlers.length}). ` +
        `${orphans.length} handlers are named in no spec. The most recently added are the ` +
        `likely cause:\n  ${orphans.slice(-15).join('\n  ')}\n\n` +
        'Add a spec that exercises the new tool, or say in the commit why the floor moved.',
    ).toBeGreaterThanOrEqual(FLOOR_PCT);
  });

  it('the floor is not set above what is actually achieved', () => {
    // A floor above the real number would fail permanently and get deleted,
    // which is how ratchets die. This keeps it honest in the other direction.
    const named = handlers.filter((h) => blob.includes(`'${h}'`) || blob.includes(`"${h}"`));
    const pct = Math.round((100 * named.length) / handlers.length);
    expect(
      FLOOR_PCT,
      `FLOOR_PCT (${FLOOR_PCT}) exceeds actual coverage (${pct}%) — the ratchet is unsatisfiable`,
    ).toBeLessThanOrEqual(pct);
  });
});
