import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  DIRECT_PROVIDER_CENSUS,
  type DirectProviderCensusEntry,
} from './direct-provider-census';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');

const GATEWAY_EXEMPT_FILES = new Set([
  'apps/server/src/modules/ai/model-gateway.service.ts',
]);

/**
 * Registry prose legitimately names provider hostnames in `purpose` strings,
 * so only `provider-host` is exempted on `direct-provider-census.ts`; any SDK
 * import, require, or constructor inside it still fails.
 */
const PROSE_HOST_ONLY_EXEMPT_FILES = new Set([
  'apps/server/src/modules/ai/direct-provider-census.ts',
]);

const SOURCE_FILE_EXT_RE = /\.(?:[cm]?ts|tsx|[cm]?js)$/;
const TEST_OR_DECL_EXT_RE = /\.(?:spec|test|e2e-spec)\.(?:[cm]?ts|tsx|[cm]?js)$|\.d\.[cm]?ts$/;

/**
 * Strips TypeScript/JavaScript comments using the full TypeScript parser AST
 * (`ts.createSourceFile`) so regex literals (`/[/*]/`) and nested template
 * literals (`` `${`/*`}` ``) can never desync stripping, and replaces every
 * comment range with whitespace (never empty string) so `new/*c*\/Anthropic`
 * or `import/*c*\/OpenAI` cannot merge adjacent tokens to evade detection.
 */
