/**
 * V1-21d-KEY-DISPATCHER-TENANT-INCLUDES — the KEY tool dispatcher on a REAL database: it reads
 * related rows only inside the business, uses an id the model hands it only inside the business (in
 * a query naming it, through a service that filters by it, or after resolving it there itself when
 * the service finds its row by the id alone), and never hands the model a row the caller cannot see.
 *
 * The dispatcher is FlowOrchestratorService.executeToolAction, which every KEY surface reaches
 * (member chat, plans, monitors, and the staff WhatsApp/SMS bridge, where no tenant context is
 * installed). Nothing but the code in the path binds a row to the business KEY acts in, so this
 * suite installs no tenant context either.
 *
 * Each case below is a finding, RED on the unmodified dispatcher (claude/elegant-curie-7azpsb at
 * 0796a728):
 *
 *   INCLUDES (V1-21c review ST-1, the TD9 class; staff-bridge-boundary's four it.todo cases). Over
 *   rows cross-linked before the TD9 repairs (an A task filed on B's project, an A booking naming
 *   B's service and contact, A invoices and tickets naming B's contact):
 *     projects_list_tasks read B's project (name) through a task's to-one project include;
 *     bookings_list_bookings read B's service (name) and B's contact (name, email);
 *     projects_list counted A's task in B's project's taskCount; fetch_project_status and
 *     draft_project_update listed and counted it under B's project (and put its title in the prompt);
 *     commerce_list_invoices, store_list_recent_orders, helpdesk_list_tickets read B's contact;
 *     draft_payment_reminder and helpdesk_draft_reply put B's contact's name into the model prompt;
 *     commerce_send_invoice EMAILED the invoice to B's contact.
 *   IDS (the census in src/modules/ai/flow-dispatcher-tenant.spec.ts): content_get_request read,
 *     and content_transition_status moved, B's content request by id; evidence_verify verified B's
 *     evidence; approval_decide_step decided B's approval request; bookings_offer_waitlist_slot
 *     booked a slot in B from B's waiting list (and names a staff member of any business);
 *     content_assign_request stored a user who is no member of the business.
 *   SEC3-ST-2 (R0-SEC3 review; revenue-authorization's RR-SEC3-02 it.todo): commerce_mark_invoice_paid
 *     returned the invoice with the whole Contact row (internal notes, phone, owner, visibility) and
 *     the whole Booking row (notes, location, calendarEventId); commerce_create_invoice and
 *     commerce_create_quote returned the whole Contact row.
 *   Review SEC-V21D-1 (a service handed businessId that ignores it, TENANT_UNBOUND_TOOLS):
 *     procurement_acknowledge_vendor, procurement_mark_fulfilled and procurement_mark_invoiced moved
 *     B's procurement request (ProcurementService updates where { id }); projects_update_task
 *     assigned A's task to B's staff member (ProjectsService resolves assigneeId by findUnique).
 *   Review SEC-V21D-2: bookings_cancel_booking and bookings_reschedule_booking answered with
 *     BookingsService's row, whose service (B's name and price) and contact the service includes
 *     with no business; on a booking naming B's contact the write and its booking event (B's contact)
 *     went out before logContactEvent refused that contact. bookings_mark_no_show did the same
 *     without the refusal.
 *
 * HOW IT IS COMPOSED: the real FlowOrchestratorService.executeToolAction (no constructor: the
 * prototype with the real PrismaService and a module ref) over the real CommerceService,
 * ContentRequestService, EvidenceService, ApprovalRequestService, BookingWaitlistService,
 * BookingsService, ProcurementService and ProjectsService.
 * Stubbed: what the path does not decide (event emitters, the CRM activity log, timeline, the
 * model gateway: aiUsage.callAi records its prompt and answers a fixed JSON, no provider traffic;
 * TransactionalEmailService.send records its recipient and answers SENT, no mail is sent).
 *
 * FIXTURES: every row carries the `v21d_` prefix (test/helpers/fixture-prefixes.json) or belongs to
 * a `v21d_` business, and is hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v21d_';
const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  memberA: `${P}memberA`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  projectA: `${P}projectA`,
  projectB: `${P}projectB`,
  taskOwnA: `${P}task_own_a`,
  taskPlanted: `${P}task_planted`, // A's task filed on B's project (before TD9-1)
  taskOwnB: `${P}task_own_b`,
  serviceA: `${P}serviceA`,
  serviceB: `${P}serviceB`,
  staffA: `${P}staffA`,
  staffB: `${P}staffB`,
  bookingOwn: `${P}booking_own`,
  bookingCross: `${P}booking_cross`, // A's booking naming B's service and B's contact (before TD9-3)
  bookingCrossService: `${P}booking_cross_service`, // A's booking on A's contact naming B's service
  bookingCrossStaff: `${P}booking_cross_staff`, // A's booking on A's contact and service naming B's staff member
  bookingOwn2: `${P}booking_own2`, // A's booking on its own contact and service (the write controls)
  invOwnPaid: `${P}inv_own_paid`, // A's PAID invoice on A's contact, linked to A's booking
  invCrossSent: `${P}inv_cross_sent`, // A's SENT invoice naming B's contact (before TD9-4)
  invCrossPaid: `${P}inv_cross_paid`, // A's PAID invoice naming B's contact
  ticketCross: `${P}ticket_cross`, // A's ticket naming B's contact
  contentA: `${P}content_a`,
  contentB: `${P}content_b`,
  evidenceA: `${P}evidence_a`,
  evidenceB: `${P}evidence_b`,
  approvalA: `${P}approval_a`,
  approvalB: `${P}approval_b`,
  waitlistB: `${P}waitlist_b`,
  procA: `${P}proc_a`,
  procB: `${P}proc_b`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
/** Strings only B (or A's private fields) holds: none may reach A's model. */
const SECRET = {
  projectB: 'B-SECRET-PROJECT',
  serviceB: 'B-SECRET-SERVICE',
  contactB: 'Bsecretname',
  contactBEmail: 'b-secret@v21d.test',
  planted: 'A-CROSSLINKED-TASK',
  notesInternal: 'V21D-PRIVATE-NOTE',
  phone: '+18685550199',
  bookingNotes: 'V21D-BOOKING-NOTE',
  calendarEventId: 'v21d_cal_event',
  contentB: 'B-SECRET-CONTENT-GOAL',
};

