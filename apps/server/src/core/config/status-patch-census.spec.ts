import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export type StatusPatchMode =
  | 'TRANSITION_CHECKED'
  | 'DECISION_REFUSED'
  | 'FREE_LABEL'
  | 'OPEN';

export interface StatusPatchCensusEntry {
  /** Path relative to repo root (`apps/server/src/...`). */
  readonly file: string;
  /** DTO class, interface, or type alias name (`Update*Dto`). */
  readonly dtoName: string;
  /** Status/stage field names declared on this DTO. */
  readonly fields: readonly ('status' | 'stage')[];
  /** Enforcement mode for status mutations through this DTO. */
  readonly mode: StatusPatchMode;
  /** Rationale, guard summary, or tracking packet/owner-question for OPEN rows. */
  readonly reason: string;
  /** Required for TRANSITION_CHECKED and DECISION_REFUSED: repo-relative path to proving spec. */
  readonly specFile?: string;
  /** Required for TRANSITION_CHECKED and DECISION_REFUSED: exact test case title inside specFile. */
  readonly specCaseTitle?: string;
}

/** Intentionally empty in the pure tests-only RED commit. */
const STATUS_PATCH_CENSUS: readonly StatusPatchCensusEntry[] = [];

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');

const SOURCE_FILE_EXT_RE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_OR_DECL_EXT_RE =
  /\.(?:spec|test|e2e-spec)\.(?:[cm]?ts|tsx|[cm]?js|jsx)$|\.d\.[cm]?ts$/;

const UPDATE_DTO_NAME_RE = /^Update[A-Za-z0-9_]*Dto$/;
const STATUS_FIELD_NAMES = new Set<'status' | 'stage'>(['status', 'stage']);
const VALID_MODES = new Set<StatusPatchMode>([
  'TRANSITION_CHECKED',
  'DECISION_REFUSED',
  'FREE_LABEL',
  'OPEN',
]);

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function staticPropName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return null;
}

export interface DiscoveredStatusDto {
  file: string;
  dtoName: string;
  fields: ('status' | 'stage')[];
}

function collectStatusFieldsFromMembers(
  members: ts.NodeArray<ts.ClassElement> | ts.NodeArray<ts.TypeElement>,
): ('status' | 'stage')[] {
  const fields = new Set<'status' | 'stage'>();
  for (const m of members) {
    if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) {
      const prop = staticPropName(m.name);
      if (prop && STATUS_FIELD_NAMES.has(prop as 'status' | 'stage')) {
        fields.add(prop as 'status' | 'stage');
      }
    }
  }
  return [...fields].sort();
}

function collectStatusFieldsFromTypeNode(node: ts.TypeNode): ('status' | 'stage')[] {
  const fields = new Set<'status' | 'stage'>();
  const walk = (t: ts.TypeNode) => {
    if (ts.isTypeLiteralNode(t)) {
      for (const f of collectStatusFieldsFromMembers(t.members)) fields.add(f);
    } else if (ts.isIntersectionTypeNode(t) || ts.isUnionTypeNode(t)) {
      for (const part of t.types) walk(part);
    } else if (ts.isParenthesizedTypeNode(t)) {
      walk(t.type);
    } else if (ts.isTypeReferenceNode(t) && t.typeArguments) {
      for (const arg of t.typeArguments) walk(arg);
    }
  };
  walk(node);
  return [...fields].sort();
}

