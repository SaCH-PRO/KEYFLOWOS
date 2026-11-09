import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CallTaskController } from '../src/modules/call-tasks/call-task.controller';
import { CallLogService } from '../src/modules/call-tasks/call-log.service';
import { CallScriptService } from '../src/modules/call-tasks/call-script.service';
import { RateLimitGuard } from '../src/core/guards/rate-limit.guard';

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
  // The V1-08 visibility gate's lookups: the member's User row and the contact
  // row it may open (findFirst), and, for the relationship and network reads,
  // which of the contacts an answer names the member may open (findMany). The
  // mock returns the seeded contacts by id and tenant; the visibility clause
  // itself is proven on the real database
  // (contacts-visibility.integration.test.ts), here only that it is sent.
  users: Array<{ id: string; role: string }> = [];
  contacts: Array<{ id: string; businessId: string }> = [];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      user: {
        findUnique: vi.fn(({ where }: any) =>
          Promise.resolve(self.users.find((u) => u.id === where.id) ?? null),
        ),
      },
      contact: {
        findFirst: vi.fn(({ where }: any) =>
          Promise.resolve(
            self.contacts.find((c) => c.id === where.id && c.businessId === where.businessId) ?? null,
          ),
        ),
        findMany: vi.fn(({ where }: any) =>
          Promise.resolve(
            self.contacts
              .filter((c) => where.id.in.includes(c.id) && c.businessId === where.businessId)
              .map((c) => ({ id: c.id })),
          ),
        ),
      },
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
  bulkUpdateContacts: vi.fn(),
  softDeleteContact: vi.fn(),
  mergeContacts: vi.fn(),
  addTask: vi.fn(),
  listContactEvents: vi.fn(),
  listContactNotes: vi.fn(),
};

const flowServiceMock = {
  getFlowIntelligence: vi.fn().mockResolvedValue({ insights: [] }),
};

// Mocked: these cases prove what the CONTROLLER hands the detail service and
// how it surfaces the service's answer. The row-level rule itself is proven
// against the real database in contacts-visibility.integration.test.ts.
const detailPayload = () => ({
  contact: { id: 'contact_1', businessId: 'biz_1', visibility: 'PRIVATE' },
  events: [], notes: [], tasks: [], invoices: [], bookings: [], customFieldValues: [],
  meta: {},
});
const crmStatsMock = {
  getCacheMetrics: () => ({}),
  contactDetail: vi.fn(),
};

// The dossier's collaborators. Recording stubs: the claim under test is that a
// denied dossier never invokes them, not what they compute.
const journeyMock = {
  getContactCrossJourney: vi.fn(),
  generateAiInsight: vi.fn(),
  getContactHealthMetrics: vi.fn(),
  getContactJourney: vi.fn(),
  getConversationContext: vi.fn(),
};

// The unread-counts handler's collaborator. Recording stub: the claim under
// test is which handler a request reaches, not what it counts.
const communicationMock = {
  unreadCounts: vi.fn(),
  list: vi.fn(),
};

// The other collaborators of the V1-08 contact-scoped sibling reads. Recording
// stubs: the claim under test is that the visibility gate runs before them and
// that a refused read never reaches them.
const revenueMock = { getContactRevenueSummary: vi.fn() };
const networkMock = {
  listForContact: vi.fn(),
  getNeighbourhood: vi.fn(),
  listGraphForBusiness: vi.fn(),
  createRelationship: vi.fn(),
  referContact: vi.fn(),
};
const dataQualityMock = { getContactIssues: vi.fn() };
const playbookMock = { getOrCreatePlaybook: vi.fn() };
const bestChannelMock = { explain: vi.fn() };

/**
 * The fourteen contact-scoped sibling reads (M13, PRS-M12) for contact_1 of
 * biz_1: the path below contacts/:contactId, the collaborator each reaches, the
 * arguments it receives, and the handler called directly (guards bypassed).
 */
