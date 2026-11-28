import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');
const CENSUS_DOC_PATH = path.join(
  REPO_ROOT,
  'docs/reconstruction/CONNECTOR-STACK-CENSUS.md',
);

const SOURCE_FILE_EXT_RE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_OR_DECL_EXT_RE =
  /\.(?:spec|test|e2e-spec)\.(?:[cm]?ts|tsx|[cm]?js|jsx)$|\.d\.[cm]?ts$/;

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

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

export type ConnectorStackSignal =
  | 'ConnectorRegistryService'
  | 'KeyConnectorService'
  | 'ProviderRegistryService'
  | 'connectorStatus'
  | 'raw-sql-connector_statuses';

const STACK_SERVICE_NAMES = new Set<ConnectorStackSignal>([
  'ConnectorRegistryService',
  'KeyConnectorService',
  'ProviderRegistryService',
]);

const MODULE_SPECIFIER_SIGNALS: readonly {
  re: RegExp;
  signal: ConnectorStackSignal;
}[] = [
  {
    re: /(?:^|\/)connector-registry\.service(?:\.[cm]?[jt]s)?$/,
    signal: 'ConnectorRegistryService',
  },
  {
    re: /(?:^|\/)key-connector\.service(?:\.[cm]?[jt]s)?$/,
    signal: 'KeyConnectorService',
  },
  {
    re: /(?:^|\/)provider-registry\.service(?:\.[cm]?[jt]s)?$/,
    signal: 'ProviderRegistryService',
  },
];

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

/** Evaluates a static string expression (string literal, no-sub template, `+` concat, or local const string alias). */
function evalStaticString(
  expr: ts.Expression,
  stringConsts: ReadonlyMap<string, string>,
): string | null {
  const unwrapped = unwrapExpr(expr);
  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return unwrapped.text;
  }
  if (ts.isIdentifier(unwrapped)) {
    return stringConsts.get(unwrapped.text) ?? null;
  }
  if (
    ts.isBinaryExpression(unwrapped) &&
    unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = evalStaticString(unwrapped.left, stringConsts);
    const right = evalStaticString(unwrapped.right, stringConsts);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

function staticPropName(
  node: ts.PropertyName,
  stringConsts: ReadonlyMap<string, string>,
): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    return evalStaticString(node.expression, stringConsts);
  }
  return null;
}

function recordModuleSpecifier(
  specifier: string,
  hits: Set<ConnectorStackSignal>,
): void {
  for (const { re, signal } of MODULE_SPECIFIER_SIGNALS) {
    if (re.test(specifier)) hits.add(signal);
  }
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, ' ');
}