let db: any;
let dispatcher: any;
let prompts: string[];
let sent: Array<{ recipientEmail: string }>;
/** Every event the services emitted: [name, payload]. */
let emitted: Array<[string, any]>;

/** Any method, any depth: an async no-op (the collaborators the path does not decide). */
const stub = (): any =>
  new Proxy(
    {},
    { get: (_t, k) => (k === 'then' ? undefined : vi.fn(async () => undefined)) },
  );

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM approval_steps WHERE approval_request_id IN (SELECT id FROM approval_requests WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('approval_requests'),
    byBiz('evidence'),
    byBiz('content_requests'),
    byBiz('booking_waitlist_entries'),
    byBiz('procurement_requests'),
    `DELETE FROM task_assignments WHERE task_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('invoices'),
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('quotes'),
    byBiz('bookings'),
    byBiz('support_tickets'),
    byBiz('project_tasks'),
    byBiz('projects'),
    byBiz('services'),
    byBiz('staff_members'),
    byBiz('business_events'),
    byBiz('activity_logs'),
    byBiz('contact_audit_entries'),
    byBiz('idempotency_keys'),
    byBiz('contacts'),
    byBiz('memberships'),
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort: a table may not exist on an older schema */
    }
  }
}

async function seed() {
  for (const id of [ID.ownerA, ID.ownerB, ID.memberA]) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'A', slug: `${P}biz-a`, ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'B', slug: `${P}biz-b`, ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: m(ID.ownerA), userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: m(ID.memberA), userId: ID.memberA, businessId: ID.bizA, role: 'STAFF' } });
  await db.membership.create({ data: { id: m(ID.ownerB), userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  await db.contact.create({
    data: {
      id: ID.contactA,
      businessId: ID.bizA,
      firstName: 'Vtwentyonedee',
      lastName: 'Alpha',
      email: `alpha@${P}test.local`,
      notesInternal: SECRET.notesInternal,
      phone: SECRET.phone,
      ownerId: ID.ownerA,
      visibility: 'PRIVATE',
    },
  });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: SECRET.contactB, lastName: 'Bravo', email: SECRET.contactBEmail } });

  await db.project.create({ data: { id: ID.projectA, businessId: ID.bizA, name: 'A-OWN-PROJECT' } });
  await db.project.create({ data: { id: ID.projectB, businessId: ID.bizB, name: SECRET.projectB } });
  await db.projectTask.create({ data: { id: ID.taskOwnA, businessId: ID.bizA, projectId: ID.projectA, title: 'A-OWN-TASK' } });
  await db.projectTask.create({ data: { id: ID.taskPlanted, businessId: ID.bizA, projectId: ID.projectB, title: SECRET.planted } });
  await db.projectTask.create({ data: { id: ID.taskOwnB, businessId: ID.bizB, projectId: ID.projectB, title: 'B-OWN-TASK' } });

  await db.service.create({ data: { id: ID.serviceA, businessId: ID.bizA, name: 'A-OWN-SERVICE', duration: 60, price: 10 } });
  await db.service.create({ data: { id: ID.serviceB, businessId: ID.bizB, name: SECRET.serviceB, duration: 60, price: 10 } });
  await db.staffMember.create({ data: { id: ID.staffA, businessId: ID.bizA, name: 'A staff' } });
  await db.staffMember.create({ data: { id: ID.staffB, businessId: ID.bizB, name: 'B staff' } });
  await db.invoice.create({
    data: { id: ID.invOwnPaid, businessId: ID.bizA, contactId: ID.contactA, invoiceNumber: `${P}INV-1`, total: 50, status: 'PAID', paidAt: new Date() },
  });
  await db.invoice.create({ data: { id: ID.invCrossSent, businessId: ID.bizA, contactId: ID.contactB, invoiceNumber: `${P}INV-2`, total: 75, status: 'SENT' } });
  await db.invoice.create({
    data: { id: ID.invCrossPaid, businessId: ID.bizA, contactId: ID.contactB, invoiceNumber: `${P}INV-3`, total: 80, status: 'PAID', paidAt: new Date() },
  });
  const at = (days: number) => new Date(Date.now() + days * 24 * 3600_000);
  await db.booking.create({
    data: {
      id: ID.bookingOwn,
      businessId: ID.bizA,
      contactId: ID.contactA,
      serviceId: ID.serviceA,
      startTime: at(30),
      endTime: at(30.05),
      notes: SECRET.bookingNotes,
      location: 'Back room',
      calendarEventId: SECRET.calendarEventId,
      invoiceId: ID.invOwnPaid, // the invoice's to-one booking (Booking.invoiceId)
    },
  });
  await db.booking.create({
    data: { id: ID.bookingCross, businessId: ID.bizA, contactId: ID.contactB, serviceId: ID.serviceB, startTime: at(31), endTime: at(31.05) },
  });
  await db.booking.create({
    data: { id: ID.bookingCrossService, businessId: ID.bizA, contactId: ID.contactA, serviceId: ID.serviceB, startTime: at(32), endTime: at(32.05) },
  });
  await db.booking.create({
    data: { id: ID.bookingCrossStaff, businessId: ID.bizA, contactId: ID.contactA, serviceId: ID.serviceA, staffId: ID.staffB, startTime: at(33), endTime: at(33.05) },
  });
  await db.booking.create({
    data: { id: ID.bookingOwn2, businessId: ID.bizA, contactId: ID.contactA, serviceId: ID.serviceA, startTime: at(34), endTime: at(34.05) },
  });

  await db.supportTicket.create({ data: { id: ID.ticketCross, businessId: ID.bizA, contactId: ID.contactB, title: 'A ticket', description: 'help' } });

  const content = (id: string, businessId: string, businessGoal: string) =>
    db.contentRequest.create({
      data: {
        id,
        businessId,
        requestedBy: 'v21d',
        source: 'manual',
        contentTypes: ['post'],
        businessGoal,
        requiredInputs: [],
        attachedAssetIds: [],
        assignedTeamMemberIds: [],
        deliveryFileIds: [],
      },
    });
  await content(ID.contentA, ID.bizA, 'A-OWN-CONTENT-GOAL');
  await content(ID.contentB, ID.bizB, SECRET.contentB);

  const evidence = (id: string, businessId: string) =>
    db.evidence.create({
      data: { id, businessId, evidenceType: 'photo', url: `https://${P}test.local/${id}.jpg`, storageKey: id, submittedBy: 'v21d', linkedType: 'job', linkedId: id },
    });
  await evidence(ID.evidenceA, ID.bizA);
  await evidence(ID.evidenceB, ID.bizB);

  const approval = async (id: string, businessId: string) => {
    await db.approvalRequest.create({ data: { id, businessId, requestType: 'spend', requesterId: 'v21d', title: `${id} approval`, payload: {} } });
    await db.approvalStep.create({ data: { approvalRequestId: id, stepOrder: 0, approverId: 'key_ai' } });
  };
  await approval(ID.approvalA, ID.bizA);
  await approval(ID.approvalB, ID.bizB);

  await db.bookingWaitlistEntry.create({ data: { id: ID.waitlistB, businessId: ID.bizB, contactId: ID.contactB, serviceId: ID.serviceB } });

  for (const [id, businessId] of [
    [ID.procA, ID.bizA],
    [ID.procB, ID.bizB],
  ]) {
    await db.procurementRequest.create({ data: { id, businessId, userPrompt: `${id} supplies`, status: 'PO_ISSUED', poIssuedAt: new Date() } });
  }
}

