import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');
const CENSUS_DOC_PATH = path.join(REPO_ROOT, 'docs/reconstruction/GOAL-SYSTEM-CENSUS.md');

/**
 * Strips `/* ... *\/` block comments and `// ...` line comments while preserving
 * single-, double-, and backtick-quoted string literals so SQL table names
 * (`ai_goals`, `business_goals`) inside template/string literals remain visible.
 */
export function stripCommentsPreservingStrings(src: string): string {
  return src.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match) => {
      const first = match[0];
      if (first === '"' || first === "'" || first === '`') return match;
      return '';
    },
  );
}

export type GoalModelName = 'AiGoal' | 'BusinessGoal';

export interface DetectedGoalWrite {
  model: GoalModelName;
  signal: string;
}

const PRISMA_WRITE_METHODS =
  '(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)';

const GOAL_WRITE_PATTERNS: readonly { model: GoalModelName; label: string; re: RegExp }[] = [
  {
    model: 'AiGoal',
    label: 'prisma-delegate-aiGoal',
    re: new RegExp(
      `(?:\\.\\s*aiGoal|\\[\\s*['"]aiGoal['"]\\s*\\])\\s*(?:\\.\\s*${PRISMA_WRITE_METHODS}|\\[\\s*['"]${PRISMA_WRITE_METHODS}['"]\\s*\\])\\s*\\(`,
    ),
  },
  {
    model: 'BusinessGoal',
    label: 'prisma-delegate-businessGoal',
    re: new RegExp(
      `(?:\\.\\s*businessGoal|\\[\\s*['"]businessGoal['"]\\s*\\])\\s*(?:\\.\\s*${PRISMA_WRITE_METHODS}|\\[\\s*['"]${PRISMA_WRITE_METHODS}['"]\\s*\\])\\s*\\(`,
    ),
  },
  {
    model: 'AiGoal',
    label: 'raw-sql-ai_goals',
    re: /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:[A-Za-z_][A-Za-z0-9_"]*\.)?"?ai_goals"?\b/i,
  },
  {
    model: 'BusinessGoal',
    label: 'raw-sql-business_goals',
    re: /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:[A-Za-z_][A-Za-z0-9_"]*\.)?"?business_goals"?\b/i,
  },
];

export function detectGoalWrites(source: string): DetectedGoalWrite[] {
  const cleaned = stripCommentsPreservingStrings(source);
  const hits: DetectedGoalWrite[] = [];
  for (const { model, label, re } of GOAL_WRITE_PATTERNS) {
    if (re.test(cleaned)) {
      hits.push({ model, signal: label });
    }
  }
  return hits;
}

export interface GoalWriterCensusRow {
  file: string;
  model: string;
  operations: string;
  triggerSources: string;
  recordedPrincipal: string;
}

/**
 * Parses markdown table rows of the form:
 * `| \`apps/server/src/...\` | AiGoal | create, delete | ... | none |`
 */
export function parseGoalCensusMarkdown(markdown: string): GoalWriterCensusRow[] {
  const rows: GoalWriterCensusRow[] = [];
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 5) continue;
    // Skip header and separator rows
    if (/^[-:\s]+$/.test(cells[0])) continue;
    if (cells[0].toLowerCase() === 'file') continue;
    const fileMatch = /^`([^`]+)`$/.exec(cells[0]);
    if (!fileMatch) continue;
    rows.push({
      file: fileMatch[1],
      model: cells[1],
      operations: cells[2],
      triggerSources: cells[3],
      recordedPrincipal: cells[4],
    });
  }
  return rows;
}

function walkTsSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsSourceFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.e2e-spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

export interface GoalWriterAuditResult {
  unregistered: Array<{ file: string; model: GoalModelName; signal: string }>;
  staleEntries: string[];
  duplicateEntries: string[];
  invalidEntries: string[];
}

export function auditGoalWriters(
  filesByRelPath: ReadonlyMap<string, string>,
  rows: readonly GoalWriterCensusRow[],
): GoalWriterAuditResult {
  const unregistered: Array<{ file: string; model: GoalModelName; signal: string }> = [];
  const staleEntries: string[] = [];
  const duplicateEntries: string[] = [];
  const invalidEntries: string[] = [];

  const registeredKeys = new Map<string, GoalWriterCensusRow>();
  for (const row of rows) {
    const key = `${row.file}::${row.model}`;
    if (registeredKeys.has(key)) {
      duplicateEntries.push(key);
    }
    registeredKeys.set(key, row);

    if (
      (row.model !== 'AiGoal' && row.model !== 'BusinessGoal') ||
      row.operations.trim().length < 3 ||
      row.triggerSources.trim().length < 5 ||
      row.recordedPrincipal.trim().length < 4
    ) {
      invalidEntries.push(key);
    }
  }

  const detectedKeys = new Set<string>();
  for (const [relPath, content] of [...filesByRelPath.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const hits = detectGoalWrites(content);
    for (const hit of hits) {
      const key = `${relPath}::${hit.model}`;
      detectedKeys.add(key);
      if (!registeredKeys.has(key)) {
        unregistered.push({ file: relPath, model: hit.model, signal: hit.signal });
      }
    }
  }

  for (const key of registeredKeys.keys()) {
    if (!detectedKeys.has(key)) {
      staleEntries.push(key);
    }
  }

  return {
    unregistered,
    staleEntries: staleEntries.sort(),
    duplicateEntries: [...new Set(duplicateEntries)].sort(),
    invalidEntries: [...new Set(invalidEntries)].sort(),
  };
}

describe('RR-GOAL-WRITER-CENSUS: AiGoal and BusinessGoal writer ratchet', () => {
  it('registers every AiGoal and BusinessGoal writer in docs/reconstruction/GOAL-SYSTEM-CENSUS.md with zero stale entries', () => {
    const docText = fs.existsSync(CENSUS_DOC_PATH)
      ? fs.readFileSync(CENSUS_DOC_PATH, 'utf8')
      : '';
    const rows = parseGoalCensusMarkdown(docText);

    const files = walkTsSourceFiles(SERVER_SRC_DIR);
    const sourceMap = new Map<string, string>();
    for (const fullPath of files) {
      const rel = path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/');
      sourceMap.set(rel, fs.readFileSync(fullPath, 'utf8'));
    }

    const audit = auditGoalWriters(sourceMap, rows);

    expect(audit.unregistered).toEqual([]);
    expect(audit.staleEntries).toEqual([]);
    expect(audit.duplicateEntries).toEqual([]);
    expect(audit.invalidEntries).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('NEGATIVE CONTROLS: catches unregistered Prisma and raw SQL goal writers, ignores reads/comments, and rejects stale/invalid rows', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/rogue/prisma-ai-goal-writer.service.ts',
        `export async function mutate(prisma: any) { return prisma.client.aiGoal.update({ where: { id: '1' }, data: {} }); }`,
      ],
      [
        'apps/server/src/modules/rogue/prisma-biz-goal-writer.service.ts',
        `export async function mutate(tx: any) { return tx.businessGoal.upsert({ where: { id: '1' }, create: {}, update: {} }); }`,
      ],
      [
        'apps/server/src/modules/rogue/raw-sql-ai-goals.service.ts',
        'export async function mutate(prisma: any) { return prisma.$executeRaw`UPDATE "ai_goals" SET status = \'DONE\'`; }',
      ],
      [
        'apps/server/src/modules/rogue/raw-sql-business-goals.service.ts',
        'export async function mutate(prisma: any) { return prisma.$executeRaw`DELETE FROM public.business_goals WHERE id = $1`; }',
      ],
      [
        'apps/server/src/modules/clean/reader-and-comments.service.ts',
        `// prisma.client.aiGoal.create({ data: {} });\n/* UPDATE business_goals SET status = 'paused' */\nexport async function list(prisma: any) { return prisma.client.businessGoal.findMany({}); }`,
      ],
      [
        'apps/server/src/modules/clean/retired-writer.service.ts',
        `export const retired = true;`,
      ],
    ]);

    const fixtureDoc = `
| File | Model | Operations | Trigger sources | Recorded principal |
| --- | --- | --- | --- | --- |
| \`apps/server/src/modules/clean/retired-writer.service.ts\` | AiGoal | create | user route | none |
| \`apps/server/src/modules/clean/retired-writer.service.ts\` | AiGoal | x | bad | n |
`;

    const rows = parseGoalCensusMarkdown(fixtureDoc);
    const audit = auditGoalWriters(syntheticFiles, rows);

    expect(audit.unregistered).toEqual([
      {
        file: 'apps/server/src/modules/rogue/prisma-ai-goal-writer.service.ts',
        model: 'AiGoal',
        signal: 'prisma-delegate-aiGoal',
      },
      {
        file: 'apps/server/src/modules/rogue/prisma-biz-goal-writer.service.ts',
        model: 'BusinessGoal',
        signal: 'prisma-delegate-businessGoal',
      },
      {
        file: 'apps/server/src/modules/rogue/raw-sql-ai-goals.service.ts',
        model: 'AiGoal',
        signal: 'raw-sql-ai_goals',
      },
      {
        file: 'apps/server/src/modules/rogue/raw-sql-business-goals.service.ts',
        model: 'BusinessGoal',
        signal: 'raw-sql-business_goals',
      },
    ]);
    expect(audit.staleEntries).toEqual([
      'apps/server/src/modules/clean/retired-writer.service.ts::AiGoal',
    ]);
    expect(audit.duplicateEntries).toEqual([
      'apps/server/src/modules/clean/retired-writer.service.ts::AiGoal',
    ]);
    expect(audit.invalidEntries).toEqual([
      'apps/server/src/modules/clean/retired-writer.service.ts::AiGoal',
    ]);
  });
});
