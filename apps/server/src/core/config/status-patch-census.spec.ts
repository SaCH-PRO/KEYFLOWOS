import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  STATUS_PATCH_CENSUS,
  type StatusPatchCensusEntry,
  type StatusPatchMode,
} from './status-patch-census.registry';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');

const SOURCE_FILE_EXT_RE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_OR_DECL_EXT_RE =
  /\.(?:spec|test|e2e-spec)\.(?:[cm]?ts|tsx|[cm]?js|jsx)$|\.d\.[cm]?ts$/;

const UPDATE_DTO_NAME_RE = /^(?:Bulk)?Update[A-Za-z0-9_]*Dto$/;
const STATUS_FIELD_NAMES = new Set<'status' | 'stage'>(['status', 'stage']);
const VALID_MODES = new Set<StatusPatchMode>([
  'TRANSITION_CHECKED',
  'DECISION_REFUSED',
  'FREE_LABEL',
  'OPEN',
]);
const ALLOWED_TEST_MODIFIERS = new Set(['concurrent', 'sequential']);
const SKIPPED_SUITE_CALLEES = new Set(['xdescribe', 'xcontext', 'xsuite']);
const SKIPPED_SUITE_MODIFIERS = new Set(['skip', 'todo', 'skipIf', 'runIf']);
const SAFE_SPEC_FILE_RE =
  /^apps\/server\/(?!.*\.\.)[A-Za-z0-9._/-]+\.(?:spec|test|e2e-spec)\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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

function staticPropName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const inner = unwrapExpr(name.expression);
    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
      return inner.text;
    }
  }
  return null;
}

function hasParameterPropertyModifier(param: ts.ParameterDeclaration): boolean {
  const mods = ts.canHaveModifiers(param) ? ts.getModifiers(param) : undefined;
  if (!mods) return false;
  return mods.some(
    (m) =>
      m.kind === ts.SyntaxKind.PublicKeyword ||
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword ||
      m.kind === ts.SyntaxKind.ReadonlyKeyword,
  );
}

function collectOwnStatusFieldsFromMembers(
  members: ts.NodeArray<ts.ClassElement> | ts.NodeArray<ts.TypeElement>,
): Set<'status' | 'stage'> {
  const fields = new Set<'status' | 'stage'>();
  for (const m of members) {
    if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) {
      const prop = staticPropName(m.name);
      if (prop && STATUS_FIELD_NAMES.has(prop as 'status' | 'stage')) {
        fields.add(prop as 'status' | 'stage');
      }
    } else if (ts.isConstructorDeclaration(m)) {
      for (const param of m.parameters) {
        if (hasParameterPropertyModifier(param) && ts.isIdentifier(param.name)) {
          if (STATUS_FIELD_NAMES.has(param.name.text as 'status' | 'stage')) {
            fields.add(param.name.text as 'status' | 'stage');
          }
        }
      }
    }
  }
  return fields;
}

function extractStringArrayArg(expr: ts.Expression): Set<string> | null {
  const unwrapped = unwrapExpr(expr);
  if (!ts.isArrayLiteralExpression(unwrapped)) return null;
  const out = new Set<string>();
  for (const el of unwrapped.elements) {
    const item = unwrapExpr(el);
    if (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) {
      out.add(item.text);
    }
  }
  return out;
}

function extractLiteralUnionKeys(typeNode: ts.TypeNode): Set<string> {
  const out = new Set<string>();
  const walk = (t: ts.TypeNode) => {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) {
      out.add(t.literal.text);
    } else if (ts.isUnionTypeNode(t)) {
      for (const part of t.types) walk(part);
    } else if (ts.isParenthesizedTypeNode(t)) {
      walk(t.type);
    }
  };
  walk(typeNode);
  return out;
}

interface ParsedFileInfo {
  relPath: string;
  sf: ts.SourceFile;
  decls: Map<
    string,
    ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration
  >;
  imports: Map<string, { targetRelPath: string; exportedName: string }>;
}

