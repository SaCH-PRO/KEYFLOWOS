/**
 * RR-MODEL-LIFECYCLE-GUARD (P124): Model lifecycle catalog census.
 *
 * Every (provider, modelId) referenced in:
 *   - PROVIDER_DEFAULT_MODEL (model-gateway.service.ts)
 *   - DEFAULT_ROUTING_TABLE (model-gateway.service.ts)
 *   - TOKEN_COST_PER_1K (llm-cost.service.ts)
 *   - KeyCortexProviderSelectionService (key-cortex-provider-selection.service.ts)
 * must have a valid entry in MODEL_LIFECYCLE_CATALOG, and no default routed
 * model may have status 'retired'.
 *
 * Pending owner ruling OQ-3, entries start as 'unverified' with null metadata
 * until the owner confirms each model's lifecycle status against provider docs.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKEN_COST_PER_1K } from './llm-cost.service';

const VALID_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'xai',
  'kimi',
  'google',
  'native',
  'opensource',
]);

const VALID_STATUSES = new Set(['active', 'deprecated', 'retired', 'unverified']);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;
const URL_RE = /^https?:\/\/\S+$/;

interface CatalogEntry {
  provider: string;
  modelId: string;
  status: string;
  retiresOn: string | null;
  source: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
}

interface CatalogModule {
  MODEL_LIFECYCLE_CATALOG: readonly CatalogEntry[];
  MODEL_LIFECYCLE_STATUSES: readonly string[];
  getModelLifecycleEntry: (
    provider: string,
    modelId: string,
    catalog?: readonly CatalogEntry[],
  ) => CatalogEntry | undefined;
  getModelLifecycleStatus: (
    provider: string,
    modelId: string,
    catalog?: readonly CatalogEntry[],
  ) => string | undefined;
  isModelRetired: (
    provider: string,
    modelId: string,
    catalog?: readonly CatalogEntry[],
  ) => boolean;
}

const CATALOG_FILE = join(__dirname, 'model-lifecycle-catalog.ts');

async function loadCatalogModule(): Promise<CatalogModule | null> {
  if (!existsSync(CATALOG_FILE)) {
    return null;
  }
  return (await import(CATALOG_FILE)) as unknown as CatalogModule;
}

interface ProviderModelPair {
  provider: string;
  modelId: string;
  origin: string;
}

function pairKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

function readGatewaySource(): string {
  return readFileSync(join(__dirname, 'model-gateway.service.ts'), 'utf8');
}

function extractProviderDefaultModels(): ProviderModelPair[] {
  const src = readGatewaySource();
  const start = src.indexOf('const PROVIDER_DEFAULT_MODEL');
  const end = src.indexOf('};', start);
  const block = src.slice(start, end);
  return [...block.matchAll(/([a-z]+):\s*'([^']+)'/g)].map((m) => ({
    provider: m[1],
    modelId: m[2],
    origin: 'PROVIDER_DEFAULT_MODEL',
  }));
}

function extractDefaultRoutingTableModels(): ProviderModelPair[] {
  const src = readGatewaySource();
  const start = src.indexOf('const DEFAULT_ROUTING_TABLE');
  const end = src.indexOf('\n};', start);
  const block = src.slice(start, end);
  const seen = new Set<string>();
  const pairs: ProviderModelPair[] = [];
  for (const m of block.matchAll(/provider:\s*'([^']+)',\s*model:\s*'([^']+)'/g)) {
    const key = pairKey(m[1], m[2]);
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ provider: m[1], modelId: m[2], origin: 'DEFAULT_ROUTING_TABLE' });
    }
  }
  return pairs;
}

function extractProviderSelectionModels(): ProviderModelPair[] {
  const src = readFileSync(
    join(__dirname, '../key-cortex/key-cortex-provider-selection.service.ts'),
    'utf8',
  );
  const seen = new Set<string>();
  const pairs: ProviderModelPair[] = [];

  const mapStart = src.indexOf('const modelMap');
  if (mapStart !== -1) {
    const mapEnd = src.indexOf('};', mapStart);
    const mapBlock = src.slice(mapStart, mapEnd);
    for (const m of mapBlock.matchAll(/([a-z]+):\s*'([^']+)'/g)) {
      const key = pairKey(m[1], m[2]);
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({
          provider: m[1],
          modelId: m[2],
          origin: 'key-cortex-provider-selection.service.ts',
        });
      }
    }
  }

  for (const m of src.matchAll(/provider:\s*'([^']+)',\s*model:\s*'([^']+)'/g)) {
    const key = pairKey(m[1], m[2]);
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({
        provider: m[1],
        modelId: m[2],
        origin: 'key-cortex-provider-selection.service.ts',
      });
    }
  }

  return pairs;
}

function findMissingFromCatalog(
  pairs: readonly ProviderModelPair[],
  catalog: readonly CatalogEntry[],
): string[] {
  const keys = new Set(catalog.map((e) => pairKey(e.provider, e.modelId)));
  return pairs
    .filter((p) => !keys.has(pairKey(p.provider, p.modelId)))
    .map((p) => `${p.provider}/${p.modelId} (${p.origin})`);
}

function findRetiredDefaults(
  pairs: readonly ProviderModelPair[],
  catalog: readonly CatalogEntry[],
): string[] {
  const byKey = new Map(catalog.map((e) => [pairKey(e.provider, e.modelId), e]));
  return pairs
    .filter((p) => byKey.get(pairKey(p.provider, p.modelId))?.status === 'retired')
    .map((p) => `${p.provider}/${p.modelId} (${p.origin})`);
}

describe('model lifecycle catalog census (RR-MODEL-LIFECYCLE-GUARD)', () => {
  it('extracts models from all four sources — census is not vacuous', () => {
    expect(extractProviderDefaultModels().length).toBeGreaterThanOrEqual(5);
    expect(extractDefaultRoutingTableModels().length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(TOKEN_COST_PER_1K).length).toBeGreaterThanOrEqual(10);
    expect(extractProviderSelectionModels().length).toBeGreaterThanOrEqual(6);
  });

  it('every routed model id has a catalog entry across PROVIDER_DEFAULT_MODEL, DEFAULT_ROUTING_TABLE, key-cortex-provider-selection, and TOKEN_COST_PER_1K', async () => {
    const mod = await loadCatalogModule();
    expect(mod, 'apps/server/src/modules/ai/model-lifecycle-catalog.ts must exist').not.toBeNull();
    const catalog = mod!.MODEL_LIFECYCLE_CATALOG;

    const allPairs = [
      ...extractProviderDefaultModels(),
      ...extractDefaultRoutingTableModels(),
      ...extractProviderSelectionModels(),
    ];

    const missingPairs = findMissingFromCatalog(allPairs, catalog);
    expect(
      missingPairs,
      'every (provider, modelId) in PROVIDER_DEFAULT_MODEL, DEFAULT_ROUTING_TABLE, and key-cortex-provider-selection must be in MODEL_LIFECYCLE_CATALOG',
    ).toEqual([]);

    const catalogModelIds = new Set(catalog.map((e) => e.modelId));
    const missingPriced = Object.keys(TOKEN_COST_PER_1K).filter((id) => !catalogModelIds.has(id));
    expect(
      missingPriced,
      'every modelId in TOKEN_COST_PER_1K must be present in MODEL_LIFECYCLE_CATALOG',
    ).toEqual([]);
  });

  it('no default routed model has status retired', async () => {
    const mod = await loadCatalogModule();
    expect(mod, 'model-lifecycle-catalog.ts must exist').not.toBeNull();
    const catalog = mod!.MODEL_LIFECYCLE_CATALOG;

    const allDefaults = [
      ...extractProviderDefaultModels(),
      ...extractDefaultRoutingTableModels(),
      ...extractProviderSelectionModels(),
    ];

    const retiredDefaults = findRetiredDefaults(allDefaults, catalog);
    expect(
      retiredDefaults,
      'no default routed model may be marked retired in MODEL_LIFECYCLE_CATALOG',
    ).toEqual([]);
  });

  it('negative control: no-retired-default check goes red when a default is marked retired in a fixture catalog', async () => {
    const mod = await loadCatalogModule();
    expect(mod, 'model-lifecycle-catalog.ts must exist').not.toBeNull();

    const allDefaults = [
      ...extractProviderDefaultModels(),
      ...extractDefaultRoutingTableModels(),
      ...extractProviderSelectionModels(),
    ];

    const fixtureCatalog: CatalogEntry[] = mod!.MODEL_LIFECYCLE_CATALOG.map((entry) =>
      entry.provider === 'anthropic' && entry.modelId === 'claude-3-5-sonnet-20241022'
        ? { ...entry, status: 'retired', retiresOn: '2025-10-28' }
        : entry,
    );

    const retired = findRetiredDefaults(allDefaults, fixtureCatalog);
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.some((r) => r.includes('anthropic/claude-3-5-sonnet-20241022'))).toBe(true);
  });

  it('negative control: missing-entry check detects an unlisted (provider, modelId)', async () => {
    const mod = await loadCatalogModule();
    expect(mod, 'model-lifecycle-catalog.ts must exist').not.toBeNull();

    const synthetic: ProviderModelPair[] = [
      { provider: 'openai', modelId: 'gpt-99-unlisted', origin: 'synthetic-fixture' },
    ];
    expect(findMissingFromCatalog(synthetic, mod!.MODEL_LIFECYCLE_CATALOG)).toEqual([
      'openai/gpt-99-unlisted (synthetic-fixture)',
    ]);
  });

  it('validates catalog schema: allow-listed statuses, valid providers, no duplicate (provider, modelId) keys, valid metadata shape', async () => {
    const mod = await loadCatalogModule();
    expect(mod, 'model-lifecycle-catalog.ts must exist').not.toBeNull();
    const { MODEL_LIFECYCLE_CATALOG, MODEL_LIFECYCLE_STATUSES } = mod!;

    expect(MODEL_LIFECYCLE_CATALOG.length).toBeGreaterThan(0);
    expect([...MODEL_LIFECYCLE_STATUSES].sort()).toEqual([
      'active',
      'deprecated',
      'retired',
      'unverified',
    ]);

    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const entry of MODEL_LIFECYCLE_CATALOG) {
      expect(VALID_PROVIDERS.has(entry.provider), `unknown provider: ${entry.provider}`).toBe(true);
      expect(typeof entry.modelId === 'string' && entry.modelId.trim().length > 0).toBe(true);
      expect(VALID_STATUSES.has(entry.status), `invalid status ${entry.status} for ${entry.provider}/${entry.modelId}`).toBe(true);

      const key = pairKey(entry.provider, entry.modelId);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);

      expect(
        entry.retiresOn === null || (typeof entry.retiresOn === 'string' && ISO_DATE_RE.test(entry.retiresOn)),
        `invalid retiresOn for ${key}: ${String(entry.retiresOn)}`,
      ).toBe(true);
      expect(
        entry.source === null || (typeof entry.source === 'string' && URL_RE.test(entry.source)),
        `invalid source URL for ${key}: ${String(entry.source)}`,
      ).toBe(true);
      expect(
        entry.checkedAt === null || (typeof entry.checkedAt === 'string' && ISO_DATE_RE.test(entry.checkedAt)),
        `invalid checkedAt for ${key}: ${String(entry.checkedAt)}`,
      ).toBe(true);
      expect(
        entry.checkedBy === null || (typeof entry.checkedBy === 'string' && entry.checkedBy.trim().length > 0),
        `invalid checkedBy for ${key}: ${String(entry.checkedBy)}`,
      ).toBe(true);
    }

    expect(duplicates, 'duplicate (provider, modelId) keys in MODEL_LIFECYCLE_CATALOG').toEqual([]);
  });

  it('lookup helpers resolve entries and identify retired status cleanly without mutating the shared catalog', async () => {
    const mod = await loadCatalogModule();
    expect(mod, 'model-lifecycle-catalog.ts must exist').not.toBeNull();
    const { getModelLifecycleEntry, getModelLifecycleStatus, isModelRetired } = mod!;

    const customCatalog: CatalogEntry[] = [
      { provider: 'openai', modelId: 'gpt-active', status: 'active', retiresOn: null, source: 'https://platform.openai.com/docs/models', checkedAt: '2026-11-26', checkedBy: 'owner' },
      { provider: 'openai', modelId: 'gpt-deprecated', status: 'deprecated', retiresOn: '2027-01-01', source: 'https://platform.openai.com/docs/deprecations', checkedAt: '2026-11-26', checkedBy: 'owner' },
      { provider: 'openai', modelId: 'gpt-retired', status: 'retired', retiresOn: '2025-10-28', source: 'https://platform.openai.com/docs/deprecations', checkedAt: '2026-11-26', checkedBy: 'owner' },
      { provider: 'openai', modelId: 'gpt-unverified', status: 'unverified', retiresOn: null, source: null, checkedAt: null, checkedBy: null },
    ];

    expect(getModelLifecycleEntry('openai', 'gpt-active', customCatalog)?.status).toBe('active');
    expect(getModelLifecycleStatus('openai', 'gpt-deprecated', customCatalog)).toBe('deprecated');
    expect(getModelLifecycleStatus('openai', 'missing-model', customCatalog)).toBeUndefined();

    expect(isModelRetired('openai', 'gpt-retired', customCatalog)).toBe(true);
    expect(isModelRetired('openai', 'gpt-active', customCatalog)).toBe(false);
    expect(isModelRetired('openai', 'gpt-deprecated', customCatalog)).toBe(false);
    expect(isModelRetired('openai', 'gpt-unverified', customCatalog)).toBe(false);
    expect(isModelRetired('anthropic', 'gpt-retired', customCatalog)).toBe(false);
    expect(isModelRetired('openai', 'unknown-model', customCatalog)).toBe(false);
  });
});
