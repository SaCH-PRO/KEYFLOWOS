/**
 * W11-KEY-ORGAN-OUTPUT-REDACT: KEY organ tools never answer stored connector
 * credentials or portal bearer tokens.
 *
 * Three KEY organ tools handed secrets to the model and to the audit log:
 *
 *   key_connector.list_connections  KeyConnectorService.listConnections maps
 *                                   every IntegrationConnection row with its
 *                                   stored provider credentials (authData).
 *   key_connector.list_providers    getProviders carries the same mapped
 *                                   connection, authData included.
 *   storelink.create_portal_access  answered { accessId, token }: the token is a
 *                                   bearer credential for the contact's portal.
 *
 * The HTTP routes never answer either (key-connector.controller connectionView,
 * review SEC-W7KC-1; FlowOrchestratorService.redactPortalAccess for the flow
 * twin portal_grant_access). In KEY the answer goes to the LLM provider and,
 * through KeyCortexToolRegistryService.audit, into CortexActionLog.result,
 * because auditResultText only takes the call's INPUT values out. Today only the
 * business owner reaches these tools in the chat (owner ruling D-119); the
 * W11 authority map opens some of them to members, so the answers are
 * projected here first.
 *
 * Every assertion over a secret serialises the WHOLE answer and looks for the
 * value, not for one field by name: a secret nested in a row, an array element
 * or a renamed field would pass a `result.token === undefined` check.
 *
 * The two projections (connection-view, portal-access-view) are loaded inside
 * the cases that compare against them, so each secret assertion reports its
 * own failure rather than a module-load error for the whole file.
 *
 * Pure: the adapters run over stubs of KeyConnectorService and PortalService
 * (the real service mapping is reproduced by the packet's real-database probe
 * and pinned at the HTTP door by test/key-connector-authority.integration).
 * Values are obviously fake.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyConnectorAdapterService } from './key-connector-adapter.service';
import { StorelinkAdapterService } from './storelink-adapter.service';
import { auditResultText } from '../key-cortex-tool-registry.service';
import { FlowOrchestratorService } from '../../ai/flow-orchestrator.service';
import { KeyCortexConnectorService } from '../key-cortex-connector.service';
import { SocialAdapterService } from '../adapters/social-adapter.service';
import { SettingsAdapterService } from '../adapters/settings-adapter.service';
import type { KeyCortexToolContext } from '../key-cortex-tool-registry.service';
import type {
  HealthCheckResult,
  KeyConnectorConnection,
  KeyConnectorProviderDef,
  SyncJob,
} from '../../key-connector/key-connector.types';

const BIZ = 'biz_w11_redact';
const CTX: KeyCortexToolContext = { businessId: BIZ };
const CONNECTOR_SECRET = 'fake_connector_secret_w11';
const PORTAL_TOKEN = 'tok_w11';

type ConnectionViewFn = (c: KeyConnectorConnection) => Record<string, unknown>;
type PortalAccessViewFn = (row: Record<string, unknown>) => Record<string, unknown>;

async function loadConnectionView(): Promise<ConnectionViewFn> {
  const mod = (await import('../../key-connector/connection-view')) as { connectionView: ConnectionViewFn };
  return mod.connectionView;
}

async function loadPortalAccessView(): Promise<PortalAccessViewFn> {
  const mod = (await import('../../portal/portal-access-view')) as { portalAccessView: PortalAccessViewFn };
  return mod.portalAccessView;
}

/** A connection exactly as KeyConnectorService.mapDbToConnection answers it: credentials and all. */
function connection(over: Partial<KeyConnectorConnection> = {}): KeyConnectorConnection {
  return {
    id: 'conn_w11_stripe',
    businessId: BIZ,
    providerKey: 'stripe',
    status: 'connected',
    displayName: 'Stripe',
    authData: { secretKey: CONNECTOR_SECRET },
    settings: { currency: 'TTD' },
    lastSyncAt: new Date('2026-11-01T10:00:00Z'),
    lastError: undefined,
    healthScore: 97,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...over,
  };
}