const SIBLING_READS: Array<{
  route: string;
  collaborator: () => ReturnType<typeof vi.fn>;
  args: unknown[];
  direct: (controller: any, req: unknown) => unknown;
}> = [
  // W6-CONTACT-EVENTS-MONEY (SEC-W5FC-1; D-90 / D-63): events also hands over the reading member, by whose revenue scope CrmTimelineService.listContactEvents withholds money events.
  { route: 'events', collaborator: () => crmServiceMock.listContactEvents, args: [{ businessId: 'biz_1', contactId: 'contact_1', viewerUserId: 'user_1' }], direct: (c, req) => c.contactEvents('biz_1', 'contact_1', req) },
  { route: 'notes', collaborator: () => crmServiceMock.listContactNotes, args: [{ businessId: 'biz_1', contactId: 'contact_1' }], direct: (c, req) => c.contactNotes('biz_1', 'contact_1', req) },
  { route: 'journey', collaborator: () => journeyMock.getContactJourney, args: ['biz_1', 'contact_1'], direct: (c, req) => c.getContactJourney('biz_1', 'contact_1', req) },
  { route: 'cross-journey', collaborator: () => journeyMock.getContactCrossJourney, args: ['biz_1', 'contact_1'], direct: (c, req) => c.getContactCrossJourney('biz_1', 'contact_1', req) },
  { route: 'story', collaborator: () => journeyMock.getContactCrossJourney, args: ['biz_1', 'contact_1'], direct: (c, req) => c.getContactStory('biz_1', 'contact_1', req) },
  { route: 'revenue-summary', collaborator: () => revenueMock.getContactRevenueSummary, args: ['biz_1', 'contact_1'], direct: (c, req) => c.getContactRevenueSummary('biz_1', 'contact_1', req) },
  { route: 'health-metrics', collaborator: () => journeyMock.getContactHealthMetrics, args: ['biz_1', 'contact_1'], direct: (c, req) => c.getContactHealthMetrics('biz_1', 'contact_1', req) },
  { route: 'relationships', collaborator: () => networkMock.listForContact, args: ['biz_1', 'contact_1'], direct: (c, req) => c.listContactRelationships('biz_1', 'contact_1', req) },
  { route: 'network', collaborator: () => networkMock.getNeighbourhood, args: ['biz_1', 'contact_1', 2], direct: (c, req) => c.getContactNetwork('biz_1', 'contact_1', req) },
  { route: 'data-quality', collaborator: () => dataQualityMock.getContactIssues, args: ['biz_1', 'contact_1'], direct: (c, req) => c.dqContactIssues('biz_1', 'contact_1', req) },
  { route: 'playbook', collaborator: () => playbookMock.getOrCreatePlaybook, args: [{ businessId: 'biz_1', contactId: 'contact_1' }], direct: (c, req) => c.getPlaybook('biz_1', 'contact_1', req) },
  { route: 'conversations', collaborator: () => communicationMock.list, args: [expect.objectContaining({ businessId: 'biz_1', contactId: 'contact_1' })], direct: (c, req) => c.listConversations('biz_1', 'contact_1', req) },
  { route: 'conversation-context', collaborator: () => journeyMock.getConversationContext, args: ['biz_1', 'contact_1'], direct: (c, req) => c.getConversationContext('biz_1', 'contact_1', req) },
  { route: 'best-channel', collaborator: () => bestChannelMock.explain, args: ['biz_1', 'contact_1'], direct: (c, req) => c.bestChannelExplain('biz_1', 'contact_1', req) },
];

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
        { provide: CrmStatsService, useValue: crmStatsMock },
        { provide: CrmImportService, useValue: {} },
        { provide: CrmPlaybookService, useValue: playbookMock },
        { provide: CrmFlowService, useValue: flowServiceMock },
        { provide: CrmActionsService, useValue: {} },
        { provide: CrmRevenueService, useValue: revenueMock },
        { provide: CrmJourneyService, useValue: journeyMock },
        { provide: CrmDuplicateDetectionService, useValue: {} },
        { provide: CrmDataQualityService, useValue: dataQualityMock },
        { provide: CrmSavedViewsService, useValue: {} },
        { provide: CrmRelationshipHealthService, useValue: {} },
        { provide: CrmCommunicationService, useValue: communicationMock },
        { provide: BestChannelService, useValue: bestChannelMock },
        { provide: ConversationAiService, useValue: {} },
        { provide: CrmNetworkService, useValue: networkMock },
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
      // `x-test-anonymous: 1` leaves the request without an identity, as the
      // real AuthMiddleware does for a missing or invalid token.
      if (req.headers['x-test-anonymous'] !== '1') {
        req.user = { id: 'user_1', role: 'OWNER' };
      }
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
    crmStatsMock.contactDetail.mockImplementation(async () => detailPayload());
    journeyMock.getContactCrossJourney.mockResolvedValue({ summary: 'journey-summary', timeline: [] });
    journeyMock.generateAiInsight.mockResolvedValue(null);
    journeyMock.getContactHealthMetrics.mockResolvedValue({ score: 1 });
    communicationMock.unreadCounts.mockResolvedValue({});
    crmServiceMock.listContactEvents.mockResolvedValue([{ id: 'event_1' }]);
    crmServiceMock.listContactNotes.mockResolvedValue([{ id: 'note_1' }]);
    journeyMock.getContactJourney.mockResolvedValue([{ id: 'milestone_1' }]);
    journeyMock.getConversationContext.mockResolvedValue({ lastDiscussed: 'context_1' });
    communicationMock.list.mockResolvedValue({ items: [{ id: 'message_1' }], nextCursor: null });
    revenueMock.getContactRevenueSummary.mockResolvedValue({ contactId: 'contact_1', lifetimeRevenue: 1 });
    networkMock.listForContact.mockResolvedValue({ outgoing: [{ id: 'rel_1' }], incoming: [] });
    networkMock.getNeighbourhood.mockResolvedValue({ nodes: [{ id: 'contact_1' }], edges: [] });
    dataQualityMock.getContactIssues.mockResolvedValue({ items: [{ id: 'issue_1' }] });
    playbookMock.getOrCreatePlaybook.mockResolvedValue({ id: 'playbook_1' });
    bestChannelMock.explain.mockResolvedValue({ channel: 'email', confidence: 1, perChannel: [] });
    prisma.users = [{ id: 'user_1', role: 'USER' }];
    // The contacts the write cases name, for the FOLLOW3-D2 visibility gate
    // (tasks: contact_3 in biz_3; merge: contact_primary and contact_duplicate in biz_4).
    prisma.contacts = [
      { id: 'contact_1', businessId: 'biz_1' },
      { id: 'contact_3', businessId: 'biz_3' },
      { id: 'contact_primary', businessId: 'biz_4' },
      { id: 'contact_duplicate', businessId: 'biz_4' },
    ];
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
      expect.objectContaining({ actor: { type: 'USER', id: 'user_1' } }),
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

  // KF-PRODUCT-CONTACTS-PILOT-001: the guarded detail route. Mocked service;
  // the real row-level rule is contacts-visibility.integration.test.ts.
  describe('GET contact detail (guarded controller regressions)', () => {
    it('hands the authenticated actor to the detail service', async () => {
      const res = await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_1')
        .expect(200);
      expect(res.body.contact.id).toBe('contact_1');
      expect(crmStatsMock.contactDetail).toHaveBeenCalledTimes(1);
      expect(crmStatsMock.contactDetail).toHaveBeenCalledWith({
        businessId: 'biz_1',
        contactId: 'contact_1',
        actorUserId: 'user_1',
      });
    });

    it('still reaches the detail service, with the actor, for a read-only member', async () => {
      prisma.memberships = [
        { userId: 'user_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: { crm: 'read' } },
      ];
      await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_1')
        .expect(200);
      expect(crmStatsMock.contactDetail).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_1', contactId: 'contact_1', actorUserId: 'user_1' }),
      );
    });

    it('surfaces the service not-found as 404 without a record in the body', async () => {
      crmStatsMock.contactDetail.mockRejectedValueOnce(new NotFoundException('Contact not found'));
      const res = await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_private')
        .expect(404);
      expect(res.body.message).toBe('Contact not found');
      expect(res.body).not.toHaveProperty('contact');
      expect(res.body).not.toHaveProperty('notes');
    });

    it('does not reach the detail service for a non-member', async () => {
      prisma.memberships = [];
      await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_1')
        .expect(403);
      expect(crmStatsMock.contactDetail).not.toHaveBeenCalled();
    });

    it('does not reach the detail service when no identity is attached', async () => {
      const res = await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_1')
        .set('x-test-anonymous', '1');
      expect([401, 403]).toContain(res.status);
      expect(crmStatsMock.contactDetail).not.toHaveBeenCalled();
    });

    it('the handler itself refuses a request that carries no user id, even if every guard were bypassed', async () => {
      const stubs = Array.from({ length: 18 }, () => ({}));
      const controller = new (CrmController as any)(...stubs);
      await expect(
        Promise.resolve().then(() => controller.getContactDetail('biz_1', 'contact_1', { user: undefined })),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        Promise.resolve().then(() => controller.getContactDetail('biz_1', 'contact_1', { user: {} })),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        Promise.resolve().then(() => controller.getContactDossier('biz_1', 'contact_1', { user: undefined })),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  // R0-D7-CONTACT-EMAIL-409: a contact whose email or phone is already held in
  // the tenant is a 409 from the service, and the controller hands it through
  // untouched: the code names the field, the existing id rides along, and the
  // audit interceptor (tap on success) writes nothing. The controller also
  // forwards the caller's identity on create (as update already did), which
  // is what lets the service bound the disclosed id to the actor's CRM
  // visibility. Mocked service; the real unique-index and visibility proof
  // is crm-contact-duplicate.integration.test.ts.
  // Without the global filter the body is the thrown object itself; with it
  // (app-bootstrap) `code` stays top-level and the id moves under `details`.
  describe('duplicate contact identity (guarded controller regressions)', () => {
    const emailTaken = () => new ConflictException({
      code: 'contact_email_taken',
      message: 'A contact with this email already exists in this business',
      existingContactId: 'contact_existing',
    });

    it('surfaces the service email conflict on create as 409 with code and existingContactId, and writes no audit entry', async () => {
      crmServiceMock.createContact.mockImplementationOnce(() => { throw emailTaken(); });
      const res = await request(app.getHttpServer())
        .post('/crm/businesses/biz_1/contacts')
        .send({ firstName: 'Dup', email: 'alice@example.com' })
        .expect(409);
      expect(res.body.code).toBe('contact_email_taken');
      expect(res.body.existingContactId).toBe('contact_existing');
      expect(res.body).not.toHaveProperty('id');
      expect(crmServiceMock.createContact).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_1', email: 'alice@example.com', actorUserId: 'user_1' }),
        expect.objectContaining({ actor: { type: 'USER', id: 'user_1' } }),
      );
      await new Promise((r) => setImmediate(r));
      expect(prisma.teamActivityLogs).toHaveLength(0);
    });

    it('surfaces the service phone conflict on update as 409 with code and existingContactId, and writes no audit entry', async () => {
      crmServiceMock.updateContact.mockRejectedValueOnce(new ConflictException({
        code: 'contact_phone_taken',
        message: 'A contact with this phone number already exists in this business',
        existingContactId: 'contact_existing',
      }));
      const res = await request(app.getHttpServer())
        .patch('/crm/businesses/biz_2/contacts/contact_99')
        .send({ phone: '+18685550100' })
        .expect(409);
      expect(res.body.code).toBe('contact_phone_taken');
      expect(res.body.existingContactId).toBe('contact_existing');
      expect(crmServiceMock.updateContact).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_2', contactId: 'contact_99', phone: '+18685550100' }),
        expect.objectContaining({ actor: { type: 'USER', id: 'user_1' } }),
      );
      await new Promise((r) => setImmediate(r));
      expect(prisma.teamActivityLogs).toHaveLength(0);
    });
  });

  // R0-CT-03-CONTACT-AUDIT-ACTOR: the contact mutation routes hand the
  // authenticated member to the service as the audit actor, so the ContactEvent
  // and ContactAuditEntry the service writes name that member instead of SYSTEM
  // or nobody. Mocked service; the real-database proof of what is persisted is
  // contacts-audit-actor.integration.test.ts.
  describe('contact mutation audit actor (guarded controller regressions)', () => {
    const userActor = { actor: { type: 'USER', id: 'user_1' } };

    it('create forwards req.user.id as the USER audit actor', async () => {
      await request(app.getHttpServer())
        .post('/crm/businesses/biz_1/contacts')
        .send({ firstName: 'Actor', email: 'actor@example.com' })
        .expect(201);
      expect(crmServiceMock.createContact).toHaveBeenCalledTimes(1);
      expect(crmServiceMock.createContact).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_1', firstName: 'Actor', actorUserId: 'user_1' }),
        expect.objectContaining(userActor),
      );
    });

    it('update forwards req.user.id as the USER audit actor', async () => {
      crmServiceMock.updateContact.mockResolvedValue({ id: 'contact_99', firstName: 'Renamed' });
      await request(app.getHttpServer())
        .patch('/crm/businesses/biz_2/contacts/contact_99')
        .send({ firstName: 'Renamed' })
        .expect(200);
      expect(crmServiceMock.updateContact).toHaveBeenCalledTimes(1);
      expect(crmServiceMock.updateContact).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_2', contactId: 'contact_99', firstName: 'Renamed', actorUserId: 'user_1' }),
        expect.objectContaining(userActor),
      );
    });

    it('delete forwards req.user.id as the USER audit actor', async () => {
      crmServiceMock.softDeleteContact.mockResolvedValue({ id: 'contact_42', deletedAt: new Date() });
      await request(app.getHttpServer())
        .delete('/crm/businesses/biz_1/contacts/contact_42')
        .expect(200);
      expect(crmServiceMock.softDeleteContact).toHaveBeenCalledTimes(1);
      expect(crmServiceMock.softDeleteContact).toHaveBeenCalledWith(
        { businessId: 'biz_1', contactId: 'contact_42', actorUserId: 'user_1' },
        expect.objectContaining(userActor),
      );
    });

    it('a request with no identity reaches none of the mutation services', async () => {
      const agent = request(app.getHttpServer());
      for (const res of [
        await agent.post('/crm/businesses/biz_1/contacts').set('x-test-anonymous', '1').send({ firstName: 'Anon' }),
        await agent.patch('/crm/businesses/biz_1/contacts/contact_1').set('x-test-anonymous', '1').send({ firstName: 'Anon' }),
        await agent.delete('/crm/businesses/biz_1/contacts/contact_1').set('x-test-anonymous', '1'),
      ]) {
        expect([401, 403]).toContain(res.status);
      }
      expect(crmServiceMock.createContact).not.toHaveBeenCalled();
      expect(crmServiceMock.updateContact).not.toHaveBeenCalled();
      expect(crmServiceMock.softDeleteContact).not.toHaveBeenCalled();
    });

    it('the handlers themselves refuse a request that carries no user id, even if every guard were bypassed, and never record it as SYSTEM', async () => {
      const crmStub = { createContact: vi.fn(), updateContact: vi.fn(), softDeleteContact: vi.fn() };
      const stubs: unknown[] = Array.from({ length: 18 }, () => ({}));
      stubs[0] = crmStub;
      const controller = new (CrmController as any)(...stubs);
      for (const req of [{ user: undefined }, { user: {} }]) {
        await expect(
          Promise.resolve().then(() => controller.createContact('biz_1', { firstName: 'X' }, req)),
        ).rejects.toMatchObject({ status: 401 });
        await expect(
          Promise.resolve().then(() => controller.updateContact('biz_1', 'contact_1', { firstName: 'X' }, req)),
        ).rejects.toMatchObject({ status: 401 });
        await expect(
          Promise.resolve().then(() => controller.softDeleteContact('biz_1', 'contact_1', req)),
        ).rejects.toMatchObject({ status: 401 });
      }
      expect(crmStub.createContact).not.toHaveBeenCalled();
      expect(crmStub.updateContact).not.toHaveBeenCalled();
      expect(crmStub.softDeleteContact).not.toHaveBeenCalled();
    });
  });

  // V1-54-CT-ROUTE-ORDER-CALLER (M15), a regression control: R0-13e declared the
  // literal contacts routes before their :contactId siblings, and
  // core/config/route-shadowing.spec.ts keeps every controller in that order
  // from the source. These cases prove the same over HTTP: Express answers the
  // first route that matches, so with PATCH contacts/:contactId first a bulk edit
  // reached updateContact as contact 'bulk' (404), and with GET contacts/:contactId
  // first unread-counts was answered as a contact detail.
  describe('contacts route order (V1-54 regression controls)', () => {
    it('PATCH contacts/bulk reaches bulkUpdateContacts with the actor, never updateContact as contact "bulk"', async () => {
      crmServiceMock.bulkUpdateContacts.mockResolvedValue({ updated: 2 });
      const res = await request(app.getHttpServer())
        .patch('/crm/businesses/biz_1/contacts/bulk')
        .send({ contactIds: ['contact_1', 'contact_2'], status: 'CLIENT' })
        .expect(200);
      expect(res.body).toEqual({ updated: 2 });
      expect(crmServiceMock.bulkUpdateContacts).toHaveBeenCalledTimes(1);
      expect(crmServiceMock.bulkUpdateContacts).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: 'biz_1',
          contactIds: ['contact_1', 'contact_2'],
          status: 'CLIENT',
          actorUserId: 'user_1',
        }),
      );
      expect(crmServiceMock.updateContact).not.toHaveBeenCalled();
    });

    it('GET contacts/unread-counts reaches the unread-count handler for the session member, never the contact detail', async () => {
      communicationMock.unreadCounts.mockResolvedValueOnce({});
      const res = await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/unread-counts')
        .expect(200);
      expect(res.body).toEqual({ counts: {} });
      expect(communicationMock.unreadCounts).toHaveBeenCalledTimes(1);
      expect(communicationMock.unreadCounts).toHaveBeenCalledWith('biz_1', 'user_1');
      expect(crmStatsMock.contactDetail).not.toHaveBeenCalled();
    });

    it('GET and PATCH contacts/:contactId still reach the single-contact handlers, not the literal siblings', async () => {
      crmServiceMock.updateContact.mockResolvedValue({ id: 'contact_7', status: 'CLIENT' });
      const agent = request(app.getHttpServer());
      await agent.get('/crm/businesses/biz_1/contacts/contact_7').expect(200);
      await agent.patch('/crm/businesses/biz_1/contacts/contact_7').send({ status: 'CLIENT' }).expect(200);
      expect(crmStatsMock.contactDetail).toHaveBeenCalledWith({
        businessId: 'biz_1',
        contactId: 'contact_7',
        actorUserId: 'user_1',
      });
      expect(crmServiceMock.updateContact).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_1', contactId: 'contact_7', status: 'CLIENT' }),
        expect.objectContaining({ actor: { type: 'USER', id: 'user_1' } }),
      );
      expect(communicationMock.unreadCounts).not.toHaveBeenCalled();
      expect(crmServiceMock.bulkUpdateContacts).not.toHaveBeenCalled();
    });
  });

  // KF-PRODUCT-CONTACTS-PILOT-001, CG-REV-PRODUCT-CONTACTS-OWNERSHIP-001: the
  // dossier route shares the detail service. Mocked; the real-database proof
  // is contacts-visibility.integration.test.ts.
  describe('GET contact dossier (guarded controller regressions)', () => {
    it('hands the actor to the detail service and only then consults the journey collaborators', async () => {
      const res = await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_1/dossier')
        .expect(200);
      expect(res.body.contact.id).toBe('contact_1');
      expect(res.body.summary).toBe('journey-summary');
      expect(crmStatsMock.contactDetail).toHaveBeenCalledWith({
        businessId: 'biz_1',
        contactId: 'contact_1',
        actorUserId: 'user_1',
      });
      for (const fn of [journeyMock.getContactCrossJourney, journeyMock.generateAiInsight, journeyMock.getContactHealthMetrics]) {
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('biz_1', 'contact_1');
      }
    });

    it('a dossier the detail service refuses is 404, carries no record, and never invokes the journey collaborators', async () => {
      crmStatsMock.contactDetail.mockRejectedValueOnce(new NotFoundException('Contact not found'));
      const res = await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_private/dossier')
        .expect(404);
      expect(res.body.message).toBe('Contact not found');
      for (const key of ['contact', 'notes', 'tasks', 'meta', 'summary', 'timeline', 'insight', 'health']) {
        expect(res.body).not.toHaveProperty(key);
      }
      expect(journeyMock.getContactCrossJourney).not.toHaveBeenCalled();
      expect(journeyMock.generateAiInsight).not.toHaveBeenCalled();
      expect(journeyMock.getContactHealthMetrics).not.toHaveBeenCalled();
    });

    it('does not reach the detail service or the collaborators for a non-member', async () => {
      prisma.memberships = [];
      await request(app.getHttpServer())
        .get('/crm/businesses/biz_1/contacts/contact_1/dossier')
        .expect(403);
      expect(crmStatsMock.contactDetail).not.toHaveBeenCalled();
      expect(journeyMock.getContactCrossJourney).not.toHaveBeenCalled();
    });
  });

  // V1-08-CT-SIBLING-VISIBILITY (M13, PRS-M12): the fourteen contact-scoped
  // sibling reads took no caller, so their collaborators checked the tenant
  // only. Each now resolves the session member's CRM access and finds the
  // contact under the visibility clause GET detail applies before its
  // collaborator runs. Mocked collaborators; the real rule, the real services
  // and the model-access proof are contacts-visibility.integration.test.ts.
  describe('contact-scoped sibling reads (V1-08, guarded controller regressions)', () => {
    it('each of the 14 sibling reads finds the contact under the session member\'s CRM access before its collaborator runs, then hands the collaborator the request unchanged', async () => {
      for (const read of SIBLING_READS) {
        vi.clearAllMocks();
        const res = await request(app.getHttpServer()).get(`/crm/businesses/biz_1/contacts/contact_1/${read.route}`);
        expect(res.status, read.route).toBe(200);
        expect(prisma.client.user.findUnique, read.route).toHaveBeenCalledWith({ where: { id: 'user_1' } });
        expect(prisma.client.contact.findFirst, read.route).toHaveBeenCalledTimes(1);
        expect(prisma.client.contact.findFirst.mock.calls[0][0].where, read.route).toMatchObject({
          id: 'contact_1',
          businessId: 'biz_1',
          deletedAt: null,
        });
        const collaborator = read.collaborator();
        expect(collaborator, read.route).toHaveBeenCalledTimes(1);
        expect(collaborator, read.route).toHaveBeenCalledWith(...read.args);
        expect(prisma.client.contact.findFirst.mock.invocationCallOrder[0], `${read.route}: gate before collaborator`)
          .toBeLessThan(collaborator.mock.invocationCallOrder[0]);
      }
    });

    it('a sibling read whose contact the gate does not find answers the detail 404 body and never reaches its collaborator', async () => {
      prisma.contacts = [];
      for (const read of SIBLING_READS) {
        const res = await request(app.getHttpServer()).get(`/crm/businesses/biz_1/contacts/contact_private/${read.route}`);
        expect(res.status, read.route).toBe(404);
        expect(res.body, read.route).toEqual({ statusCode: 404, message: 'Contact not found', error: 'Not Found' });
        expect(read.collaborator(), read.route).not.toHaveBeenCalled();
      }
    });

    it("a STAFF member's gate carries the PRIVATE visibility clause naming that member, and crm_view owned narrows it to owned and shared rows", async () => {
      for (const [scopes, clause] of [
        [{ crm: 'read' }, { OR: [{ visibility: { in: ['TEAM', 'SHARED'] } }, { ownerId: 'user_1' }, { shares: { some: { userId: 'user_1' } } }] }],
        [{ crm: 'read', crm_view: 'owned' }, { OR: [{ ownerId: 'user_1' }, { shares: { some: { userId: 'user_1' } } }] }],
      ] as const) {
        prisma.memberships = [{ userId: 'user_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: { ...scopes } }];
        for (const read of SIBLING_READS) {
          vi.clearAllMocks();
          await request(app.getHttpServer()).get(`/crm/businesses/biz_1/contacts/contact_1/${read.route}`).expect(200);
          expect(prisma.client.contact.findFirst.mock.calls[0][0].where.AND, `${read.route} ${JSON.stringify(scopes)}`).toEqual([clause]);
        }
      }
    });

    it('a request with no identity reaches none of the 14 collaborators', async () => {
      for (const read of SIBLING_READS) {
        const res = await request(app.getHttpServer())
          .get(`/crm/businesses/biz_1/contacts/contact_1/${read.route}`)
          .set('x-test-anonymous', '1');
        expect([401, 403], read.route).toContain(res.status);
        expect(read.collaborator(), read.route).not.toHaveBeenCalled();
      }
      expect(prisma.client.contact.findFirst).not.toHaveBeenCalled();
    });

    it('the 14 sibling handlers themselves refuse a request that carries no user id (401) before any lookup, even if every guard were bypassed', async () => {
      const controller = app.get(CrmController);
      for (const read of SIBLING_READS) {
        for (const req of [{ user: undefined }, { user: {} }]) {
          await expect(
            Promise.resolve().then(() => read.direct(controller, req)),
            `${read.route} ${JSON.stringify(req)}`,
          ).rejects.toMatchObject({ status: 401 });
        }
        expect(read.collaborator(), read.route).not.toHaveBeenCalled();
      }
      expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.contact.findFirst).not.toHaveBeenCalled();
    });
  });

  // V1-08 review repairs (ST-1, ST-2, ST-3, CR-1). relationships and network
  // answer for a contact the member may open but name its neighbours (the
  // relationship rows carry the neighbour's full row, the graph its nodes and
  // edge notes), and the business network names every related contact, so each
  // keeps only the contacts the gate's lookup returns for the member; the
  // relationship writes gate both ends. Mocked collaborators and a mocked
  // lookup (prisma.contacts stands for the contacts the member may open); the
  // real rule over real rows is contacts-visibility.integration.test.ts.
  describe('relationship reads and writes apply visibility to every contact they name (V1-08 review, guarded controller regressions)', () => {
    const STAFF_READ = { userId: 'user_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: { crm: 'read' } };
    const STAFF_WRITE = { userId: 'user_1', businessId: 'biz_1', role: 'STAFF', permissionScopes: { crm: 'write' } };
    const STAFF_CLAUSE = { OR: [{ visibility: { in: ['TEAM', 'SHARED'] } }, { ownerId: 'user_1' }, { shares: { some: { userId: 'user_1' } } }] };
    const NOT_FOUND = { statusCode: 404, message: 'Contact not found', error: 'Not Found' };
    const seen = (...ids: string[]) => ids.map((id) => ({ id, businessId: 'biz_1' }));
    const edge = (id: string, fromContactId: string, toContactId: string) => ({ id, fromContactId, toContactId, type: 'colleague_of', since: null, note: `${id}-note` });

    it("relationships: a STAFF member's answer keeps only the rows whose other contact the lookup returns; the owner's is the collaborator's, unchanged, with no lookup", async () => {
      const rows = {
        outgoing: [
          { id: 'rel_out_open', toContactId: 'contact_open', toContact: { id: 'contact_open' } },
          { id: 'rel_out_hidden', toContactId: 'contact_hidden', toContact: { id: 'contact_hidden', email: 'hidden@example.test' } },
        ],
        incoming: [
          { id: 'rel_in_hidden', fromContactId: 'contact_hidden', fromContact: { id: 'contact_hidden', email: 'hidden@example.test' } },
          { id: 'rel_in_open', fromContactId: 'contact_open', fromContact: { id: 'contact_open' } },
        ],
      };
      networkMock.listForContact.mockResolvedValue(rows);
      prisma.contacts = seen('contact_1', 'contact_open');

      const owner = await request(app.getHttpServer()).get('/crm/businesses/biz_1/contacts/contact_1/relationships').expect(200);
      expect(owner.body).toEqual(rows);
      expect(prisma.client.contact.findMany).not.toHaveBeenCalled();

      prisma.memberships = [STAFF_READ];
      vi.clearAllMocks();
      const staff = await request(app.getHttpServer()).get('/crm/businesses/biz_1/contacts/contact_1/relationships').expect(200);
      expect(staff.body.outgoing.map((r: any) => r.id)).toEqual(['rel_out_open']);
      expect(staff.body.incoming.map((r: any) => r.id)).toEqual(['rel_in_open']);
      expect(staff.text).not.toContain('contact_hidden');
      expect(prisma.client.contact.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.contact.findMany.mock.calls[0][0]).toEqual({
        where: { businessId: 'biz_1', deletedAt: null, id: { in: ['contact_open', 'contact_hidden'] }, AND: [STAFF_CLAUSE] },
        select: { id: true },
      });
      expect(prisma.client.contact.findFirst.mock.invocationCallOrder[0]).toBeLessThan(networkMock.listForContact.mock.invocationCallOrder[0]);
    });

    it("network: a STAFF member's graph drops a neighbour the lookup does not return, its edges, and a contact reached only through it; one reached another way stays, at the requested depth", async () => {
      // contact_far is two steps away only through contact_hidden; contact_far2
      // also through contact_open.
      const graph = {
        rootId: 'contact_1',
        nodes: ['contact_1', 'contact_hidden', 'contact_far', 'contact_open', 'contact_far2'].map((id) => ({ id })),
        edges: [
          edge('e_root_hidden', 'contact_1', 'contact_hidden'),
          edge('e_hidden_far', 'contact_hidden', 'contact_far'),
          edge('e_root_open', 'contact_open', 'contact_1'),
          edge('e_open_far2', 'contact_open', 'contact_far2'),
          edge('e_hidden_far2', 'contact_far2', 'contact_hidden'),
        ],
      };
      networkMock.getNeighbourhood.mockResolvedValue(graph);
      prisma.contacts = seen('contact_1', 'contact_open', 'contact_far', 'contact_far2');

      const owner = await request(app.getHttpServer()).get('/crm/businesses/biz_1/contacts/contact_1/network').expect(200);
      expect(owner.body).toEqual(graph);
      expect(prisma.client.contact.findMany).not.toHaveBeenCalled();

      prisma.memberships = [STAFF_READ];
      vi.clearAllMocks();
      const staff = await request(app.getHttpServer()).get('/crm/businesses/biz_1/contacts/contact_1/network').expect(200);
      expect(networkMock.getNeighbourhood).toHaveBeenCalledWith('biz_1', 'contact_1', 2);
      expect(staff.body).toEqual({
        rootId: 'contact_1',
        nodes: [{ id: 'contact_1' }, { id: 'contact_open' }, { id: 'contact_far2' }],
        edges: [edge('e_root_open', 'contact_open', 'contact_1'), edge('e_open_far2', 'contact_open', 'contact_far2')],
      });
      expect(staff.text).not.toContain('contact_hidden');
      expect(staff.text).not.toContain('contact_far"');
      expect(prisma.client.contact.findMany.mock.calls[0][0].where.AND).toEqual([STAFF_CLAUSE]);
      expect(prisma.client.contact.findMany.mock.calls[0][0].where.id.in).not.toContain('contact_1');

      // depth=1: the first ring only, still without the hidden neighbour.
      networkMock.getNeighbourhood.mockResolvedValue({
        rootId: 'contact_1',
        nodes: ['contact_1', 'contact_hidden', 'contact_open'].map((id) => ({ id })),
        edges: [edge('e_root_hidden', 'contact_1', 'contact_hidden'), edge('e_root_open', 'contact_open', 'contact_1'), edge('e_hidden_open', 'contact_hidden', 'contact_open')],
      });
      const ring = await request(app.getHttpServer()).get('/crm/businesses/biz_1/contacts/contact_1/network?depth=1').expect(200);
      expect(networkMock.getNeighbourhood).toHaveBeenLastCalledWith('biz_1', 'contact_1', 1);
      expect(ring.body).toEqual({
        rootId: 'contact_1',
        nodes: [{ id: 'contact_1' }, { id: 'contact_open' }],
        edges: [edge('e_root_open', 'contact_open', 'contact_1')],
      });
    });

    it("business network: a STAFF member sees only the contacts the lookup returns, no edge with a hidden end, and no contact shown only for its edges to hidden ones; the owner's graph is unchanged", async () => {
      // contact_c is related only to the hidden contact_h; contact_iso has no
      // edge in the answer (its other end was filtered out by the service).
      const graph = {
        nodes: ['contact_a', 'contact_b', 'contact_h', 'contact_c', 'contact_iso'].map((id) => ({ id })),
        edges: [edge('e_ab', 'contact_a', 'contact_b'), edge('e_ah', 'contact_a', 'contact_h'), edge('e_ch', 'contact_h', 'contact_c')],
      };
      networkMock.listGraphForBusiness.mockResolvedValue(graph);
      prisma.contacts = seen('contact_a', 'contact_b', 'contact_c', 'contact_iso');

      const owner = await request(app.getHttpServer()).get('/crm/businesses/biz_1/network?type=colleague_of').expect(200);
      expect(owner.body).toEqual(graph);
      expect(networkMock.listGraphForBusiness).toHaveBeenCalledWith('biz_1', { type: 'colleague_of', relationshipHealth: undefined, minDealValue: undefined, search: undefined });
      expect(prisma.client.contact.findMany).not.toHaveBeenCalled();

      prisma.memberships = [STAFF_READ];
      vi.clearAllMocks();
      const staff = await request(app.getHttpServer()).get('/crm/businesses/biz_1/network').expect(200);
      expect(staff.body).toEqual({
        nodes: [{ id: 'contact_a' }, { id: 'contact_b' }, { id: 'contact_iso' }],
        edges: [edge('e_ab', 'contact_a', 'contact_b')],
      });
      expect(prisma.client.contact.findMany.mock.calls[0][0].where).toEqual({
        businessId: 'biz_1', deletedAt: null, id: { in: ['contact_a', 'contact_b', 'contact_h', 'contact_c', 'contact_iso'] }, AND: [STAFF_CLAUSE],
      });
      expect(prisma.client.user.findUnique.mock.invocationCallOrder[0]).toBeLessThan(networkMock.listGraphForBusiness.mock.invocationCallOrder[0]);
    });

    it('the business network handler itself refuses a request that carries no user id (401) before reading the graph', async () => {
      const controller = app.get(CrmController);
      for (const req of [{ user: undefined }, { user: {} }]) {
        await expect(Promise.resolve().then(() => controller.getNetworkGraph('biz_1', req as any))).rejects.toMatchObject({ status: 401 });
      }
      expect(networkMock.listGraphForBusiness).not.toHaveBeenCalled();
    });

    it('POST relationships gates both ends before createRelationship: a hidden or absent end answers the detail 404 and nothing is written; a non-string toContactId is 400', async () => {
      prisma.memberships = [STAFF_WRITE];
      prisma.contacts = seen('contact_1', 'contact_2');
      networkMock.createRelationship.mockResolvedValue({ id: 'rel_new' });
      const post = (contactId: string, body: unknown) =>
        request(app.getHttpServer()).post(`/crm/businesses/biz_1/contacts/${contactId}/relationships`).send(body as object);

      await post('contact_1', { toContactId: 'contact_2', type: 'colleague_of' }).expect(201);
      expect(prisma.client.contact.findFirst.mock.calls.map((c: any[]) => c[0].where.id)).toEqual(['contact_1', 'contact_2']);
      expect(prisma.client.contact.findFirst.mock.calls[1][0].where.AND).toEqual([STAFF_CLAUSE]);
      expect(networkMock.createRelationship).toHaveBeenCalledWith({
        businessId: 'biz_1', fromContactId: 'contact_1', toContactId: 'contact_2', type: 'colleague_of', since: null, note: null,
      });
      expect(prisma.client.contact.findFirst.mock.invocationCallOrder[1]).toBeLessThan(networkMock.createRelationship.mock.invocationCallOrder[0]);

      vi.clearAllMocks();
      const toHidden = await post('contact_1', { toContactId: 'contact_hidden', type: 'colleague_of' });
      const fromHidden = await post('contact_hidden', { toContactId: 'contact_2', type: 'colleague_of' });
      for (const res of [toHidden, fromHidden]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(NOT_FOUND);
      }
      await post('contact_1', { toContactId: { not: 'x' }, type: 'colleague_of' }).expect(400);
      expect(networkMock.createRelationship).not.toHaveBeenCalled();

      const controller = app.get(CrmController);
      await expect(Promise.resolve().then(() => controller.createContactRelationship('biz_1', 'contact_1', { user: undefined }, { toContactId: 'contact_2', type: 'colleague_of' }))).rejects.toMatchObject({ status: 401 });
      expect(networkMock.createRelationship).not.toHaveBeenCalled();
    });

    it('POST refer gates the referrer and an existing target before referContact: a hidden one answers the detail 404 and nothing is written', async () => {
      prisma.memberships = [STAFF_WRITE];
      prisma.contacts = seen('contact_1', 'contact_2');
      networkMock.referContact.mockResolvedValue({ relationship: { id: 'rel_ref' }, targetContactId: 'contact_2' });
      const refer = (contactId: string, body: unknown) =>
        request(app.getHttpServer()).post(`/crm/businesses/biz_1/contacts/${contactId}/refer`).send(body as object);

      await refer('contact_1', { contactId: 'contact_2' }).expect(201);
      expect(prisma.client.contact.findFirst.mock.calls.map((c: any[]) => c[0].where.id)).toEqual(['contact_1', 'contact_2']);
      expect(networkMock.referContact).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      await refer('contact_1', { firstName: 'New' }).expect(201);
      expect(prisma.client.contact.findFirst.mock.calls.map((c: any[]) => c[0].where.id)).toEqual(['contact_1']);

      vi.clearAllMocks();
      for (const [contactId, body] of [['contact_hidden', { firstName: 'New' }], ['contact_1', { contactId: 'contact_hidden' }]] as const) {
        const res = await refer(contactId, body);
        expect(res.status, `${contactId} ${JSON.stringify(body)}`).toBe(404);
        expect(res.body).toEqual(NOT_FOUND);
      }
      await refer('contact_1', { contactId: { not: 'x' } }).expect(400);
      expect(networkMock.referContact).not.toHaveBeenCalled();
    });
  });

  // Review ST-4 (hand-off, not fixed here: outside V1-08's write set or its 14
  // routes). Correction to the V1-08 return: the CRM controller is not the only
  // REST caller of the gated collaborators; BestChannelService.explain is also
  // reached through GET contacts/:contactId/insight-card
  // (contact-insight.service.ts), which checks the tenant only. These
  // contact-scoped routes still take no caller and check the tenant only (or,
  // for audit, not even the contact); each needs the same gate in its own
  // controller.
  // Done in FOLLOW3-D3 (crm-ai, privacy audit, deals, account-suggestion, custom-field values: test/crm-sibling-controllers-visibility.integration.test.ts) and FOLLOW3-D5 (order-history, referral-stats, people-flow health, momentum: test/contact-reads-noncrm-visibility.integration.test.ts), V1-84. This it.todo was review ST-4's follow-up.
  // Done in FOLLOW3-D2 (V1-84): the remaining contact-scoped routes of crm.controller.ts apply CRM record visibility, proven on a real database in test/crm-contact-routes-visibility.integration.test.ts (prefix v84b_). This it.todo was review ST-4's follow-up.
  // Done in FOLLOW3-D2 (V1-84): DELETE relationships/:relationshipId refuses an edge with a hidden end (404 like an unknown id), test/crm-contact-routes-visibility.integration.test.ts.
});

