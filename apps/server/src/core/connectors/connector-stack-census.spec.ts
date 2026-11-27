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

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, ' ');
}

const RAW_SQL_CONNECTOR_STATUSES_RE =
  /(?:^|[^A-Za-z0-9_])(?:["`]?[A-Za-z_][A-Za-z0-9_]*["`]?\s*\.\s*)?["`]?connector_statuses["`]?(?![A-Za-z0-9_])/i;

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

  const visit = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;

    // 1. Named imports/exports or identifier references to the 3 connector stack services
    if (ts.isIdentifier(node)) {
      if (STACK_SERVICE_NAMES.has(node.text as ConnectorStackSignal)) {
        hits.add(node.text as ConnectorStackSignal);
      }
    }

    // 2. Prisma connectorStatus delegate access (., ?., ['connectorStatus'], [`connectorStatus`], destructuring)
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'connectorStatus') {
      hits.add('connectorStatus');
    } else if (ts.isElementAccessExpression(node)) {
      const key = staticPropertyKey(unwrapExpr(node.argumentExpression));
      if (key === 'connectorStatus') hits.add('connectorStatus');
    } else if (ts.isBindingElement(node)) {
      const propName = node.propertyName
        ? staticPropertyKey(node.propertyName)
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null;
      if (propName === 'connectorStatus') hits.add('connectorStatus');
    }

    // 3. Raw SQL / table reference to connector_statuses in string/template literals
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
      if (RAW_SQL_CONNECTOR_STATUSES_RE.test(stripSqlComments(rawText))) {
        hits.add('raw-sql-connector_statuses');
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Also check comment-stripped source for raw SQL table references
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

    if (cells.length < 4) {
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

const PLACEHOLDER_RE = /^(?:tbd|todo|n\/a|unknown|[-?.]+)$/i;

export interface ConnectorStackAuditResult {
  unregistered: Array<{ file: string; signals: ConnectorStackSignal[] }>;
  staleEntries: string[];
  duplicateEntries: string[];
  invalidEntries: string[];
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

  const matchedFiles = new Set<string>();
  for (const [relPath, content] of [...filesByRelPath.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const signals = detectConnectorStackSignals(content, relPath);
    if (signals.length > 0) {
      matchedFiles.add(relPath);
      if (!registeredByPath.has(relPath)) {
        unregistered.push({ file: relPath, signals });
      }
    }
  }

  for (const file of registeredByPath.keys()) {
    if (!matchedFiles.has(file)) {
      staleEntries.push(file);
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

describe('RR-CONNECTOR-STACK-CENSUS: ConnectorRegistry and KeyConnector stack ratchet', () => {
  it('registers every importer of ConnectorRegistryService / KeyConnectorService / ProviderRegistryService and every connectorStatus accessor in docs/reconstruction/CONNECTOR-STACK-CENSUS.md with zero stale or malformed entries', () => {
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
    expect(audit.malformedRows).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(0);
  });

  it('NEGATIVE CONTROLS: catches unlisted ConnectorRegistryService / KeyConnectorService / ProviderRegistryService importers and connectorStatus / raw-SQL accessors, ignores comments/JSDoc, and rejects stale/malformed/placeholder rows', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/rogue/uses-core-registry.service.ts',
        `import { ConnectorRegistryService } from '../../core/connectors/connector-registry.service';\nexport class Rogue { constructor(private readonly r: ConnectorRegistryService) {} }`,
      ],
      [
        'apps/server/src/modules/rogue/uses-key-connector.service.ts',
        `import { KeyConnectorService } from '../key-connector/key-connector.service';\nexport const ref = KeyConnectorService;`,
      ],
      [
        'apps/server/src/modules/rogue/uses-provider-registry.service.ts',
        `import { ProviderRegistryService } from '../key-connector/providers/provider-registry.service';\nexport const ref = ProviderRegistryService;`,
      ],
      [
        'apps/server/src/modules/rogue/direct-status-optional-bracket.service.ts',
        'export async function read(prisma: any) { return prisma.client?.[`connectorStatus`].findMany({}); }',
      ],
      [
        'apps/server/src/modules/rogue/destructured-status.service.ts',
        `export async function read(prisma: any) { const { connectorStatus } = prisma.client; return connectorStatus.findFirst({}); }`,
      ],
      [
        'apps/server/src/modules/rogue/raw-sql-status.service.ts',
        'export async function read(prisma: any) { return prisma.$queryRaw`SELECT * FROM /* c */ "public"."connector_statuses"`; }',
      ],
      [
        'apps/server/src/modules/clean/commented-only.service.ts',
        `/** @see ConnectorRegistryService // https://example.com */\n// import { KeyConnectorService } from 'x';\n/* prisma.client.connectorStatus.findMany({}) */\nexport const clean = true;`,
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
| \`apps/server/src/modules/clean/retired-importer.service.ts\` | core-registry | hidden in v1 | none |
| \`apps/server/src/modules/clean/retired-importer.service.ts\` | invalid-stack | TBD | N/A |
| apps/server/src/modules/clean/unbackticked.service.ts | core-registry | hidden in v1 | none |
`;

    const parsed = parseConnectorStackMarkdown(fixtureDoc);
    const audit = auditConnectorStackFiles(syntheticFiles, parsed);

    expect(audit.unregistered).toEqual([
      {
        file: 'apps/server/src/modules/rogue/destructured-status.service.ts',
        signals: ['connectorStatus'],
      },
      {
        file: 'apps/server/src/modules/rogue/direct-status-optional-bracket.service.ts',
        signals: ['connectorStatus'],
      },
      {
        file: 'apps/server/src/modules/rogue/raw-sql-status.service.ts',
        signals: ['raw-sql-connector_statuses'],
      },
      {
        file: 'apps/server/src/modules/rogue/uses-core-registry.service.ts',
        signals: ['ConnectorRegistryService'],
      },
      {
        file: 'apps/server/src/modules/rogue/uses-key-connector.service.ts',
        signals: ['KeyConnectorService'],
      },
      {
        file: 'apps/server/src/modules/rogue/uses-provider-registry.service.ts',
        signals: ['ProviderRegistryService'],
      },
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
    ]);
  });
});