function resolveRelativeImport(
  fromRelPath: string,
  specifier: string,
  allPaths: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const baseDir = path.posix.dirname(fromRelPath);
  const raw = path.posix.normalize(path.posix.join(baseDir, specifier));
  const candidates = [
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.mts`,
    `${raw}.cts`,
    `${raw}.js`,
    `${raw}/index.ts`,
    `${raw}/index.tsx`,
  ];
  for (const c of candidates) {
    if (allPaths.has(c)) return c;
  }
  return null;
}

function buildParsedIndex(
  filesByRelPath: ReadonlyMap<string, string>,
): Map<string, ParsedFileInfo> {
  const allPaths = new Set(filesByRelPath.keys());
  const index = new Map<string, ParsedFileInfo>();

  for (const [relPath, content] of filesByRelPath.entries()) {
    const sf = ts.createSourceFile(
      relPath,
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      scriptKindForPath(relPath),
    );
    const decls = new Map<
      string,
      ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration
    >();
    const imports = new Map<
      string,
      { targetRelPath: string; exportedName: string }
    >();

    const collect = (node: ts.Node) => {
      if (ts.isJSDoc(node)) return;
      if (
        (ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        node.name
      ) {
        decls.set(node.name.text, node);
      } else if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        const target = resolveRelativeImport(
          relPath,
          node.moduleSpecifier.text,
          allPaths,
        );
        if (target) {
          for (const el of node.importClause.namedBindings.elements) {
            const exportedName = el.propertyName ? el.propertyName.text : el.name.text;
            imports.set(el.name.text, { targetRelPath: target, exportedName });
          }
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);

    index.set(relPath, { relPath, sf, decls, imports });
  }

  return index;
}

function resolveFieldsOfSymbol(
  fileInfo: ParsedFileInfo,
  symbolName: string,
  index: ReadonlyMap<string, ParsedFileInfo>,
  visiting: Set<string>,
): Set<'status' | 'stage'> {
  const visitKey = `${fileInfo.relPath}#${symbolName}`;
  if (visiting.has(visitKey)) return new Set();
  visiting.add(visitKey);
  try {
    const localDecl = fileInfo.decls.get(symbolName);
    if (localDecl) {
      return resolveFieldsOfDecl(fileInfo, localDecl, index, visiting);
    }
    const imp = fileInfo.imports.get(symbolName);
    if (imp) {
      const targetInfo = index.get(imp.targetRelPath);
      if (targetInfo) {
        return resolveFieldsOfSymbol(targetInfo, imp.exportedName, index, visiting);
      }
    }
    return new Set();
  } finally {
    visiting.delete(visitKey);
  }
}

function resolveFieldsOfTypeNode(
  fileInfo: ParsedFileInfo,
  node: ts.TypeNode,
  index: ReadonlyMap<string, ParsedFileInfo>,
  visiting: Set<string>,
): Set<'status' | 'stage'> {
  const fields = new Set<'status' | 'stage'>();
  if (ts.isTypeLiteralNode(node)) {
    for (const f of collectOwnStatusFieldsFromMembers(node.members)) fields.add(f);
  } else if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    for (const part of node.types) {
      for (const f of resolveFieldsOfTypeNode(fileInfo, part, index, visiting)) {
        fields.add(f);
      }
    }
  } else if (ts.isParenthesizedTypeNode(node)) {
    for (const f of resolveFieldsOfTypeNode(fileInfo, node.type, index, visiting)) {
      fields.add(f);
    }
  } else if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    const args = node.typeArguments ?? [];
    if ((name === 'Partial' || name === 'Required' || name === 'Readonly') && args[0]) {
      for (const f of resolveFieldsOfTypeNode(fileInfo, args[0], index, visiting)) {
        fields.add(f);
      }
    } else if (name === 'Pick' && args.length >= 2) {
      const baseFields = resolveFieldsOfTypeNode(fileInfo, args[0], index, visiting);
      const picked = extractLiteralUnionKeys(args[1]);
      for (const f of baseFields) {
        if (picked.has(f)) fields.add(f);
      }
    } else if (name === 'Omit' && args.length >= 2) {
      const baseFields = resolveFieldsOfTypeNode(fileInfo, args[0], index, visiting);
      const omitted = extractLiteralUnionKeys(args[1]);
      for (const f of baseFields) {
        if (!omitted.has(f)) fields.add(f);
      }
    } else {
      for (const f of resolveFieldsOfSymbol(fileInfo, name, index, visiting)) {
        fields.add(f);
      }
    }
  }
  return fields;
}