// V1-54-CT-ROUTE-ORDER-CALLER: a call log's caller is the session member. POST
// businesses/:b/calls took `body.callerId ?? req.user.id ?? 'system'` and POST
// contacts/:c/calls/from-next-action did the same, so any member could log a call
// as another member (or as nobody), and complete/follow-up fell back to 'system'
// as their actor. GET calls/scheduled/today keeps callerId as an optional read
// filter: without one it is every member's day in the business, which the
// Operations dashboard and the call-tasks page (neither sends one) show as the
// team's calls (review CR-1 reverted a narrowing to the session member, which
// was outside the packet's write-attribution proof). CallLog is under the tenant extension
// (packages/db/src/client.ts:85) and the guards bind the business, so this is
// attribution, not tenant isolation. The real CallLogService runs over a
// recording Prisma double: the claim is which callerId the row is written with
// and which callerId the read is bounded by. vitest emits no decorator
// metadata, so the global ValidationPipe is inert here: these cases say nothing
// about CreateCallLogDto, which still requires a (now ignored) body callerId.
class CallPrismaMock {
  memberships: MembershipSeed[] = [];
  contacts: any[] = [];
  callLogs: any[] = [];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      membership: {
        findUnique: vi.fn(({ where }: any) => {
          const composite = where.userId_businessId;
          if (!composite) return Promise.resolve(null);
          return Promise.resolve(
            self.memberships.find(
              (m) => m.userId === composite.userId && m.businessId === composite.businessId,
            ) ?? null,
          );
        }),
      },
      contact: {
        findFirst: vi.fn(({ where }: any) =>
          Promise.resolve(
            self.contacts.find((c) => c.id === where.id && c.businessId === where.businessId) ?? null,
          ),
        ),
        findUnique: vi.fn(({ where }: any) =>
          Promise.resolve(self.contacts.find((c) => c.id === where.id) ?? null),
        ),
      },
      callLog: {
        create: vi.fn(({ data }: any) => {
          const row = { id: `call_${self.callLogs.length + 1}`, completedAt: null, createdAt: new Date(), ...data };
          self.callLogs.push(row);
          return Promise.resolve(row);
        }),
        findFirst: vi.fn(({ where }: any) =>
          Promise.resolve(
            self.callLogs.find((l) => l.id === where.id && l.businessId === where.businessId) ?? null,
          ),
        ),
        findMany: vi.fn(() => Promise.resolve([])),
        count: vi.fn(() => Promise.resolve(0)),
        // applies its whole where, as Postgres does under the row lock (review ST-1)
        updateMany: vi.fn(({ where, data }: any) => {
          const i = self.callLogs.findIndex((l) =>
            Object.entries(where).every(([k, v]) => (v === null ? l[k] == null : l[k] === v)),
          );
          if (i < 0) return Promise.resolve({ count: 0 });
          self.callLogs[i] = { ...self.callLogs[i], ...data };
          return Promise.resolve({ count: 1 });
        }),
      },
    };
  }
}

