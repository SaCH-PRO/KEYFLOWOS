/**
 * V1-35-DM-POLLER-CLAIM (#174 REL-01/02; PRS-M17, PRS-M18; owner ruling D-29),
 * REAL database.
 *
 * CrossModuleAgentService runs a 60-second poller over ScheduledAgentJob. Two
 * defects at the V1 base (cross-module-agent.service.ts processScheduledJobs):
 *
 *   - PRS-M17 (REL-01). The poller read every due PENDING job whatever its
 *     jobType, ran the ones it knows, logged "Unknown job type" for the rest and
 *     then marked them COMPLETED too. abandoned_cart_recovery (written and run by
 *     AbandonedCartRecoveryService.sendRecoveryEmails, which reads PENDING only),
 *     review_solicitation and lead_magnet_enroll were therefore closed without
 *     their effect: recovery emails were never sent.
 *   - PRS-M18 (REL-02). Read, execute, then update: no claim between the read and
 *     the effect. Two overlapping ticks, or two server instances, both executed
 *     the same job, so the follow-up task and the reminder email were doubled.
 *
 * The fix: the poller reads only its own job types (quote_followup,
 * post_purchase_review_request, post_purchase_reorder_prompt) and claims each
 * job before any effect with updateMany({ id, status: 'PENDING' }) ->
 * COMPLETED, executing only when count === 1. A failed execution flips the
 * claimed row to FAILED. This is the KF-EXEC-TIME-001 "one claimant" invariant
 * for this fabric; the lease (crash after claim, stale worker) stays V1+.
 *
 * What runs for real against DATABASE_URL: PrismaService, ActivityService,
 * CrossModuleAgentService (resolved from a Nest testing module), and
 * AbandonedCartRecoveryService for the hand-off control. The provider-facing
 * collaborators are recorders, so no provider traffic: CrmService.addTask,
 * GmailService.sendEmail and TransactionalEmailService.send. The 60 s timer the
 * constructor arms is stopped at once; every case calls processScheduledJobs()
 * directly.
 *
 * The poller is not tenant-scoped (it reads every business's due jobs, take 50,
 * oldest first), so this suite's jobs are scheduled in 2001 to sort first, and
 * every assertion filters recorder calls and rows by this suite's business.
 * The job reads of the poller and of the cart runner (V35-02) are also narrowed
 * to this suite's business, ANDed with their own where clause (review
 * CR-D17-2): a suite running beside this one on the same database (for example
 * job-runner-claims, whose due post-purchase, review and cart rows date from
 * 2000) is never claimed here. The where clause, the claim and the execution
 * are the real code; the job-type filter V35-01 pins still applies, since the
 * other modules' rows it seeds belong to this suite's business.
 *
 * Fixtures: prefix `v35a_` (registered in test/helpers/fixture-prefixes.json),
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll, beforeEach (jobs,
 * activities, notifications, workflow counters) and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v35a_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  quote: `${P}quote`,
  quoteB: `${P}quoteB`,
  order: `${P}order`,
};

const CONTACT_EMAIL = `${P}contact@test.local`;

/** Due long ago, so these rows sort ahead of anything else in the shared table (take 50, oldest first). */
function dueAt(offsetSeconds: number) {
  return new Date(Date.UTC(2001, 0, 1, 0, 0, offsetSeconds));
}

let db: any;
let moduleRef: any;
let prismaService: any;
let activityService: any;
let AgentClass: any;
let CartRecoveryClass: any;
let agent: any;

