import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { KeyConnectorService } from '../key-connector.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { HealthCheckService } from '../health/health-check.service';
import { SyncEngineService } from '../sync/sync-engine.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';

// ── Mock @keyflow/db ──────────────────────────────────────────────────
const mockDb = {
  integrationConnection: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  syncJob: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  connectorAuditLog: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  connectorHealthLog: {
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
};

jest.mock('@keyflow/db', () => ({ db: mockDb }));

// ── Test Suite ────────────────────────────────────────────────────────

describe('KeyConnectorService', () => {
  let service: KeyConnectorService;
  let registry: ProviderRegistryService;

  const TEST_BUSINESS_ID = 'biz_123';
  const TEST_USER_ID = 'user_456';
  const TEST_CONNECTION_ID = 'conn_789';
  const TEST_PROVIDER_KEY = 'google_contacts';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyConnectorService,
        ProviderRegistryService,
        HealthCheckService,
        SyncEngineService,
        AiGatewayService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn().mockReturnValue(of({ status: 200, data: {} })),
            post: jest.fn().mockReturnValue(of({ status: 200, data: {} })),
          },
        },
      ],
    }).compile();

    service = module.get<KeyConnectorService>(KeyConnectorService);
    registry = module.get<ProviderRegistryService>(ProviderRegistryService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(registry).toBeDefined();
  });

  // ══════════════════════════════════════════════════════════════════════
  // getProviders
  // ══════════════════════════════════════════════════════════════════════

  describe('getProviders', () => {
    it('should return all providers with connection status', async () => {
      mockDb.integrationConnection.findMany.mockResolvedValue([
        {
          id: TEST_CONNECTION_ID,
          businessId: TEST_BUSINESS_ID,
          providerKey: TEST_PROVIDER_KEY,
          status: 'connected',
          displayName: 'Google Contacts',
          authData: { accessToken: 'abc' },
          settings: {},
          lastSyncAt: new Date(),
          lastError: null,
          healthScore: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getProviders(TEST_BUSINESS_ID);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Should contain the google_contacts provider with a connection
      const googleContacts = result.find(
        (r) => r.provider.key === TEST_PROVIDER_KEY,
      );
      expect(googleContacts).toBeDefined();
      expect(googleContacts?.connection).toBeDefined();
      expect(googleContacts?.connection?.status).toBe('connected');
    });

    it('should filter providers by category', async () => {
      mockDb.integrationConnection.findMany.mockResolvedValue([]);

      const result = await service.getProviders(
        TEST_BUSINESS_ID,
        'internal',
      );

      expect(result.every((r) => r.provider.category === 'internal')).toBe(
        true,
      );
      expect(result.length).toBe(19); // 19 internal modules
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // connectProvider
  // ══════════════════════════════════════════════════════════════════════

  describe('connectProvider', () => {
    it('should create a new connection', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue(null);
      mockDb.integrationConnection.create.mockResolvedValue({
        id: TEST_CONNECTION_ID,
        businessId: TEST_BUSINESS_ID,
        providerKey: TEST_PROVIDER_KEY,
        status: 'connected',
        displayName: 'Google Contacts',
        authData: { accessToken: 'abc' },
        settings: {},
        lastSyncAt: null,
        lastError: null,
        healthScore: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockDb.connectorAuditLog.create.mockResolvedValue({});

      const result = await service.connectProvider(
        TEST_BUSINESS_ID,
        TEST_USER_ID,
        TEST_PROVIDER_KEY,
        { accessToken: 'abc' },
        {},
        'My Google Contacts',
      );

      expect(result).toBeDefined();
      expect(result.providerKey).toBe(TEST_PROVIDER_KEY);
      expect(result.status).toBe('connected');
      expect(mockDb.integrationConnection.create).toHaveBeenCalledTimes(1);
    });

    it('should reject duplicate connections', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: TEST_CONNECTION_ID,
        providerKey: TEST_PROVIDER_KEY,
      });

      await expect(
        service.connectProvider(
          TEST_BUSINESS_ID,
          TEST_USER_ID,
          TEST_PROVIDER_KEY,
          {},
        ),
      ).rejects.toThrow(/already exists/);
    });

    it('should reject unknown providers', async () => {
      await expect(
        service.connectProvider(
          TEST_BUSINESS_ID,
          TEST_USER_ID,
          'nonexistent_provider',
          {},
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // disconnectProvider
  // ══════════════════════════════════════════════════════════════════════

  describe('disconnectProvider', () => {
    it('should delete an existing connection', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: TEST_CONNECTION_ID,
        businessId: TEST_BUSINESS_ID,
        providerKey: TEST_PROVIDER_KEY,
      });
      mockDb.integrationConnection.delete.mockResolvedValue({});
      mockDb.connectorAuditLog.create.mockResolvedValue({});

      await service.disconnectProvider(
        TEST_BUSINESS_ID,
        TEST_CONNECTION_ID,
        TEST_USER_ID,
      );

      expect(mockDb.integrationConnection.delete).toHaveBeenCalledWith({
        where: { id: TEST_CONNECTION_ID },
      });
    });

    it('should throw for non-existent connection', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.disconnectProvider(
          TEST_BUSINESS_ID,
          'nonexistent_conn',
          TEST_USER_ID,
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // getConnections
  // ══════════════════════════════════════════════════════════════════════

  describe('getConnections', () => {
    it('should return all connections for a business', async () => {
      mockDb.integrationConnection.findMany.mockResolvedValue([
        {
          id: TEST_CONNECTION_ID,
          businessId: TEST_BUSINESS_ID,
          providerKey: 'stripe',
          status: 'connected',
          displayName: 'Stripe',
          authData: {},
          settings: {},
          lastSyncAt: null,
          lastError: null,
          healthScore: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getConnections(TEST_BUSINESS_ID);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].providerKey).toBe('stripe');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // getConnectionHealth
  // ══════════════════════════════════════════════════════════════════════

  describe('getConnectionHealth', () => {
    it('should return health results for all connections', async () => {
      mockDb.integrationConnection.findMany.mockResolvedValue([]);

      const result = await service.getConnectionHealth(TEST_BUSINESS_ID);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // processAiCommand
  // ══════════════════════════════════════════════════════════════════════

  describe('processAiCommand', () => {
    it('should route a command to a module', async () => {
      const command = {
        intent: 'list contacts',
        module: 'crm',
        action: 'list_contacts',
        parameters: { limit: 10 },
        businessId: TEST_BUSINESS_ID,
        userId: TEST_USER_ID,
      };

      const result = await service.processAiCommand(
        TEST_BUSINESS_ID,
        TEST_USER_ID,
        command,
      );

      expect(result).toBeDefined();
      expect(result.routedTo).toBe('crm');
    });

    it('should route a command to an external provider', async () => {
      mockDb.integrationConnection.findFirst.mockResolvedValue({
        id: TEST_CONNECTION_ID,
        status: 'connected',
      });

      const command = {
        intent: 'send email',
        provider: 'sendgrid',
        action: 'send_email',
        parameters: { to: 'test@example.com', subject: 'Hello' },
        businessId: TEST_BUSINESS_ID,
        userId: TEST_USER_ID,
      };

      const result = await service.processAiCommand(
        TEST_BUSINESS_ID,
        TEST_USER_ID,
        command,
      );

      expect(result).toBeDefined();
      expect(result.routedTo).toBe('sendgrid');
    });

    it('should handle NL routing via intent keywords', async () => {
      mockDb.connectorAuditLog.create.mockResolvedValue({});

      const command = {
        intent: 'find leads',
        parameters: { originalText: 'find leads' },
        businessId: TEST_BUSINESS_ID,
        userId: TEST_USER_ID,
      };

      const result = await service.processAiCommand(
        TEST_BUSINESS_ID,
        TEST_USER_ID,
        command,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // getAuditLog
  // ══════════════════════════════════════════════════════════════════════

  describe('getAuditLog', () => {
    it('should return audit entries', async () => {
      mockDb.connectorAuditLog.findMany.mockResolvedValue([
        {
          id: 'audit_1',
          businessId: TEST_BUSINESS_ID,
          userId: TEST_USER_ID,
          providerKey: TEST_PROVIDER_KEY,
          connectionId: TEST_CONNECTION_ID,
          action: 'connect_provider',
          status: 'success',
          details: JSON.stringify({ providerName: 'Google Contacts' }),
          createdAt: new Date(),
        },
      ]);

      const result = await service.getAuditLog(TEST_BUSINESS_ID);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].action).toBe('connect_provider');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // getSyncHistory
  // ══════════════════════════════════════════════════════════════════════

  describe('getSyncHistory', () => {
    it('should return sync history', async () => {
      mockDb.syncJob.findMany.mockResolvedValue([]);

      const result = await service.getSyncHistory(TEST_BUSINESS_ID);

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
