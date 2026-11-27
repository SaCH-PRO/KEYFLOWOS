/**
 * RR-INDEX-COVERAGE-REPORT (REC-INDEX-COVERAGE, first safe static slice; D-167):
 *
 * Every tenant model listed in `BUSINESS_ID_MODELS` (`packages/db/src/client.ts`)
 * must declare an index, unique constraint, or primary key whose LEADING column
 * is `businessId` (`@@index([businessId, ...])`, `@@unique([businessId, ...])`,
 * `@@id([businessId, ...])`, or `businessId String @unique` / `@id`), OR be
 * explicitly acknowledged in the shrink-only ledger `ACKNOWLEDGED_UNINDEXED`.
 *
 * Shrink-only discipline:
 *   - Any unindexed tenant model missing from `ACKNOWLEDGED_UNINDEXED` fails CI.
 *   - Any acknowledged model that gains a `businessId`-led index fails CI until
 *     removed from `ACKNOWLEDGED_UNINDEXED`.
 *   - Any ghost entry not in `BUSINESS_ID_MODELS` or missing from `schema.prisma`
 *     fails CI.
 *
 * Schema migrations adding missing indexes ship only inside an owner-approved
 * migration set (D-167); this packet reads `schema.prisma` read-only.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const CLIENT_PATH = path.join(ROOT, 'packages', 'db', 'src', 'client.ts');
const SCHEMA_PATH = path.join(ROOT, 'packages', 'db', 'prisma', 'schema.prisma');

/**
 * Shrink-only ledger of `BUSINESS_ID_MODELS` lacking a `businessId`-led index.
 * RED commit starts empty to expose every currently unindexed tenant model.
 */
const ACKNOWLEDGED_UNINDEXED: Record<string, string> = {};

function readBusinessIdModels(clientSrc: string): string[] {
  const at = clientSrc.indexOf('const BUSINESS_ID_MODELS = new Set([');
  if (at < 0) throw new Error('BUSINESS_ID_MODELS not found in packages/db/src/client.ts');
  const end = clientSrc.indexOf(']);', at);
  if (end < 0) throw new Error('BUSINESS_ID_MODELS closing ]); not found');
  const body = clientSrc.slice(at, end);
  return [...body.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
}

function parseSchemaModelBlocks(schemaSrc: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schemaSrc))) {
    const name = m[1];
    const start = m.index + m[0].length;
    const end = schemaSrc.indexOf('\n}', start);
    if (end < 0) continue;
    map.set(name, schemaSrc.slice(start, end));
  }
  return map;
}