function provider(key: string, name: string): KeyConnectorProviderDef {
  return {
    key,
    name,
    category: 'payments' as KeyConnectorProviderDef['category'],
    description: `${name} provider`,
    authType: 'api_key' as KeyConnectorProviderDef['authType'],
    capabilities: [{ type: 'read', resource: 'payments' } as KeyConnectorProviderDef['capabilities'][number]],
  };
}

const HEALTH: HealthCheckResult = {
  providerKey: 'stripe',
  connectionId: 'conn_w11_stripe',
  status: 'healthy',
  latencyMs: 42,
  message: 'ok',
  checkedAt: new Date('2026-11-02T10:00:00Z'),
};

const SYNC_JOB: SyncJob = {
  id: 'sync_w11_1',
  connectionId: 'conn_w11_stripe',
  providerKey: 'stripe',
  businessId: BIZ,
  status: 'pending' as SyncJob['status'],
  direction: 'bidirectional',
  recordsRead: 0,
  recordsCreated: 0,
  recordsUpdated: 0,
  recordsFailed: 0,
  startedAt: new Date('2026-11-02T11:00:00Z'),
};

function makeConnectorAdapter(over: Record<string, unknown> = {}) {
  const keyConnector = {
    listConnections: vi.fn(async () => [connection(), connection({ id: 'conn_w11_slack', providerKey: 'slack', displayName: 'Slack', authData: { botToken: `${CONNECTOR_SECRET}_bot` } })]),
    listProviders: vi.fn(async () => [
      { provider: provider('stripe', 'Stripe'), connection: connection() },
      { provider: provider('paypal', 'PayPal'), connection: undefined },
    ]),
    checkHealth: vi.fn(async () => HEALTH),
    triggerSync: vi.fn(async () => SYNC_JOB),
    ...over,
  };
  const cortexConnector = { execute: vi.fn(async () => ({ success: true, data: { rows: 3 } })) };
  const adapter = new KeyConnectorAdapterService(keyConnector as never, cortexConnector as never, {} as never);
  return { adapter, keyConnector, cortexConnector };
}

/** A PortalAccess row exactly as Prisma returns it from PortalService.createAccess: token and all. */
function accessRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pa_w11',
    businessId: BIZ,
    contactId: 'contact_w11',
    token: PORTAL_TOKEN,
    enabled: true,
    expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    settings: { invoices: true, projects: true },
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...over,
  };
}