function resolveFieldsOfHeritageExpr(
  fileInfo: ParsedFileInfo,
  expr: ts.Expression,
  typeArgs: ts.NodeArray<ts.TypeNode> | undefined,
  index: ReadonlyMap<string, ParsedFileInfo>,
  visiting: Set<string>,
): Set<'status' | 'stage'> {
  const fields = new Set<'status' | 'stage'>();
  const unwrapped = unwrapExpr(expr);
  if (ts.isIdentifier(unwrapped)) {
    const name = unwrapped.text;
    const args = typeArgs ?? [];
    if ((name === 'Partial' || name === 'Required' || name === 'Readonly') && args[0]) {
      return resolveFieldsOfTypeNode(fileInfo, args[0], index, visiting);
    }
    if (name === 'Pick' && args.length >= 2) {
      const baseFields = resolveFieldsOfTypeNode(fileInfo, args[0], index, visiting);
      const picked = extractLiteralUnionKeys(args[1]);
      for (const f of baseFields) {
        if (picked.has(f)) fields.add(f);
      }
      return fields;
    }
    if (name === 'Omit' && args.length >= 2) {
      const baseFields = resolveFieldsOfTypeNode(fileInfo, args[0], index, visiting);
      const omitted = extractLiteralUnionKeys(args[1]);
      for (const f of baseFields) {
        if (!omitted.has(f)) fields.add(f);
      }
      return fields;
    }
    for (const f of resolveFieldsOfSymbol(fileInfo, name, index, visiting)) {
      fields.add(f);
    }
    return fields;
  }
  if (ts.isCallExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
    const helper = unwrapped.expression.text;
    const args = unwrapped.arguments;
    if (helper === 'PartialType' && args[0]) {
      return resolveFieldsOfHeritageExpr(fileInfo, args[0], undefined, index, visiting);
    }
    if (helper === 'PickType' && args.length >= 2) {
      const baseFields = resolveFieldsOfHeritageExpr(
        fileInfo,
        args[0],
        undefined,
        index,
        visiting,
      );
      const picked = extractStringArrayArg(args[1]);
      if (!picked) return baseFields;
      for (const f of baseFields) {
        if (picked.has(f)) fields.add(f);
      }
      return fields;
    }
    if (helper === 'OmitType' && args.length >= 2) {
      const baseFields = resolveFieldsOfHeritageExpr(
        fileInfo,
        args[0],
        undefined,
        index,
        visiting,
      );
      const omitted = extractStringArrayArg(args[1]);
      if (!omitted) return baseFields;
      for (const f of baseFields) {
        if (!omitted.has(f)) fields.add(f);
      }
      return fields;
    }
    if (helper === 'IntersectionType') {
      for (const arg of args) {
        for (const f of resolveFieldsOfHeritageExpr(
          fileInfo,
          arg,
          undefined,
          index,
          visiting,
        )) {
          fields.add(f);
        }
      }
      return fields;
    }
  }
  return fields;
}

function resolveFieldsOfDecl(
  fileInfo: ParsedFileInfo,
  decl: ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  index: ReadonlyMap<string, ParsedFileInfo>,
  visiting: Set<string>,
): Set<'status' | 'stage'> {
  if (ts.isTypeAliasDeclaration(decl)) {
    return resolveFieldsOfTypeNode(fileInfo, decl.type, index, visiting);
  }
  const fields = collectOwnStatusFieldsFromMembers(decl.members);
  if (decl.heritageClauses) {
    for (const clause of decl.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const exprWithTypeArgs of clause.types) {
        for (const f of resolveFieldsOfHeritageExpr(
          fileInfo,
          exprWithTypeArgs.expression,
          exprWithTypeArgs.typeArguments,
          index,
          visiting,
        )) {
          fields.add(f);
        }
      }
    }
  }
  return fields;
}

export interface DiscoveredStatusDto {
  file: string;
  dtoName: string;
  fields: ('status' | 'stage')[];
}

function typeNodeContainsInlineLiteral(node: ts.TypeNode): boolean {
  if (ts.isTypeLiteralNode(node)) return true;
  if (ts.isParenthesizedTypeNode(node)) return typeNodeContainsInlineLiteral(node.type);
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    return node.types.some((t) => typeNodeContainsInlineLiteral(t));
  }
  if (ts.isTypeReferenceNode(node) && node.typeArguments) {
    return node.typeArguments.some((arg) => typeNodeContainsInlineLiteral(arg));
  }
  return false;
}

