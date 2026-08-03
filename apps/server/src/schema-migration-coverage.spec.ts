/**
 * The migrations directory must actually be able to build the database.
 *
 * Two independent defects were found on 2026-08-03, both of which had been
 * present for months while every check that existed reported green. Neither
 * needs a database to detect, which is the point of this file.
 *
 *   COVERAGE — schema.prisma had 29 models that NO migration created, among
 *   them helpdesk_tickets and cortex_action_logs, tables that live code
 *   queries. Environments were kept in sync with `prisma db push`, which
 *   writes no migration, so the gap never surfaced.
 *
 *   ORDER — migrations apply in lexicographic order of directory name.
 *   `20250626_add_key_connector_fields` sorted FIRST and did
 *   `ALTER TABLE "integration_connections"`, a table created five months later
 *   by `20251128000000_baseline_full_schema`. On a virgin database
 *   `prisma migrate deploy` died on migration 1 of 19 with 42P01 and produced
 *   exactly one table. The migration is written with `ADD COLUMN IF NOT EXISTS`
 *   throughout, which is why it read as safe — that guards the COLUMN, not the
 *   TABLE.
 *
 * Both are the same underlying failure: the migration history was never
 * replayed from empty, so nothing ever asked whether it could be.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PRISMA_DIR = join(__dirname, '..', '..', '..', 'packages', 'db', 'prisma');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');

/** Migration folders in the order postgres will actually apply them. */
function migrationsInApplyOrder(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => ({ name, file: join(MIGRATIONS_DIR, name, 'migration.sql') }))
    .filter((m) => existsSync(m.file))
    .map((m) => ({ name: m.name, sql: readFileSync(m.file, 'utf8') }));
}

/** SQL with comments and string literals removed, so we never match prose. */
function codeOnly(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Table name for every model in schema.prisma. Prisma uses the model name
 * verbatim unless the block carries an `@@map`.
 */
function modelTables(): Map<string, string> {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
  const out = new Map<string, string>();
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const m of schema.matchAll(modelRe)) {
    const [, model, body] = m;
    const mapped = body.match(/^\s*@@map\("([^"]+)"\)/m);
    out.set(model, mapped ? mapped[1] : model);
  }
  return out;
}

function tablesCreatedBy(sql: string): string[] {
  return [
    ...codeOnly(sql).matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi),
  ].map((m) => m[1]);
}

describe('every model can actually be created', () => {
  it('has a CREATE TABLE for each model in schema.prisma', () => {
    const created = new Set(
      migrationsInApplyOrder().flatMap((m) => tablesCreatedBy(m.sql)),
    );
    const missing = [...modelTables()]
      .filter(([, table]) => !created.has(table))
      .map(([model, table]) => `${model} -> ${table}`);

    // 29 models used to fail this, including tables live code reads.
    expect(missing).toEqual([]);
  });

  it('parsed a realistic number of models, so a broken regex cannot pass it', () => {
    // The original count of "11 tables created by migrations" was wrong by 393
    // because the extraction silently collapsed. An assertion that reads zero
    // models would trivially satisfy the test above.
    expect(modelTables().size).toBeGreaterThan(400);
  });
});

describe('the history replays from empty', () => {
  it('never touches a table before some earlier migration creates it', () => {
    const seen = new Set<string>();
    const violations: string[] = [];

    for (const { name, sql } of migrationsInApplyOrder()) {
      const code = codeOnly(sql);

      // Everything this migration creates counts as available to itself:
      // ordering within one file is postgres's problem, not the sequence's.
      for (const t of tablesCreatedBy(sql)) seen.add(t);

      const touched = [
        ...code.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?"([^"]+)"/gi),
        ...code.matchAll(
          /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?"[^"]+"\s+ON\s+"([^"]+)"/gi,
        ),
      ].map((m) => m[1]);

      for (const t of touched) {
        if (!seen.has(t)) violations.push(`${name} touches "${t}" before it exists`);
      }
    }

    // This is the exact shape of the 42P01 that made migrate deploy unusable.
    expect(violations).toEqual([]);
  });

  it('found migrations to check, so an empty directory cannot pass', () => {
    expect(migrationsInApplyOrder().length).toBeGreaterThan(0);
  });
});