type Call = { method: string; input: any };
const calls: Call[] = [];
/** Per-call delay inside the recorders: widens the window between a poller's read and its write. */
const RECORDER_DELAY_MS = 25;
let failAddTaskFor: string | null = null;
/** Runs inside crm.addTask (after the recorder pause, before any refusal): a writer acting while a job executes. */
let addTaskHook: ((input: any) => Promise<void>) | null = null;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const crmStub = {
  addTask: async (input: any) => {
    calls.push({ method: 'crm.addTask', input });
    await pause(RECORDER_DELAY_MS);
    if (addTaskHook) await addTaskHook(input);
    if (failAddTaskFor && typeof input?.title === 'string' && input.title.includes(failAddTaskFor)) {
      throw new Error('v35a_ recorder: addTask refused');
    }
    return { id: `${P}task` };
  },
};
const gmailStub = {
  sendEmail: async (input: any) => {
    calls.push({ method: 'gmail.sendEmail', input });
    await pause(RECORDER_DELAY_MS);
    return { id: `${P}mail` };
  },
};
const emailStub = {
  send: async (input: any) => {
    calls.push({ method: 'email.send', input });
    await pause(RECORDER_DELAY_MS);
    return { id: `${P}tx` };
  },
};

/** Recorder calls made for this suite's business only (the poller may also meet another suite's leftovers). */
function ownCalls(method?: string) {
  return calls.filter((c) => c.input?.businessId === ID.biz && (!method || c.method === method));
}

async function cleanJobsAndEffects() {
  for (const sql of [
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cross_module_workflows WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cross_module_workflows WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The client with its scheduledAgentJob reads narrowed to this suite's business (ANDed with the caller's where clause). */
function scopeJobReads(client: any) {
  const jobs = new Proxy(client.scheduledAgentJob, {
    get(target, prop) {
      if (prop === 'findMany') {
        return (args: any) => target.findMany({ ...args, where: { AND: [args?.where ?? {}, { businessId: ID.biz }] } });
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'scheduledAgentJob') return jobs;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function newAgent(prisma: any = prismaService) {
  const svc = new AgentClass(prisma, activityService, crmStub, gmailStub, emailStub);
  // The constructor arms the 60 s poller; stop it so only the calls below run jobs.
  svc.onModuleDestroy();
  return svc;
}

async function job(id: string, jobType: string, entityId: string, checkpoint: string, payload: Record<string, unknown>, offsetSeconds: number) {
  return db.scheduledAgentJob.create({
    data: {
      id: `${P}${id}`,
      businessId: ID.biz,
      jobType,
      entityId,
      checkpoint,
      status: 'PENDING',
      scheduledFor: dueAt(offsetSeconds),
      payload,
    },
  });
}

/** The Day-3 checkpoint ('day_first': a task and the reminder email); one per quote, as the writer's unique key allows. */
function quoteFollowUpJob(id: string, offsetSeconds: number, quoteId: string = ID.quote, quoteRef = `${P}Q-001`) {
  return job(id, 'quote_followup', quoteId, 'day_first', {
    contactId: ID.contact,
    quoteRef,
    days: 3,
    autoSendEmail: true,
    contactName: 'V35a Customer',
    contactEmail: CONTACT_EMAIL,
  }, offsetSeconds);
}

function reviewRequestJob(id: string, offsetSeconds: number) {
  return job(id, 'post_purchase_review_request', ID.order, `review_${id}`, {
    contactId: ID.contact,
    orderId: ID.order,
    orderNumber: `${P}ORD-${id}`,
    customerEmail: CONTACT_EMAIL,
    customerName: 'V35a Customer',
    productNames: ['V35a widget'],
  }, offsetSeconds);
}

async function row(id: string) {
  return db.scheduledAgentJob.findUnique({ where: { id: `${P}${id}` } });
}

/** The quote's writer re-sends it: CrossModuleAgentService.handleQuoteSent upserts its day_first/day_second jobs back to PENDING (+3 d / +7 d, new payload, executedAt null). */
async function resendQuote(quoteId: string) {
  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: { contact: true } });
  await agent.handleQuoteSent({ businessId: ID.biz, quote });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ActivityService } = await import('../src/modules/flow/activity.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  AgentClass = (await import('../src/modules/flow/cross-module-agent.service')).CrossModuleAgentService;
  CartRecoveryClass = (await import('../src/modules/conversion/abandoned-cart-recovery.service')).AbandonedCartRecoveryService;

  moduleRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      ActivityService,
      AgentClass,
      { provide: CrmService, useValue: crmStub },
      { provide: GmailService, useValue: gmailStub },
      { provide: TransactionalEmailService, useValue: emailStub },
    ],
  }).compile();

  prismaService = moduleRef.get(PrismaService);
  // The one PrismaService instance the module's agent, every newAgent() and the cart runner use:
  // their job reads see this suite's business only (review CR-D17-2). Fixtures still use `db`.
  prismaService.client = scopeJobReads(prismaService.client);
  activityService = moduleRef.get(ActivityService);
  agent = moduleRef.get(AgentClass);
  agent.onModuleDestroy();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V35a Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V35a', lastName: 'Customer', email: CONTACT_EMAIL } });
  // An open offer: the quote follow-up executor acts only on SENT/VIEWED quotes with no invoice.
  await db.quote.create({
    data: { id: ID.quote, businessId: ID.biz, contactId: ID.contact, quoteNumber: `${P}Q-001`, status: 'SENT', total: 100, subtotal: 100, sentAt: new Date() },
  });
  await db.quote.create({
    data: { id: ID.quoteB, businessId: ID.biz, contactId: ID.contact, quoteNumber: `${P}Q-002`, status: 'SENT', total: 200, subtotal: 200, sentAt: new Date() },
  });
}, 120_000);

