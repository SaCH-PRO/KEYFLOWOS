/**
 * The brand library KEY could not open.
 *
 * AssetService has nine methods, a nine-route controller and two screens
 * (/app/assets and /app/assets/[id]). It had zero tools, so KEY could not name
 * a single logo, find the brand kit, or say which image a campaign already
 * used.
 *
 * WHAT THIS FILE IS REALLY GUARDING
 *
 * Every AssetService method takes a BARE id — getAsset(id), updateAsset(id,
 * ...), tagAsset(id, ...), deleteAsset(id). Not one takes a businessId, so not
 * one can check a tenant.
 *
 * The Prisma tenant extension does cover Asset on the HTTP path, where
 * TenantInterceptor's AsyncLocalStorage is live. But that is AMBIENT
 * protection, and this session found what happens when a caller arrives without
 * it: the WebSocket approval path had no tenant context, and a bare-id lookup
 * let one business approve and execute another's proposal.
 *
 * So the handlers verify ownership themselves, and these tests assert that they
 * do — with the service stubbed to return a FOREIGN asset, which is the case
 * ambient scoping would have quietly handled and an explicit check must catch.
 *
 * The delete assertions are the sharp ones. Asset is not in the soft-delete set
 * (packages/db/src/client.ts), so deleteAsset is a real DELETE with no undo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { getToolByName } from './flow-tool-registry';

const MINE = 'biz_mine';
const THEIRS = 'biz_theirs';

const ASSET_TOOLS = [
  'assets_list',
  'assets_get',
  'assets_list_folders',
  'assets_tag',
  'assets_untag',
  'assets_update',
  'assets_delete',
] as const;

function makeAssetStub(ownerBusinessId: string) {
  return {
    listAssets: vi.fn(async () => ({ assets: [{ id: 'a1' }], total: 1 })),
    getAsset: vi.fn(async (id: string) => ({
      id,
      name: 'Logo.png',
      businessId: ownerBusinessId,
      tags: ['brand'],
    })),
    getFolders: vi.fn(async () => ['brand', 'social']),
    tagAsset: vi.fn(async (id: string, tags: string[]) => ({ id, tags })),
    untagAsset: vi.fn(async (id: string, tags: string[]) => ({ id, tags })),
    updateAsset: vi.fn(async (id: string, input: Record<string, unknown>) => ({ id, ...input })),
    deleteAsset: vi.fn(async () => undefined),
  };
}

let assets: ReturnType<typeof makeAssetStub>;
let svc: FlowOrchestratorService;

function build(ownerBusinessId: string) {
  assets = makeAssetStub(ownerBusinessId);
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: { get: () => assets },
  }) as FlowOrchestratorService;
}

function run(tool: string, args: Record<string, unknown>) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
  }).executeToolAction(MINE, tool, args);
}

beforeEach(() => build(MINE));

describe('KEY can work the asset library', () => {
  it('every tool is registered', () => {
    for (const name of ASSET_TOOLS) {
      expect(getToolByName(name), `${name} is missing`).toBeDefined();
    }
  });

  it('can read it and organise it, not just look at it', () => {
    const tools = ASSET_TOOLS.map((n) => getToolByName(n)!);
    const reads = tools.filter((t) => t.family === 'read');
    const writes = tools.filter((t) => ['crud', 'organize'].includes(t.family ?? ''));

    expect(reads.length, 'no way to see the library').toBeGreaterThanOrEqual(3);
    expect(writes.length, 'a read-only organ is half an organ').toBeGreaterThanOrEqual(4);
  });

  it('a permanent delete is gated above the organise verbs', () => {
    // deleteAsset is a hard delete. If it sat at the same tier as tagging, an
    // autonomy budget that permits routine tidying would also permit
    // irreversible destruction.
    const del = getToolByName('assets_delete')!;
    const tag = getToolByName('assets_tag')!;

    expect(del.riskTier).toBeGreaterThan(tag.riskTier as number);
    expect(del.riskTier).toBeGreaterThanOrEqual(3);
    expect(del.description, 'the description does not warn it is permanent').toMatch(
      /no undo|permanent/i,
    );
  });

  it('does not advertise an upload it cannot perform', () => {
    // createAsset requires url, storageKey AND uploadedBy. KEY has no bytes.
    // The house rule is that a tool which cannot keep its promise is removed
    // rather than advertised — see schedule_action in tool-honesty-sweep.
    expect(getToolByName('assets_create')).toBeUndefined();
    expect(getToolByName('assets_upload')).toBeUndefined();
  });

  it('does not record usage it did not cause', () => {
    // trackUsage writes "this asset was used in X". KEY does not attach assets
    // through this path, so a tool for it would fabricate the record.
    expect(getToolByName('assets_track_usage')).toBeUndefined();
  });
});

describe('the happy path reaches the service and reports what it returned', () => {
  it('list passes the filters through, scoped to the caller', async () => {
    await run('assets_list', { folder: 'brand', limit: 5 });
    const [businessId, filters] = assets.listAssets.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(businessId).toBe(MINE);
    expect(filters).toMatchObject({ folder: 'brand', limit: 5 });
  });

  it('get returns the asset', async () => {
    const out = (await run('assets_get', { assetId: 'a1' })) as { name: string };
    expect(out.name).toBe('Logo.png');
  });

  it('folders come from the service, for this business', async () => {
    const out = (await run('assets_list_folders', {})) as { folders: string[] };
    expect(assets.getFolders).toHaveBeenCalledWith(MINE);
    expect(out.folders).toEqual(['brand', 'social']);
  });

  it('tag reports the tags the service returned, not the ones it was asked for', async () => {
    assets.tagAsset.mockResolvedValueOnce({ id: 'a1', tags: ['brand', 'logo'] });
    const out = (await run('assets_tag', { assetId: 'a1', tags: ['logo'] })) as { tags: string[] };
    // The argument was ['logo']; the truth is ['brand','logo'] because existing
    // tags are kept. A handler answering from `args` would say ['logo'].
    expect(out.tags).toEqual(['brand', 'logo']);
  });

  it('delete names what it destroyed, read before the row was gone', async () => {
    const out = (await run('assets_delete', { assetId: 'a1' })) as { name: string; deleted: boolean };
    expect(assets.deleteAsset).toHaveBeenCalledWith('a1');
    // "deleted asset_abc123" tells an owner nothing about what they lost, and
    // after the delete there is nothing left to read the name from.
    expect(out.name).toBe('Logo.png');
    expect(out.deleted).toBe(true);
  });
});

describe('an asset belonging to another business is not reachable', () => {
  beforeEach(() => build(THEIRS));

  it('get refuses', async () => {
    await expect(run('assets_get', { assetId: 'a1' })).rejects.toThrow(/not found/i);
  });

  it('tag refuses, and does not write', async () => {
    await expect(run('assets_tag', { assetId: 'a1', tags: ['x'] })).rejects.toThrow(/not found/i);
    expect(assets.tagAsset, "tagged another business's asset").not.toHaveBeenCalled();
  });

  it('untag refuses, and does not write', async () => {
    await expect(run('assets_untag', { assetId: 'a1', tags: ['x'] })).rejects.toThrow(/not found/i);
    expect(assets.untagAsset).not.toHaveBeenCalled();
  });

  it('update refuses, and does not write', async () => {
    await expect(run('assets_update', { assetId: 'a1', name: 'x' })).rejects.toThrow(/not found/i);
    expect(assets.updateAsset).not.toHaveBeenCalled();
  });

  it('delete refuses, and nothing is destroyed', async () => {
    // The one that matters. Asset is not soft-deleted; a wrong id here is a
    // permanently lost file record belonging to someone else.
    await expect(run('assets_delete', { assetId: 'a1' })).rejects.toThrow(/not found/i);
    expect(assets.deleteAsset, "deleted another business's asset").not.toHaveBeenCalled();
  });

  it('reports not-found rather than forbidden', async () => {
    // A Forbidden confirms the id exists and turns the tool into an oracle for
    // enumerating another business's asset ids.
    const err = await run('assets_get', { assetId: 'a1' })
      .then(() => null)
      .catch((e: Error) => e);
    expect(String(err?.message)).not.toMatch(/forbidden|not allowed|permission|another business/i);
  });
});

describe('tags arrive from a model, so they are validated', () => {
  it('rejects a bare string where an array is required, without writing', async () => {
    await expect(
      run('assets_tag', { assetId: 'a1', tags: 'brand' }),
    ).rejects.toThrow(/must be an array of strings/i);
    expect(assets.tagAsset).not.toHaveBeenCalled();
  });

  it('rejects an array with a non-string in it', async () => {
    await expect(
      run('assets_untag', { assetId: 'a1', tags: ['ok', 7] }),
    ).rejects.toThrow(/must be an array of strings/i);
    expect(assets.untagAsset).not.toHaveBeenCalled();
  });

  it('but accepts a real array of strings', async () => {
    // Negative control: without it the two above would pass against a handler
    // that rejected every tag list it was ever given.
    await run('assets_tag', { assetId: 'a1', tags: ['brand', 'logo'] });
    expect(assets.tagAsset).toHaveBeenCalledWith('a1', ['brand', 'logo']);
  });

  it('lets update omit tags entirely without clearing them', async () => {
    // `tags: undefined` must stay undefined, not become []. updateAsset REPLACES
    // tags, so coercing an absent field to an empty array would silently strip
    // every tag off an asset the caller only meant to rename.
    await run('assets_update', { assetId: 'a1', name: 'Renamed.png' });
    const [, input] = assets.updateAsset.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(input.tags).toBeUndefined();
    expect(input.name).toBe('Renamed.png');
  });
});