function run(businessId: string, tool: string, args: Record<string, unknown>) {
  return dispatcher.executeToolAction(businessId, tool, args);
}
/** What a failed call left behind: the rejection, or the answer it should not have given. */
async function outcome(businessId: string, tool: string, args: Record<string, unknown>) {
  try {
    return { result: await run(businessId, tool, args), error: null as Error | null };
  } catch (error) {
    return { result: null, error: error as Error };
  }
}
const leaks = (value: unknown, secrets: string[]) => secrets.filter((s) => JSON.stringify(value ?? null).includes(s));

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { ContentRequestService } = await import('../src/modules/content-ops/content-request.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { ApprovalRequestService } = await import('../src/modules/approvals/approval-request.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { HelpdeskService } = await import('../src/modules/helpdesk/helpdesk.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { ActivityLogService } = await import('../src/modules/activity/activity.service');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { ProcurementService } = await import('../src/modules/procurement/procurement.service');
  const { ProjectsService } = await import('../src/modules/projects/projects.service');
  const { NotFoundException } = await import('@nestjs/common');

  const prisma = new PrismaService();
  emitted = [];
  const emitter = {
    emit: vi.fn((name: string, payload: unknown) => {
      emitted.push([name, payload]);
      return true;
    }),
  };
  // CRM activity log: refuses a contact outside the business, as CrmService.logContactEvent does.
  const crm = {
    logContactEvent: vi.fn(async ({ businessId, contactId }: { businessId: string; contactId: string }) => {
      const c = await db.contact.findFirst({ where: { id: contactId, businessId } });
      if (!c) throw new NotFoundException('Contact not found');
    }),
  };
  const commerce = new CommerceService(prisma as any, emitter as any, crm as any, stub(), stub(), stub(), stub(), stub(), stub());
  const approvals = new ApprovalRequestService(prisma as any, emitter as any);
  const contentRequests = new ContentRequestService(prisma as any, emitter as any, approvals);
  const evidence = new EvidenceService(prisma as any, stub(), emitter as any);
  const waitlist = new BookingWaitlistService(prisma as any, emitter as any);
  const bookings = new BookingsService(prisma as any, emitter as any, crm as any, commerce as any, stub(), stub(), stub(), stub(), stub());
  const procurement = new ProcurementService(prisma as any, stub());
  const projects = new ProjectsService(prisma as any, emitter as any, stub(), stub(), stub());
  sent = [];
  const email = {
    send: vi.fn(async (input: { recipientEmail: string }) => {
      sent.push({ recipientEmail: input.recipientEmail });
      return { status: 'SENT' };
    }),
  };
  const helpdesk = { listTicketMessages: vi.fn(async () => []) };
  const services = new Map<unknown, unknown>([
    [CommerceService, commerce],
    [ContentRequestService, contentRequests],
    [EvidenceService, evidence],
    [ApprovalRequestService, approvals],
    [BookingWaitlistService, waitlist],
    [BookingsService, bookings],
    [ProcurementService, procurement],
    [ProjectsService, projects],
    [HelpdeskService, helpdesk],
    [TransactionalEmailService, email],
    [ActivityLogService, stub()],
  ]);
  prompts = [];
  dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    moduleRef: { get: (token: unknown) => services.get(token) ?? stub() },
    // the model gateway: the prompt is recorded, nothing leaves the process
    aiUsage: {
      callAi: vi.fn(async (req: { messages: Array<{ content: string }> }) => {
        prompts.push(req.messages.map((x) => x.content).join('\n'));
        return { content: JSON.stringify({ subject: 's', body: 'b', nextSteps: [] }) };
      }),
    },
  });

  await cleanup();
  await seed();
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
}, 60_000);

