import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');
const CENSUS_DOC_PATH = path.join(REPO_ROOT, 'docs/reconstruction/GOAL-SYSTEM-CENSUS.md');

const SOURCE_FILE_EXT_RE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_OR_DECL_EXT_RE =
  /\.(?:spec|test|e2e-spec)\.(?:[cm]?ts|tsx|[cm]?js|jsx)$|\.d\.[cm]?ts$/;

const PRISMA_WRITE_METHOD_NAMES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const NESTED_RELATION_WRITE_OPS = new Set([
  'create',
  'createMany',
  'connectOrCreate',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'set',
]);

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Strips TypeScript/JavaScript comments using the full TypeScript parser AST
 * (`ts.createSourceFile`) while skipping `ts.isJSDoc(node)` subtrees so JSDoc
 * inner tags can never advance `cursor` past a declaration's leading trivia.
 */
export function stripCommentsPreservingStrings(
  src: string,
  filePath = 'scan.ts',
): string {
  const sf = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindForPath(filePath),
  );
  const parts: string[] = [];
  let cursor = 0;

  const visit = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    const children = node.getChildren(sf);
    if (children.length === 0) {
      const start = node.getStart(sf);
      if (node.pos >= cursor && start > node.pos) {
        const trivia = src.slice(node.pos, start);
        if (trivia.includes('//') || trivia.includes('/*')) {
          parts.push(src.slice(cursor, node.pos));
          parts.push(trivia.includes('\n') ? '\n' : ' ');
          cursor = start;
        }
      }
      return;
    }
    for (const child of children) {
      visit(child);
    }
  };
  visit(sf);

  if (cursor === 0) return src;
  parts.push(src.slice(cursor));
  return parts.join('');
}

export type GoalModelName = 'AiGoal' | 'BusinessGoal';

export interface DetectedGoalWrite {
  model: GoalModelName;
  signal: string;
}

function unwrapExpr(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function staticPropertyKey(node: ts.PropertyName | ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    return staticPropertyKey(unwrapExpr(node.expression));
  }
  return null;
}

function memberAccessName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return staticPropertyKey(unwrapExpr(node.argumentExpression));
}

function delegateModelFromExpr(
  expr: ts.Expression,
  aliases: ReadonlyMap<string, GoalModelName>,
): GoalModelName | null {
  const unwrapped = unwrapExpr(expr);
  if (ts.isIdentifier(unwrapped)) {
    return aliases.get(unwrapped.text) ?? null;
  }
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    const name = memberAccessName(unwrapped);
    if (name === 'aiGoal') return 'AiGoal';
    if (name === 'businessGoal') return 'BusinessGoal';
  }
  return null;
}

function parentDelegateName(expr: ts.Expression): string | null {
  const unwrapped = unwrapExpr(expr);
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return memberAccessName(unwrapped);
  }
  return null;
}

function objectContainsNestedWriteOp(obj: ts.ObjectLiteralExpression): boolean {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = staticPropertyKey(prop.name);
      if (key && NESTED_RELATION_WRITE_OPS.has(key)) return true;
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      if (NESTED_RELATION_WRITE_OPS.has(prop.name.text)) return true;
    }
  }
  return false;
}