/** Strips single-line `//` comments from a Prisma model body before parsing attributes. */
function stripLineComments(block: string): string {
  return block
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * True iff the Prisma model block declares:
 *   - field-level `businessId String ... @unique` or `@id`, OR
 *   - `@@index([businessId, ...])`, `@@unique([businessId, ...])`, or `@@id([businessId, ...])`
 *     where `businessId` is the FIRST indexed column (with optional sort/length/ops qualifiers).
 */
function hasLeadingBusinessIdIndex(rawBlock: string): boolean {
  const block = stripLineComments(rawBlock);

  // Field-level @unique or @id on businessId
  for (const line of block.split('\n')) {
    if (/^\s*businessId\s+String\b/.test(line) && /@(?:unique|id)\b/.test(line)) {
      return true;
    }
  }

  // Model-level @@index / @@unique / @@id with businessId as first element of [...]
  const attrRe = /@@(?:index|unique|id)\s*\(\s*(?:fields\s*:\s*)?\[\s*([A-Za-z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(block))) {
    if (m[1] === 'businessId') return true;
  }

  return false;
}

interface IndexCoverageAudit {
  missingFromSchema: string[];
  unacknowledgedUnindexed: string[];
  staleAcknowledged: string[];
  ghostAcknowledged: string[];
  emptyReasons: string[];
}

function auditTenantIndexCoverage(
  businessIdModels: readonly string[],
  schemaSrc: string,
  acknowledged: Record<string, string>,
): IndexCoverageAudit {
  const blocks = parseSchemaModelBlocks(schemaSrc);
  const listedSet = new Set(businessIdModels);
  const missingFromSchema: string[] = [];
  const unacknowledgedUnindexed: string[] = [];
  const staleAcknowledged: string[] = [];
  const ghostAcknowledged: string[] = [];
  const emptyReasons: string[] = [];

  for (const model of businessIdModels) {
    const block = blocks.get(model);
    if (block === undefined) {
      missingFromSchema.push(model);
      continue;
    }
    const indexed = hasLeadingBusinessIdIndex(block);
    const isAck = Object.prototype.hasOwnProperty.call(acknowledged, model);
    if (!indexed && !isAck) {
      unacknowledgedUnindexed.push(model);
    } else if (indexed && isAck) {
      staleAcknowledged.push(model);
    }
  }

  for (const [model, reason] of Object.entries(acknowledged)) {
    if (!listedSet.has(model) || !blocks.has(model)) {
      ghostAcknowledged.push(model);
    } else if (typeof reason !== 'string' || reason.trim().length < 10) {
      emptyReasons.push(model);
    }
  }

  return {
    missingFromSchema: missingFromSchema.sort(),
    unacknowledgedUnindexed: unacknowledgedUnindexed.sort(),
    staleAcknowledged: staleAcknowledged.sort(),
    ghostAcknowledged: ghostAcknowledged.sort(),
    emptyReasons: emptyReasons.sort(),
  };
}

describe('RR-INDEX-COVERAGE-REPORT: every BUSINESS_ID_MODELS table has a businessId-led index or shrink-only acknowledgement', () => {
  it('RED-BEFORE: real schema.prisma against BUSINESS_ID_MODELS has zero unacknowledged unindexed models, zero stale entries, and zero ghosts', () => {
    const clientSrc = fs.readFileSync(CLIENT_PATH, 'utf8');
    const schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const models = readBusinessIdModels(clientSrc);
    expect(models.length).toBeGreaterThan(20);

    const audit = auditTenantIndexCoverage(models, schemaSrc, ACKNOWLEDGED_UNINDEXED);
    expect(audit.missingFromSchema, 'BUSINESS_ID_MODELS missing from schema.prisma').toEqual([]);
    expect(audit.unacknowledgedUnindexed, 'tenant models lacking a businessId-led index').toEqual([]);
    expect(audit.staleAcknowledged, 'acknowledged models that now have a businessId-led index (shrink list!)').toEqual([]);
    expect(audit.ghostAcknowledged, 'acknowledged models not in BUSINESS_ID_MODELS / schema.prisma').toEqual([]);
    expect(audit.emptyReasons, 'acknowledged entries with missing/short reasons').toEqual([]);
  });

  it('NEGATIVE CONTROLS: scanner enforces leading businessId index, accepts @@unique/@@index/@unique, catches stale acks and missing schema models', () => {
    const fixtureSchema = `
model IndexedByCreatedOnly {
  id         String   @id
  businessId String
  createdAt  DateTime
  @@index([createdAt])
}

model UniqueCompound {
  id         String @id
  businessId String
  code       String
  @@unique([businessId, code])
}

model IndexedComposite {
  id         String    @id
  businessId String
  deletedAt  DateTime?
  @@index([businessId, deletedAt])
}

model UniqueField {
  id         String @id
  businessId String @unique
}

model TrailingBusinessIdOnly {
  id         String @id
  postId     String
  businessId String
  @@index([postId, businessId])
}
`;
    // Model with only [createdAt] or trailing [postId, businessId] fails when unacknowledged
    const r1 = auditTenantIndexCoverage(
      ['IndexedByCreatedOnly', 'UniqueCompound', 'IndexedComposite', 'UniqueField', 'TrailingBusinessIdOnly'],
      fixtureSchema,
      {},
    );
    expect(r1.unacknowledgedUnindexed).toEqual(['IndexedByCreatedOnly', 'TrailingBusinessIdOnly']);
    expect(r1.missingFromSchema).toEqual([]);

    // @@unique([businessId, code]), @@index([businessId, deletedAt]), and field @unique pass cleanly
    const r2 = auditTenantIndexCoverage(['UniqueCompound', 'IndexedComposite', 'UniqueField'], fixtureSchema, {});
    expect(r2).toEqual({
      missingFromSchema: [],
      unacknowledgedUnindexed: [],
      staleAcknowledged: [],
      ghostAcknowledged: [],
      emptyReasons: [],
    });

    // An acknowledged model that gains a businessId-led index fails until removed (shrink-only)
    const r3 = auditTenantIndexCoverage(['IndexedComposite'], fixtureSchema, {
      IndexedComposite: 'Legacy missing index before migration',
    });
    expect(r3.staleAcknowledged).toEqual(['IndexedComposite']);

    // A BUSINESS_ID_MODELS entry missing from schema.prisma fails
    const r4 = auditTenantIndexCoverage(['GhostTenantModel'], fixtureSchema, {});
    expect(r4.missingFromSchema).toEqual(['GhostTenantModel']);
  });
});