// ─── INCLUDES: relation reads over rows cross-linked before the TD9 repairs ───

describe("V1-21d INCLUDES — a dispatcher read never hands KEY another business's related row", () => {
  it("projects_list_tasks: A's task filed on B's project reads no project (staff-bridge-boundary ST-1 todo 1)", async () => {
    const out = await run(ID.bizA, 'projects_list_tasks', {});
    const planted = out.tasks.find((t: { id: string }) => t.id === ID.taskPlanted);
    expect(planted, 'the task is A’s own row and stays listed').toBeDefined();
    expect(planted.project).toBeNull();
    expect(leaks(out, [SECRET.projectB])).toEqual([]);
    // control: A's own task reads its own project
    expect(out.tasks.find((t: { id: string }) => t.id === ID.taskOwnA).project).toMatchObject({ id: ID.projectA, name: 'A-OWN-PROJECT' });
    // and by B's project id: the same planted row, still without B's project
    const byId = await run(ID.bizA, 'projects_list_tasks', { projectId: ID.projectB });
    expect(byId.tasks.map((t: { id: string }) => t.id)).toEqual([ID.taskPlanted]);
    expect(leaks(byId, [SECRET.projectB, 'B-OWN-TASK'])).toEqual([]);
  });

  it("bookings_list_bookings: A's booking naming B's service and B's contact reads neither (ST-1 todos 2 and 3)", async () => {
    const out = await run(ID.bizA, 'bookings_list_bookings', { limit: 50 });
    const cross = out.bookings.find((b: { id: string }) => b.id === ID.bookingCross);
    expect(cross).toBeDefined();
    expect(cross.service).toBeNull();
    expect(cross.contact).toBeNull();
    expect(leaks(out, [SECRET.serviceB, SECRET.contactB, SECRET.contactBEmail])).toEqual([]);
    const own = out.bookings.find((b: { id: string }) => b.id === ID.bookingOwn);
    expect(own.service).toMatchObject({ name: 'A-OWN-SERVICE' });
    expect(own.contact).toMatchObject({ firstName: 'Vtwentyonedee' });
  });

  it("projects_list: B's project counts B's tasks only, not A's task filed on it (ST-1 todo 4)", async () => {
    const out = await run(ID.bizB, 'projects_list', {});
    expect(out.projects.find((p: { id: string }) => p.id === ID.projectB).taskCount).toBe(1);
  });

  it("fetch_project_status: B's project status counts B's tasks only", async () => {
    const out = await run(ID.bizB, 'fetch_project_status', { projectId: ID.projectB });
    expect(out.projects).toHaveLength(1);
    expect(out.projects[0]).toMatchObject({ id: ID.projectB, totalTasks: 1 });
  });

  it("draft_project_update: the prompt for B's project carries B's tasks only", async () => {
    prompts.length = 0;
    await run(ID.bizB, 'draft_project_update', { projectId: ID.projectB });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('B-OWN-TASK');
    expect(prompts[0]).not.toContain(SECRET.planted);
    // B's one open task, not "0/2" with A's planted task counted
    expect(prompts[0]).toContain('0/1 tasks done');
  });

  it("commerce_list_invoices and store_list_recent_orders: an A invoice naming B's contact reads no contact", async () => {
    const list = await run(ID.bizA, 'commerce_list_invoices', { limit: 50 });
    expect(list.invoices.find((i: { id: string }) => i.id === ID.invCrossSent).contact).toBeNull();
    expect(list.invoices.find((i: { id: string }) => i.id === ID.invOwnPaid).contact).toMatchObject({ firstName: 'Vtwentyonedee' });
    const orders = await run(ID.bizA, 'store_list_recent_orders', { limit: 50 });
    expect(orders.orders.find((i: { id: string }) => i.id === ID.invCrossPaid).contact).toBeNull();
    expect(leaks([list, orders], [SECRET.contactB, SECRET.contactBEmail])).toEqual([]);
  });

  it("helpdesk_list_tickets: an A ticket naming B's contact reads no contact", async () => {
    const out = await run(ID.bizA, 'helpdesk_list_tickets', {});
    expect(out.tickets.find((t: { id: string }) => t.id === ID.ticketCross).contact).toBeNull();
    expect(leaks(out, [SECRET.contactB, SECRET.contactBEmail])).toEqual([]);
  });

  it("draft_payment_reminder and helpdesk_draft_reply: B's contact's name never reaches the model prompt", async () => {
    prompts.length = 0;
    await run(ID.bizA, 'draft_payment_reminder', { invoiceId: ID.invCrossSent });
    await run(ID.bizA, 'helpdesk_draft_reply', { ticketId: ID.ticketCross });
    expect(prompts).toHaveLength(2);
    expect(leaks(prompts, [SECRET.contactB, SECRET.contactBEmail])).toEqual([]);
  });

  it("commerce_send_invoice: an A invoice naming B's contact is emailed to no one, and its status is left as it was (DRAFT)", async () => {
    sent.length = 0;
    await db.invoice.update({ where: { id: ID.invCrossSent }, data: { status: 'DRAFT' } });
    const { error } = await outcome(ID.bizA, 'commerce_send_invoice', { invoiceId: ID.invCrossSent });
    expect(error).not.toBeNull();
    expect(sent.map((s) => s.recipientEmail)).toEqual([]);
    expect((await db.invoice.findUnique({ where: { id: ID.invCrossSent } })).status).toBe('DRAFT');
    await db.invoice.update({ where: { id: ID.invCrossSent }, data: { status: 'SENT' } });
  });
});