function makeStorelinkAdapter(row: Record<string, unknown> = accessRow()) {
  const portal = { list: vi.fn(async () => []), createAccess: vi.fn(async () => row) };
  const adapter = new StorelinkAdapterService(
    {} as never,
    portal as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { adapter, portal };
}

/** FlowOrchestratorService.redactPortalAccess on a bare prototype instance, as ai/portal-tools.spec does. */
function flowRedact(row: Record<string, unknown>): Record<string, unknown> {
  const svc = Object.create(FlowOrchestratorService.prototype) as {
    redactPortalAccess: (r: Record<string, unknown>) => Record<string, unknown>;
  };
  return svc.redactPortalAccess(row);
}

function serialised(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

describe('W11-KEY-ORGAN-OUTPUT-REDACT: key_connector organ tools never answer stored credentials (SEC-W7KC-1 at the KEY door)', () => {
  it('the stubs really carry the secrets, so the assertions below are not vacuous', async () => {
    const { keyConnector } = makeConnectorAdapter();
    expect(serialised(await keyConnector.listConnections())).toContain(CONNECTOR_SECRET);
    expect(serialised(await keyConnector.listProviders())).toContain(CONNECTOR_SECRET);
    expect(serialised(accessRow())).toContain(PORTAL_TOKEN);
  });

  it('key_connector.list_connections answers no authData key and no stored secret anywhere, in its answer or in its audit text; each connection is connectionView(connection)', async () => {
    const { adapter, keyConnector } = makeConnectorAdapter();
    const out = await adapter.executeTool('key_connector.list_connections', CTX, {});

    expect(keyConnector.listConnections).toHaveBeenCalledWith(BIZ);
    expect(out.success).toBe(true);
    const text = serialised(out);
    expect(text.includes(CONNECTOR_SECRET), 'list_connections answered a stored connector secret').toBe(false);
    expect(text.includes('"authData"'), 'list_connections answered an authData key').toBe(false);
    expect(serialised(auditResultText(out.data, {})).includes(CONNECTOR_SECRET)).toBe(false);

    const connectionView = await loadConnectionView();
    const source = await keyConnector.listConnections();
    const data = out.data as { connections: unknown[]; count: number };
    expect(data.count).toBe(2);
    expect(data.connections).toEqual(source.map((c) => connectionView(c)));
  });

  it('key_connector.list_providers answers each provider unchanged and each connection only as connectionView(connection), with no secret anywhere (the GET key-connector/providers shape)', async () => {
    const { adapter, keyConnector } = makeConnectorAdapter();
    const out = await adapter.executeTool('key_connector.list_providers', CTX, { category: 'payments' });

    expect(keyConnector.listProviders).toHaveBeenCalledWith(BIZ, 'payments');
    expect(out.success).toBe(true);
    const text = serialised(out);
    expect(text.includes(CONNECTOR_SECRET), 'list_providers answered a stored connector secret').toBe(false);
    expect(text.includes('"authData"'), 'list_providers answered an authData key').toBe(false);
    expect(serialised(auditResultText(out.data, { category: 'payments' })).includes(CONNECTOR_SECRET)).toBe(false);

    const connectionView = await loadConnectionView();
    const source = await keyConnector.listProviders();
    const data = out.data as { providers: Array<{ provider: unknown; connection?: unknown }>; count: number };
    expect(data.count).toBe(2);
    expect(data.providers).toEqual(
      source.map((entry) => ({
        provider: entry.provider,
        connection: entry.connection ? connectionView(entry.connection) : undefined,
      })),
    );
    expect(data.providers[0].provider).toEqual(provider('stripe', 'Stripe'));
    expect(data.providers[1].connection).toBeUndefined();
  });

  it('connectionView is an allowlist: a column added to the connection later is not answered by default', async () => {
    const connectionView = await loadConnectionView();
    const widened = { ...connection(), refreshToken: 'rt_w11_added_by_a_future_mapper' } as KeyConnectorConnection;
    const view = connectionView(widened);
    expect(serialised(view).includes('rt_w11_added_by_a_future_mapper')).toBe(false);
    expect(serialised(view).includes(CONNECTOR_SECRET)).toBe(false);
    expect(Object.keys(view).sort()).toEqual(
      [
        'businessId',
        'createdAt',
        'displayName',
        'healthScore',
        'id',
        'lastError',
        'lastSyncAt',
        'providerKey',
        'settings',
        'status',
        'updatedAt',
      ].sort(),
    );
  });

  it('control: key_connector.check_health and trigger_sync answers are unchanged (HealthCheckResult and SyncJob carry no credentials); execute_internal answers a module answer without secrets as it came (SEC-W11OR-1 backstop changes nothing there)', async () => {
    const { adapter, keyConnector, cortexConnector } = makeConnectorAdapter();

    const health = await adapter.executeTool('key_connector.check_health', CTX, { connectionId: 'conn_w11_stripe' });
    expect(keyConnector.checkHealth).toHaveBeenCalledWith(BIZ, 'conn_w11_stripe');
    expect(health).toEqual({ success: true, data: HEALTH });

    const sync = await adapter.executeTool('key_connector.trigger_sync', CTX, { connectionId: 'conn_w11_stripe' });
    expect(keyConnector.triggerSync).toHaveBeenCalledWith(BIZ, 'conn_w11_stripe');
    expect(sync).toEqual({ success: true, data: SYNC_JOB });

    const internal = await adapter.executeTool('key_connector.execute_internal', CTX, { module: 'crm', action: 'count' });
    expect(cortexConnector.execute).toHaveBeenCalledTimes(1);
    expect(internal).toEqual({ success: true, data: { success: true, data: { rows: 3 } } });
  });
});

/**
 * Review SEC-W11OR-1: key_connector.execute_internal forwarded the
 * KeyCortexConnectorService answer as it came, and two module actions behind it
 * answer raw credential rows (social.get_connected_accounts: SocialConnection
 * token and refreshToken; settings.configure_integration: the upserted
 * IntegrationConnection with authData and authDataRef). These cases run the
 * REAL KeyCortexConnectorService dispatch and the real social and settings
 * adapters over stubbed SocialConnectionsService, IntegrationHubService and
 * Prisma, so the answer is the one those actions really give.
 */
const SOCIAL_TOKEN = 'fake_fbpage_access_tok_w11r';
const SOCIAL_REFRESH = 'fake_fbpage_refresh_tok_w11r';
const STORED_SECRET = 'fake_stored_connector_secret_w11r';
const STORED_BARE_KEY = 'fake_stored_bare_key_w11r';
const AUTH_DATA_REF = 'fake_vault_ref_w11r';
const ACTOR = 'user_w11r_owner';

/** KeyCortexConnectorService constructor positions (registry 0 .. bridge 19): social 14, settings 18. */
function realCortexConnector(parts: { social?: unknown; settings?: unknown }): KeyCortexConnectorService {
  const args: unknown[] = Array.from({ length: 20 }, () => ({}));
  args[14] = parts.social ?? {};
  args[18] = parts.settings ?? {};
  return new KeyCortexConnectorService(...(args as ConstructorParameters<typeof KeyCortexConnectorService>));
}

function socialConnectionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sc_w11r_fb',
    businessId: BIZ,
    platform: 'FACEBOOK',
    platformId: 'page_w11r',
    accountName: 'W11R Page',
    profilePicture: null,
    token: SOCIAL_TOKEN,
    refreshToken: SOCIAL_REFRESH,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    scopes: 'pages_manage_posts',
    status: 'CONNECTED',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...over,
  };
}

