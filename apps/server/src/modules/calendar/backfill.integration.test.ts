import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CalendarProjectionService } from './calendar-projection.service';
import { CalendarBackfillService } from './backfill';

const prismaService: Pick<PrismaService, 'client'> = { client: db } as any;
const projection = new CalendarProjectionService(prismaService as PrismaService);
const backfill = new CalendarBackfillService(
  prismaService as PrismaService,
  projection,
);

const TAG = `cal-bf-${Date.now()}`;
let businessId = '';
let userId = '';
let contactId = '';
let serviceId = '';

async function seed() {
  const user = await db.user.create({
    data: { email: `${TAG}@example.com`, name: 'Backfill User' },
  });
  userId = user.id;

  const business = await db.business.create({
    data: {
      name: `${TAG} Biz`,
      ownerId: user.id,
    },
  });
  businessId = business.id;

  const contact = await db.contact.create({
    data: {
      businessId,
      displayName: `${TAG} Contact`,
      firstName: 'Backfill',
      lastName: 'Tester',
      email: `${TAG}-c@example.com`,
    },
  });
  contactId = contact.id;

  const svc = await db.service.create({
    data: {
      businessId,
      name: 'Demo Service',
      price: 100,
      duration: 60,
    },
  });
  serviceId = svc.id;

  // Booking
  await db.booking.create({
    data: {
      businessId,
      contactId,
      serviceId,
      startTime: new Date('2026-09-01T10:00:00Z'),
      endTime: new Date('2026-09-01T11:00:00Z'),
      status: 'CONFIRMED',
    },
  });

  // Social post (scheduled)
  await db.socialPost.create({
    data: {
      businessId,
      content: 'Hello world from backfill test',
      status: 'SCHEDULED',
      scheduledAt: new Date('2026-09-02T15:00:00Z'),
    },
  });

  // Email campaign (scheduled)
  await db.emailCampaign.create({
    data: {
      businessId,
      name: 'Newsletter',
      subject: 'Hi',
      body: 'Body',
      status: 'SCHEDULED',
      scheduledAt: new Date('2026-09-03T09:00:00Z'),
    },
  });

  // Contact task
  await db.contactTask.create({
    data: {
      businessId,
      contactId,
      title: 'Call back',
      dueDate: new Date('2026-09-04T12:00:00Z'),
      status: 'OPEN',
      priority: 'HIGH',
      source: 'follow_up',
    },
  });

  // Invoice with future due date (due, not overdue)
  await db.invoice.create({
    data: {
      businessId,
      contactId,
      invoiceNumber: `${TAG}-INV-1`,
      total: 250,
      currency: 'TTD',
      status: 'SENT',
      issueDate: new Date('2026-08-01'),
      dueDate: new Date('2026-12-01'),
    },
  });

  // Invoice that is overdue relative to "now" we pass below
  await db.invoice.create({
    data: {
      businessId,
      contactId,
      invoiceNumber: `${TAG}-INV-2`,
      total: 75,
      currency: 'TTD',
      status: 'SENT',
      issueDate: new Date('2026-01-01'),
      dueDate: new Date('2026-02-01'),
    },
  });

  // Quote with expiry
  await db.quote.create({
    data: {
      businessId,
      contactId,
      quoteNumber: `${TAG}-Q-1`,
      total: 500,
      currency: 'TTD',
      status: 'SENT',
      expiryDate: new Date('2026-10-15'),
    },
  });

  // Project with due date
  const project = await db.project.create({
    data: {
      businessId,
      name: 'Launch website',
      status: 'ACTIVE',
      priority: 'HIGH',
      dueDate: new Date('2026-11-01'),
    },
  });

  // Project task with due date
  await db.projectTask.create({
    data: {
      businessId,
      projectId: project.id,
      title: 'Wireframes',
      dueDate: new Date('2026-09-20'),
      priority: 'NORMAL',
    },
  });

  // Recurring invoice
  await db.recurringInvoice.create({
    data: {
      businessId,
      contactId,
      name: 'Monthly retainer',
      frequency: 'MONTHLY',
      startDate: new Date('2026-09-15'),
      nextRunDate: new Date('2026-09-15'),
      amount: 1000,
      currency: 'TTD',
    },
  });
}

