import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { CrmController } from '../src/modules/crm/crm.controller';
import { CrmService } from '../src/modules/crm/crm.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { CrmRateLimitGuard } from '../src/modules/crm/guards/rate-limit.guard';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { FeatureFlagGuard } from '../src/modules/crm/guards/feature-flag.guard';
import { TeamAuditInterceptor } from '../src/core/interceptors/team-audit.interceptor';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { CrmTimelineService } from '../src/modules/crm/crm-timeline.service';
import { CrmStatsService } from '../src/modules/crm/crm-stats.service';
import { CrmImportService } from '../src/modules/crm/crm-import.service';
import { CrmPlaybookService } from '../src/modules/crm/crm-playbook.service';
import { CrmFlowService } from '../src/modules/crm/crm-flow.service';
import { CrmActionsService } from '../src/modules/crm/crm-actions.service';
import { CrmRevenueService } from '../src/modules/crm/crm-revenue.service';
import { CrmJourneyService } from '../src/modules/crm/crm-journey.service';
import { CrmDuplicateDetectionService } from '../src/modules/crm/crm-duplicate-detection.service';
import { CrmDataQualityService } from '../src/modules/crm/crm-data-quality.service';
import { CrmSavedViewsService } from '../src/modules/crm/crm-saved-views.service';
import { CrmRelationshipHealthService } from '../src/modules/crm/crm-relationship-health.service';
import { CrmCommunicationService } from '../src/modules/crm/crm-communication.service';
import { BestChannelService } from '../src/modules/crm/best-channel.service';
import { ConversationAiService } from '../src/modules/crm/conversation-ai.service';
import { CrmNetworkService } from '../src/modules/crm/crm-network.service';
import { ContactInsightService } from '../src/modules/crm/contact-insight.service';

interface MembershipSeed {
  userId: string;
  businessId: string;
  role: string;
  permissionScopes?: Record<string, string> | null;
}

interface BusinessSeed {
  id: string;
  metaData?: Record<string, unknown> | null;
}

class CrmPrismaMock {
  memberships: MembershipSeed[] = [];
  businesses: BusinessSeed[] = [];
  teamActivityLogs: any[] = [];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      membership: {
        findUnique: vi.fn(({ where }: any) => {
          const composite = where.userId_businessId;
          if (!composite) return Promise.resolve(null);
          const match = self.memberships.find(
            (m) => m.userId === composite.userId && m.businessId === composite.businessId,
          );
          return Promise.resolve(match ?? null);
        }),
      },
      business: {
        findUnique: vi.fn(({ where }: any) =>
          Promise.resolve(self.businesses.find((b) => b.id === where.id) ?? null),
        ),
      },
      teamActivityLog: {
        create: vi.fn(({ data }: any) => {
          const item = { id: `log_${self.teamActivityLogs.length + 1}`, ...data, createdAt: new Date() };
          self.teamActivityLogs.push(item);
          return Promise.resolve(item);
        }),
      },
    };
  }
}

const crmServiceMock = {
  contacts: [] as any[],
  listContacts: vi.fn((input: { businessId: string }) =>
    crmServiceMock.contacts.filter((c: any) => c.businessId === input.businessId),
  ),
  createContact: vi.fn((input: { businessId: string; firstName?: string; email?: string }) => {
    const item = { id: `contact_${crmServiceMock.contacts.length + 1}`, status: 'LEAD', ...input };
    crmServiceMock.contacts.push(item);
    return item;
  }),
  updateContact: vi.fn(),
  mergeContacts: vi.fn(),
  addTask: vi.fn(),
};

const flowServiceMock = {
  getFlowIntelligence: vi.fn().mockResolvedValue({ insights: [] }),
};

const subscriptionsMock = {
  checkLimit: vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 1000, upgradeTo: 'PRO' }),
};

