/**
 * FU-WA-INBOUND-KEY-EXCLUDE (P60, owner ruling D-280 / SEC-WAW-1)
 *
 * Pasted inbound WhatsApp text — stored by CrmService.captureInboundWhatsApp as
 * ContactNote(source='whatsapp_inbound') and ContactEvent(type='communication.whatsapp',
 * source='whatsapp_inbound') — MUST stay out of every automatic KEY prompt,
 * background scan, and indirect ledger/touchpoint body copy. Owner-initiated KEY
 * use stays allowed.
 *
 * On a REAL Postgres database (`contacts`, `contact_notes`, `contact_events`,
 * `activities`, `journey_touchpoints`), stubbing ONLY the LLM provider calls to
 * inspect the exact prompt strings.
 *
 * Fixtures: prefix `v94w_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v94w_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
};

const CANARY = {
  waInbound: 'CANARY_WA_INBOUND_IGNORE_PREVIOUS_INSTRUCTIONS_94W',
  teamNull: 'CANARY_TEAM_NOTE_NULL_SOURCE_94W',
  teamManual: 'CANARY_TEAM_NOTE_MANUAL_SOURCE_94W',
  emailEvent: 'CANARY_NORMAL_EMAIL_EVENT_BODY_94W',
};

let db: any;
let prismaService: any;
let crmService: any;
let crmTimeline: any;
let intuitionService: any;
let conversationAi: any;
let patternDetector: any;
let flowOrchestrator: any;
let customerJourney: any;
let contactInsightListener: any;
let markStaleSpy: ReturnType<typeof vi.fn>;

const llmPrompts: Array<{ caller: string; prompt: string }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM journey_touchpoints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM conversation_ai_insights WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { KeyCortexIntuitionService } = await import('../src/modules/key-cortex/key-cortex-intuition.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { PatternDetectorService } = await import('../src/modules/ai/pattern-detector.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { CustomerJourneyService } = await import('../src/modules/growth-intelligence/customer-journey.service');
  const { ContactInsightListener } = await import('../src/modules/crm/contact-insight.listener');

  prismaService = new PrismaService();
  const events = new EventEmitter2({ wildcard: true, delimiter: '.' });
  const timelineService = new TimelineService(prismaService);
  crmTimeline = new CrmTimelineService(prismaService, events, timelineService);

  const noop = new Proxy({}, { get: () => vi.fn(async () => undefined) });
  const contactAuditStub = { write: vi.fn(async () => undefined) };
  const statsStub = { invalidateCache: vi.fn() };
  const flowStub = { invalidateCache: vi.fn() };
  const subsStub = { checkLimit: vi.fn(async () => ({ allowed: true })) };

  crmService = new CrmService(
    prismaService,
    events,
    subsStub as any,
    crmTimeline,
    statsStub as any,
    noop as any,
    flowStub as any,
    noop as any,
    contactAuditStub as any,
    noop as any,
  );

  const aiUsageStub = {
    trackAndComplete: vi.fn(async (_bizId: string, _userId: unknown, feature: string, opts: { messages: Array<{ content: string }> }) => {
      const prompt = (opts?.messages ?? []).map((m) => m.content).join('\n');
      llmPrompts.push({ caller: feature, prompt });
      return { content: '[]', model: 'stub' };
    }),
    callAi: vi.fn(async (opts: { feature: string; messages: Array<{ content: string }> }) => {
      const prompt = (opts?.messages ?? []).map((m) => m.content).join('\n');
      llmPrompts.push({ caller: opts.feature, prompt });
      if (opts.feature === 'flow_draft_followup') {
        return { content: JSON.stringify({ subject: 'Hi', body: 'Hello', callToAction: 'Reply' }), model: 'stub' };
      }
      if (opts.feature === 'crm_conversation_suggest_replies') {
        return { content: JSON.stringify({ replies: [{ channel: 'whatsapp', body: 'Thanks!', tone: 'warm', rationale: 'test' }] }), model: 'stub' };
      }
      return {
        content: JSON.stringify({
          summary: 'Stub summary',
          sentiment: 'neutral',
          lastIntent: 'inquiry',
          openQuestions: [],
          actionItems: [],
        }),
        model: 'stub',
      };
    }),
  };

  intuitionService = new KeyCortexIntuitionService(
    prismaService,
    noop as any,
    noop as any,
    noop as any,
    aiUsageStub as any,
  );
  conversationAi = new ConversationAiService(prismaService, aiUsageStub as any, events);
  patternDetector = new PatternDetectorService(prismaService, aiUsageStub as any, noop as any);
  customerJourney = new CustomerJourneyService(prismaService);

  markStaleSpy = vi.fn(async () => undefined);
  contactInsightListener = new ContactInsightListener({ markStale: markStaleSpy } as any);

  // Build FlowOrchestratorService with real PrismaService and captured aiUsageStub for draft_followup_message.
  flowOrchestrator = Object.create(FlowOrchestratorService.prototype);
  flowOrchestrator.prisma = prismaService;
  flowOrchestrator.aiUsage = aiUsageStub;

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@example.test`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.biz, name: 'V94W Studio', slug: `${P}studio`, ownerId: ID.owner, currency: 'TTD' },
  });
  await db.membership.create({
    data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
  });
  await db.contact.create({
    data: {
      id: ID.contact,
      businessId: ID.biz,
      firstName: 'Asha',
      lastName: 'Mohammed',
      phone: '+18685550194',
      whatsappNumber: '+18685550194',
      status: 'LEAD',
    },
  });
}, 60_000);

beforeEach(async () => {
  llmPrompts.length = 0;
  markStaleSpy.mockClear();
  await db.$executeRawUnsafe(`DELETE FROM journey_touchpoints WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM conversation_ai_insights WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`);
});

afterAll(async () => {
  await cleanup();
}, 30_000);

describe('FU-WA-INBOUND-KEY-EXCLUDE (P60, D-280 / SEC-WAW-1)', () => {
  it('[WAX-01] RED-BEFORE: KeyCortexIntuitionService automatic corpus & semantic LLM prompt exclude whatsapp_inbound notes while keeping NULL-source and manual notes', async () => {
    await crmService.captureInboundWhatsApp({
      businessId: ID.biz,
      contactId: ID.contact,
      phone: '+18685550194',
      message: CANARY.waInbound,
      actorUserId: ID.owner,
    });
    // Seed a legacy NULL-source team note AND an explicit manual team note (both MUST remain in corpus).
    await db.contactNote.create({
      data: { id: `${P}note_null`, businessId: ID.biz, contactId: ID.contact, body: CANARY.teamNull, source: null },
    });
    await db.contactNote.create({
      data: { id: `${P}note_manual`, businessId: ID.biz, contactId: ID.contact, body: CANARY.teamManual, source: 'manual' },
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const corpus: Array<{ source: string; text: string }> = await intuitionService.collectTextCorpus(ID.biz, since);
    const allCorpusText = corpus.map((c) => c.text).join('\n');

    expect(allCorpusText).not.toContain(CANARY.waInbound);
    expect(allCorpusText).toContain(CANARY.teamNull);
    expect(allCorpusText).toContain(CANARY.teamManual);

    // Also prove aiSemanticAnalysis (called by hourly detectLinguisticSignals) receives zero WhatsApp canary text.
    await intuitionService.aiSemanticAnalysis(ID.biz, corpus);
    expect(llmPrompts).toHaveLength(1);
    expect(llmPrompts[0].prompt).not.toContain(CANARY.waInbound);
    expect(llmPrompts[0].prompt).toContain(CANARY.teamNull);
    expect(llmPrompts[0].prompt).toContain(CANARY.teamManual);
  });

  it('[WAX-02] RED-BEFORE: ConversationAiService auto-load summarizeThread excludes pasted WhatsApp events, while explicit owner-initiated regenerate/suggestReplies still allow them', async () => {
    await crmService.captureInboundWhatsApp({
      businessId: ID.biz,
      contactId: ID.contact,
      phone: '+18685550194',
      message: CANARY.waInbound,
      actorUserId: ID.owner,
    });

    // Automatic tab-mount call (default includeInboundWhatsApp = false): only pasted WhatsApp event exists -> 0 LLM calls.
    const autoEmpty = await conversationAi.summarizeThread(ID.biz, ID.contact);
    expect(autoEmpty.insight).toBeNull();
    expect(llmPrompts).toHaveLength(0);

    // Add a regular email communication event: auto summary summarizes email ONLY, never pasted WhatsApp text.
    await db.contactEvent.create({
      data: {
        id: `${P}ev_email`,
        businessId: ID.biz,
        contactId: ID.contact,
        type: 'communication.email',
        source: null,
        data: { body: CANARY.emailEvent, direction: 'in' },
      },
    });
    const autoWithEmail = await conversationAi.summarizeThread(ID.biz, ID.contact, { force: true });
    expect(autoWithEmail.insight).not.toBeNull();
    expect(llmPrompts).toHaveLength(1);
    expect(llmPrompts[0].prompt).toContain(CANARY.emailEvent);
    expect(llmPrompts[0].prompt).not.toContain(CANARY.waInbound);

    // Control (owner-initiated per D-280): explicit owner regenerate & suggest-replies CAN include pasted WhatsApp text.
    llmPrompts.length = 0;
    await conversationAi.summarizeThread(ID.biz, ID.contact, { force: true, includeInboundWhatsApp: true });
    await conversationAi.suggestReplies(ID.biz, ID.contact, { includeInboundWhatsApp: true });
    expect(llmPrompts).toHaveLength(2);
    expect(llmPrompts[0].prompt).toContain(CANARY.waInbound);
    expect(llmPrompts[1].prompt).toContain(CANARY.waInbound);
  });

  it('[WAX-03] RED-BEFORE: FlowOrchestratorService draft_followup_message excludes whatsapp_inbound notes on PRO_AUTO_MONITOR / automatic runs, allows them in interactive owner chat', async () => {
    await crmService.captureInboundWhatsApp({
      businessId: ID.biz,
      contactId: ID.contact,
      phone: '+18685550194',
      message: CANARY.waInbound,
      actorUserId: ID.owner,
    });
    await db.contactNote.create({
      data: { id: `${P}note_flow_null`, businessId: ID.biz, contactId: ID.contact, body: CANARY.teamNull, source: null },
    });

    // Automatic Pro Auto monitor run (no interactive human principal): MUST exclude whatsapp_inbound note.
    await flowOrchestrator.executeToolAction(
      ID.biz,
      'draft_followup_message',
      { contactId: ID.contact, channel: 'email', tone: 'friendly' },
      { surface: 'PRO_AUTO_MONITOR', onBehalfOfUserId: ID.owner },
    );
    expect(llmPrompts).toHaveLength(1);
    expect(llmPrompts[0].prompt).not.toContain(CANARY.waInbound);
    expect(llmPrompts[0].prompt).toContain(CANARY.teamNull);

    // Control (owner-initiated interactive chat): authenticated principalUserId on CHAT surface stays allowed.
    llmPrompts.length = 0;
    await flowOrchestrator.executeToolAction(
      ID.biz,
      'draft_followup_message',
      { contactId: ID.contact, channel: 'email', tone: 'friendly' },
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(llmPrompts).toHaveLength(1);
    expect(llmPrompts[0].prompt).toContain(CANARY.waInbound);
  });

  it('[WAX-04] RED-BEFORE: PatternDetectorService.fetchRecentContactEvents excludes whatsapp_inbound / communication.whatsapp events and drops unused data column', async () => {
    await crmService.captureInboundWhatsApp({
      businessId: ID.biz,
      contactId: ID.contact,
      phone: '+18685550194',
      message: CANARY.waInbound,
      actorUserId: ID.owner,
    });
    await db.contactEvent.create({
      data: {
        id: `${P}ev_normal`,
        businessId: ID.biz,
        contactId: ID.contact,
        type: 'status.changed',
        source: null,
        data: { from: 'LEAD', to: 'PROSPECT' },
      },
    });

    const rows: Array<Record<string, unknown>> = await patternDetector.fetchRecentContactEvents(ID.biz);
    expect(rows.some((r) => r.id === `${P}ev_normal`)).toBe(true);
    expect(rows.some((r) => r.type === 'communication.whatsapp')).toBe(false);
    expect(rows.every((r) => !('data' in r))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(CANARY.waInbound);
  });

  it('[WAX-05] RED-BEFORE: write-side indirect copies (Activity ledger, deleteNote, ContactInsightListener, CustomerJourneyService) do not leak pasted WhatsApp text or trigger automatic stale recompute', async () => {
    const captured = await crmService.captureInboundWhatsApp({
      businessId: ID.biz,
      contactId: ID.contact,
      phone: '+18685550194',
      message: CANARY.waInbound,
      actorUserId: ID.owner,
    });
    // Allow fire-and-forget Activity write to commit.
    await new Promise((r) => setTimeout(r, 100));

    // 1. ContactEvent itself keeps body for CRM Timeline UI / P41, while Unified Ledger Activity strips body.
    const storedEvent = await db.contactEvent.findUniqueOrThrow({ where: { id: captured.event.id } });
    expect((storedEvent.data as Record<string, unknown>).body).toBe(CANARY.waInbound);

    const activities = await db.activity.findMany({ where: { businessId: ID.biz, contactId: ID.contact } });
    expect(activities.length).toBeGreaterThan(0);
    for (const act of activities) {
      expect(act.detail ?? '').not.toContain(CANARY.waInbound);
      expect(JSON.stringify(act.data ?? {})).not.toContain(CANARY.waInbound);
    }

    // 2. ContactInsightListener does NOT mark contact stale for automatic LLM recompute on whatsapp_inbound event.
    await contactInsightListener.onContactEventLogged({
      businessId: ID.biz,
      contactId: ID.contact,
      type: 'communication.whatsapp',
      source: 'whatsapp_inbound',
    });
    expect(markStaleSpy).not.toHaveBeenCalled();

    // 3. CustomerJourneyService.backfillBusiness strips pasted WhatsApp body from JourneyTouchpoint.metadata.
    await customerJourney.backfillBusiness(ID.biz);
    const touchpoints = await db.journeyTouchpoint.findMany({ where: { businessId: ID.biz, contactId: ID.contact } });
    for (const tp of touchpoints) {
      expect(JSON.stringify(tp.metadata ?? {})).not.toContain(CANARY.waInbound);
    }

    // 4. Deleting the whatsapp_inbound note does NOT copy its body into note.deleted ContactEvent or Activity.
    await crmTimeline.deleteNote({ businessId: ID.biz, noteId: captured.note.id });
    await new Promise((r) => setTimeout(r, 100));
    const deleteEvents = await db.contactEvent.findMany({
      where: { businessId: ID.biz, contactId: ID.contact, type: 'note.deleted' },
    });
    expect(deleteEvents).toHaveLength(1);
    expect(JSON.stringify(deleteEvents[0].data ?? {})).not.toContain(CANARY.waInbound);
  });
});