describe('call logs take the caller from the session (V1-54)', () => {
  let app: INestApplication;
  let prisma: CallPrismaMock;
  const emitter = { emit: vi.fn() };
  const scripts = { generateScript: vi.fn() };

  beforeAll(async () => {
    prisma = new CallPrismaMock();
    const moduleRef = await Test.createTestingModule({
      controllers: [CallTaskController],
      providers: [
        ModuleScopeGuard,
        CallLogService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
        { provide: CallScriptService, useValue: scripts },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    // CallTaskController's constructor carries no @Inject, and vitest transpiles
    // without decorator metadata, so Nest cannot resolve its parameters here (the
    // compiled server can). Hand it the module's real CallLogService and the stub.
    const controller = moduleRef.get(CallTaskController) as any;
    controller.callLogs = moduleRef.get(CallLogService);
    controller.callScripts = scripts;

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      // `x-test-user` names the session member (default user_1);
      // `x-test-anonymous: 1` leaves the request without an identity.
      if (req.headers['x-test-anonymous'] !== '1') {
        req.user = { id: (req.headers['x-test-user'] as string) || 'user_1', role: 'MEMBER' };
      }
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.memberships = [
      { userId: 'user_1', businessId: 'biz_1', role: 'OWNER', permissionScopes: { crm: 'admin' } },
      { userId: 'user_2', businessId: 'biz_1', role: 'STAFF', permissionScopes: { crm: 'write' } },
    ];
    prisma.contacts = [
      { id: 'contact_1', businessId: 'biz_1', nextActionType: 'call', nextActionAt: new Date('2026-11-03T10:00:00.000Z') },
      // another business's contact, also due a call
      { id: 'contact_b', businessId: 'biz_2', nextActionType: 'call', nextActionAt: new Date('2026-11-03T11:00:00.000Z') },
    ];
    prisma.callLogs = [];
  });

  it('POST calls records the session member as the caller and ignores a body callerId naming another member', async () => {
    const res = await request(app.getHttpServer())
      .post('/businesses/biz_1/calls')
      .send({ businessId: 'biz_1', contactId: 'contact_1', callerId: 'user_2', scheduledAt: '2026-11-03T10:00:00.000Z' })
      .expect(201);
    expect(res.body.callerId).toBe('user_1');
    expect(prisma.client.callLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.callLogs).toHaveLength(1);
    expect(prisma.callLogs[0]).toMatchObject({ businessId: 'biz_1', contactId: 'contact_1', callerId: 'user_1' });
    expect(emitter.emit).toHaveBeenCalledWith(
      'call_log.created',
      expect.objectContaining({ businessId: 'biz_1', callerId: 'user_1' }),
    );
  });

  it('POST contacts/:contactId/calls/from-next-action records the session member and ignores a body callerId', async () => {
    const res = await request(app.getHttpServer())
      .post('/businesses/biz_1/contacts/contact_1/calls/from-next-action')
      .set('x-test-user', 'user_2')
      .send({ callerId: 'user_1' })
      .expect(201);
    expect(res.body.callerId).toBe('user_2');
    expect(prisma.callLogs).toHaveLength(1);
    expect(prisma.callLogs[0]).toMatchObject({ businessId: 'biz_1', contactId: 'contact_1', callerId: 'user_2' });
    expect(emitter.emit).toHaveBeenCalledWith(
      'call_log.created_from_next_action',
      expect.objectContaining({ callerId: 'user_2' }),
    );
  });

  // Review CR-1: the packet had narrowed this read to the session member when no
  // callerId is sent. The web never sends one, so the Operations dashboard's
  // "Calls Today" and the call-tasks page's "Scheduled Today" would have gone
  // from the team's calls to the viewer's own, a consumer-visible change outside
  // V1-54's write-attribution proof. Absent callerId is the business's day, now
  // by an explicit where without the key rather than Prisma dropping undefined.
  it("GET calls/scheduled/today keeps callerId as an optional read filter: absent, every member's open calls today; present, that member's", async () => {
    const agent = request(app.getHttpServer());
    await agent.get('/businesses/biz_1/calls/scheduled/today').set('x-test-user', 'user_2').expect(200);
    await agent.get('/businesses/biz_1/calls/scheduled/today?callerId=user_1').set('x-test-user', 'user_2').expect(200);
    expect(prisma.client.callLog.findMany).toHaveBeenCalledTimes(2);
    const [team, named] = prisma.client.callLog.findMany.mock.calls.map((c: any[]) => c[0].where);
    expect(team).toMatchObject({ businessId: 'biz_1', completedAt: null });
    expect(team).not.toHaveProperty('callerId');
    expect(named).toMatchObject({ businessId: 'biz_1', callerId: 'user_1', completedAt: null });
    expect(prisma.client.callLog.create).not.toHaveBeenCalled();
  });

  // Review ST-3: createFromContactNextAction looked the contact up by id alone
  // and wrote the call log under the contact's business. The double's
  // findUnique answers by id alone, as Prisma does with no ambient tenant (the
  // HTTP path arms one in TenantInterceptor; these cases do not). It now looks
  // the contact up within the path business.
  it("POST contacts/:contactId/calls/from-next-action for another business's contact answers 404 and writes nothing", async () => {
    const res = await request(app.getHttpServer())
      .post('/businesses/biz_1/contacts/contact_b/calls/from-next-action')
      .send({})
      .expect(404);
    expect(JSON.stringify(res.body)).not.toContain('nextActionAt');
    expect(prisma.client.callLog.create).not.toHaveBeenCalled();
    expect(prisma.callLogs).toEqual([]);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  // Review ST-1: two members completing the same call at once both got 201 and
  // each emitted call_log.completed with its own outcome and completedBy, while
  // the row kept one. The completion is now a compare-and-set on completedAt.
  it('POST calls/:callId/complete from two members at once: one 201, the other 400, one completion event naming the stored outcome', async () => {
    prisma.callLogs = [
      { id: 'call_open', businessId: 'biz_1', contactId: 'contact_1', callerId: 'user_1', completedAt: null, notes: null, evidenceIds: [] },
    ];
    const agent = request(app.getHttpServer());
    const responses = await Promise.all([
      agent.post('/businesses/biz_1/calls/call_open/complete').set('x-test-user', 'user_1').send({ outcome: 'reached' }),
      agent.post('/businesses/biz_1/calls/call_open/complete').set('x-test-user', 'user_2').send({ outcome: 'callback_requested' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    const row = prisma.callLogs.find((l) => l.id === 'call_open');
    const events = emitter.emit.mock.calls.filter((c: any[]) => c[0] === 'call_log.completed').map((c: any[]) => c[1]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ businessId: 'biz_1', callLogId: 'call_open', outcome: row.outcome });
    const winner = responses.find((r) => r.status === 201)!;
    expect(winner.body).toMatchObject({ id: 'call_open', outcome: row.outcome });
    expect(events[0].completedBy).toBe(row.outcome === 'reached' ? 'user_1' : 'user_2');
  });

  // Review ST-2 (hand-off, not fixed here): no call-log route applies CRM record
  // visibility. A crm 'write' STAFF member with crm_view 'owned' who gets 404 on
  // GET contacts/:id for another member's PRIVATE contact can still create a call
  // log on it through from-next-action and read its call notes through GET calls
  // ?contactId=, GET calls/:callId and GET calls/scheduled/today?callerId=. This
  // predates V1-54 and is not widened by it; applying visibility to call logs
  // (resolveCrmAccess + visibilityClause through the contact) is a policy change
  // across every call-log route that V1-54's proof does not cover and V1-08's 14
  // sibling reads leave out. It needs its own packet.
  // Done in FOLLOW3-D4 (V1-84): call-log routes apply CRM record visibility through the call log's contact, test/call-log-visibility.integration.test.ts (prefix v84d_).

  // Review ST-4 (hand-off, not fixed here): the KEY tool call_create_task passes
  // args.callerId, which the model chooses, to createCallLog, which stores it
  // unchecked, so on the KEY, staff-bridge and auto-trigger paths a call log can
  // name any member or any string as its caller. The tool contract defines
  // callerId as the member who will make the call (an assignee), and the fix
  // belongs in flow-orchestrator.service.ts, outside V1-54's write set.
  it.todo('KEY call_create_task records a member of the business as the caller, never an arbitrary string (review ST-4, flow-orchestrator.service.ts)');

  it('GET calls keeps callerId as an optional read filter: absent, the list is the business\'s; present, it names whose calls to read', async () => {
    const agent = request(app.getHttpServer());
    await agent.get('/businesses/biz_1/calls').expect(200);
    await agent.get('/businesses/biz_1/calls?callerId=user_2').expect(200);
    const [unfiltered, filtered] = prisma.client.callLog.findMany.mock.calls.map((c: any[]) => c[0].where);
    expect(unfiltered).toEqual({ businessId: 'biz_1' });
    expect(filtered).toEqual({ businessId: 'biz_1', callerId: 'user_2' });
    expect(prisma.client.callLog.create).not.toHaveBeenCalled();
  });

  it('a request with no identity writes no call log', async () => {
    const agent = request(app.getHttpServer());
    for (const res of [
      await agent.post('/businesses/biz_1/calls').set('x-test-anonymous', '1')
        .send({ businessId: 'biz_1', contactId: 'contact_1', callerId: 'user_1' }),
      await agent.post('/businesses/biz_1/contacts/contact_1/calls/from-next-action').set('x-test-anonymous', '1')
        .send({ callerId: 'user_1' }),
    ]) {
      expect([401, 403]).toContain(res.status);
    }
    expect(prisma.client.callLog.create).not.toHaveBeenCalled();
  });

  it('the handlers themselves refuse a request that carries no user id, even if every guard were bypassed, and never record SYSTEM', async () => {
    const callLogs = {
      createCallLog: vi.fn(),
      createFromContactNextAction: vi.fn(),
      completeCall: vi.fn(),
      createFollowUpTask: vi.fn(),
      getScheduledCalls: vi.fn(),
    };
    const controller = new CallTaskController(callLogs as any, scripts as any);
    for (const req of [{ user: undefined }, { user: {} }] as any[]) {
      await expect(
        Promise.resolve().then(() => controller.create('biz_1', { businessId: 'biz_1', callerId: 'user_2' } as any, req)),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        Promise.resolve().then(() => controller.createFromNextAction('biz_1', 'contact_1', { callerId: 'user_2' }, req)),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        Promise.resolve().then(() => controller.complete('biz_1', 'call_1', { outcome: 'reached' } as any, req)),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        Promise.resolve().then(() => controller.createFollowUp('biz_1', 'call_1', { title: 'Follow up' } as any, req)),
      ).rejects.toMatchObject({ status: 401 });
      // GET calls/scheduled/today is not here: after review CR-1 it is a read
      // that names no one from the session (callerId is a query filter), so like
      // GET calls it relies on AuthGuard and BusinessGuard alone.
    }
    for (const fn of Object.values(callLogs)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
