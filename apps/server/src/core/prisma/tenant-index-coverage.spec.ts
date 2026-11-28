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
 * Re-derived directly against `packages/db/prisma/schema.prisma`; adding indexes
 * ships only inside an owner-approved migration set (D-167). Remove an entry as
 * soon as its migration lands (stale entries fail CI).
 */
const ACKNOWLEDGED_UNINDEXED: Record<string, string> = {
  AiPlanResult:
    'Only declares @@index([planId]); missing businessId-led index (deferred to owner-approved migration, D-167).',
  Cohort:
    'Declares no secondary index on businessId; missing businessId-led index (deferred to owner-approved migration, D-167).',
  CommunityComment:
    'Only declares @@index([postId]) despite trash queries filtering by (businessId, deletedAt) (deferred to owner-approved migration, D-167).',
  Course:
    'Only declares @@index([category]) after joining BUSINESS_ID_MODELS; missing businessId-led index (deferred to owner-approved migration, D-167).',
  KeyInteractionFeedback:
    'Only declares @@index([sessionId, createdAt]); missing businessId-led index (deferred to owner-approved migration, D-167).',
};

/** Strips block (`/* ... *\/`) and line (`// ...`) comments while preserving double-quoted string literals. */
function stripComments(src: string): string {
  return src.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
    match.startsWith('"') ? match : '',
  );
}

function readBusinessIdModels(clientSrc: string): string[] {
  const at = clientSrc.indexOf('const BUSINESS_ID_MODELS = new Set([');
  if (at < 0) throw new Error('BUSINESS_ID_MODELS not found in packages/db/src/client.ts');
  const end = clientSrc.indexOf(']);', at);
  if (end < 0) throw new Error('BUSINESS_ID_MODELS closing ]); not found');
  const body = stripComments(clientSrc.slice(at, end));
  return [...body.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
}

function parseSchemaModelBlocks(schemaSrc: string): Map<string, string> {
  const cleaned = stripComments(schemaSrc);
  const map = new Map<string, string>();
  const re = /^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const name = m[1];
    const start = m.index + m[0].length;
    const end = cleaned.indexOf('\n}', start);
    if (end < 0) continue;
    map.set(name, cleaned.slice(start, end));
  }
  return map;
}

/** Extracts balanced argument text inside `(...)` starting at `openParenIdx`. */
function extractBalancedParens(src: string, openParenIdx: number): string {
  let depth = 0;
  let inString = false;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === '\\') {
        i++; // skip escaped character (handles both \" and \\)
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(openParenIdx + 1, i);
    }
  }
  return '';
}

/**
 * True iff the Prisma model block declares:
 *   - field-level `businessId String(?) ... @unique` or `@id`, OR
 *   - `@@index([businessId, ...])`, `@@unique([businessId, ...])`, or `@@id([businessId, ...])`
 *     (positional or named `fields:` in any argument order) where `businessId` is the FIRST column.
 */