async function cleanup() {
  if (!businessId) return;
  // RAW SQL THROUGHOUT, NOT deleteMany.
  //
  // Ten of the models below are registered with the soft-delete extension
  // (packages/db/src/client.ts:19-34), so deleteMany on them is rewritten into
  // an UPDATE that sets deletedAt. This teardown reported success and left every
  // one of those rows in place — the next run's seed then matched the survivors,
  // and an upsert with an empty `update` leaves deletedAt set, so the seed did
  // nothing and the failures pointed at the service instead of at the fixture.
  //
  // Converted wholesale rather than only the ten, so the delete ORDER is
  // preserved in one place: children before parents, business last but for the
  // user. Mixing raw SQL with deleteMany would keep the ordering correct only by
  // accident.
  const scoped = (table: string) => `DELETE FROM ${table} WHERE business_id = '${businessId}'`;
  const statements = [
    scoped('calendar_events'),
    scoped('recurring_invoices'),
    scoped('project_tasks'),
    scoped('projects'),
    scoped('quotes'),
    scoped('invoices'),
    scoped('contact_tasks'),
    scoped('email_campaigns'),
    scoped('social_posts'),
    scoped('bookings'),
    ...(serviceId ? [`DELETE FROM services WHERE id = '${serviceId}'`] : []),
    scoped('contacts'),
    `DELETE FROM businesses WHERE id = '${businessId}'`,
    ...(userId ? [`DELETE FROM users WHERE id = '${userId}'`] : []),
  ];
  for (const sql of statements) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
  await db.$disconnect();
}

const HAS_DB = Boolean(process.env.DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;

d('CalendarBackfillService (integration)', () => {
  beforeAll(async () => {
    await seed();
  });
  afterAll(async () => {
    await cleanup();
  });

  it('projects every supported source row on first run', async () => {
    const NOW = new Date('2026-09-10T00:00:00Z');
    const [stats] = await backfill.run({ businessId, now: NOW });
    expect(stats.businessId).toBe(businessId);
    expect(stats.bookings).toBe(1);
    expect(stats.socialPosts).toBe(1);
    expect(stats.emailCampaigns).toBe(1);
    expect(stats.contactTasks).toBe(1);
    expect(stats.invoicesDue).toBe(2);
    expect(stats.invoicesOverdue).toBe(1);
    expect(stats.quotes).toBe(1);
    expect(stats.projects).toBe(1);
    expect(stats.projectTasks).toBe(1);
    expect(stats.recurringInvoices).toBe(1);

    const events = await db.calendarEvent.findMany({
      where: { businessId, deletedAt: null },
    });
    // 1 booking + 1 social + 1 campaign + 1 task + 2 invoice_due + 1 invoice_overdue
    // + 1 quote + 1 project + 1 project_task + 1 recurring = 11
    expect(events.length).toBe(11);

    // Spot-check a couple of fields
    const followUp = events.find((e) => e.type === 'FOLLOW_UP');
    expect(followUp?.priority).toBe('HIGH');

    const overdue = events.find((e) => e.type === 'INVOICE_OVERDUE');
    expect(overdue?.status).toBe('OVERDUE');
    expect(overdue?.priority).toBe('HIGH');
  });

  it('is idempotent — a second run does not create duplicates', async () => {
    const NOW = new Date('2026-09-10T00:00:00Z');
    const beforeCount = await db.calendarEvent.count({
      where: { businessId, deletedAt: null },
    });
    await backfill.run({ businessId, now: NOW });
    await backfill.run({ businessId, now: NOW });
    const afterCount = await db.calendarEvent.count({
      where: { businessId, deletedAt: null },
    });
    expect(afterCount).toBe(beforeCount);
  });

  it('removeForSource soft-deletes a projection and a re-run restores it', async () => {
    const booking = await db.booking.findFirst({ where: { businessId } });
    expect(booking).toBeTruthy();

    await projection.removeForSource({
      businessId,
      sourceType: 'booking',
      sourceId: booking!.id,
    });
    const afterDelete = await db.calendarEvent.findFirst({
      where: { businessId, sourceType: 'booking', sourceId: booking!.id },
    });
    expect(afterDelete?.deletedAt).not.toBeNull();

    await backfill.runForBusiness(businessId, new Date('2026-09-10T00:00:00Z'));

    const afterReBackfill = await db.calendarEvent.findFirst({
      where: { businessId, sourceType: 'booking', sourceId: booking!.id },
    });
    expect(afterReBackfill?.deletedAt).toBeNull();
  });
});