// ─── IDS: a model-supplied id is resolved inside the business before use ─────

describe('V1-21d IDS — an id the model hands KEY is resolved inside the business before it is used', () => {
  it("content_get_request refuses B's content request; content_transition_status leaves it as it was", async () => {
    const read = await outcome(ID.bizA, 'content_get_request', { requestId: ID.contentB });
    expect(read.error?.message).toMatch(/not found/i);
    expect(leaks(read.result, [SECRET.contentB])).toEqual([]);
    const moved = await outcome(ID.bizA, 'content_transition_status', { requestId: ID.contentB, newStatus: 'submitted' });
    expect(moved.error?.message).toMatch(/not found/i);
    expect((await db.contentRequest.findUnique({ where: { id: ID.contentB } })).status).toBe('draft');
  });

  it('control: its own content request is read and moved', async () => {
    const read = await run(ID.bizA, 'content_get_request', { requestId: ID.contentA });
    expect(read.request).toMatchObject({ id: ID.contentA, businessGoal: 'A-OWN-CONTENT-GOAL' });
    const moved = await run(ID.bizA, 'content_transition_status', { requestId: ID.contentA, newStatus: 'submitted' });
    expect(moved).toEqual({ requestId: ID.contentA, newStatus: 'submitted' });
  });

  it('content_assign_request assigns only members of the business', async () => {
    const foreign = await outcome(ID.bizA, 'content_assign_request', { requestId: ID.contentA, teamMemberIds: [ID.memberA, ID.ownerB] });
    expect(foreign.error?.message).toMatch(/not found|not a member/i);
    expect((await db.contentRequest.findUnique({ where: { id: ID.contentA } })).assignedTeamMemberIds).toEqual([]);
    const own = await run(ID.bizA, 'content_assign_request', { requestId: ID.contentA, teamMemberIds: [ID.memberA] });
    expect(own.assignedTo).toEqual([ID.memberA]);
  });

  it("evidence_verify refuses B's evidence and verifies nothing there", async () => {
    const { error } = await outcome(ID.bizA, 'evidence_verify', { evidenceId: ID.evidenceB });
    expect(error?.message).toMatch(/not found/i);
    expect((await db.evidence.findUnique({ where: { id: ID.evidenceB } })).verifiedAt).toBeNull();
    // control
    const own = await run(ID.bizA, 'evidence_verify', { evidenceId: ID.evidenceA });
    expect(own).toMatchObject({ evidenceId: ID.evidenceA, verified: true });
  });

  it("approval_decide_step refuses B's approval request and decides nothing there", async () => {
    const { error } = await outcome(ID.bizA, 'approval_decide_step', { approvalRequestId: ID.approvalB, decision: 'approve' });
    expect(error?.message).toMatch(/not found/i);
    expect((await db.approvalRequest.findUnique({ where: { id: ID.approvalB } })).status).toBe('pending');
    // control
    const own = await run(ID.bizA, 'approval_decide_step', { approvalRequestId: ID.approvalA, decision: 'approve' });
    expect(own).toMatchObject({ approvalRequestId: ID.approvalA, newStatus: 'approved' });
  });

  it("bookings_offer_waitlist_slot refuses B's waiting-list entry: no booking is written in B, the entry still waits", async () => {
    const before = await db.booking.count({ where: { businessId: ID.bizB } });
    const slot = { startTime: new Date(Date.now() + 40 * 24 * 3600_000).toISOString(), endTime: new Date(Date.now() + 40.05 * 24 * 3600_000).toISOString() };
    const { result, error } = await outcome(ID.bizA, 'bookings_offer_waitlist_slot', { entryId: ID.waitlistB, serviceId: ID.serviceA, ...slot });
    expect(error?.message).toMatch(/not found/i);
    expect(leaks(result, [SECRET.contactB, SECRET.serviceB])).toEqual([]);
    expect(await db.booking.count({ where: { businessId: ID.bizB } })).toBe(before);
    expect((await db.bookingWaitlistEntry.findUnique({ where: { id: ID.waitlistB } })).status).toBe('WAITING');
  });

  it("bookings_offer_waitlist_slot refuses another business's service or staff member before anything is written", async () => {
    const entry = await db.bookingWaitlistEntry.create({ data: { id: `${P}waitlist_a`, businessId: ID.bizA, contactId: ID.contactA, serviceId: ID.serviceA } });
    const slot = { startTime: new Date(Date.now() + 41 * 24 * 3600_000).toISOString(), endTime: new Date(Date.now() + 41.05 * 24 * 3600_000).toISOString() };
    const before = await db.booking.count({ where: { businessId: ID.bizA } });
    const staff = await outcome(ID.bizA, 'bookings_offer_waitlist_slot', { entryId: entry.id, serviceId: ID.serviceA, staffId: ID.staffB, ...slot });
    expect(staff.error?.message).toMatch(/not found/i);
    const service = await outcome(ID.bizA, 'bookings_offer_waitlist_slot', { entryId: entry.id, serviceId: ID.serviceB, ...slot });
    expect(service.error?.message).toMatch(/not found/i);
    expect(await db.booking.count({ where: { businessId: ID.bizA } })).toBe(before);
    // control: its own entry, service and staff member are offered the slot
    const own = await run(ID.bizA, 'bookings_offer_waitlist_slot', { entryId: entry.id, serviceId: ID.serviceA, staffId: ID.staffA, ...slot });
    expect(own.booking).toMatchObject({ businessId: ID.bizA, serviceId: ID.serviceA, staffId: ID.staffA });
  });
});

