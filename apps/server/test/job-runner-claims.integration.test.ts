/**
 * V1-84 (FOLLOW3-D17-JOB-RUNNER-CLAIMS), REAL database.
 *
 * ScheduledAgentJob has four runners. V1-35 gave the cross-module poller
 * (CrossModuleAgentService.processScheduledJobs) a compare-and-set claim before
 * any effect; its review (SEC-V35-3, CR-V35-1) named the other three, which
 * still read PENDING jobs, run the effect, then write the row with an
 * unconditional update:
 *
 *   - CommerceIntegrationService.processPostPurchaseJobs(businessId): the
 *     post-purchase review request and reorder prompt. Also reachable by any
 *     member through POST marketplace/businesses/:businessId/post-purchase/process,
 *     and it runs the same job types the cross-module poller runs.
 *   - ReviewSolicitationService.processPendingJobs (hourly): review_solicitation.
 *   - AbandonedCartRecoveryService.sendRecoveryEmails (hourly):
 *     abandoned_cart_recovery.
 *
 * Two overlapping calls (two ticks, two server instances, a member's POST
 * beside the poller) both read the job and both send. The fix applies the V1-35
 * claim unchanged: updateMany where { id, PENDING, the updatedAt read, still
 * due } (plus businessId for the business-scoped runner) -> COMPLETED with
 * executedAt, executing only when count === 1. A failed execution marks the row
 * FAILED only while it is still this claim's (status COMPLETED, the claim's
 * executedAt). A claim that throws leaves the row PENDING. A lease for a crash
 * after the claim stays V1+ (BUILD-MAP, ScheduledAgentJob lease).
 *
 * What runs for real against DATABASE_URL: PrismaService, the three runners
 * (constructed from their classes), CrossModuleAgentService.processScheduledJobs
 * for the hand-off case, the CRM task writer (CrmService.addTask ->
 * CrmTimelineService.addTask, ContactAuditService), and for the route cases
 * MarketplaceController behind the real AuthGuard, BusinessGuard and
 * CrmRateLimitGuard. The only identity stand-in is a test middleware reading
 * `x-test-user`, as AuthMiddleware attaches the user after token verification.
 * TransactionalEmailService is a gated recorder: in the concurrent cases each
 * send waits until both runs have read the job table (both runs read before
 * either sends), so the race is deterministic. No provider is called.
 *
 * The review and cart runners and the cross-module poller are not
 * tenant-scoped (they read every business's due jobs, take 50, oldest first),
 * so this suite's jobs are due in 2000 to sort first, every recorder assertion
 * filters by this suite's businesses, and the poller's read in the hand-off
 * case is narrowed to this suite's business (its claim and execution are the
 * real code).
 *
 * Fixtures: prefix `v84q_` (registered in test/helpers/fixture-prefixes.json),
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll, beforeEach (jobs
 * and CRM effects) and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84q_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  orderA: `${P}orderA`,
  cartEvent: `${P}cartEvent`,
  booking: `${P}booking`,
};
const BUSINESSES = new Set([ID.bizA, ID.bizB]);
const CONTACT_EMAIL = `${P}contact@test.local`;
const ORDER_NUMBER = `${P}ORD-1`;
const REVIEW_TASK_TITLE = `Request product review for order ${ORDER_NUMBER}`;

/** Due long ago, so these rows sort ahead of anything else in the shared table (take 50, oldest first). */
function dueAt(offsetSeconds: number) {
  return new Date(Date.UTC(2000, 0, 1, 0, 0, offsetSeconds));
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: any;
let moduleRef: any;
let app: any;
let prismaService: any;
let crmService: any;
let CommerceIntegrationClass: any;
let ReviewSolicitationClass: any;
let CartRecoveryClass: any;
let AgentClass: any;

// ---------------------------------------------------------------------------
// The gated TransactionalEmailService recorder
// ---------------------------------------------------------------------------
type Send = { recorder: string; input: any };
const sends: Send[] = [];
/** scheduledAgentJob.findMany calls made through a gated client (gatedPrisma). */
let reads = 0;
/** A send waits until this many reads have happened (0: no gate). */
let gateReads = 0;
let gateTimedOut = false;
const GATE_TIMEOUT_MS = 5_000;
/** Per-send pause after recording: widens the window between a runner's read and its write. */
const RECORDER_DELAY_MS = 25;
/** Runs inside a send after it is recorded: a writer acting, or a refusal, while a job executes. */
let sendHook: ((input: any) => Promise<void>) | null = null;

async function waitForGate() {
  const deadline = Date.now() + GATE_TIMEOUT_MS;
  while (reads < gateReads) {
    if (Date.now() > deadline) {
      gateTimedOut = true;
      return;
    }
    await pause(5);
  }
}

function recorder(name: string) {
  return {
    send: async (input: any) => {
      await waitForGate();
      sends.push({ recorder: name, input });
      await pause(RECORDER_DELAY_MS);
      if (sendHook) await sendHook(input);
      return { status: 'SENT', messageId: `${P}msg` };
    },
  };
}
const emailRecorder = recorder('runner');
const pollerEmailRecorder = recorder('poller');

/** Sends for this suite's businesses only (a global runner may also meet another suite's leftovers). */
function ownSends(recorderName = 'runner', type?: string) {
  return sends.filter((s) => s.recorder === recorderName && BUSINESSES.has(s.input?.businessId) && (!type || s.input?.type === type));
}

// ---------------------------------------------------------------------------
// A Prisma client whose job reads are counted (for the gate) and whose job
// writes are recorded; optional hooks act between a read and the claim.
// ---------------------------------------------------------------------------
type JobWrite = { method: string; where: any; data: any };
const jobWrites: JobWrite[] = [];

function gatedPrisma(opts: {
  afterRead?: (rows: any[]) => Promise<void>;
  /** Replace what the read returns (a read that is not what the claim must trust). */
  overrideRead?: () => Promise<any[]>;
  /** The claim shape (updateMany where status PENDING) throws, as a dropped connection would. */
  claimThrows?: boolean;
} = {}) {
  const realClient = prismaService.client;
  const jobs = new Proxy(realClient.scheduledAgentJob, {
    get(target, prop) {
      if (prop === 'findMany') {
        return async (args: any) => {
          const rows = opts.overrideRead ? await opts.overrideRead() : await target.findMany(args);
          reads += 1;
          if (opts.afterRead) await opts.afterRead(rows);
          return rows;
        };
      }
      if (prop === 'update' || prop === 'updateMany') {
        return async (args: any) => {
          if (opts.claimThrows && prop === 'updateMany' && args?.where?.status === 'PENDING') {
            throw new Error(`${P} recorder: claim refused (connection lost)`);
          }
          const result = await (target as any)[prop](args);
          // Only writes that changed a row (an update, or an updateMany that matched).
          if (prop === 'update' || result?.count > 0) jobWrites.push({ method: String(prop), where: args?.where, data: args?.data });
          return result;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const client = new Proxy(realClient, {
    get(target, prop) {
      if (prop === 'scheduledAgentJob') return jobs;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client };
}

/** Writes that closed this job COMPLETED (the runner's completion stamp). */
function completionWrites(jobId: string) {
  return jobWrites.filter((w) => w.where?.id === jobId && w.data?.status === 'COMPLETED');
}

// ---------------------------------------------------------------------------
// The three runners, constructed from their classes over a given client
// ---------------------------------------------------------------------------
const expensesStub = { createExpense: async () => null };

function postPurchaseRunner(prisma: any = gatedPrisma()) {
  return new CommerceIntegrationClass(prisma, crmService, expensesStub, emailRecorder);
}
function reviewRunner(prisma: any = gatedPrisma()) {
  return new ReviewSolicitationClass(prisma, emailRecorder);
}
function cartRunner(prisma: any = gatedPrisma()) {
  return new CartRecoveryClass(prisma, emailRecorder);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
async function job(id: string, businessId: string, jobType: string, entityId: string, checkpoint: string, payload: Record<string, unknown>, offsetSeconds: number) {
  return db.scheduledAgentJob.create({
    data: { id: `${P}${id}`, businessId, jobType, entityId, checkpoint, status: 'PENDING', scheduledFor: dueAt(offsetSeconds), payload },
  });
}

function postPurchaseReviewJob(id = 'pp', businessId = ID.bizA) {
  return job(id, businessId, 'post_purchase_review_request', ID.orderA, `review_${id}`, {
    contactId: ID.contactA,
    orderId: ID.orderA,
    orderNumber: ORDER_NUMBER,
    customerEmail: CONTACT_EMAIL,
    customerName: 'V84q Customer',
    productNames: ['V84q widget'],
  }, 1);
}

function reviewSolicitationJob(id = 'rs') {
  return job(id, ID.bizA, 'review_solicitation', ID.booking, `review_booking_${id}`, {
    contactId: ID.contactA,
    contactEmail: CONTACT_EMAIL,
    contactName: 'V84q Customer',
    entityType: 'booking',
  }, 2);
}

function cartJob(id = 'cart') {
  return job(id, ID.bizA, 'abandoned_cart_recovery', ID.cartEvent, `abandoned_${id}_h24`, {
    visitorId: `${P}visitor`,
    contactEmail: CONTACT_EMAIL,
    contactName: 'V84q Customer',
    productIds: [],
    hour: 24,
  }, 3);
}

async function row(id: string) {
  return db.scheduledAgentJob.findUnique({ where: { id: `${P}${id}` } });
}

async function reviewTasks() {
  return db.contactTask.findMany({ where: { businessId: ID.bizA, contactId: ID.contactA, title: REVIEW_TASK_TITLE } });
}

/** Another writer sets the row back to PENDING (a new run, due later) while its claimed execution is still running. */
async function rearm(id: string) {
  await db.scheduledAgentJob.update({
    where: { id: `${P}${id}` },
    data: { status: 'PENDING', executedAt: null, scheduledFor: new Date(Date.now() + 3 * 86_400_000) },
  });
}

// The three runners as one table: each case below runs for every runner.
const RUNNERS = [
  {
    name: 'processPostPurchaseJobs(A) (post_purchase_review_request)',
    jobId: 'pp',
    sendType: 'review_request',
    seed: () => postPurchaseReviewJob('pp'),
    run: (prisma?: any) => postPurchaseRunner(prisma).processPostPurchaseJobs(ID.bizA),
  },
  {
    name: 'ReviewSolicitationService.processPendingJobs (review_solicitation)',
    jobId: 'rs',
    sendType: 'review_request',
    seed: () => reviewSolicitationJob('rs'),
    run: (prisma?: any) => reviewRunner(prisma).processPendingJobs(),
  },
  {
    name: 'AbandonedCartRecoveryService.sendRecoveryEmails (abandoned_cart_recovery)',
    jobId: 'cart',
    sendType: 'booking_created',
    seed: () => cartJob('cart'),
    run: (prisma?: any) => cartRunner(prisma).sendRecoveryEmails(),
  },
] as const;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
async function cleanJobsAndEffects() {
  for (const sql of [
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  CommerceIntegrationClass = (await import('../src/modules/marketplace/commerce-integration.service')).CommerceIntegrationService;
  ReviewSolicitationClass = (await import('../src/modules/conversion/review-solicitation.service')).ReviewSolicitationService;
  CartRecoveryClass = (await import('../src/modules/conversion/abandoned-cart-recovery.service')).AbandonedCartRecoveryService;
  AgentClass = (await import('../src/modules/flow/cross-module-agent.service')).CrossModuleAgentService;

  Logger.overrideLogger(false);

  moduleRef = await Test.createTestingModule({
    controllers: [MarketplaceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      CommerceIntegrationClass,
      // The real CRM task writer: CrmService.addTask -> CrmTimelineService.addTask (contact check,
      // contact_tasks row, task.created event) and its ContactAuditService row.
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CrmListsService, useValue: {} },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: ExpensesService, useValue: expensesStub },
      { provide: TransactionalEmailService, useValue: emailRecorder },
      { provide: MarketplaceService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v84q_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  prismaService = moduleRef.get(PrismaService);
  crmService = moduleRef.get(CrmService);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownera@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerb@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V84q Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84q Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V84q', lastName: 'Customer', email: CONTACT_EMAIL } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(async () => {
  sends.length = 0;
  jobWrites.length = 0;
  reads = 0;
  gateReads = 0;
  gateTimedOut = false;
  sendHook = null;
  await cleanJobsAndEffects();
});

// ---------------------------------------------------------------------------
// JR-01..03: one claimant per job
// ---------------------------------------------------------------------------
describe('JR-01..03: two concurrent runs over one due job run its effect once', () => {
  it('JR-01: two concurrent processPostPurchaseJobs(A) over one due post_purchase_review_request make one sender call and at most one CRM task; the row ends COMPLETED with a single completion stamp', async () => {
    const seeded = await postPurchaseReviewJob('pp');
    gateReads = 2; // both runs read before either sends

    await Promise.all([postPurchaseRunner().processPostPurchaseJobs(ID.bizA), postPurchaseRunner().processPostPurchaseJobs(ID.bizA)]);

    expect(gateTimedOut).toBe(false);
    expect(reads).toBe(2);
    const sent = ownSends('runner', 'review_request');
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({ businessId: ID.bizA, recipientEmail: CONTACT_EMAIL, dedupeKey: `review-request-${ID.orderA}` });
    expect(await reviewTasks()).toHaveLength(1);
    const r = await row('pp');
    expect(r.status).toBe('COMPLETED');
    expect(r.executedAt).toBeInstanceOf(Date);
    expect(completionWrites(seeded.id)).toHaveLength(1);
  }, 30_000);

  it('JR-02: two concurrent processPendingJobs over one review_solicitation job make one review_request send; the row ends COMPLETED with a single completion stamp', async () => {
    const seeded = await reviewSolicitationJob('rs');
    gateReads = 2;

    await Promise.all([reviewRunner().processPendingJobs(), reviewRunner().processPendingJobs()]);

    expect(gateTimedOut).toBe(false);
    expect(reads).toBe(2);
    const sent = ownSends('runner', 'review_request');
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({ businessId: ID.bizA, recipientEmail: CONTACT_EMAIL, contactId: ID.contactA });
    const r = await row('rs');
    expect(r.status).toBe('COMPLETED');
    expect(r.executedAt).toBeInstanceOf(Date);
    expect(completionWrites(seeded.id)).toHaveLength(1);
  }, 30_000);

  it('JR-03: two concurrent sendRecoveryEmails over one cart job make one send; the row ends COMPLETED with a single completion stamp', async () => {
    const seeded = await cartJob('cart');
    gateReads = 2;

    await Promise.all([cartRunner().sendRecoveryEmails(), cartRunner().sendRecoveryEmails()]);

    expect(gateTimedOut).toBe(false);
    expect(reads).toBe(2);
    const sent = ownSends('runner');
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({ businessId: ID.bizA, recipientEmail: CONTACT_EMAIL, dedupeKey: `cart-recovery_${ID.cartEvent}_24` });
    const r = await row('cart');
    expect(r.status).toBe('COMPLETED');
    expect(r.executedAt).toBeInstanceOf(Date);
    expect(completionWrites(seeded.id)).toHaveLength(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// JR-04: hand-off with the cross-module poller
// ---------------------------------------------------------------------------
describe('JR-04: a job the cross-module poller claimed is not re-run', () => {
  it('JR-04: processPostPurchaseJobs(A) reads the job PENDING, the real cross-module poller then claims and runs it; this runner makes no sender call, one review email and one CRM task in all, and the poller\'s completion stamp stands', async () => {
    await postPurchaseReviewJob('pp');

    // The poller's read is narrowed to this suite's business (the table is shared); its claim and execution are the real code.
    const pollerClient = new Proxy(prismaService.client, {
      get(target, prop) {
        if (prop === 'scheduledAgentJob') {
          return new Proxy(target.scheduledAgentJob, {
            get(jobs, p) {
              if (p === 'findMany') return (args: any) => jobs.findMany({ ...args, where: { ...(args?.where ?? {}), businessId: ID.bizA } });
              const value = Reflect.get(jobs, p);
              return typeof value === 'function' ? value.bind(jobs) : value;
            },
          });
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const poller = new AgentClass({ client: pollerClient }, {}, crmService, null, pollerEmailRecorder);
    poller.onModuleDestroy(); // the constructor arms no timer under NODE_ENV=test; stop it regardless

    let pollerStamp: Date | null = null;
    const runner = postPurchaseRunner(gatedPrisma({
      afterRead: async (rows) => {
        expect(rows.map((r) => r.id)).toContain(`${P}pp`);
        await poller.processScheduledJobs();
        pollerStamp = (await row('pp')).executedAt;
      },
    }));
    await runner.processPostPurchaseJobs(ID.bizA);

    // Non-vacuity: the poller did claim and run the job.
    expect(ownSends('poller', 'review_request')).toHaveLength(1);
    expect(pollerStamp).toBeInstanceOf(Date);
    // This runner: no effect.
    expect(ownSends('runner')).toEqual([]);
    expect(await reviewTasks()).toHaveLength(1);
    const r = await row('pp');
    expect(r.status).toBe('COMPLETED');
    expect(r.executedAt?.toISOString()).toBe((pollerStamp as unknown as Date).toISOString());
  }, 30_000);
});

// ---------------------------------------------------------------------------
// JR-05..07: failure handling
// ---------------------------------------------------------------------------
describe.each(RUNNERS)('JR-05..07 $name', (runner) => {
  it('JR-05 (executedAt fence): an execution that fails after another writer set the row back to PENDING leaves the row as that writer set it (PENDING, executedAt null), not FAILED', async () => {
    await runner.seed();
    let rearmed = false;
    sendHook = async () => {
      if (rearmed) return;
      rearmed = true;
      await rearm(runner.jobId);
      throw new Error(`${P} recorder: send refused`);
    };

    await runner.run();

    expect(rearmed).toBe(true);
    expect(ownSends('runner', runner.sendType)).toHaveLength(1);
    const r = await row(runner.jobId);
    expect({ status: r.status, executedAt: r.executedAt }).toEqual({ status: 'PENDING', executedAt: null });
    expect(r.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
  }, 30_000);

  it('JR-06 (control): an execution that fails ends FAILED after one attempt, and a later run does not run it again', async () => {
    await runner.seed();
    sendHook = async () => { throw new Error(`${P} recorder: send refused`); };

    await runner.run();
    expect((await row(runner.jobId)).status).toBe('FAILED');
    expect(ownSends('runner', runner.sendType)).toHaveLength(1);

    sendHook = null;
    await runner.run();
    expect((await row(runner.jobId)).status).toBe('FAILED');
    expect(ownSends('runner', runner.sendType)).toHaveLength(1);
  }, 30_000);

  it('JR-07: a claim that throws leaves the row PENDING with no effect', async () => {
    const seeded = await runner.seed();

    const outcome = await runner.run(gatedPrisma({ claimThrows: true })).then(() => 'resolved', () => 'rejected');

    expect(['resolved', 'rejected']).toContain(outcome);
    expect(ownSends('runner')).toEqual([]);
    const r = await row(runner.jobId);
    expect({ status: r.status, executedAt: r.executedAt }).toEqual({ status: 'PENDING', executedAt: null });
    expect(r.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());
  }, 30_000);
});

// ---------------------------------------------------------------------------
// JR-08..10: tenant boundary of the business-scoped runner
// ---------------------------------------------------------------------------
describe('JR-08..10: processPostPurchaseJobs never claims or runs another business\'s job', () => {
  it('JR-08 (control): processPostPurchaseJobs(B) leaves A\'s due job PENDING, untouched, with no effect', async () => {
    const seeded = await postPurchaseReviewJob('pp', ID.bizA);

    const result = await postPurchaseRunner().processPostPurchaseJobs(ID.bizB);

    expect(result).toEqual({ processed: 0 });
    expect(ownSends('runner')).toEqual([]);
    expect(await reviewTasks()).toEqual([]);
    const r = await row('pp');
    expect({ status: r.status, executedAt: r.executedAt }).toEqual({ status: 'PENDING', executedAt: null });
    expect(r.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());
  }, 30_000);

  it('JR-09: the claim itself is tenant-bound: processPostPurchaseJobs(B) handed A\'s due job by its read does not claim or run it', async () => {
    const seeded = await postPurchaseReviewJob('pp', ID.bizA);

    const runner = postPurchaseRunner(gatedPrisma({
      overrideRead: () => db.scheduledAgentJob.findMany({ where: { id: seeded.id } }),
    }));
    await runner.processPostPurchaseJobs(ID.bizB);

    expect(ownSends('runner')).toEqual([]);
    expect(await reviewTasks()).toEqual([]);
    const r = await row('pp');
    expect({ status: r.status, executedAt: r.executedAt }).toEqual({ status: 'PENDING', executedAt: null });
    expect(r.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());
  }, 30_000);

  it('JR-10 (control): POST marketplace/businesses/B/post-purchase/process by B\'s owner leaves A\'s job PENDING; the same POST for A by B\'s owner is refused 403; A\'s owner runs it once', async () => {
    const seeded = await postPurchaseReviewJob('pp', ID.bizA);
    const post = (businessId: string, user: string) =>
      request(app.getHttpServer()).post(`/marketplace/businesses/${businessId}/post-purchase/process`).set('x-test-user', user);

    const own = await post(ID.bizB, ID.ownerB);
    expect(own.status).toBe(201);
    expect(own.body).toEqual({ processed: 0 });

    const cross = await post(ID.bizA, ID.ownerB);
    expect(cross.status).toBe(403);

    expect(ownSends('runner')).toEqual([]);
    let r = await row('pp');
    expect({ status: r.status, executedAt: r.executedAt }).toEqual({ status: 'PENDING', executedAt: null });
    expect(r.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());

    // Non-vacuity: A's member does run it, once.
    const ownerA = await post(ID.bizA, ID.ownerA);
    expect(ownerA.status).toBe(201);
    expect(ownerA.body).toEqual({ processed: 1 });
    expect(ownSends('runner', 'review_request')).toHaveLength(1);
    expect(await reviewTasks()).toHaveLength(1);
    r = await row('pp');
    expect(r.status).toBe('COMPLETED');
    expect(r.executedAt).toBeInstanceOf(Date);
  }, 30_000);
});
