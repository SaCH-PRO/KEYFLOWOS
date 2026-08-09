/**
 * An integration test may not clean up a soft-deleted model with deleteMany.
 *
 * packages/db/src/client.ts:19-34 registers fifteen models with the soft-delete
 * extension. For those, `deleteMany` is rewritten into an UPDATE that sets
 * deletedAt. The call succeeds, returns a count, and the row stays in the table.
 *
 * In application code that is the entire point. In a fixture teardown it is a
 * trap with a delayed fuse:
 *
 *   1. afterAll "deletes" the business. It reports success. The row remains.
 *   2. The next run's seed upserts the same id and MATCHES that surviving row.
 *   3. An upsert whose `update` clause is empty leaves deletedAt set, so the
 *      seed silently does nothing.
 *   4. Every assertion afterwards fails against an invisible row, for a reason
 *      that has nothing to do with the code under test.
 *
 * The first run passes. The second does not. Whoever hits it debugs the service.
 *
 * FOUND, NOT THEORISED. Two suites had it, and the evidence was sitting in the
 * database: `zz_ctxv2_biz`, `zz_tse_bizA` and `zz_tse_bizB` were all still in
 * `businesses` with deleted_at set, after their teardowns had reported success.
 * Ten other integration suites already clean up with raw SQL, which runs
 * underneath the extension — so the correct pattern was already the house
 * majority and these two were the exception.
 *
 * The rule is narrow on purpose: only the fifteen soft-deleted models, only in
 * test files. deleteMany on anything else is a real delete and is fine.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const SERVER = join(__dirname, '..', '..', '..');

/**
 * The models registered with softDelete() in packages/db/src/client.ts.
 *
 * Read from source rather than duplicated, so adding a model to the extension
 * automatically widens this gate instead of quietly outdating it.
 */
function softDeletedModels(): string[] {
  const client = readFileSync(
    join(SERVER, '..', '..', 'packages', 'db', 'src', 'client.ts'),
    'utf8',
  );
  const block = client.slice(client.indexOf('softDelete(['), client.indexOf(']', client.indexOf('softDelete([')));
  return [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** Every test file under apps/server. */
function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'dist') return [];
    const p = join(dir, e.name);
    if (e.isDirectory()) return testFiles(p);
    return /\.(spec|test)\.ts$/.test(e.name) ? [p] : [];
  });
}

/** `db.business.deleteMany` / `prisma.client.contact.deleteMany` etc. */
function offendingCalls(): Array<{ file: string; line: number; model: string }> {
  const models = new Set(softDeletedModels().map((m) => m[0].toLowerCase() + m.slice(1)));
  const found: Array<{ file: string; line: number; model: string }> = [];

  for (const file of [...testFiles(join(SERVER, 'src')), ...testFiles(join(SERVER, 'test'))]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\.(\w+)\.deleteMany\s*\(/g)) {
      if (!models.has(m[1])) continue;
      found.push({
        file: file.slice(SERVER.length + 1).split(sep).join('/'),
        line: src.slice(0, m.index).split('\n').length,
        model: m[1],
      });
    }
  }
  return found;
}

describe('a fixture cleans up for real', () => {
  it('knows which models are soft-deleted', () => {
    // If this list ever reads empty the gate below passes trivially — the
    // shape of failure this whole exercise has been about.
    const models = softDeletedModels();
    expect(
      models.length,
      'could not read the softDelete() model list from packages/db/src/client.ts — ' +
        'the gate is now measuring nothing',
    ).toBeGreaterThan(5);
    expect(models).toContain('Business');
  });

  it('no test deletes a soft-deleted model with deleteMany', () => {
    const offenders = offendingCalls();

    expect(
      offenders.map((o) => `${o.file}:${o.line} ${o.model}.deleteMany`),
      'deleteMany on a soft-deleted model is rewritten into an UPDATE setting ' +
        'deletedAt. The teardown will report success and leave the row, the next ' +
        "run's upsert will match it, and the seed will silently do nothing from " +
        'the second run onward. Use raw SQL — `db.$executeRawUnsafe("DELETE FROM ' +
        '<table> WHERE ...")` — which runs underneath the extension, as the other ' +
        'integration suites here do.',
    ).toEqual([]);
  });
});