// ─── SEC3-ST-2: the commerce write tools hand the model the write projection ──

describe('V1-21d SEC3-ST-2 — a KEY commerce write answers with the write projection (revenue-authorization RR-SEC3-02)', () => {
  const PRIVATE = [SECRET.notesInternal, SECRET.phone, SECRET.bookingNotes, SECRET.calendarEventId, 'Back room', 'PRIVATE'];

  it('commerce_mark_invoice_paid: no Booking row, the contact as toInvoiceWriteResponse answers it', async () => {
    const out = await run(ID.bizA, 'commerce_mark_invoice_paid', { invoiceId: ID.invOwnPaid });
    expect(out.id).toBe(ID.invOwnPaid);
    expect(out.invoice).toMatchObject({ id: ID.invOwnPaid, status: 'PAID', contactId: ID.contactA });
    expect(out.invoice).not.toHaveProperty('booking');
    expect(Object.keys(out.invoice.contact).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
    expect(leaks(out, PRIVATE)).toEqual([]);
    // only the answer changes: the rows keep their fields
    expect(await db.contact.findUnique({ where: { id: ID.contactA }, select: { notesInternal: true, phone: true } })).toEqual({
      notesInternal: SECRET.notesInternal,
      phone: SECRET.phone,
    });
  });

  it("commerce_mark_invoice_paid: an A invoice naming B's contact answers no contact", async () => {
    const out = await run(ID.bizA, 'commerce_mark_invoice_paid', { invoiceId: ID.invCrossPaid });
    expect(out.invoice.contact).toBeNull();
    expect(leaks(out, [SECRET.contactB, SECRET.contactBEmail])).toEqual([]);
  });

  it('commerce_create_invoice and commerce_create_quote: the contact projected the same way', async () => {
    const items = [{ description: 'v21d', quantity: 1, unitPrice: 5 }];
    const inv = await run(ID.bizA, 'commerce_create_invoice', { contactId: ID.contactA, items });
    expect(inv.invoice).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA });
    expect(Object.keys(inv.invoice.contact).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
    const qt = await run(ID.bizA, 'commerce_create_quote', { contactId: ID.contactA, items });
    expect(qt.quote).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA });
    expect(Object.keys(qt.quote.contact).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
    expect(leaks([inv, qt], PRIVATE)).toEqual([]);
  });
});