describe('CRM e2e', () => {
  let app: INestApplication;
  let prisma: CrmPrismaMock;

  beforeAll(async () => {
    prisma = new CrmPrismaMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        ModuleScopeGuard,
        FeatureFlagGuard,
        PlanLimitGuard,
        TeamAuditInterceptor,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptionsMock },
        { provide: CrmService, useValue: crmServiceMock },
        { provide: CrmTimelineService, useValue: { addTask: vi.fn().mockResolvedValue({ id: 'task_1' }) } },
        { provide: CrmStatsService, useValue: { getCacheMetrics: () => ({}) } },
        { provide: CrmImportService, useValue: {} },
        { provide: CrmPlaybookService, useValue: {} },
        { provide: CrmFlowService, useValue: flowServiceMock },
        { provide: CrmActionsService, useValue: {} },
        { provide: CrmRevenueService, useValue: {} },
        { provide: CrmJourneyService, useValue: {} },
        { provide: CrmDuplicateDetectionService, useValue: {} },
        { provide: CrmDataQualityService, useValue: {} },
        { provide: CrmSavedViewsService, useValue: {} },
        { provide: CrmRelationshipHealthService, useValue: {} },
        { provide: CrmCommunicationService, useValue: {} },
        { provide: BestChannelService, useValue: {} },
        { provide: ConversationAiService, useValue: {} },
        { provide: CrmNetworkService, useValue: {} },
        { provide: ContactInsightService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CrmRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user_1', role: 'OWNER' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    crmServiceMock.contacts = [];
    vi.clearAllMocks();
    crmServiceMock.listContacts.mockImplementation((input: { businessId: string }) =>
      crmServiceMock.contacts.filter((c: any) => c.businessId === input.businessId),
    );
    flowServiceMock.getFlowIntelligence.mockResolvedValue({ insights: [] });
    subscriptionsMock.checkLimit.mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 1000,
      upgradeTo: 'PRO',
    });
    prisma.memberships = [
      { userId: 'user_1', businessId: 'biz_1', role: 'OWNER', permissionScopes: { crm: 'admin' } },
      { userId: 'user_1', businessId: 'biz_2', role: 'ADMIN', permissionScopes: { crm: 'admin' } },
      { userId: 'user_1', businessId: 'biz_3', role: 'OWNER', permissionScopes: { crm: 'admin' } },
      { userId: 'user_1', businessId: 'biz_4', role: 'OWNER', permissionScopes: { crm: 'admin' } },
    ];
    prisma.businesses = [
      { id: 'biz_1', metaData: { features: { insights: true } } },
      { id: 'biz_2', metaData: { features: { insights: true } } },
      { id: 'biz_3', metaData: { features: { insights: true } } },
      { id: 'biz_4', metaData: { features: { insights: true } } },
    ];
    prisma.teamActivityLogs = [];
  });

  it('creates and lists contacts for a business', async () => {
    const agent = request(app.getHttpServer());
    await agent
      .post('/crm/businesses/biz_1/contacts')
      .send({ firstName: 'Alice', email: 'alice@example.com' })
      .expect(201);

    const res = await agent.get('/crm/businesses/biz_1/contacts').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].firstName).toBe('Alice');
    expect(crmServiceMock.listContacts).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1' }),
    );
  });

  it('writes a team-audit log entry when a contact is created', async () => {
    await request(app.getHttpServer())
      .post('/crm/businesses/biz_1/contacts')
      .send({ firstName: 'Audit', email: 'audit@example.com' })
      .expect(201);

    // Allow tap() side-effect to flush
    await new Promise((r) => setImmediate(r));

    expect(prisma.teamActivityLogs).toHaveLength(1);
    expect(prisma.teamActivityLogs[0]).toMatchObject({
      businessId: 'biz_1',
      userId: 'user_1',
      module: 'crm',
      action: 'contact_created',
      entityType: 'contact',
    });
    expect(prisma.teamActivityLogs[0].entityId).toBeDefined();
  });

  it('updates a contact and passes business scoping', async () => {
    const agent = request(app.getHttpServer());
    crmServiceMock.updateContact.mockResolvedValue({ id: 'contact_99', status: 'CLIENT' });
    await agent
      .patch('/crm/businesses/biz_2/contacts/contact_99')
      .send({ status: 'CLIENT' })
      .expect(200);
    expect(crmServiceMock.updateContact).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_2', contactId: 'contact_99', status: 'CLIENT' }),
    );
  });

  it('adds tasks with priority and reminder', async () => {
    const agent = request(app.getHttpServer());
    const timelineMock = (app.get(CrmController) as any).timeline as { addTask: ReturnType<typeof vi.fn> };
    timelineMock.addTask = vi.fn().mockResolvedValue({ id: 'task_1', title: 'Follow up' });
    await agent
      .post('/crm/businesses/biz_3/contacts/contact_3/tasks')
      .send({ title: 'Follow up', priority: 'HIGH', remindAt: '2024-01-01T00:00:00.000Z' })
      .expect(201);
    expect(timelineMock.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_3',
        contactId: 'contact_3',
        title: 'Follow up',
        priority: 'HIGH',
        remindAt: '2024-01-01T00:00:00.000Z',
      }),
    );
  });

  it('merges contacts with primary/duplicate ids', async () => {
    const agent = request(app.getHttpServer());
    crmServiceMock.mergeContacts.mockResolvedValue({ id: 'contact_primary' });
    await agent
      .post('/crm/businesses/biz_4/contacts/contact_primary/merge/contact_duplicate')
      .send({})
      .expect(201);
    expect(crmServiceMock.mergeContacts).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_4',
        primaryId: 'contact_primary',
        duplicateId: 'contact_duplicate',
      }),
    );
  });

  it('rejects writes when the user is not a member of the business', async () => {
    prisma.memberships = [];
    const res = await request(app.getHttpServer())
      .post('/crm/businesses/biz_1/contacts')
      .send({ firstName: 'NoAccess', email: 'noaccess@example.com' })
      .expect(403);
    expect(res.body.message).toMatch(/Not a member/);
    expect(crmServiceMock.createContact).not.toHaveBeenCalled();
  });

  it('rejects writes when the membership only grants read access on the module', async () => {
    prisma.memberships = [
      { userId: 'user_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: { crm: 'read' } },
    ];
    const res = await request(app.getHttpServer())
      .post('/crm/businesses/biz_1/contacts')
      .send({ firstName: 'ReadOnly', email: 'readonly@example.com' })
      .expect(403);
    expect(res.body.message).toMatch(/Insufficient permissions/);
    expect(crmServiceMock.createContact).not.toHaveBeenCalled();
  });

  it('still allows reads when only read scope is granted', async () => {
    prisma.memberships = [
      { userId: 'user_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: { crm: 'read' } },
    ];
    await request(app.getHttpServer()).get('/crm/businesses/biz_1/contacts').expect(200);
  });

  it('rejects creation when the plan-limit guard reports the limit is exhausted', async () => {
    subscriptionsMock.checkLimit.mockResolvedValueOnce({
      allowed: false,
      current: 100,
      limit: 100,
      upgradeTo: 'PRO',
    });
    const res = await request(app.getHttpServer())
      .post('/crm/businesses/biz_1/contacts')
      .send({ firstName: 'Limit', email: 'limit@example.com' })
      .expect(403);
    expect(res.body.error).toBe('PLAN_LIMIT_REACHED');
    expect(subscriptionsMock.checkLimit).toHaveBeenCalledWith('biz_1', 'contacts');
    expect(crmServiceMock.createContact).not.toHaveBeenCalled();
  });

  it('blocks insights endpoints when the feature flag is disabled', async () => {
    prisma.businesses = [
      { id: 'biz_1', metaData: { features: { insights: false } } },
    ];
    const res = await request(app.getHttpServer())
      .get('/crm/businesses/biz_1/flow-intelligence')
      .expect(403);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    expect(flowServiceMock.getFlowIntelligence).not.toHaveBeenCalled();
  });

  it('allows insights endpoints when the feature flag is enabled', async () => {
    await request(app.getHttpServer())
      .get('/crm/businesses/biz_1/flow-intelligence')
      .expect(200);
    expect(flowServiceMock.getFlowIntelligence).toHaveBeenCalledWith('biz_1');
  });
});
