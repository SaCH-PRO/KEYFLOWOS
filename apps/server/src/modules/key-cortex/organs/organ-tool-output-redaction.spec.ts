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
import type { KeyCortexToolContext } from '../key-cortex-tool-registry.service';
import type {
  HealthCheckResult,
  KeyConnectorConnection,
  KeyConnectorProviderDef,
  SyncJob,
} from '../../key-connector/key-connector.types';

const BIZ = 'biz_w11_redact';
const CTX: KeyCortexToolContext = { businessId: BIZ };
const CONNECTOR_SECRET = 'sk_live_w11';
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

  it('control: key_connector.check_health, trigger_sync and execute_internal answers are unchanged (HealthCheckResult and SyncJob carry no credentials)', async () => {
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