// ─── review SEC-V21D-1: a service that ignores the business gets only an id resolved inside it ───

describe('V1-21d review SEC-V21D-1 — a TENANT_UNBOUND_TOOLS service is handed only ids the dispatcher resolved inside the business', () => {
  it("procurement_acknowledge_vendor, procurement_mark_fulfilled and procurement_mark_invoiced refuse B's request and leave it as it was", async () => {
    for (const tool of ['procurement_acknowledge_vendor', 'procurement_mark_fulfilled', 'procurement_mark_invoiced']) {
      const { result, error } = await outcome(ID.bizA, tool, { requestId: ID.procB });
      expect(error?.message, tool).toMatch(/not found/i);
      expect(result, tool).toBeNull();
    }
    expect(
      await db.procurementRequest.findUnique({ where: { id: ID.procB }, select: { status: true, vendorAcknowledgedAt: true, fulfilledAt: true, invoicedAt: true } }),
    ).toEqual({ status: 'PO_ISSUED', vendorAcknowledgedAt: null, fulfilledAt: null, invoicedAt: null });
  });

  it('control: its own request moves through acknowledged, fulfilled and invoiced', async () => {
    expect(await run(ID.bizA, 'procurement_acknowledge_vendor', { requestId: ID.procA })).toEqual({ id: ID.procA, status: 'VENDOR_ACKNOWLEDGED' });
    expect(await run(ID.bizA, 'procurement_mark_fulfilled', { requestId: ID.procA })).toEqual({ id: ID.procA, status: 'FULFILLED' });
    expect(await run(ID.bizA, 'procurement_mark_invoiced', { requestId: ID.procA })).toEqual({ id: ID.procA, status: 'INVOICED' });
  });

  it("projects_update_task refuses B's staff member, or a user who is no member, as the assignee: the task and its assignments are left as they were", async () => {
    for (const assigneeId of [ID.staffB, ID.ownerB]) {
      const { error } = await outcome(ID.bizA, 'projects_update_task', { taskId: ID.taskOwnA, assigneeId, title: 'A-RENAMED' });
      expect(error?.message, assigneeId).toMatch(/not found/i);
    }
    expect(await db.projectTask.findUnique({ where: { id: ID.taskOwnA }, select: { assigneeId: true, title: true } })).toEqual({
      assigneeId: null,
      title: 'A-OWN-TASK',
    });
    expect(await db.taskAssignment.count({ where: { taskId: ID.taskOwnA } })).toBe(0);
  });

  it('control: its own staff member, then a member of the business, is assigned; an update naming no assignee is not checked', async () => {
    const staff = await run(ID.bizA, 'projects_update_task', { taskId: ID.taskOwnA, assigneeId: ID.staffA });
    expect(staff).toMatchObject({ id: ID.taskOwnA, assigneeId: ID.staffA });
    const member = await run(ID.bizA, 'projects_update_task', { taskId: ID.taskOwnA, assigneeId: ID.memberA });
    expect(member).toMatchObject({ id: ID.taskOwnA, assigneeId: ID.memberA });
    expect(
      await db.taskAssignment.findFirst({ where: { taskId: ID.taskOwnA, unassignedAt: null }, select: { assignableType: true, assignableId: true } }),
    ).toEqual({ assignableType: 'User', assignableId: ID.memberA });
    const renamed = await run(ID.bizA, 'projects_update_task', { taskId: ID.taskOwnA, title: 'A-OWN-TASK' });
    expect(renamed).toMatchObject({ id: ID.taskOwnA, title: 'A-OWN-TASK', assigneeId: ID.memberA });
  });
});