const LOWERCASE_TABLE_TOKEN_RE =
  /(?:^|[^A-Za-z0-9_])(?:["`]?[A-Za-z_][A-Za-z0-9_]*["`]?\s*\.\s*)?["`]?connector_statuses["`]?(?![A-Za-z0-9_])/;

const RAW_SQL_CONNECTOR_STATUSES_RE =
  /\b(?:FROM(?:\s+ONLY)?|JOIN|USING|TABLE|COPY|LOCK\s+TABLE|ALTER\s+TABLE|INSERT\s+INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM(?:\s+ONLY)?|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?(?:\s+ONLY)?)\s+(?:\(\s*)?(?:[^;]*?,\s*)?(?:["`]?[A-Za-z_][A-Za-z0-9_]*["`]?\s*\.\s*)?["`]?connector_statuses["`]?(?![A-Za-z0-9_])/i;

export function detectConnectorStackSignals(
  source: string,
  filePath = 'scan.ts',
): ConnectorStackSignal[] {
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindForPath(filePath),
  );
  const hits = new Set<ConnectorStackSignal>();

  // Collect local `const k = 'connectorStatus'` style string constants for indirect bracket/Reflect access
  const stringConsts = new Map<string, string>();
  const collectConsts = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const val = evalStaticString(node.initializer, stringConsts);
      if (val !== null) stringConsts.set(node.name.text, val);
    }
    ts.forEachChild(node, collectConsts);
  };
  collectConsts(sf);

  const visit = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;

    // 1a. Named identifier references to the 3 connector stack services
    if (ts.isIdentifier(node)) {
      if (STACK_SERVICE_NAMES.has(node.text as ConnectorStackSignal)) {
        hits.add(node.text as ConnectorStackSignal);
      }
    }

    // 1b. Static module specifiers (catches namespace imports, `export *`, `import = require(...)`, `import(...)` type)
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      recordModuleSpecifier(node.moduleSpecifier.text, hits);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      recordModuleSpecifier(node.moduleReference.expression.text, hits);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      recordModuleSpecifier(node.argument.literal.text, hits);
    } else if (
      (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) &&
      node.propertyName &&
      ts.isStringLiteral(node.propertyName)
    ) {
      if (STACK_SERVICE_NAMES.has(node.propertyName.text as ConnectorStackSignal)) {
        hits.add(node.propertyName.text as ConnectorStackSignal);
      }
    }

    // 1c. Dynamic `import(...)`, `require(...)`, `Reflect.get(..., 'connectorStatus')`, string-token DI `.get('ConnectorRegistryService')`
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const callee = unwrapExpr(node.expression);
      const isDynImportOrRequire =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require');
      if (isDynImportOrRequire) {
        const spec = evalStaticString(node.arguments[0], stringConsts);
        if (spec) recordModuleSpecifier(spec, hits);
      } else if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        if (
          method === 'get' &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'Reflect' &&
          node.arguments.length >= 2
        ) {
          const prop = evalStaticString(node.arguments[1], stringConsts);
          if (prop === 'connectorStatus') hits.add('connectorStatus');
          if (prop && STACK_SERVICE_NAMES.has(prop as ConnectorStackSignal)) {
            hits.add(prop as ConnectorStackSignal);
          }
        } else if (method === 'get' || method === 'resolve') {
          const token = evalStaticString(node.arguments[0], stringConsts);
          if (token && STACK_SERVICE_NAMES.has(token as ConnectorStackSignal)) {
            hits.add(token as ConnectorStackSignal);
          }
        }
      }
    }

    // 2. Prisma connectorStatus delegate access (., ?., ['connectorStatus'], [`connectorStatus`], const/concat key, destructuring)
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'connectorStatus') {
      hits.add('connectorStatus');
    } else if (ts.isElementAccessExpression(node)) {
      const key = evalStaticString(node.argumentExpression, stringConsts);
      if (key === 'connectorStatus') hits.add('connectorStatus');
      if (key && STACK_SERVICE_NAMES.has(key as ConnectorStackSignal)) {
        hits.add(key as ConnectorStackSignal);
      }
    } else if (ts.isBindingElement(node)) {
      const propName = node.propertyName
        ? staticPropName(node.propertyName, stringConsts)
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null;
      if (propName === 'connectorStatus') hits.add('connectorStatus');
      if (propName && STACK_SERVICE_NAMES.has(propName as ConnectorStackSignal)) {
        hits.add(propName as ConnectorStackSignal);
      }
    }

    // 3. Raw SQL / Prisma.raw / string-literal table references to connector_statuses
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
      if (
        LOWERCASE_TABLE_TOKEN_RE.test(sql) ||
        RAW_SQL_CONNECTOR_STATUSES_RE.test(sql)
      ) {
        hits.add('raw-sql-connector_statuses');
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Also check comment-stripped source for concatenated/multiline SQL clause references
  const stripped = stripSqlComments(stripCommentsPreservingStrings(source, filePath));
  if (RAW_SQL_CONNECTOR_STATUSES_RE.test(stripped)) {
    hits.add('raw-sql-connector_statuses');
  }

  return [...hits].sort();
}

export type ConnectorStackKind =
  | 'core-registry'
  | 'key-connector'
  | 'direct-connector-status'
  | 'mixed';

const VALID_STACK_KINDS = new Set<string>([
  'core-registry',
  'key-connector',
  'direct-connector-status',
  'mixed',
]);

export interface ConnectorStackCensusRow {
  file: string;
  stack: string;
  v1Journey: string;
  credentialRead: string;
}

