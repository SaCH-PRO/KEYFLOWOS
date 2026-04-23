import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { CrmController } from '../src/modules/crm/crm.controller';
import { CrmService } from '../src/modules/crm/crm.service';
import { CrmTimelineService } from '../src/modules/crm/crm-timeline.service';
import { CrmStatsService } from '../src/modules/crm/crm-stats.service';
import { CrmImportService } from '../src/modules/crm/crm-import.service';
import { CrmPlaybookService } from '../src/modules/crm/crm-playbook.service';
import { CrmVisionService } from '../src/modules/crm/crm-vision.service';
import { CrmFlowService } from '../src/modules/crm/crm-flow.service';
import { CrmActionsService } from '../src/modules/crm/crm-actions.service';
import { CrmRevenueService } from '../src/modules/crm/crm-revenue.service';
import { CrmJourneyService } from '../src/modules/crm/crm-journey.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { CrmRateLimitGuard } from '../src/modules/crm/guards/rate-limit.guard';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { FeatureFlagGuard } from '../src/modules/crm/guards/feature-flag.guard';
import { TeamAuditInterceptor } from '../src/core/interceptors/team-audit.interceptor';
import { PrismaService } from '../src/core/prisma/prisma.service';

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

const timelineMock = {
  addTask: vi.fn(),
};

describe('CRM e2e', () => {
  let app: INestApplication;

  beforeEach(() => {
    crmServiceMock.contacts = [];
    vi.clearAllMocks();
    crmServiceMock.listContacts.mockImplementation((input: { businessId: string }) =>
      crmServiceMock.contacts.filter((c: any) => c.businessId === input.businessId),
    );
    timelineMock.addTask.mockResolvedValue({ id: 'task_1', title: 'Follow up' });
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        { provide: CrmService, useValue: crmServiceMock },
        { provide: CrmTimelineService, useValue: timelineMock },
        { provide: CrmStatsService, useValue: { getCacheMetrics: vi.fn(() => ({})) } },
        { provide: CrmImportService, useValue: {} },
        { provide: CrmPlaybookService, useValue: {} },
        { provide: CrmVisionService, useValue: {} },
        { provide: CrmFlowService, useValue: {} },
        { provide: CrmActionsService, useValue: {} },
        { provide: CrmRevenueService, useValue: {} },
        { provide: CrmJourneyService, useValue: {} },
        { provide: PrismaService, useValue: { client: { teamActivityLog: { create: vi.fn().mockResolvedValue(undefined) } } } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ModuleScopeGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CrmRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlanLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureFlagGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(TeamAuditInterceptor)
      .useValue({ intercept: (_ctx: any, next: any) => next.handle() })
      .compile();

    app = moduleRef.createNestApplication();
    const controller = moduleRef.get(CrmController);
    (controller as any).crm = crmServiceMock;
    app.use((req: any, _res: any, next: any) => {
      (req as any).user = { id: 'user_1' };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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
    expect(crmServiceMock.listContacts).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_1' }));
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
      expect.objectContaining({ businessId: 'biz_4', primaryId: 'contact_primary', duplicateId: 'contact_duplicate' }),
    );
  });
});