export function scanAllStatusPatchSurfaces(
  filesByRelPath: ReadonlyMap<string, string>,
): DiscoveredStatusDto[] {
  const index = buildParsedIndex(filesByRelPath);
  const out: DiscoveredStatusDto[] = [];

  for (const relPath of [...filesByRelPath.keys()].sort()) {
    const fileInfo = index.get(relPath)!;
    const foundInFile: DiscoveredStatusDto[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isJSDoc(node)) return;

      // 1. Named (Bulk)?Update*Dto classes, interfaces, and type aliases (own + inherited)
      if (
        (ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        node.name &&
        UPDATE_DTO_NAME_RE.test(node.name.text)
      ) {
        const fields = [
          ...resolveFieldsOfDecl(fileInfo, node, index, new Set()),
        ].sort();
        if (fields.length > 0) {
          foundInFile.push({ file: relPath, dtoName: node.name.text, fields });
        }
      }

      // 2. Inline @Body() object literals on @Patch / @Put controller methods
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !member.name) continue;
          const decs = ts.canHaveDecorators(member)
            ? ts.getDecorators(member) ?? []
            : [];
          const hasPatchOrPut = decs.some(
            (d) =>
              ts.isCallExpression(d.expression) &&
              ts.isIdentifier(d.expression.expression) &&
              (d.expression.expression.text === 'Patch' ||
                d.expression.expression.text === 'Put'),
          );
          if (!hasPatchOrPut) continue;
          const methodName = staticPropName(member.name);
          if (!methodName) continue;

          for (const param of member.parameters) {
            const pDecs = ts.canHaveDecorators(param)
              ? ts.getDecorators(param) ?? []
              : [];
            const hasBody = pDecs.some(
              (d) =>
                ts.isCallExpression(d.expression) &&
                ts.isIdentifier(d.expression.expression) &&
                d.expression.expression.text === 'Body',
            );
            if (!hasBody || !param.type || !typeNodeContainsInlineLiteral(param.type)) {
              continue;
            }
            const fields = [
              ...resolveFieldsOfTypeNode(fileInfo, param.type, index, new Set()),
            ].sort();
            if (fields.length > 0) {
              foundInFile.push({
                file: relPath,
                dtoName: `${className}.${methodName}@Body`,
                fields,
              });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(fileInfo.sf);

    foundInFile.sort((a, b) => a.dtoName.localeCompare(b.dtoName));
    out.push(...foundInFile);
  }

  return out;
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

function isSkippedSuiteCall(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr) && SKIPPED_SUITE_CALLEES.has(expr.text)) return true;
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    (expr.expression.text === 'describe' ||
      expr.expression.text === 'suite' ||
      expr.expression.text === 'context') &&
    SKIPPED_SUITE_MODIFIERS.has(expr.name.text)
  ) {
    return true;
  }
  if (ts.isCallExpression(expr)) {
    return isSkippedSuiteCall(expr.expression);
  }
  return false;
}

function isActiveTestCallee(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) {
    return expr.text === 'it' || expr.text === 'test';
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    (expr.expression.text === 'it' || expr.expression.text === 'test')
  ) {
    return ALLOWED_TEST_MODIFIERS.has(expr.name.text);
  }
  return false;
}