function integrationConnectionRow(): Record<string, unknown> {
  return {
    id: 'ic_w11r_stripe',
    businessId: BIZ,
    providerKey: 'stripe',
    displayName: null,
    status: 'CONNECTED',
    authDataRef: AUTH_DATA_REF,
    authData: { secretKey: STORED_SECRET, key: STORED_BARE_KEY },
    scopes: [],
    settings: { currency: 'TTD' },
    healthScore: 100,
    lastSyncAt: null,
    lastError: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
  };
}

function internalAdapter(cortexConnector: unknown) {
  return new KeyConnectorAdapterService({} as never, cortexConnector as never, {} as never);
}

describe('W11-KEY-ORGAN-OUTPUT-REDACT review SEC-W11OR-1: key_connector.execute_internal never answers stored credentials from the module actions behind it', () => {
  it('social.get_connected_accounts through execute_internal answers each SocialConnection without its token or refreshToken value, in its answer or in its audit text; the account fields stay', async () => {
    const connections = {
      listConnections: vi.fn(async () => [socialConnectionRow()]),
      getConnection: vi.fn(async () => socialConnectionRow()),
    };
    const social = new SocialAdapterService({} as never, connections as never, {} as never, {} as never, {} as never);
    const adapter = internalAdapter(realCortexConnector({ social }));

    for (const input of [
      { module: 'social', action: 'get_connected_accounts' },
      { module: 'social', action: 'get_connected_accounts', params: { platform: 'facebook' } },
    ]) {
      const out = await adapter.executeTool('key_connector.execute_internal', { businessId: BIZ, userId: ACTOR }, input);
      expect(out.success).toBe(true);
      const text = serialised(out);
      expect(text.includes(SOCIAL_TOKEN), 'execute_internal answered a social page token').toBe(false);
      expect(text.includes(SOCIAL_REFRESH), 'execute_internal answered a social refresh token').toBe(false);
      const audit = auditResultText(out.data, input) ?? '';
      expect(audit.includes(SOCIAL_TOKEN) || audit.includes(SOCIAL_REFRESH), 'the audit text kept a social token').toBe(false);

      const answer = out.data as { success: boolean; data: Array<Record<string, unknown>> };
      expect(answer.success).toBe(true);
      expect(answer.data).toHaveLength(1);
      expect(answer.data[0]).toMatchObject({ id: 'sc_w11r_fb', platform: 'FACEBOOK', accountName: 'W11R Page', status: 'CONNECTED' });
    }
    expect(connections.listConnections).toHaveBeenCalledWith(BIZ);
    expect(connections.getConnection).toHaveBeenCalledWith(BIZ, 'facebook');
  });

  it('settings.configure_integration through execute_internal answers the IntegrationConnection without its authData or authDataRef, in its answer or in its audit text; the connection fields stay', async () => {
    const integrations = { createConnection: vi.fn(async () => integrationConnectionRow()) };
    const prisma = {
      client: {
        user: { findUnique: vi.fn(async () => ({ role: 'USER' })) },
        // connect admin (R0-09c ST-6) and settings admin (SWEEP-P0-SCOPES round 1 class repair: binding an integration).
        membership: { findUnique: vi.fn(async () => ({ role: 'OWNER', permissionScopes: { connect: 'admin', settings: 'admin' } })) },
      },
    };
    const settings = new SettingsAdapterService({} as never, integrations as never, prisma as never);
    const adapter = internalAdapter(realCortexConnector({ settings }));
    const input = { module: 'settings', action: 'configure_integration', params: { integration: 'stripe', enabled: true } };

    const out = await adapter.executeTool('key_connector.execute_internal', { businessId: BIZ, userId: ACTOR }, input);
    expect(out.success).toBe(true);
    expect(integrations.createConnection).toHaveBeenCalledWith(BIZ, 'stripe', { settings: {}, scopes: [] });
    const text = serialised(out);
    for (const secret of [STORED_SECRET, STORED_BARE_KEY, AUTH_DATA_REF]) {
      expect(text.includes(secret), `execute_internal answered a stored connector credential (${secret})`).toBe(false);
      expect((auditResultText(out.data, input) ?? '').includes(secret), 'the audit text kept a stored credential').toBe(false);
    }

    const answer = out.data as { success: boolean; data: Record<string, unknown> };
    expect(answer.success).toBe(true);
    // Both columns are withheld whole, with deepRedact's marker: authData's own
    // keys (here a bare `key`) need not match any shared sensitive name.
    expect(answer.data.authData).toBe('***REDACTED***');
    expect(answer.data.authDataRef).toBe('***REDACTED***');
    expect(answer.data).toMatchObject({ id: 'ic_w11r_stripe', providerKey: 'stripe', status: 'CONNECTED', settings: { currency: 'TTD' } });
  });

  it('the backstop holds for any module answer, at any depth: shared sensitive names and connector credential columns are withheld, other fields and BigInt counts are answered, and the module answer object is not changed', async () => {
    const moduleAnswer = {
      success: true,
      data: {
        rows: [
          { id: 'row_w11r', apiKey: 'fake_api_key_w11r', nested: { password: 'fake_password_w11r', label: 'kept_w11r' } },
          { id: 'row_w11r_2', connection: { authData: { key: STORED_BARE_KEY } } },
        ],
        total: BigInt(7),
      },
    };
    const before = JSON.stringify(moduleAnswer, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    const adapter = internalAdapter({ execute: vi.fn(async () => moduleAnswer) });

    const out = await adapter.executeTool('key_connector.execute_internal', CTX, { module: 'crm', action: 'count' });
    const text = serialised(out);
    for (const secret of ['fake_api_key_w11r', 'fake_password_w11r', STORED_BARE_KEY]) {
      expect(text.includes(secret), `execute_internal answered ${secret}`).toBe(false);
    }
    expect(text).toContain('kept_w11r');
    expect(text).toContain('row_w11r_2');
    expect((out.data as { data: { total: unknown } }).data.total).toBe('7');
    expect(JSON.stringify(moduleAnswer, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
  });

  it('a module answer with no JSON form (a cycle) keeps only its outcome, still answered as a success because the action may already have written', async () => {
    const cyclic: Record<string, unknown> = { success: true, data: { token: 'fake_cycle_tok_w11r' } };
    (cyclic.data as Record<string, unknown>).self = cyclic;
    const adapter = internalAdapter({ execute: vi.fn(async () => cyclic) });

    const out = await adapter.executeTool('key_connector.execute_internal', CTX, { module: 'crm', action: 'count' });
    expect(out.success).toBe(true);
    expect(out.data).toEqual({ success: true, dataWithheld: 'the module answer has no JSON form' });
    expect(serialised(out).includes('fake_cycle_tok_w11r')).toBe(false);
  });
});

describe('W11-KEY-ORGAN-OUTPUT-REDACT: storelink.create_portal_access never answers the portal bearer token', () => {
  it('answers no token key and no token value, in its answer or in its audit text; the answer is the allowlist with a live link, keeping accessId', async () => {
    const row = accessRow();
    const { adapter, portal } = makeStorelinkAdapter(row);
    const out = await adapter.executeTool('storelink.create_portal_access', CTX, {
      contactId: 'contact_w11',
      settings: { invoices: true },
    });

    expect(portal.createAccess).toHaveBeenCalledWith(BIZ, 'contact_w11', { invoices: true });
    expect(out.success).toBe(true);
    const text = serialised(out);
    expect(text.includes(PORTAL_TOKEN), 'create_portal_access answered the portal bearer token').toBe(false);
    expect(text.includes('"token"'), 'create_portal_access answered a token key').toBe(false);
    expect(serialised(auditResultText(out.data, { contactId: 'contact_w11' })).includes(PORTAL_TOKEN)).toBe(false);

    const portalAccessView = await loadPortalAccessView();
    expect(out.data).toEqual({ accessId: 'pa_w11', ...portalAccessView(row) });
    expect((out.data as { hasLiveLink: boolean }).hasLiveLink).toBe(true);
  });

  it('parity: portalAccessView gives the same fields as FlowOrchestratorService.redactPortalAccess for the same row (live, expired, disabled)', async () => {
    const portalAccessView = await loadPortalAccessView();
    const rows = [
      accessRow(),
      accessRow({ expiresAt: new Date(Date.now() - 60_000) }),
      accessRow({ enabled: false, lastAccessedAt: new Date('2026-11-03T09:00:00Z'), accessCount: 4 }),
    ];
    for (const row of rows) {
      expect(portalAccessView(row)).toEqual(flowRedact(row));
    }
    expect(portalAccessView(rows[0]).hasLiveLink).toBe(true);
    expect(portalAccessView(rows[1]).hasLiveLink).toBe(false);
    expect(portalAccessView(rows[2]).hasLiveLink).toBe(false);
  });

  it('portalAccessView is an allowlist: a future secret column on the row is not answered', async () => {
    const portalAccessView = await loadPortalAccessView();
    const row = accessRow({ signingKey: 'sig_w11_added_by_a_future_migration' });
    const view = portalAccessView(row);
    expect(serialised(view).includes('sig_w11_added_by_a_future_migration')).toBe(false);
    expect(serialised(view).includes(PORTAL_TOKEN)).toBe(false);

    const { adapter } = makeStorelinkAdapter(row);
    const out = await adapter.executeTool('storelink.create_portal_access', CTX, { contactId: 'contact_w11' });
    expect(serialised(out).includes('sig_w11_added_by_a_future_migration')).toBe(false);
  });
});
