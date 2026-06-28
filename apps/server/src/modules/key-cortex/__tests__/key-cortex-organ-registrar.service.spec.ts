import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexOrganRegistrarService } from '../key-cortex-organ-registrar.service';
import { KeyCortexToolRegistryService } from '../key-cortex-tool-registry.service';
import { KeyCortexSafeDatabaseService } from '../key-cortex-safe-database.service';
import { TemporalFlowAdapterService } from '../organs/temporal-flow-adapter.service';
import { KeyInboxAdapterService } from '../organs/key-inbox-adapter.service';
import { KeyGenomeAdapterService } from '../organs/key-genome-adapter.service';
import { StorelinkAdapterService } from '../organs/storelink-adapter.service';
import { KeyConnectorAdapterService } from '../organs/key-connector-adapter.service';

function makeRegistrar(): {
  registrar: KeyCortexOrganRegistrarService;
  registry: KeyCortexToolRegistryService;
} {
  const mockPrisma = { client: { cortexActionLog: { create: vi.fn().mockResolvedValue({}) } } } as any;
  const registry = new KeyCortexToolRegistryService(mockPrisma);

  const mockBus = { publish: vi.fn(), emit: vi.fn() } as any;
  const safeDatabase = new KeyCortexSafeDatabaseService(mockPrisma, mockBus);
  const mockTemporal = { analyze: vi.fn(), emit: vi.fn(), list: vi.fn() } as any;
  const temporalAdapter = new TemporalFlowAdapterService(mockTemporal, mockBus);

  const mockInbox = {
    listThreads: vi.fn(),
    listInsights: vi.fn(),
    getThread: vi.fn(),
    addReply: vi.fn(),
    updateThread: vi.fn(),
    generateBrief: vi.fn(),
  } as any;
  const mockReplySender = {} as any;
  const inboxAdapter = new KeyInboxAdapterService(mockInbox, mockReplySender, mockBus);

  const mockBlueprint = {
    getBlueprint: vi.fn(),
    calculateGenomeIntegrity: vi.fn(),
    updateDnaSection: vi.fn(),
  } as any;
  const mockSignal = { listSignals: vi.fn() } as any;
  const mockRecommendation = { listRecommendations: vi.fn() } as any;
  const mockFact = { listFacts: vi.fn() } as any;
  const mockReadiness = { getReadiness: vi.fn() } as any;
  const mockScoring = { computeBusinessScore: vi.fn().mockReturnValue({}) } as any;
  const genomeAdapter = new KeyGenomeAdapterService(
    mockBlueprint,
    mockSignal,
    mockRecommendation,
    mockFact,
    mockReadiness,
    mockScoring,
    mockBus,
  );

  const mockSite = {
    getStorefrontConfig: vi.fn(),
    getAnalytics: vi.fn(),
    getConversionFunnel: vi.fn(),
    getProductHealthAudit: vi.fn(),
  } as any;
  const mockPortal = { list: vi.fn() } as any;
  const mockPortalContent = {} as any;
  const mockPromo = { create: vi.fn() } as any;
  const mockIntake = { listForBusiness: vi.fn() } as any;
  const storelinkAdapter = new StorelinkAdapterService(
    mockSite,
    mockPortal,
    mockPortalContent,
    mockPromo,
    mockIntake,
    mockBus,
  );

  const mockKeyConnector = { listProviders: vi.fn(), listConnections: vi.fn(), checkHealth: vi.fn(), triggerSync: vi.fn() } as any;
  const mockCortexConnector = { execute: vi.fn() } as any;
  const mockExternalConnector = { execute: vi.fn() } as any;
  const connectorAdapter = new KeyConnectorAdapterService(
    mockKeyConnector,
    mockCortexConnector,
    mockExternalConnector,
    mockBus,
  );

  const registrar = new KeyCortexOrganRegistrarService(
    registry,
    temporalAdapter,
    inboxAdapter,
    genomeAdapter,
    storelinkAdapter,
    connectorAdapter,
    safeDatabase,
  );

  return { registrar, registry };
}

describe('KeyCortexOrganRegistrarService', () => {
  let registrar: KeyCortexOrganRegistrarService;
  let registry: KeyCortexToolRegistryService;

  beforeEach(() => {
    const setup = makeRegistrar();
    registrar = setup.registrar;
    registry = setup.registry;
  });

  it('registers tools from all organ adapters', () => {
    registrar.onModuleInit();
    const stats = registry.getStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.byModule.temporal_flow).toBeGreaterThan(0);
    expect(stats.byModule.key_inbox).toBeGreaterThan(0);
    expect(stats.byModule.key_genome).toBeGreaterThan(0);
    expect(stats.byModule.storelink).toBeGreaterThan(0);
    expect(stats.byModule.key_connector).toBeGreaterThan(0);
    expect(stats.byModule.key_cortex).toBeGreaterThan(0);
  });

  it('registers expected example tools', () => {
    registrar.onModuleInit();
    expect(registry.hasTool('temporal_flow.list_events')).toBe(true);
    expect(registry.hasTool('key_inbox.send_reply')).toBe(true);
    expect(registry.hasTool('key_genome.get_blueprint')).toBe(true);
    expect(registry.hasTool('storelink.get_analytics')).toBe(true);
    expect(registry.hasTool('key_connector.list_providers')).toBe(true);
    expect(registry.hasTool('cortex.query_database')).toBe(true);
    expect(registry.hasTool('cortex.update_record')).toBe(true);
  });

  it('does not duplicate register if called twice', () => {
    registrar.onModuleInit();
    const first = registry.getStats().total;
    registrar.onModuleInit();
    const second = registry.getStats().total;
    expect(second).toBe(first);
  });
});