afterAll(async () => {
  if (moduleRef) await moduleRef.close();
  if (db) await cleanup();
});

beforeEach(async () => {
  calls.length = 0;
  failAddTaskFor = null;
  addTaskHook = null;
  await cleanJobsAndEffects();
});

// ---------------------------------------------------------------------------
// REL-01 / PRS-M17: the poller runs only its own job types
// ---------------------------------------------------------------------------
describe('REL-01: the cross-module poller leaves other modules\' job types alone', () => {
  it('V35-01: due PENDING abandoned_cart_recovery, review_solicitation, lead_magnet_enroll and unknown jobs stay PENDING (executedAt null, no effect); its own quote_followup job in the same tick still runs', async () => {
    await job('cart', 'abandoned_cart_recovery', `${P}cartEvent`, `${P}abandoned_h24`, { visitorId: `${P}visitor`, contactEmail: CONTACT_EMAIL, contactName: 'V35a Customer', productIds: [], hour: 24 }, 1);
    await job('review', 'review_solicitation', `${P}booking`, `review_booking_${P}booking`, { contactId: ID.contact, contactEmail: CONTACT_EMAIL, contactName: 'V35a Customer', entityType: 'booking' }, 2);
    await job('magnet', 'lead_magnet_enroll', ID.contact, `enroll_${P}seq`, { sequenceId: `${P}seq`, contactId: ID.contact }, 3);
    await job('unknown', `${P}unknown_type`, ID.contact, `${P}unknown`, {}, 4);
    await quoteFollowUpJob('own', 5);

    await agent.processScheduledJobs();

    for (const id of ['cart', 'review', 'magnet', 'unknown']) {
      const r = await row(id);
      expect({ id, status: r.status, executedAt: r.executedAt }).toEqual({ id, status: 'PENDING', executedAt: null });
    }
    // Non-vacuity: the poller did run this tick, and its own job completed with its effects.
    const own = await row('own');
    expect(own.status).toBe('COMPLETED');
    expect(own.executedAt).toBeInstanceOf(Date);
    expect(ownCalls('crm.addTask')).toHaveLength(1);
    expect(ownCalls('gmail.sendEmail')).toHaveLength(1);
    expect(ownCalls('email.send')).toHaveLength(0);
  }, 30_000);

  it('V35-02: the abandoned_cart_recovery job the poller left PENDING is then sent by its own service (AbandonedCartRecoveryService.sendRecoveryEmails) and completed there', async () => {
    await job('cart', 'abandoned_cart_recovery', `${P}cartEvent`, `${P}abandoned_h24`, { visitorId: `${P}visitor`, contactEmail: CONTACT_EMAIL, contactName: 'V35a Customer', productIds: [], hour: 24 }, 1);

    await agent.processScheduledJobs();
    expect((await row('cart')).status).toBe('PENDING');

    const recovery = new CartRecoveryClass(prismaService, emailStub);
    await recovery.sendRecoveryEmails();

    const sent = ownCalls('email.send');
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({ recipientEmail: CONTACT_EMAIL, dedupeKey: `cart-recovery_${P}cartEvent_24` });
    expect((await row('cart')).status).toBe('COMPLETED');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// REL-02 / PRS-M18: one claimant per job
// ---------------------------------------------------------------------------
describe('REL-02: each job is claimed atomically before any effect', () => {
  async function expectExactlyOnce() {
    // quote_followup: one task, one reminder email, one activity, one notification, one run counted.
    const followUpTasks = ownCalls('crm.addTask').filter((c) => String(c.input.title).startsWith('Follow up on quote'));
    expect(followUpTasks).toHaveLength(1);
    const reminders = ownCalls('gmail.sendEmail');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].input).toMatchObject({ to: CONTACT_EMAIL, subject: `Following up on your quote ${P}Q-001` });
    const activities = await db.activity.findMany({ where: { businessId: ID.biz, entityId: ID.quote, action: 'quote_followup_day_first' } });
    expect(activities).toHaveLength(1);
    const notifications = await db.notification.findMany({ where: { businessId: ID.biz, type: 'agent.quote_followup_triggered' } });
    expect(notifications).toHaveLength(1);
    const counter = await db.crossModuleWorkflow.findUnique({ where: { businessId_workflowKey: { businessId: ID.biz, workflowKey: 'quote_followup' } } });
    expect(counter?.runCount).toBe(1);

    // post_purchase_review_request: one review email, one review task.
    const reviewEmails = ownCalls('email.send').filter((c) => c.input.type === 'review_request');
    expect(reviewEmails).toHaveLength(1);
    const reviewTasks = ownCalls('crm.addTask').filter((c) => String(c.input.title).startsWith('Request product review'));
    expect(reviewTasks).toHaveLength(1);

    for (const id of ['followup', 'review']) {
      const r = await row(id);
      expect({ id, status: r.status }).toEqual({ id, status: 'COMPLETED' });
      expect(r.executedAt).toBeInstanceOf(Date);
    }
  }

  it('V35-03: two overlapping ticks of one poller (processScheduledJobs() twice, concurrently) run each due job once: crm.addTask, gmail.sendEmail and the review email are each called once, and the rows end COMPLETED', async () => {
    await quoteFollowUpJob('followup', 1);
    await reviewRequestJob('review', 2);

    await Promise.all([agent.processScheduledJobs(), agent.processScheduledJobs()]);

    await expectExactlyOnce();
  }, 30_000);

  it('V35-04: two poller instances (two server processes sharing the database) racing one tick each run each due job once', async () => {
    await quoteFollowUpJob('followup', 1);
    await reviewRequestJob('review', 2);

    const other = newAgent();
    await Promise.all([agent.processScheduledJobs(), other.processScheduledJobs()]);

    await expectExactlyOnce();
  }, 30_000);

  it('V35-05: a job read as PENDING but taken by another claimant before this poller claims it (here: completed by the marketplace post-purchase runner) is not executed: no email, no task, the other claimant\'s row is untouched', async () => {
    await reviewRequestJob('review', 1);
    const realClient = prismaService.client;
    const jobId = `${P}review`;
    const takenAt = new Date(Date.UTC(2001, 0, 2));

    // The read returns the row as PENDING; the other claimant then completes it
    // before this poller's next statement (the gap between read and claim).
    const jobsAfterRead = new Proxy(realClient.scheduledAgentJob, {
      get(target, prop) {
        if (prop === 'findMany') {
          return async (args: unknown) => {
            const rows = await target.findMany(args);
            await realClient.scheduledAgentJob.updateMany({ where: { id: jobId, status: 'PENDING' }, data: { status: 'COMPLETED', executedAt: takenAt } });
            return rows;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const racingClient = new Proxy(realClient, {
      get(target, prop) {
        if (prop === 'scheduledAgentJob') return jobsAfterRead;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const racing = newAgent({ client: racingClient });
    await racing.processScheduledJobs();

    expect(ownCalls()).toEqual([]);
    const r = await row('review');
    expect(r.status).toBe('COMPLETED');
    expect(r.executedAt?.toISOString()).toBe(takenAt.toISOString());
  }, 30_000);

  it('V35-06 (regression control): a claimed job whose execution throws ends FAILED after one attempt, and a later tick does not run it again', async () => {
    await reviewRequestJob('review', 1);
    failAddTaskFor = `${P}ORD-review`;

    await agent.processScheduledJobs();
    expect((await row('review')).status).toBe('FAILED');
    expect(ownCalls('crm.addTask')).toHaveLength(1);

    await agent.processScheduledJobs();
    expect((await row('review')).status).toBe('FAILED');
    expect(ownCalls('crm.addTask')).toHaveLength(1);
    expect(ownCalls('email.send')).toHaveLength(1);
  }, 30_000);

  it('V35-07 (review SEC-V35-1): a job re-armed by its writer after the read (quote B re-sent while job A executes: PENDING again, +3 days, new payload) is not claimed with the stale payload: no task or reminder for B, B stays PENDING, not executed, due in the future', async () => {
    await quoteFollowUpJob('followupA', 1, ID.quote, `${P}Q-001`);
    await quoteFollowUpJob('followupB', 2, ID.quoteB, `${P}Q-002`);
    const before = await row('followupB');

    let resent = false;
    addTaskHook = async (input) => {
      if (resent || !String(input?.title).includes(`${P}Q-001`)) return;
      resent = true;
      await resendQuote(ID.quoteB);
    };

    const startedAt = Date.now();
    await agent.processScheduledJobs();
    expect(resent).toBe(true);

    // Non-vacuity: job A ran once with its effects.
    const a = await row('followupA');
    expect(a.status).toBe('COMPLETED');
    expect(ownCalls('crm.addTask').filter((c) => String(c.input.title).includes(`${P}Q-001`))).toHaveLength(1);
    expect(ownCalls('gmail.sendEmail').filter((c) => String(c.input.subject).includes(`${P}Q-001`))).toHaveLength(1);

    // Job B: the re-armed version is the one that stands, not run now.
    expect(ownCalls('crm.addTask').filter((c) => String(c.input.title).includes(`${P}Q-002`))).toEqual([]);
    expect(ownCalls('gmail.sendEmail').filter((c) => String(c.input.subject).includes(`${P}Q-002`))).toEqual([]);
    const b = await row('followupB');
    expect(b.status).toBe('PENDING');
    expect(b.executedAt).toBeNull();
    expect(b.scheduledFor.getTime()).toBeGreaterThan(startedAt + 2 * 86400000);
    expect(b.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(b.payload).toMatchObject({ quoteRef: `${P}Q-002`, days: 3 });
  }, 30_000);

  it('V35-08 (review SEC-V35-2): a claimed job whose execution throws after its writer re-armed the row (quote re-sent mid-execution) is not overwritten FAILED: the re-armed follow-up stays PENDING, not executed, due in the future', async () => {
    await quoteFollowUpJob('followup', 1);
    failAddTaskFor = `${P}Q-001`;
    let resent = false;
    let midway: any = null;
    addTaskHook = async () => {
      if (resent) return;
      resent = true;
      await resendQuote(ID.quote);
      midway = await row('followup');
    };

    const startedAt = Date.now();
    await agent.processScheduledJobs();
    expect(resent).toBe(true);
    expect(ownCalls('crm.addTask')).toHaveLength(1);
    // Mid-execution the writer had re-armed the row (the refusal came after).
    expect({ status: midway?.status, executedAt: midway?.executedAt }).toEqual({ status: 'PENDING', executedAt: null });

    const r = await row('followup');
    expect(r.status).toBe('PENDING');
    expect(r.executedAt).toBeNull();
    expect(r.scheduledFor.getTime()).toBeGreaterThan(startedAt + 2 * 86400000);
  }, 30_000);
});