/**
 * Verifies that `specContent` contains an active (non-skipped, non-todo,
 * non-commented, not nested inside a skipped suite) `it(...)` or `test(...)`
 * call whose first argument matches `expectedTitle` verbatim.
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
    if (found || ts.isJSDoc(node)) return;
    if (ts.isCallExpression(node)) {
      if (isSkippedSuiteCall(node.expression)) {
        return; // Do not descend into describe.skip / describe.todo / xdescribe
      }
      if (node.arguments.length >= 2 && isActiveTestCallee(node.expression)) {
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
      } else if (!SAFE_SPEC_FILE_RE.test(entry.specFile)) {
        missingEvidence.push(`${key}: specFile is not a valid server test path (${entry.specFile})`);
      } else {
        const specSrc = readSpecFile(entry.specFile);
        if (specSrc === null) {
          missingEvidence.push(`${key}: specFile not found (${entry.specFile})`);
        } else if (!specContainsTestCase(specSrc, entry.specCaseTitle, entry.specFile)) {
          missingEvidence.push(
            `${key}: active test case not found in ${entry.specFile}: ${entry.specCaseTitle}`,
          );
        }
      }
    }
  }

  const discovered = scanAllStatusPatchSurfaces(filesByRelPath);
  const discoveredKeys = new Set<string>();
  for (const dto of discovered) {
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

describe('RR-STATUS-PATCH-CENSUS: generic Update*Dto and inline @Patch/@Put status ratchet', () => {
  it('registers every Update*Dto (own + inherited) and inline @Patch/@Put @Body() accepting status or stage with active proof evidence and exact OPEN rows', () => {
    const files = walkSourceFiles(SERVER_SRC_DIR);
    expect(files.length).toBeGreaterThan(50);
    expect(STATUS_PATCH_CENSUS.length).toBeGreaterThan(0);
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

    const openDtos = STATUS_PATCH_CENSUS.filter((e) => e.mode === 'OPEN')
      .map((e) => e.dtoName)
      .sort();
    expect(openDtos).toEqual(['UpdateChangeOrderDto', 'UpdateContractDto']);
  });

  it('NEGATIVE CONTROLS: catches unregistered direct/inherited/computed/constructor/inline status surfaces, rejects skipped/todo/describe.skip/non-test/missing evidence, and flags field mismatches and stale/duplicate entries', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/rogue/create-inherited.dto.ts',
        `export class CreateInheritedDto { status?: string; }`,
      ],
      [
        'apps/server/src/modules/rogue/update-inherited.dto.ts',
        `import { CreateInheritedDto } from './create-inherited.dto';\nexport class UpdateInheritedDto extends PartialType(CreateInheritedDto) {}`,
      ],
      [
        'apps/server/src/modules/rogue/update-foo.dto.ts',
        `export class UpdateFooDto { ['status']?: string; constructor(public stage?: string) {} }`,
      ],
      [
        'apps/server/src/modules/rogue/inline-patch.controller.ts',
        `export class InlineRogueController {\n  @Patch(':id')\n  update(@Body() body: { status?: string }) { return body; }\n}`,
      ],
      [
        'apps/server/src/modules/clean/update-safe.dto.ts',
        `// export class UpdateCommentedDto { status?: string; }\nexport class UpdateSafeDto { title?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-mismatch.dto.ts',
        `export interface UpdateMismatchDto { status?: string; stage?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-skipped-proof.dto.ts',
        `export interface UpdateSkippedProofDto { status?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-todo-proof.dto.ts',
        `export interface UpdateTodoProofDto { status?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-skipped-suite.dto.ts',
        `export interface UpdateSkippedSuiteDto { status?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-non-test-proof.dto.ts',
        `export interface UpdateNonTestProofDto { status?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-missing-file.dto.ts',
        `export interface UpdateMissingFileDto { status?: string; }`,
      ],
      [
        'apps/server/src/modules/clean/update-omitted-proof.dto.ts',
        `export interface UpdateOmittedProofDto { status?: string; }`,
      ],
    ]);

    const syntheticSpecs = new Map<string, string>([
      [
        'apps/server/src/modules/clean/checked.spec.ts',
        [
          `describe('checked', () => {`,
          `  it.skip('skipped proof case', () => {});`,
          `  it.todo('todo proof case');`,
          `  // it('commented proof case', () => {});`,
          `  describe.skip('skipped suite', () => {`,
          `    it('nested inside skipped suite', () => {});`,
          `  });`,
          `});`,
        ].join('\n'),
      ],
      [
        'apps/server/src/modules/clean/helper.ts',
        `export function run() { it('fake helper call', () => {}); }`,
      ],
    ]);

    const registry: StatusPatchCensusEntry[] = [
      {
        file: 'apps/server/src/modules/clean/update-mismatch.dto.ts',
        dtoName: 'UpdateMismatchDto',
        fields: ['status'],
        mode: 'FREE_LABEL',
        reason: 'Missing stage field in registry should fail fieldMismatches.',
      },
      {
        file: 'apps/server/src/modules/clean/update-skipped-proof.dto.ts',
        dtoName: 'UpdateSkippedProofDto',
        fields: ['status'],
        mode: 'TRANSITION_CHECKED',
        reason: 'Points to an it.skip test case which must be rejected.',
        specFile: 'apps/server/src/modules/clean/checked.spec.ts',
        specCaseTitle: 'skipped proof case',
      },
      {
        file: 'apps/server/src/modules/clean/update-todo-proof.dto.ts',
        dtoName: 'UpdateTodoProofDto',
        fields: ['status'],
        mode: 'TRANSITION_CHECKED',
        reason: 'Points to an it.todo stub which must be rejected.',
        specFile: 'apps/server/src/modules/clean/checked.spec.ts',
        specCaseTitle: 'todo proof case',
      },
      {
        file: 'apps/server/src/modules/clean/update-skipped-suite.dto.ts',
        dtoName: 'UpdateSkippedSuiteDto',
        fields: ['status'],
        mode: 'TRANSITION_CHECKED',
        reason: 'Points to an it() inside describe.skip which must be rejected.',
        specFile: 'apps/server/src/modules/clean/checked.spec.ts',
        specCaseTitle: 'nested inside skipped suite',
      },
      {
        file: 'apps/server/src/modules/clean/update-non-test-proof.dto.ts',
        dtoName: 'UpdateNonTestProofDto',
        fields: ['status'],
        mode: 'TRANSITION_CHECKED',
        reason: 'Points to a non-test helper file which must be rejected.',
        specFile: 'apps/server/src/modules/clean/helper.ts',
        specCaseTitle: 'fake helper call',
      },
      {
        file: 'apps/server/src/modules/clean/update-missing-file.dto.ts',
        dtoName: 'UpdateMissingFileDto',
        fields: ['status'],
        mode: 'DECISION_REFUSED',
        reason: 'Points to a missing spec file which must be rejected.',
        specFile: 'apps/server/src/modules/clean/nonexistent.spec.ts',
        specCaseTitle: 'any case',
      },
      {
        file: 'apps/server/src/modules/clean/update-omitted-proof.dto.ts',
        dtoName: 'UpdateOmittedProofDto',
        fields: ['status'],
        mode: 'DECISION_REFUSED',
        reason: 'Omits specFile and specCaseTitle which must be rejected.',
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
        file: 'apps/server/src/modules/rogue/inline-patch.controller.ts',
        dtoName: 'InlineRogueController.update@Body',
        fields: ['status'],
      },
      {
        file: 'apps/server/src/modules/rogue/update-foo.dto.ts',
        dtoName: 'UpdateFooDto',
        fields: ['stage', 'status'],
      },
      {
        file: 'apps/server/src/modules/rogue/update-inherited.dto.ts',
        dtoName: 'UpdateInheritedDto',
        fields: ['status'],
      },
    ]);
    expect(audit.fieldMismatches).toEqual([
      'apps/server/src/modules/clean/update-mismatch.dto.ts#UpdateMismatchDto: expected [status], got [stage,status]',
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
      'apps/server/src/modules/clean/update-missing-file.dto.ts#UpdateMissingFileDto: specFile not found (apps/server/src/modules/clean/nonexistent.spec.ts)',
      'apps/server/src/modules/clean/update-non-test-proof.dto.ts#UpdateNonTestProofDto: specFile is not a valid server test path (apps/server/src/modules/clean/helper.ts)',
      'apps/server/src/modules/clean/update-omitted-proof.dto.ts#UpdateOmittedProofDto: missing specFile or specCaseTitle',
      'apps/server/src/modules/clean/update-skipped-proof.dto.ts#UpdateSkippedProofDto: active test case not found in apps/server/src/modules/clean/checked.spec.ts: skipped proof case',
      'apps/server/src/modules/clean/update-skipped-suite.dto.ts#UpdateSkippedSuiteDto: active test case not found in apps/server/src/modules/clean/checked.spec.ts: nested inside skipped suite',
      'apps/server/src/modules/clean/update-todo-proof.dto.ts#UpdateTodoProofDto: active test case not found in apps/server/src/modules/clean/checked.spec.ts: todo proof case',
    ]);
  });
});