export function scanUpdateDtosWithStatus(
  source: string,
  relPath: string,
): DiscoveredStatusDto[] {
  const sf = ts.createSourceFile(
    relPath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindForPath(relPath),
  );
  const out: DiscoveredStatusDto[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (
      (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.name &&
      UPDATE_DTO_NAME_RE.test(node.name.text)
    ) {
      const fields = collectStatusFieldsFromMembers(node.members);
      if (fields.length > 0) {
        out.push({ file: relPath, dtoName: node.name.text, fields });
      }
    } else if (
      ts.isTypeAliasDeclaration(node) &&
      UPDATE_DTO_NAME_RE.test(node.name.text)
    ) {
      const fields = collectStatusFieldsFromTypeNode(node.type);
      if (fields.length > 0) {
        out.push({ file: relPath, dtoName: node.name.text, fields });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return out.sort((a, b) => a.dtoName.localeCompare(b.dtoName));
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

/**
 * Verifies that `specContent` contains an `it(...)` or `test(...)` call whose
 * first argument is a static string/no-substitution template literal matching
 * `expectedTitle` verbatim.
 */
export function specContainsTestCase(
  specContent: string,
  expectedTitle: string,
  filePath = 'check.spec.ts',
): boolean {
  const sf = ts.createSourceFile(
    filePath,
    specContent,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindForPath(filePath),
  );
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const expr = node.expression;
      const callee = ts.isIdentifier(expr)
        ? expr.text
        : ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)
          ? expr.expression.text
          : null;
      if (callee === 'it' || callee === 'test') {
        const firstArg = node.arguments[0];
        if (
          (ts.isStringLiteral(firstArg) ||
            ts.isNoSubstitutionTemplateLiteral(firstArg)) &&
          firstArg.text === expectedTitle
        ) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export interface StatusPatchAuditResult {
  unregistered: DiscoveredStatusDto[];
  staleEntries: string[];
  duplicateEntries: string[];
  fieldMismatches: string[];
  invalidEntries: string[];
  missingEvidence: string[];
}

export function auditStatusPatchDtos(
  filesByRelPath: ReadonlyMap<string, string>,
  registry: readonly StatusPatchCensusEntry[],
  readSpecFile: (repoRelPath: string) => string | null,
): StatusPatchAuditResult {
  const unregistered: DiscoveredStatusDto[] = [];
  const staleEntries: string[] = [];
  const duplicateEntries: string[] = [];
  const fieldMismatches: string[] = [];
  const invalidEntries: string[] = [];
  const missingEvidence: string[] = [];

  const registeredByKey = new Map<string, StatusPatchCensusEntry>();
  for (const entry of registry) {
    const key = `${entry.file}#${entry.dtoName}`;
    if (registeredByKey.has(key)) {
      duplicateEntries.push(key);
    }
    registeredByKey.set(key, entry);

    if (
      !VALID_MODES.has(entry.mode) ||
      entry.reason.trim().length < 15 ||
      entry.fields.length === 0
    ) {
      invalidEntries.push(key);
    }

    if (entry.mode === 'TRANSITION_CHECKED' || entry.mode === 'DECISION_REFUSED') {
      if (!entry.specFile || !entry.specCaseTitle) {
        missingEvidence.push(`${key}: missing specFile or specCaseTitle`);
      } else {
        const specSrc = readSpecFile(entry.specFile);
        if (specSrc === null) {
          missingEvidence.push(`${key}: specFile not found (${entry.specFile})`);
        } else if (!specContainsTestCase(specSrc, entry.specCaseTitle, entry.specFile)) {
          missingEvidence.push(
            `${key}: test case not found in ${entry.specFile}: ${entry.specCaseTitle}`,
          );
        }
      }
    }
  }

  const discoveredKeys = new Set<string>();
  for (const [relPath, content] of [...filesByRelPath.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const dtos = scanUpdateDtosWithStatus(content, relPath);
    for (const dto of dtos) {
      const key = `${dto.file}#${dto.dtoName}`;
      discoveredKeys.add(key);
      const entry = registeredByKey.get(key);
      if (!entry) {
        unregistered.push(dto);
      } else {
        const expectedFields = [...entry.fields].sort();
        if (expectedFields.join(',') !== dto.fields.join(',')) {
          fieldMismatches.push(
            `${key}: expected [${expectedFields.join(',')}], got [${dto.fields.join(',')}]`,
          );
        }
      }
    }
  }

  for (const key of registeredByKey.keys()) {
    if (!discoveredKeys.has(key)) {
      staleEntries.push(key);
    }
  }

  return {
    unregistered,
    staleEntries: staleEntries.sort(),
    duplicateEntries: [...new Set(duplicateEntries)].sort(),
    fieldMismatches: fieldMismatches.sort(),
    invalidEntries: [...new Set(invalidEntries)].sort(),
    missingEvidence: missingEvidence.sort(),
  };
}

describe('RR-STATUS-PATCH-CENSUS: generic Update*Dto lifecycle status ratchet', () => {
  it('registers every Update*Dto accepting status or stage with verified proof evidence and zero drift', () => {
    const files = walkSourceFiles(SERVER_SRC_DIR);
    const sourceMap = new Map<string, string>();
    for (const fullPath of files) {
      const rel = path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/');
      sourceMap.set(rel, fs.readFileSync(fullPath, 'utf8'));
    }

    const audit = auditStatusPatchDtos(sourceMap, STATUS_PATCH_CENSUS, (specRel) => {
      const abs = path.join(REPO_ROOT, specRel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    });

    expect(audit.unregistered).toEqual([]);
    expect(audit.staleEntries).toEqual([]);
    expect(audit.duplicateEntries).toEqual([]);
    expect(audit.fieldMismatches).toEqual([]);
    expect(audit.invalidEntries).toEqual([]);
    expect(audit.missingEvidence).toEqual([]);
    expect(STATUS_PATCH_CENSUS.length).toBeGreaterThanOrEqual(12);
  });

  it('NEGATIVE CONTROLS: catches unregistered UpdateFooDto status/stage fields, rejects missing or fabricated spec evidence, and flags stale/duplicate entries', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/rogue/update-foo.dto.ts',
        `export class UpdateFooDto { title?: string; status?: string; }`,
      ],
      [
        'apps/server/src/modules/rogue/update-bar.dto.ts',
        `export type UpdateBarDto = { stage?: string };`,
      ],
      [
        'apps/server/src/modules/clean/update-safe.dto.ts',
        `// export class UpdateCommentedDto { status?: string; }\nexport class UpdateSafeDto { title?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-checked.dto.ts',
        `export interface UpdateCheckedDto { status?: string; }`,
      ],
    ]);

    const syntheticSpecs = new Map<string, string>([
      [
        'apps/server/src/modules/clean/checked.spec.ts',
        `describe('checked', () => { it('proves real transition', () => {}); });`,
      ],
    ]);

    const registry: StatusPatchCensusEntry[] = [
      {
        file: 'apps/server/src/modules/clean/update-checked.dto.ts',
        dtoName: 'UpdateCheckedDto',
        fields: ['status'],
        mode: 'TRANSITION_CHECKED',
        reason: 'Status transitions verified by dedicated transition test.',
        specFile: 'apps/server/src/modules/clean/checked.spec.ts',
        specCaseTitle: 'nonexistent fabricated test title',
      },
      {
        file: 'apps/server/src/modules/clean/update-safe.dto.ts',
        dtoName: 'UpdateSafeDto',
        fields: ['status'],
        mode: 'FREE_LABEL',
        reason: 'Retired status field that no longer exists on DTO.',
      },
      {
        file: 'apps/server/src/modules/clean/update-safe.dto.ts',
        dtoName: 'UpdateSafeDto',
        fields: ['status'],
        mode: 'FREE_LABEL',
        reason: 'short',
      },
    ];

    const audit = auditStatusPatchDtos(
      syntheticFiles,
      registry,
      (rel) => syntheticSpecs.get(rel) ?? null,
    );

    expect(audit.unregistered).toEqual([
      {
        file: 'apps/server/src/modules/rogue/update-bar.dto.ts',
        dtoName: 'UpdateBarDto',
        fields: ['stage'],
      },
      {
        file: 'apps/server/src/modules/rogue/update-foo.dto.ts',
        dtoName: 'UpdateFooDto',
        fields: ['status'],
      },
    ]);
    expect(audit.staleEntries).toEqual([
      'apps/server/src/modules/clean/update-safe.dto.ts#UpdateSafeDto',
    ]);
    expect(audit.duplicateEntries).toEqual([
      'apps/server/src/modules/clean/update-safe.dto.ts#UpdateSafeDto',
    ]);
    expect(audit.invalidEntries).toEqual([
      'apps/server/src/modules/clean/update-safe.dto.ts#UpdateSafeDto',
    ]);
    expect(audit.missingEvidence).toEqual([
      'apps/server/src/modules/clean/update-checked.dto.ts#UpdateCheckedDto: test case not found in apps/server/src/modules/clean/checked.spec.ts: nonexistent fabricated test title',
    ]);
  });
});