export interface ParsedConnectorStackCensus {
  rows: ConnectorStackCensusRow[];
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
    if (ch === '\\' && inner[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
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

export function parseConnectorStackMarkdown(
  markdown: string,
): ParsedConnectorStackCensus {
  const rows: ConnectorStackCensusRow[] = [];
  const malformedRows: string[] = [];

  const lines = markdown.split('\n');
  const hasRegistryHeading = lines.some((l) =>
    /^##\s+Connector Stack Registry\b/i.test(l.trim()),
  );
  let inSection = !hasRegistryHeading;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (hasRegistryHeading && /^##\s+/.test(line)) {
      inSection = /^##\s+Connector Stack Registry\b/i.test(line);
      continue;
    }
    if (!inSection || !line.startsWith('|')) continue;

    const cells = splitMarkdownRow(line);
    if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;
    if (cells[0].toLowerCase() === 'file') continue;

    if (cells.length !== 4) {
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
      stack: cells[1],
      v1Journey: cells[2],
      credentialRead: cells[3],
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

const PLACEHOLDER_RE = /^(?:tbd|todo|n\/a|unknown)\b|^[-?.]+$/i;

function expectedStackForSignals(
  signals: readonly ConnectorStackSignal[],
): ConnectorStackKind {
  const hasCore = signals.includes('ConnectorRegistryService');
  const hasKey =
    signals.includes('KeyConnectorService') ||
    signals.includes('ProviderRegistryService');
  if (hasCore && hasKey) return 'mixed';
  if (hasKey) return 'key-connector';
  if (hasCore) return 'core-registry';
  return 'direct-connector-status';
}

export interface ConnectorStackAuditResult {
  unregistered: Array<{ file: string; signals: ConnectorStackSignal[] }>;
  staleEntries: string[];
  duplicateEntries: string[];
  invalidEntries: string[];
  stackMismatches: string[];
  malformedRows: string[];
}

export function auditConnectorStackFiles(
  filesByRelPath: ReadonlyMap<string, string>,
  parsed: ParsedConnectorStackCensus,
): ConnectorStackAuditResult {
  const unregistered: Array<{ file: string; signals: ConnectorStackSignal[] }> = [];
  const staleEntries: string[] = [];
  const duplicateEntries: string[] = [];
  const invalidEntries: string[] = [];
  const stackMismatches: string[] = [];

  const registeredByPath = new Map<string, ConnectorStackCensusRow>();
  for (const row of parsed.rows) {
    if (registeredByPath.has(row.file)) {
      duplicateEntries.push(row.file);
    }
    registeredByPath.set(row.file, row);

    const journey = row.v1Journey.trim();
    const cred = row.credentialRead.trim();
    if (
      !VALID_STACK_KINDS.has(row.stack) ||
      journey.length < 4 ||
      PLACEHOLDER_RE.test(journey) ||
      cred.length < 4 ||
      PLACEHOLDER_RE.test(cred)
    ) {
      invalidEntries.push(row.file);
    }
  }

  const matchedSignals = new Map<string, ConnectorStackSignal[]>();
  for (const [relPath, content] of [...filesByRelPath.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const signals = detectConnectorStackSignals(content, relPath);
    if (signals.length > 0) {
      matchedSignals.set(relPath, signals);
      const row = registeredByPath.get(relPath);
      if (!row) {
        unregistered.push({ file: relPath, signals });
      } else if (VALID_STACK_KINDS.has(row.stack)) {
        const expected = expectedStackForSignals(signals);
        if (row.stack !== expected) {
          stackMismatches.push(
            `${relPath}: registered stack "${row.stack}" does not match detected signals [${signals.join(', ')}] (expected "${expected}")`,
          );
        }
      }
    }
  }

  for (const file of registeredByPath.keys()) {
    if (!matchedSignals.has(file)) {
      staleEntries.push(file);
    }
  }

  return {
    unregistered,
    staleEntries: staleEntries.sort(),
    duplicateEntries: [...new Set(duplicateEntries)].sort(),
    invalidEntries: [...new Set(invalidEntries)].sort(),
    stackMismatches: stackMismatches.sort(),
    malformedRows: [...parsed.malformedRows],
  };
}

describe('RR-CONNECTOR-STACK-CENSUS: ConnectorRegistry and KeyConnector stack ratchet', () => {
  it('registers every importer of ConnectorRegistryService / KeyConnectorService / ProviderRegistryService and every connectorStatus accessor in docs/reconstruction/CONNECTOR-STACK-CENSUS.md with zero stale, mismatched, or malformed entries', () => {
    const docText = fs.existsSync(CENSUS_DOC_PATH)
      ? fs.readFileSync(CENSUS_DOC_PATH, 'utf8')
      : '';
    const parsed = parseConnectorStackMarkdown(docText);

    const files = walkSourceFiles(SERVER_SRC_DIR);
    const sourceMap = new Map<string, string>();
    for (const fullPath of files) {
      const rel = path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/');
      sourceMap.set(rel, fs.readFileSync(fullPath, 'utf8'));
    }

    const audit = auditConnectorStackFiles(sourceMap, parsed);

    expect(audit.unregistered).toEqual([]);
    expect(audit.staleEntries).toEqual([]);
    expect(audit.duplicateEntries).toEqual([]);
    expect(audit.invalidEntries).toEqual([]);
    expect(audit.stackMismatches).toEqual([]);
    expect(audit.malformedRows).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(0);
  });

  it('NEGATIVE CONTROLS: catches direct, namespace, dynamic import/require, re-export, indirect connectorStatus, and raw-SQL variants; ignores CONNECTOR_STATUSES constant and comments; rejects stale, mismatched, malformed, and placeholder rows', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/rogue/namespace-and-reexport.service.ts',
        `import * as reg from '../../core/connectors/connector-registry.service';\nexport const S = Object.values(reg)[0];`,
      ],
      [
        'apps/server/src/modules/rogue/wildcard-reexport.service.ts',
        `export * from '../key-connector/key-connector.service';`,
      ],
      [
        'apps/server/src/modules/rogue/dynamic-import-and-require.service.ts',
        `export async function load() { const a = await import('../key-connector/providers/provider-registry.service'); return a; }`,
      ],
      [
        'apps/server/src/modules/rogue/string-token-di.service.ts',
        `export function lookup(ref: any) { return ref.get('ConnectorRegistryService'); }`,
      ],
      [
        'apps/server/src/modules/rogue/indirect-status-alias-and-reflect.service.ts',
        `export function read(prisma: any) { const k = 'connector' + 'Status'; return Reflect.get(prisma.client, k); }`,
      ],
      [
        'apps/server/src/modules/rogue/raw-sql-prisma-raw-and-using.service.ts',
        'export async function read(prisma: any, Prisma: any) { await prisma.$queryRaw`SELECT * FROM ${Prisma.raw("connector_statuses")}`; return prisma.$executeRaw`DELETE FROM foo USING\n  "public"."connector_statuses"`; }',
      ],
      [
        'apps/server/src/modules/clean/mislabeled-stack.service.ts',
        `import { KeyConnectorService } from '../key-connector/key-connector.service';\nexport const ref = KeyConnectorService;`,
      ],
      [
        'apps/server/src/modules/clean/const-and-comments.service.ts',
        `/** @see ConnectorRegistryService // https://example.com\n * SELECT * FROM connector_statuses\n */\n// import { KeyConnectorService } from 'x';\n/* SELECT * FROM connector_statuses */\nexport const CONNECTOR_STATUSES = ['connected'] as const;\nexport function idx(obj: Record<string, unknown>, connectorStatus: string) { return obj[connectorStatus]; }`,
      ],
      [
        'apps/server/src/modules/clean/retired-importer.service.ts',
        `export const migrated = true;`,
      ],
    ]);

    const fixtureDoc = `
## Connector Stack Registry

| File | Stack | V1 Journey | Credential Read |
| --- | --- | --- | --- |
| \`apps/server/src/modules/clean/mislabeled-stack.service.ts\` | core-registry | Journey K | none |
| \`apps/server/src/modules/clean/retired-importer.service.ts\` | core-registry | hidden in v1 | none |
| \`apps/server/src/modules/clean/retired-importer.service.ts\` | invalid-stack | TODO: fill | N/A (later) |
| apps/server/src/modules/clean/unbackticked.service.ts | core-registry | hidden in v1 | none |
| \`apps/server/src/modules/clean/extra-pipe.service.ts\` | core-registry | hidden | extra | none |
`;

    const parsed = parseConnectorStackMarkdown(fixtureDoc);
    const audit = auditConnectorStackFiles(syntheticFiles, parsed);

    expect(audit.unregistered).toEqual([
      {
        file: 'apps/server/src/modules/rogue/dynamic-import-and-require.service.ts',
        signals: ['ProviderRegistryService'],
      },
      {
        file: 'apps/server/src/modules/rogue/indirect-status-alias-and-reflect.service.ts',
        signals: ['connectorStatus'],
      },
      {
        file: 'apps/server/src/modules/rogue/namespace-and-reexport.service.ts',
        signals: ['ConnectorRegistryService'],
      },
      {
        file: 'apps/server/src/modules/rogue/raw-sql-prisma-raw-and-using.service.ts',
        signals: ['raw-sql-connector_statuses'],
      },
      {
        file: 'apps/server/src/modules/rogue/string-token-di.service.ts',
        signals: ['ConnectorRegistryService'],
      },
      {
        file: 'apps/server/src/modules/rogue/wildcard-reexport.service.ts',
        signals: ['KeyConnectorService'],
      },
    ]);
    expect(audit.stackMismatches).toEqual([
      'apps/server/src/modules/clean/mislabeled-stack.service.ts: registered stack "core-registry" does not match detected signals [KeyConnectorService] (expected "key-connector")',
    ]);
    expect(audit.staleEntries).toEqual([
      'apps/server/src/modules/clean/retired-importer.service.ts',
    ]);
    expect(audit.duplicateEntries).toEqual([
      'apps/server/src/modules/clean/retired-importer.service.ts',
    ]);
    expect(audit.invalidEntries).toEqual([
      'apps/server/src/modules/clean/retired-importer.service.ts',
    ]);
    expect(audit.malformedRows).toEqual([
      '| apps/server/src/modules/clean/unbackticked.service.ts | core-registry | hidden in v1 | none |',
      '| `apps/server/src/modules/clean/extra-pipe.service.ts` | core-registry | hidden | extra | none |',
    ]);
  });
});