// ─── review SEC-V21D-2: a booking write over a booking linked across businesses ───

describe("V1-21d review SEC-V21D-2 — a KEY booking write never answers with, or writes through, another business's related row", () => {
  const eventsFor = (bookingId: string) => emitted.filter(([, payload]) => payload?.booking?.id === bookingId).map(([name]) => name);
  const bookingState = (id: string) => db.booking.findUnique({ where: { id }, select: { status: true, startTime: true } });

  it("bookings_cancel_booking and bookings_reschedule_booking refuse A's booking on B's service: nothing written, no event, B's service in no answer", async () => {
    const before = await bookingState(ID.bookingCrossService);
    emitted.length = 0;
    const cancel = await outcome(ID.bizA, 'bookings_cancel_booking', { bookingId: ID.bookingCrossService });
    const moved = await outcome(ID.bizA, 'bookings_reschedule_booking', {
      bookingId: ID.bookingCrossService,
      startTime: new Date(Date.now() + 50 * 24 * 3600_000).toISOString(),
    });
    for (const { result, error } of [cancel, moved]) {
      expect(error?.message).toMatch(/another business/i);
      expect(leaks([result, error?.message], [SECRET.serviceB, ID.serviceB])).toEqual([]);
    }
    expect(await bookingState(ID.bookingCrossService)).toEqual(before);
    expect(eventsFor(ID.bookingCrossService)).toEqual([]);
  });

  it("bookings_cancel_booking and bookings_mark_no_show refuse A's booking on B's contact BEFORE the write: no status change, no booking event carrying B's contact", async () => {
    const before = await bookingState(ID.bookingCross);
    emitted.length = 0;
    for (const tool of ['bookings_cancel_booking', 'bookings_mark_no_show']) {
      const { result, error } = await outcome(ID.bizA, tool, { bookingId: ID.bookingCross });
      expect(error?.message, tool).toMatch(/another business/i);
      expect(leaks([result, error?.message], [SECRET.contactB, SECRET.contactBEmail, SECRET.serviceB]), tool).toEqual([]);
    }
    expect(await bookingState(ID.bookingCross)).toEqual(before);
    expect(eventsFor(ID.bookingCross)).toEqual([]);
    expect(leaks(emitted, [SECRET.contactB, SECRET.contactBEmail])).toEqual([]);
  });

  it("bookings_cancel_booking refuses A's booking with B's staff member", async () => {
    const before = await bookingState(ID.bookingCrossStaff);
    const { error } = await outcome(ID.bizA, 'bookings_cancel_booking', { bookingId: ID.bookingCrossStaff });
    expect(error?.message).toMatch(/another business/i);
    expect(await bookingState(ID.bookingCrossStaff)).toEqual(before);
  });

  it("refuses B's own booking as not found", async () => {
    const at = (days: number) => new Date(Date.now() + days * 24 * 3600_000);
    const theirs = await db.booking.create({
      data: { id: `${P}booking_b`, businessId: ID.bizB, contactId: ID.contactB, serviceId: ID.serviceB, startTime: at(60), endTime: at(60.05) },
    });
    const { error } = await outcome(ID.bizA, 'bookings_cancel_booking', { bookingId: theirs.id });
    expect(error?.message).toMatch(/not found/i);
    expect((await bookingState(theirs.id)).status).not.toBe('CANCELLED');
  });

  it('control: its own booking is rescheduled and cancelled, answering with its own service and contact', async () => {
    emitted.length = 0;
    const startTime = new Date(Date.now() + 70 * 24 * 3600_000);
    const moved = await run(ID.bizA, 'bookings_reschedule_booking', { bookingId: ID.bookingOwn2, startTime: startTime.toISOString() });
    expect(moved.id).toBe(ID.bookingOwn2);
    expect(moved.booking).toMatchObject({ id: ID.bookingOwn2, service: { id: ID.serviceA, name: 'A-OWN-SERVICE' }, contact: { id: ID.contactA } });
    expect(new Date(moved.booking.startTime).getTime()).toBe(startTime.getTime());
    const cancelled = await run(ID.bizA, 'bookings_cancel_booking', { bookingId: ID.bookingOwn2 });
    expect(cancelled.booking).toMatchObject({ id: ID.bookingOwn2, status: 'CANCELLED', service: { name: 'A-OWN-SERVICE' }, contact: { id: ID.contactA } });
    expect(eventsFor(ID.bookingOwn2)).toEqual(expect.arrayContaining(['booking.rescheduled', 'booking.cancelled']));
  });
});