function hasLeadingBusinessIdIndex(rawBlock: string): boolean {
  const block = stripComments(rawBlock);

  // Field-level @unique or @id on businessId (stripping quoted string literals like @map("..."))
  for (const line of block.split('\n')) {
    if (/^\s*businessId\s+String\b/.test(line)) {
      const withoutStrings = line.replace(/"(?:\\.|[^"\\])*"/g, '""');
      if (/(?:^|\s)@(?:unique|id)\b/.test(withoutStrings)) {
        return true;
      }
    }
  }

  // Model-level @@index / @@unique / @@id anchored at line start with businessId as first element of [...]
  const attrRe = /^\s*@@(?:index|unique|id)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(block))) {
    const args = extractBalancedParens(block, m.index + m[0].length - 1);
    const argsWithoutStrings = args.replace(/"(?:\\.|[^"\\])*"/g, '""');
    const fieldsMatch = /(?:^|,)\s*(?:fields\s*:\s*)?\[\s*([A-Za-z][A-Za-z0-9_]*)/.exec(argsWithoutStrings);
    if (fieldsMatch && fieldsMatch[1] === 'businessId') return true;
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
  it('real schema.prisma against BUSINESS_ID_MODELS has zero unacknowledged unindexed models, zero stale entries, and zero ghosts', () => {
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

  it('NEGATIVE CONTROLS: scanner enforces leading businessId index, strips line/block comments, handles Prisma syntax variants, and enforces shrink-only rules', () => {
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
  id         String  @id
  businessId String? @unique
}

model MultilineAndQualified {
  id         String @id
  businessId String
  @@index(
    [businessId(sort: Desc)]
  )
}

model NamedMapBeforeFields {
  id         String @id
  businessId String
  @@index(map: "idx_named_biz", fields: [businessId])
}

model EscapedBackslashMapBeforeFields {
  id         String @id
  businessId String
  @@index(map: "idx_escaped\\\\", fields: [businessId])
}

model UrlDefaultWithUniqueField {
  id         String @id
  businessId String @default("https://example.com") @unique
}

model TrailingBusinessIdOnly {
  id         String @id
  postId     String
  businessId String
  @@index([postId, businessId])
}

model PrefixCollisionOnly {
  id             String @id
  businessId     String
  businessIdHash String
  @@index([businessIdHash])
}

model LineCommentedIndex {
  id         String @id
  businessId String // @unique
  // @@index([businessId])
}

model BlockCommentedIndex {
  id         String @id
  businessId String /* @unique */
  /*
    @@index([businessId])
  */
}

model MapStringWithAtId {
  id         String @id
  businessId String @map("biz_@id")
}

model StringLiteralFakeModelIndex {
  id         String @id
  businessId String
  note       String @default("@@index([businessId])")
}
`;
    const failingModels = [
      'BlockCommentedIndex',
      'IndexedByCreatedOnly',
      'LineCommentedIndex',
      'MapStringWithAtId',
      'PrefixCollisionOnly',
      'StringLiteralFakeModelIndex',
      'TrailingBusinessIdOnly',
    ];
    const passingModels = [
      'UniqueCompound',
      'IndexedComposite',
      'UniqueField',
      'MultilineAndQualified',
      'NamedMapBeforeFields',
      'EscapedBackslashMapBeforeFields',
      'UrlDefaultWithUniqueField',
    ];

    const r1 = auditTenantIndexCoverage([...failingModels, ...passingModels], fixtureSchema, {});
    expect(r1.unacknowledgedUnindexed).toEqual(failingModels);
    expect(r1.missingFromSchema).toEqual([]);

    const r2 = auditTenantIndexCoverage(passingModels, fixtureSchema, {});
    expect(r2).toEqual({
      missingFromSchema: [],
      unacknowledgedUnindexed: [],
      staleAcknowledged: [],
      ghostAcknowledged: [],
      emptyReasons: [],
    });

    // Shrink-only: acknowledged model that gains a businessId-led index fails until removed
    const r3 = auditTenantIndexCoverage(['IndexedComposite'], fixtureSchema, {
      IndexedComposite: 'Legacy missing index before migration',
    });
    expect(r3.staleAcknowledged).toEqual(['IndexedComposite']);

    // Missing from schema.prisma fails
    const r4 = auditTenantIndexCoverage(['GhostTenantModel'], fixtureSchema, {});
    expect(r4.missingFromSchema).toEqual(['GhostTenantModel']);

    // Ghost acknowledged model and empty/short reason fail
    const r5 = auditTenantIndexCoverage(['IndexedByCreatedOnly'], fixtureSchema, {
      IndexedByCreatedOnly: 'short',
      NotInList: 'Should fail as a ghost acknowledgement entry',
    });
    expect(r5.emptyReasons).toEqual(['IndexedByCreatedOnly']);
    expect(r5.ghostAcknowledged).toEqual(['NotInList']);

    // Commented-out entry in BUSINESS_ID_MODELS is ignored by readBusinessIdModels
    const commentedClient = `
      const BUSINESS_ID_MODELS = new Set([
        'RealModel',
        // 'CommentedOutModel',
        /* 'BlockCommentedModel', */
      ]);
    `;
    expect(readBusinessIdModels(commentedClient)).toEqual(['RealModel']);
  });
});