export function stripCommentsPreservingStrings(src: string): string {
  const sf = ts.createSourceFile(
    'scan.ts',
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );
  const parts: string[] = [];
  let cursor = 0;

  const visit = (node: ts.Node) => {
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

const SDK_PACKAGE_SPECIFIER =
  '(?:openai(?:\\/[^\'\\"`]*)?|@anthropic-ai\\/[^\'\\"`]+|@google\\/genai(?:\\/[^\'\\"`]*)?|@google\\/generative-ai(?:\\/[^\'\\"`]*)?)';

const PROVIDER_SDK_IMPORT_PATTERNS: readonly { label: string; re: RegExp }[] = [
  {
    label: 'sdk-import-from',
    re: new RegExp(
      `\\b(?:import|export)(?:\\s+|(?=[*{]))(?:type\\s+)?[^;]*?\\bfrom\\s*['"]${SDK_PACKAGE_SPECIFIER}['"]`,
    ),
  },
  {
    label: 'sdk-side-effect-import',
    re: new RegExp(`\\bimport\\s*['"]${SDK_PACKAGE_SPECIFIER}['"]`),
  },
  {
    label: 'sdk-dynamic-import-or-require',
    re: new RegExp(
      `\\b(?:import|require)\\s*\\(\\s*['"\`]${SDK_PACKAGE_SPECIFIER}['"\`]\\s*(?:,|\\))`,
    ),
  },
  {
    label: 'sdk-constructor',
    re: /\bnew\s+(?:[A-Za-z_$][\w$]*\.)?(?:OpenAI|AzureOpenAI|Anthropic|GoogleGenerativeAI|GoogleGenAI)\b/,
  },
  {
    label: 'provider-host',
    re: /\b(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai|api\.x\.ai|api\.moonshot(?:\.[a-z]+)?)\b/i,
  },
];

export function detectDirectProviderSignals(source: string): string[] {
  const cleaned = stripCommentsPreservingStrings(source);
  const hits: string[] = [];
  for (const { label, re } of PROVIDER_SDK_IMPORT_PATTERNS) {
    if (re.test(cleaned)) {
      hits.push(label);
    }
  }
  return hits;
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

export interface DirectProviderAuditResult {
  unregistered: Array<{ file: string; signals: string[] }>;
  staleEntries: string[];
  duplicateEntries: string[];
  invalidEntries: string[];
}

export function auditDirectProviderSites(
  filesByRelPath: ReadonlyMap<string, string>,
  registry: readonly DirectProviderCensusEntry[],
): DirectProviderAuditResult {
  const unregistered: Array<{ file: string; signals: string[] }> = [];
  const staleEntries: string[] = [];
  const duplicateEntries: string[] = [];
  const invalidEntries: string[] = [];

  const registeredByPath = new Map<string, DirectProviderCensusEntry>();
  for (const entry of registry) {
    if (registeredByPath.has(entry.file)) {
      duplicateEntries.push(entry.file);
    }
    registeredByPath.set(entry.file, entry);

    if (
      entry.purpose.trim().length < 15 ||
      entry.migrationTarget.trim().length < 5 ||
      typeof entry.metered !== 'boolean' ||
      typeof entry.honoursKeyDisabled !== 'boolean' ||
      typeof entry.supportsByok !== 'boolean' ||
      (entry.kind !== 'direct-call' && entry.kind !== 'non-calling-reference')
    ) {
      invalidEntries.push(entry.file);
    }
  }

  const matchedFiles = new Set<string>();
  for (const [relPath, content] of [...filesByRelPath.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (GATEWAY_EXEMPT_FILES.has(relPath)) continue;
    let signals = detectDirectProviderSignals(content);
    if (PROSE_HOST_ONLY_EXEMPT_FILES.has(relPath)) {
      signals = signals.filter((s) => s !== 'provider-host');
    }
    if (signals.length > 0) {
      matchedFiles.add(relPath);
      if (!registeredByPath.has(relPath)) {
        unregistered.push({ file: relPath, signals });
      }
    }
  }

  for (const entry of registry) {
    if (!matchedFiles.has(entry.file)) {
      staleEntries.push(entry.file);
    }
  }

  return {
    unregistered,
    staleEntries: [...new Set(staleEntries)].sort(),
    duplicateEntries: [...new Set(duplicateEntries)].sort(),
    invalidEntries: [...new Set(invalidEntries)].sort(),
  };
}

describe('RR-DIRECT-PROVIDER-CENSUS: direct LLM provider SDK / host ratchet', () => {
  it('registers every direct provider SDK import, constructor, or host outside ModelGatewayService with zero stale entries', () => {
    const files = walkSourceFiles(SERVER_SRC_DIR);
    const sourceMap = new Map<string, string>();
    for (const fullPath of files) {
      const rel = path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/');
      sourceMap.set(rel, fs.readFileSync(fullPath, 'utf8'));
    }

    const audit = auditDirectProviderSites(sourceMap, DIRECT_PROVIDER_CENSUS);

    expect(audit.unregistered).toEqual([]);
    expect(audit.staleEntries).toEqual([]);
    expect(audit.duplicateEntries).toEqual([]);
    expect(audit.invalidEntries).toEqual([]);
  });

  it('NEGATIVE CONTROLS: catches unregistered provider SDK calls/imports/hosts including lexer/ESM evasion forms, ignores comments, and rejects stale/invalid entries', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/ai/model-gateway.service.ts',
        `import OpenAI from 'openai';\nconst url = 'https://api.anthropic.com/v1/messages';`,
      ],
      [
        'apps/server/src/modules/ai/direct-provider-census.ts',
        `export const NOTE = 'https://api.openai.com';\nexport const bad = new OpenAI();`,
      ],
      [
        'apps/server/src/modules/rogue/anthropic-ctor.service.ts',
        `export function run() { return new/*c*/Anthropic({ apiKey: 'x' }); }`,
      ],
      [
        'apps/server/src/modules/rogue/namespaced-azure.service.ts',
        `export function run(sdk: any) { return [new sdk.Anthropic(), new AzureOpenAI]; }`,
      ],
      [
        'apps/server/src/modules/rogue/static-import-spaceless.service.ts',
        `import{default as A}from'@anthropic-ai/sdk'; export const a = A;`,
      ],
      [
        'apps/server/src/modules/rogue/comment-split-import.service.ts',
        `import/*c*/OpenAI/*c*/from 'openai'; export const o = OpenAI;`,
      ],
      [
        'apps/server/src/modules/rogue/dynamic-import-attrs.service.ts',
        `export async function load() { return import('openai', { with: {} }); }`,
      ],
      [
        'apps/server/src/modules/rogue/template-require.service.ts',
        'export const sdk = require(`@anthropic-ai/sdk`);',
      ],
      [
        'apps/server/src/modules/rogue/regex-literal-smuggle.service.ts',
        `export const r1 = /[/*]/; export const c = new GoogleGenAI(); export const r2 = /[*/]/;`,
      ],
      [
        'apps/server/src/modules/rogue/moonshot-url.service.ts',
        `export const ENDPOINT = "https://api.moonshot.cn/v1/chat/completions";`,
      ],
      [
        'apps/server/src/modules/clean/commented-only.service.ts',
        `// import OpenAI from 'openai';\n/* new Anthropic({ apiKey: 'x' }); https://api.openai.com */\nexport const ok = true;`,
      ],
      [
        'apps/server/src/modules/clean/stale-registered.service.ts',
        `export const migratedToGateway = true;`,
      ],
    ]);

    const registry: DirectProviderCensusEntry[] = [
      {
        file: 'apps/server/src/modules/clean/stale-registered.service.ts',
        kind: 'direct-call',
        purpose: 'Previously called OpenAI directly before moving to ModelGatewayService.',
        metered: true,
        honoursKeyDisabled: true,
        supportsByok: false,
        migrationTarget: 'Completed — remove entry',
      },
      {
        file: 'apps/server/src/modules/clean/stale-registered.service.ts',
        kind: 'direct-call',
        purpose: 'short',
        metered: true,
        honoursKeyDisabled: true,
        supportsByok: false,
        migrationTarget: 'x',
      },
    ];

    const audit = auditDirectProviderSites(syntheticFiles, registry);

    expect(audit.unregistered.map((u) => u.file)).toEqual([
      'apps/server/src/modules/ai/direct-provider-census.ts',
      'apps/server/src/modules/rogue/anthropic-ctor.service.ts',
      'apps/server/src/modules/rogue/comment-split-import.service.ts',
      'apps/server/src/modules/rogue/dynamic-import-attrs.service.ts',
      'apps/server/src/modules/rogue/moonshot-url.service.ts',
      'apps/server/src/modules/rogue/namespaced-azure.service.ts',
      'apps/server/src/modules/rogue/regex-literal-smuggle.service.ts',
      'apps/server/src/modules/rogue/static-import-spaceless.service.ts',
      'apps/server/src/modules/rogue/template-require.service.ts',
    ]);
    expect(audit.unregistered[0].signals).toEqual(['sdk-constructor']);
    expect(audit.unregistered[1].signals).toContain('sdk-constructor');
    expect(audit.unregistered[2].signals).toContain('sdk-import-from');
    expect(audit.unregistered[3].signals).toContain('sdk-dynamic-import-or-require');
    expect(audit.unregistered[4].signals).toContain('provider-host');
    expect(audit.unregistered[5].signals).toContain('sdk-constructor');
    expect(audit.unregistered[6].signals).toContain('sdk-constructor');
    expect(audit.unregistered[7].signals).toContain('sdk-import-from');
    expect(audit.unregistered[8].signals).toContain('sdk-dynamic-import-or-require');
    expect(audit.staleEntries).toEqual([
      'apps/server/src/modules/clean/stale-registered.service.ts',
    ]);
    expect(audit.duplicateEntries).toEqual([
      'apps/server/src/modules/clean/stale-registered.service.ts',
    ]);
    expect(audit.invalidEntries).toEqual([
      'apps/server/src/modules/clean/stale-registered.service.ts',
    ]);
  });
});