function subtreeHasGoalRelationWrite(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isPropertyAssignment(n)) {
      const key = staticPropertyKey(n.name);
      if (key === 'goal') {
        const init = unwrapExpr(n.initializer);
        if (ts.isObjectLiteralExpression(init) && objectContainsNestedWriteOp(init)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, ' ');
}

function buildRawSqlPattern(table: 'ai_goals' | 'business_goals'): RegExp {
  const ident = `(?:["\`]?[A-Za-z_][A-Za-z0-9_]*["\`]?\\s*\\.\\s*)?["\`]?${table}["\`]?(?![A-Za-z0-9_])`;
  return new RegExp(
    `\\b(?:INSERT\\s+INTO|UPDATE(?:\\s+ONLY)?|DELETE\\s+FROM(?:\\s+ONLY)?|MERGE\\s+INTO|TRUNCATE(?:\\s+TABLE)?(?:\\s+ONLY)?)\\s+(?:[^;\\n]*?,\\s*)?${ident}`,
    'i',
  );
}

const RAW_SQL_PATTERNS: readonly { model: GoalModelName; label: string; re: RegExp }[] = [
  { model: 'AiGoal', label: 'raw-sql-ai_goals', re: buildRawSqlPattern('ai_goals') },
  {
    model: 'BusinessGoal',
    label: 'raw-sql-business_goals',
    re: buildRawSqlPattern('business_goals'),
  },
];

export function detectGoalWrites(
  source: string,
  filePath = 'scan.ts',
): DetectedGoalWrite[] {
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindForPath(filePath),
  );

  const hits = new Map<string, DetectedGoalWrite>();
  const addHit = (model: GoalModelName, signal: string) => {
    hits.set(`${model}::${signal}`, { model, signal });
  };

  // Track local aliases/destructured bindings to `.aiGoal` / `.businessGoal`
  const aliases = new Map<string, GoalModelName>();
  const collectAliases = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrapExpr(node.initializer);
      if (ts.isIdentifier(node.name)) {
        const directModel = delegateModelFromExpr(init, aliases);
        if (directModel) aliases.set(node.name.text, directModel);
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const propName = el.propertyName
            ? staticPropertyKey(el.propertyName)
            : ts.isIdentifier(el.name)
              ? el.name.text
              : null;
          if (propName === 'aiGoal' && ts.isIdentifier(el.name)) {
            aliases.set(el.name.text, 'AiGoal');
          } else if (propName === 'businessGoal' && ts.isIdentifier(el.name)) {
            aliases.set(el.name.text, 'BusinessGoal');
          }
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(sf);

  // AST walk for Prisma delegate writes, nested relation writes, and SQL literals
  const visit = (node: ts.Node) => {
    // 1. Prisma delegate write access (covers ., ?., !, <T>, ['create'], [`create`], aliases, .call/.apply/.bind)
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const methodName = memberAccessName(node);
      if (methodName && PRISMA_WRITE_METHOD_NAMES.has(methodName)) {
        const targetModel = delegateModelFromExpr(node.expression, aliases);
        if (targetModel) {
          addHit(
            targetModel,
            targetModel === 'AiGoal'
              ? 'prisma-delegate-aiGoal'
              : 'prisma-delegate-businessGoal',
          );
        }
      }
    }

    // 2a. Nested relation writes on Business.aiGoals / Business.businessGoals
    if (ts.isPropertyAssignment(node)) {
      const key = staticPropertyKey(node.name);
      if (key === 'aiGoals' || key === 'businessGoals') {
        const init = unwrapExpr(node.initializer);
        if (ts.isObjectLiteralExpression(init) && objectContainsNestedWriteOp(init)) {
          addHit(
            key === 'aiGoals' ? 'AiGoal' : 'BusinessGoal',
            key === 'aiGoals' ? 'nested-relation-aiGoals' : 'nested-relation-businessGoals',
          );
        }
      }
    }

    // 2b. Nested `goal: { <writeOp>: ... }` inside aiPlan / project / projectPlan writes
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpr(node.expression);
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const methodName = memberAccessName(callee);
        if (methodName && PRISMA_WRITE_METHOD_NAMES.has(methodName)) {
          const parentModel = parentDelegateName(callee.expression);
          if (
            (parentModel === 'aiPlan' ||
              parentModel === 'project' ||
              parentModel === 'projectPlan') &&
            node.arguments.some((arg) => subtreeHasGoalRelationWrite(arg))
          ) {
            const targetModel: GoalModelName =
              parentModel === 'aiPlan' ? 'AiGoal' : 'BusinessGoal';
            addHit(
              targetModel,
              parentModel === 'aiPlan'
                ? 'nested-relation-aiPlan-goal'
                : 'nested-relation-project-goal',
            );
          }
        }
      }
    }

    // 3. Raw SQL inside string/template literals (stripping inline SQL comments)
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const rawText = ts.isTemplateExpression(node)
        ? [
            node.head.text,
            ...node.templateSpans.map((span) => ` $EXPR ${span.literal.text}`),
          ].join('')
        : node.text;
      const sql = stripSqlComments(rawText);
      for (const { model, label, re } of RAW_SQL_PATTERNS) {
        if (re.test(sql)) {
          addHit(model, label);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Also check stripped source for non-literal SQL concatenation patterns
  const stripped = stripSqlComments(stripCommentsPreservingStrings(source, filePath));
  for (const { model, label, re } of RAW_SQL_PATTERNS) {
    if (re.test(stripped)) {
      addHit(model, label);
    }
  }

  return [...hits.values()].sort((a, b) =>
    `${a.model}::${a.signal}`.localeCompare(`${b.model}::${b.signal}`),
  );
}

export interface GoalWriterCensusRow {
  file: string;
  model: string;
  operations: string;
  triggerSources: string;
  recordedPrincipal: string;
}

export interface ParsedGoalCensus {
  rows: GoalWriterCensusRow[];
  malformedRows: string[];
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Parses markdown table rows under `## Writer Registry` (or the entire document
 * if no `## Writer Registry` heading is present in a minimal test fixture).
 * Malformed table rows are returned in `malformedRows` rather than silently skipped.
 */
export function parseGoalCensusMarkdown(markdown: string): ParsedGoalCensus {
  const rows: GoalWriterCensusRow[] = [];
  const malformedRows: string[] = [];

  const lines = markdown.split('\n');
  const hasRegistryHeading = lines.some((l) => /^##\s+Writer Registry\b/i.test(l.trim()));
  let inSection = !hasRegistryHeading;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (hasRegistryHeading && /^##\s+/.test(line)) {
      inSection = /^##\s+Writer Registry\b/i.test(line);
      continue;
    }
    if (!inSection || !line.startsWith('|')) continue;

    const cells = splitMarkdownRow(line);
    if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;
    if (cells[0].toLowerCase() === 'file') continue;

    if (cells.length < 5) {
      malformedRows.push(line);
      continue;
    }
    const fileMatch = /^`([^`]+)`$/.exec(cells[0]);
    if (!fileMatch) {
      malformedRows.push(line);
      continue;
    }
    rows.push({
      file: fileMatch[1],
      model: cells[1],
      operations: cells[2],
      triggerSources: cells[3],
      recordedPrincipal: cells[4],
    });
  }
  return { rows, malformedRows };
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (
      entry.isFile() &&
      SOURCE_FILE_EXT_RE.test(entry.name) &&
      !TEST_OR_DECL_EXT_RE.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

const VALID_OPERATION_TOKEN_RE =
  /\b(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany|raw-sql|nested)\b/i;
const PLACEHOLDER_RE = /^(?:tbd|todo|n\/a|unknown|[-?.]+)$/i;

export interface GoalWriterAuditResult {
  unregistered: Array<{ file: string; model: GoalModelName; signal: string }>;
  staleEntries: string[];
  duplicateEntries: string[];
  invalidEntries: string[];
  malformedRows: string[];
}

export function auditGoalWriters(
  filesByRelPath: ReadonlyMap<string, string>,
  parsed: ParsedGoalCensus,
): GoalWriterAuditResult {
  const unregistered: Array<{ file: string; model: GoalModelName; signal: string }> = [];
  const staleEntries: string[] = [];
  const duplicateEntries: string[] = [];
  const invalidEntries: string[] = [];

  const registeredKeys = new Map<string, GoalWriterCensusRow>();
  for (const row of parsed.rows) {
    const key = `${row.file}::${row.model}`;
    if (registeredKeys.has(key)) {
      duplicateEntries.push(key);
    }
    registeredKeys.set(key, row);

    const triggers = row.triggerSources.trim();
    const principal = row.recordedPrincipal.trim();
    if (
      (row.model !== 'AiGoal' && row.model !== 'BusinessGoal') ||
      !VALID_OPERATION_TOKEN_RE.test(row.operations) ||
      triggers.length < 5 ||
      PLACEHOLDER_RE.test(triggers) ||
      principal.length < 4 ||
      PLACEHOLDER_RE.test(principal)
    ) {
      invalidEntries.push(key);
    }
  }

  const detectedKeys = new Set<string>();
  for (const [relPath, content] of [...filesByRelPath.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const hits = detectGoalWrites(content, relPath);
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
    malformedRows: [...parsed.malformedRows],
  };
}

describe('RR-GOAL-WRITER-CENSUS: AiGoal and BusinessGoal writer ratchet', () => {
  it('registers every AiGoal and BusinessGoal writer in docs/reconstruction/GOAL-SYSTEM-CENSUS.md with zero stale or malformed entries', () => {
    const docText = fs.existsSync(CENSUS_DOC_PATH)
      ? fs.readFileSync(CENSUS_DOC_PATH, 'utf8')
      : '';
    const parsed = parseGoalCensusMarkdown(docText);

    const files = walkSourceFiles(SERVER_SRC_DIR);
    const sourceMap = new Map<string, string>();
    for (const fullPath of files) {
      const rel = path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/');
      sourceMap.set(rel, fs.readFileSync(fullPath, 'utf8'));
    }

    const audit = auditGoalWriters(sourceMap, parsed);

    expect(audit.unregistered).toEqual([]);
    expect(audit.staleEntries).toEqual([]);
    expect(audit.duplicateEntries).toEqual([]);
    expect(audit.invalidEntries).toEqual([]);
    expect(audit.malformedRows).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(0);
  });

  it('NEGATIVE CONTROLS: catches direct, aliased, optional-chained, nested-relation, and raw-SQL goal writers, ignores reads/comments/JSDoc, and rejects stale/malformed/placeholder rows', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/rogue/optional-and-generic.service.ts',
        `export async function mutate(prisma: any) { return prisma.client.aiGoal?.update<any>({ where: { id: '1' }, data: {} }); }`,
      ],
      [
        'apps/server/src/modules/rogue/bracket-template-and-nonnull.service.ts',
        'export async function mutate(tx: any) { return tx![`businessGoal`][`upsert`]({ where: { id: "1" }, create: {}, update: {} }); }',
      ],
      [
        'apps/server/src/modules/rogue/aliased-and-destructured.service.ts',
        `export async function mutate(prisma: any) { const { aiGoal } = prisma.client; return aiGoal.create.call(aiGoal, { data: {} }); }`,
      ],
      [
        'apps/server/src/modules/rogue/nested-business-goals.service.ts',
        `export async function mutate(prisma: any) { return prisma.client.business.update({ where: { id: 'b' }, data: { aiGoals: { create: { title: 'x' } }, businessGoals: { upsert: [] } } }); }`,
      ],
      [
        'apps/server/src/modules/rogue/nested-plan-and-project-goal.service.ts',
        `export async function mutate(prisma: any) { await prisma.client.aiPlan.create({ data: { goal: { create: { title: 'x' } } } }); return prisma.client.project.update({ where: { id: 'p' }, data: { goal: { update: { title: 'y' } } } }); }`,
      ],
      [
        'apps/server/src/modules/rogue/raw-sql-merge-and-quoted-schema.service.ts',
        'export async function mutate(prisma: any) { return prisma.$executeRaw`MERGE INTO /* c */ "public"."ai_goals" USING src ON false WHEN NOT MATCHED THEN INSERT VALUES (1)`; }',
      ],
      [
        'apps/server/src/modules/rogue/raw-sql-only-and-truncate.service.ts',
        'export async function mutate(prisma: any) { return prisma.$executeRaw`TRUNCATE TABLE ONLY ai_plans, "business_goals"`; }',
      ],
      [
        'apps/server/src/modules/clean/reader-jsdoc-and-comments.service.ts',
        `/** @param {string} x // https://example.com\n * prisma.client.aiGoal.create({ data: {} })\n */\nexport async function list(prisma: any, req: { businessGoal: string }) {\n  // prisma.client.aiGoal.create({ data: {} });\n  /* UPDATE business_goals SET status = 'paused' */\n  const label = req.businessGoal;\n  await prisma.client.project.findFirst({ include: { goal: { select: { id: true } } } });\n  return [label, await prisma.client.businessGoal.findMany({})];\n}`,
      ],
      [
        'apps/server/src/modules/clean/retired-writer.service.ts',
        `export const retired = true;`,
      ],
    ]);

    const fixtureDoc = `
## Writer Registry

| File | Model | Operations | Trigger sources | Recorded principal |
| --- | --- | --- | --- | --- |
| \`apps/server/src/modules/clean/retired-writer.service.ts\` | AiGoal | create | user route | none |
| \`apps/server/src/modules/clean/retired-writer.service.ts\` | AiGoal | noop | TBD | N/A |
| apps/server/src/modules/clean/unbackticked.service.ts | AiGoal | create | user route | none |
`;

    const parsed = parseGoalCensusMarkdown(fixtureDoc);
    const audit = auditGoalWriters(syntheticFiles, parsed);

    expect(audit.unregistered).toEqual([
      {
        file: 'apps/server/src/modules/rogue/aliased-and-destructured.service.ts',
        model: 'AiGoal',
        signal: 'prisma-delegate-aiGoal',
      },
      {
        file: 'apps/server/src/modules/rogue/bracket-template-and-nonnull.service.ts',
        model: 'BusinessGoal',
        signal: 'prisma-delegate-businessGoal',
      },
      {
        file: 'apps/server/src/modules/rogue/nested-business-goals.service.ts',
        model: 'AiGoal',
        signal: 'nested-relation-aiGoals',
      },
      {
        file: 'apps/server/src/modules/rogue/nested-business-goals.service.ts',
        model: 'BusinessGoal',
        signal: 'nested-relation-businessGoals',
      },
      {
        file: 'apps/server/src/modules/rogue/nested-plan-and-project-goal.service.ts',
        model: 'AiGoal',
        signal: 'nested-relation-aiPlan-goal',
      },
      {
        file: 'apps/server/src/modules/rogue/nested-plan-and-project-goal.service.ts',
        model: 'BusinessGoal',
        signal: 'nested-relation-project-goal',
      },
      {
        file: 'apps/server/src/modules/rogue/optional-and-generic.service.ts',
        model: 'AiGoal',
        signal: 'prisma-delegate-aiGoal',
      },
      {
        file: 'apps/server/src/modules/rogue/raw-sql-merge-and-quoted-schema.service.ts',
        model: 'AiGoal',
        signal: 'raw-sql-ai_goals',
      },
      {
        file: 'apps/server/src/modules/rogue/raw-sql-only-and-truncate.service.ts',
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
    expect(audit.malformedRows).toEqual([
      '| apps/server/src/modules/clean/unbackticked.service.ts | AiGoal | create | user route | none |',
    ]);
  });
});
