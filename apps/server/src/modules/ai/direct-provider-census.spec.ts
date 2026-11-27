import * as fs from 'fs';
import * as path from 'path';

type DirectProviderSiteKind = 'direct-call' | 'non-calling-reference';

interface DirectProviderCensusEntry {
  readonly file: string;
  readonly kind: DirectProviderSiteKind;
  readonly purpose: string;
  readonly metered: boolean;
  readonly honoursKeyDisabled: boolean;
  readonly supportsByok: boolean;
  readonly migrationTarget: string;
}

const DIRECT_PROVIDER_CENSUS: readonly DirectProviderCensusEntry[] = [];

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');

const EXEMPT_FILES = new Set([
  'apps/server/src/modules/ai/model-gateway.service.ts',
  'apps/server/src/modules/ai/direct-provider-census.ts',
]);

/**
 * Strips `/* ... *\/` block comments and `// ...` line comments while preserving
 * single-, double-, and backtick-quoted string literals so URLs like
 * `https://api.openai.com` are never truncated by `//`.
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

const PROVIDER_SDK_IMPORT_PATTERNS: readonly { label: string; re: RegExp }[] = [
  {
    label: 'sdk-import-from',
    re: /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s*['"](?:openai(?:\/[^'"]*)?|@anthropic-ai\/[^'"]+|@google\/genai(?:\/[^'"]*)?|@google\/generative-ai(?:\/[^'"]*)?)['"]/,
  },
  {
    label: 'sdk-side-effect-import',
    re: /\bimport\s*['"](?:openai(?:\/[^'"]*)?|@anthropic-ai\/[^'"]+|@google\/genai(?:\/[^'"]*)?|@google\/generative-ai(?:\/[^'"]*)?)['"]/,
  },
  {
    label: 'sdk-dynamic-import-or-require',
    re: /\b(?:import|require)\s*\(\s*['"](?:openai(?:\/[^'"]*)?|@anthropic-ai\/[^'"]+|@google\/genai(?:\/[^'"]*)?|@google\/generative-ai(?:\/[^'"]*)?)['"]\s*\)/,
  },
  {
    label: 'sdk-constructor',
    re: /\bnew\s+(?:OpenAI|Anthropic|GoogleGenerativeAI|GoogleGenAI)\s*\(/,
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
    if (EXEMPT_FILES.has(relPath)) continue;
    const signals = detectDirectProviderSignals(content);
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
    staleEntries: staleEntries.sort(),
    duplicateEntries: [...new Set(duplicateEntries)].sort(),
    invalidEntries: [...new Set(invalidEntries)].sort(),
  };
}

describe('RR-DIRECT-PROVIDER-CENSUS: direct LLM provider SDK / host ratchet', () => {
  it('registers every direct provider SDK import, constructor, or host outside ModelGatewayService with zero stale entries', () => {
    const files = walkTsSourceFiles(SERVER_SRC_DIR);
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

  it('NEGATIVE CONTROLS: catches unregistered provider SDK calls/imports/hosts, ignores comments, and rejects stale/invalid entries', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/ai/model-gateway.service.ts',
        `import OpenAI from 'openai';\nconst url = 'https://api.anthropic.com/v1/messages';`,
      ],
      [
        'apps/server/src/modules/rogue/anthropic-ctor.service.ts',
        `export function run() { return new Anthropic({ apiKey: 'x' }); }`,
      ],
      [
        'apps/server/src/modules/rogue/dynamic-google.service.ts',
        `export async function load() { return import('@google/genai'); }`,
      ],
      [
        'apps/server/src/modules/rogue/require-openai.service.ts',
        `const sdk = require('openai'); export default sdk;`,
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
      'apps/server/src/modules/rogue/anthropic-ctor.service.ts',
      'apps/server/src/modules/rogue/dynamic-google.service.ts',
      'apps/server/src/modules/rogue/moonshot-url.service.ts',
      'apps/server/src/modules/rogue/require-openai.service.ts',
    ]);
    expect(audit.unregistered[0].signals).toContain('sdk-constructor');
    expect(audit.unregistered[1].signals).toContain('sdk-dynamic-import-or-require');
    expect(audit.unregistered[2].signals).toContain('provider-host');
    expect(audit.unregistered[3].signals).toContain('sdk-dynamic-import-or-require');
    expect(audit.staleEntries).toEqual([
      'apps/server/src/modules/clean/stale-registered.service.ts',
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
