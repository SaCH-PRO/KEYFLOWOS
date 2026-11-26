/**
 * FU-TIMELINE-CALLERS-SCOPE (P122, V1-86; REAL database; owner rulings D-100, D-179, D-227, D-234):
 * Every member-facing reader and mutator of the temporal-flow timeline applies the acting member's
 * canonical module filter (`TemporalFlowService.readerFilter` + `memorySight` + `forReader`).
 *
 * Caller families verified against real Postgres:
 *   1. KEY Cortex Organ Adapter (`TemporalFlowAdapterService`):
 *      - `temporal_flow.list_events`
 *      - `temporal_flow.analyze_timeline`
 *      - `temporal_flow.mark_resolved` (fail-closed refusal + zero existence oracle + zero mutation)
 *      - `getState(businessId, reader)`
 *   2. KEY Cortex Connector Adapter (`TemporalAdapterService`):
 *      - `getTimeline` / `execute('get_timeline')` (including SUPER_ADMIN by actorId only, fail-closed null/non-string actor)
 *   3. Genome Evolution (`GenomeEvolutionService` + `GenomeEvolutionController` + `TemporalFlowService.findGenomeSignals`):
 *      - `POST /business-genome/businesses/:businessId/evolution-proposals/generate-from-temporal-flow`
 *      - `generateFromTemporalFlow(businessId, createdBy, reader)`
 *   4. Business Command Center (`BusinessCommandCenterService` + `BusinessCommandCenterController`):
 *      - `GET /business-command-center/businesses/:businessId/snapshot`
 *   5. Business Intelligence & KEY Executive Modes (`BusinessIntelligenceService`, `KeyExecutiveModeService` + controllers):
 *      - `GET /intelligence/businesses/:businessId/executive-brief`
 *      - `GET /intelligence/businesses/:businessId/key-modes/:mode`
 *
 * Requires DATABASE_URL. Every seeded row carries the `v86t_` prefix and is hard-deleted by raw SQL
 * in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v86t_';

const ID = {
  owner: `${P}owner`, // OWNER of biz, role defaults
  bookingsOnly: `${P}bookings`, // STAFF of biz: bookings:read, ai:write, settings:write (NO operations, NO revenue, NO storefront)
  revenueOnly: `${P}revenue`, // STAFF of biz: revenue:read, ai:read (NO operations, NO bookings, NO storefront)
  opsOnly: `${P}ops`, // STAFF of biz: operations:read, ai:read (NO revenue, NO bookings, NO storefront)
  superAdmin: `${P}super`, // platform SUPER_ADMIN, no membership row in biz
  crossTenant: `${P}cross`, // OWNER of bizOther, bookings-only + ai:write + settings:write STAFF of biz
  stranger: `${P}stranger`, // USER with no membership anywhere
  biz: `${P}biz`,
  bizOther: `${P}bizother`,
  propFin: `${P}prop_fin`,
};

const USERS = [
  ID.owner,
  ID.bookingsOnly,
  ID.revenueOnly,
  ID.opsOnly,
  ID.superAdmin,
  ID.crossTenant,
  ID.stranger,
];

// Sentinel secrets that must NEVER leak to members lacking the owning module's read scope.
const INBOX_AI_SECRET = `${P}inbox_ai_secret`;
const INBOX_SENDER_SECRET = `${P}sender_handle_secret`;
const INBOX_MEM_SECRET = `${P}memory_inbox_secret`;
const OVERDUE_INV_SECRET = `${P}INV_999 overdue 4500.00`;
const FIN_PROPOSAL_SECRET = `${P}fin_proposal_secret $8,500`;
const SHOPIFY_SECRET = `${P}shopify_order_777`;
const UNCLASSIFIED_SECRET = `${P}unclassified_webhook_secret`;
const OTHER_TENANT_SECRET = `${P}other_tenant_secret`;

const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000);

type EventSeed = {
  key: string;
  businessId?: string;
  source: string;
  type: string;
  module?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  summary?: string;
  occurredAt: Date;
  importance?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

const EVENT_SEEDS: EventSeed[] = [
  // Operations / KEY Inbox (must be withheld when operations:read is absent)
  {
    key: 'inboxAnalyzed',
    source: 'whatsapp',
    type: 'key_inbox.message_analyzed',
    module: 'key_inbox',
    title: `Analysis: ${INBOX_AI_SECRET}`,
    summary: INBOX_SENDER_SECRET,
    occurredAt: at(1),
    importance: 'CRITICAL',
    status: 'ACTION_REQUIRED',
    payload: { senderHandle: INBOX_SENDER_SECRET, intent: 'complaint' },
  },
  {
    key: 'inboxResolvable',
    source: 'key_inbox',
    type: 'key_inbox.risk_detected',
    module: 'key_inbox',
    title: `Resolvable inbox risk ${INBOX_AI_SECRET}`,
    summary: INBOX_SENDER_SECRET,
    occurredAt: at(2),
    importance: 'HIGH',
    status: 'ACTION_REQUIRED',
  },
  // 3 WhatsApp leads -> triggers analyze.opportunities + findGenomeSignals('marketing')
  { key: 'waLead1', source: 'WHATSAPP', type: 'whatsapp.lead.created', module: 'key_inbox', title: `${P}wa_lead_1`, occurredAt: at(3) },
  { key: 'waLead2', source: 'WHATSAPP', type: 'whatsapp.lead.created', module: 'key_inbox', title: `${P}wa_lead_2`, occurredAt: at(4) },
  { key: 'waLead3', source: 'WHATSAPP', type: 'whatsapp.lead.created', module: 'key_inbox', title: `${P}wa_lead_3`, occurredAt: at(5) },

  // Revenue (must be withheld when revenue:read is absent)
  {
    key: 'invoiceOverdue',
    source: 'APP',
    type: 'invoice.overdue',
    module: null,
    title: OVERDUE_INV_SECRET,
    occurredAt: at(6),
    importance: 'CRITICAL',
    status: 'ACTION_REQUIRED',
  },
  // 3 paid invoices -> triggers findGenomeSignals('sales')
  { key: 'invoicePaid1', source: 'APP', type: 'invoice.paid', module: 'revenue', title: `${P}paid_inv_1`, occurredAt: at(7) },
  { key: 'invoicePaid2', source: 'APP', type: 'invoice.paid', module: 'revenue', title: `${P}paid_inv_2`, occurredAt: at(8) },
  { key: 'invoicePaid3', source: 'APP', type: 'invoice.paid', module: 'revenue', title: `${P}paid_inv_3`, occurredAt: at(9) },

  // Financial KEY action proposal (module key-autonomy is business-wide; withheld by forReader for non-revenue)
  {
    key: 'proposalFin',
    source: 'KEY',
    type: 'key.action.proposed',
    module: 'key-autonomy',
    entityType: 'key_action_proposal',
    entityId: ID.propFin,
    title: FIN_PROPOSAL_SECRET,
    occurredAt: at(10),
    importance: 'CRITICAL',
    status: 'ACTION_REQUIRED',
    payload: { amount: 8500 },
  },

  // Storefront + Revenue
  {
    key: 'shopifyOrder',
    source: 'SHOPIFY',
    type: 'shopify.order.created',
    module: null,
    title: SHOPIFY_SECRET,
    occurredAt: at(11),
    status: 'RECORDED',
  },

  // Unclassified -> fails closed unless reader reads all 4 event-owning modules
  {
    key: 'webhookEvent',
    source: 'WEBHOOK',
    type: 'webhook.custom',
    module: null,
    title: UNCLASSIFIED_SECRET,
    occurredAt: at(12),
    status: 'RECORDED',
  },

  // Bookings (visible to bookingsOnly)
  {
    key: 'calendarSynced',
    source: 'GOOGLE_CALENDAR',
    type: 'google_calendar.event.synced',
    module: 'calendar',
    title: `${P}calendar_booking`,
    occurredAt: at(13),
    status: 'RECORDED',
  },
  // 5 bookings -> triggers analyze.opportunities + findGenomeSignals('operations')
  { key: 'booking1', source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}booking_1`, occurredAt: at(14) },
  { key: 'booking2', source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}booking_2`, occurredAt: at(15) },
  { key: 'booking3', source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}booking_3`, occurredAt: at(16) },
  { key: 'booking4', source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}booking_4`, occurredAt: at(17) },
  { key: 'booking5', source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}booking_5`, occurredAt: at(18) },

  // Business-wide (visible to every member)
  {
    key: 'manualNote',
    source: 'MANUAL',
    type: 'manual.event',
    module: null,
    title: `${P}manual_standup`,
    occurredAt: at(19),
    status: 'RECORDED',
  },

  // Other tenant's inbox event
  {
    key: 'otherInbox',
    businessId: ID.bizOther,
    source: 'key_inbox',
    type: 'key_inbox.message_analyzed',
    module: 'key_inbox',
    title: OTHER_TENANT_SECRET,
    summary: OTHER_TENANT_SECRET,
    occurredAt: at(1),
    importance: 'CRITICAL',
    status: 'ACTION_REQUIRED',
  },
];

const idOf = (key: string) => `${P}ev_${key}`;
const keyOfId = new Map(EVENT_SEEDS.map((s) => [idOf(s.key), s.key]));
const ALL_BIZ_KEYS = EVENT_SEEDS.filter((s) => !s.businessId).map((s) => s.key);
const OPS_KEYS = ['inboxAnalyzed', 'inboxResolvable', 'waLead1', 'waLead2', 'waLead3'];
const REVENUE_KEYS = ['invoiceOverdue', 'invoicePaid1', 'invoicePaid2', 'invoicePaid3', 'proposalFin'];
const BOOKINGS_KEYS = ['calendarSynced', 'booking1', 'booking2', 'booking3', 'booking4', 'booking5'];
const WIDE_KEYS = ['manualNote'];

const MEM_INBOX_ID = `${P}mem_inbox`;

let db: any;
let app: any;
let organAdapter: any;
let connectorAdapter: any;
let genomeEvolution: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM genome_evolution_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM temporal_flow_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
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

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { GenomeGateGuard } = await import('../src/core/auth/genome-gate.guard');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
  const { TemporalFlowAdapterService } = await import('../src/modules/key-cortex/organs/temporal-flow-adapter.service');
  const { TemporalAdapterService } = await import('../src/modules/key-cortex/adapters/temporal-adapter.service');
  const { KeyCortexEventBusService } = await import('../src/modules/key-cortex/key-cortex-event-bus.service');
  const { BusinessCommandCenterController } = await import('../src/modules/business-command-center/business-command-center.controller');
  const { BusinessCommandCenterService } = await import('../src/modules/business-command-center/business-command-center.service');
  const { BusinessIntelligenceController } = await import('../src/modules/intelligence/business-intelligence.controller');
  const { BusinessIntelligenceService } = await import('../src/modules/intelligence/business-intelligence.service');
  const { KeyExecutiveModeController } = await import('../src/modules/intelligence/key-executive-mode.controller');
  const { KeyExecutiveModeService } = await import('../src/modules/intelligence/key-executive-mode.service');
  const { GenomeEvolutionController } = await import('../src/modules/business-genome/genome-evolution.controller');
  const { GenomeEvolutionService } = await import('../src/modules/business-genome/genome-evolution.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { BusinessAssetsService } = await import('../src/modules/business-assets/business-assets.service');
  const { ConstitutionVersionService } = await import('../src/modules/business-genome/constitution-version.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { GenomeScoringService } = await import('../src/modules/business-genome/key-genome/genome-scoring.service');
  const { GenomeModuleReadinessService } = await import('../src/modules/business-genome/key-genome/genome-module-readiness.service');
  const { GenomeSignalService } = await import('../src/modules/business-genome/key-genome/genome-signal.service');
  const { GenomeRecommendationService } = await import('../src/modules/business-genome/key-genome/genome-recommendation.service');
  const { CommandCenterKeyGenomeBridgeService } = await import('../src/modules/business-command-center/command-center-key-genome-bridge.service');

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [
      BusinessCommandCenterController,
      BusinessIntelligenceController,
      KeyExecutiveModeController,
      GenomeEvolutionController,
    ],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      GenomeGateGuard,
      TemporalFlowService,
      TemporalFlowMemoryService,
      TemporalFlowAdapterService,
      TemporalAdapterService,
      BusinessCommandCenterService,
      BusinessIntelligenceService,
      KeyExecutiveModeService,
      GenomeEvolutionService,
      {
        provide: SemanticMemoryService,
        useValue: {
          search: async ({
            businessId,
            limit,
            visibleTo,
          }: {
            businessId: string;
            limit?: number;
            visibleTo?: (hits: any[]) => Promise<boolean[]>;
          }) => {
            if (businessId !== ID.biz) return [];
            let hits: any[] = [
              {
                id: `${MEM_INBOX_ID}_hit`,
                content: `thread:summary — ${INBOX_MEM_SECRET}`,
                sourceType: 'temporal_memory',
                sourceId: MEM_INBOX_ID,
                metadata: { sourceModule: 'key_inbox' },
                similarity: 0.95,
              },
            ];
            if (visibleTo) {
              const keep = await visibleTo(hits);
              hits = hits.filter((_, i) => keep[i]);
            }
            return hits.slice(0, limit ?? 10);
          },
          store: async () => undefined,
        },
      },
      {
        provide: KeyCortexEventBusService,
        useValue: { publish: async () => undefined, subscribe: () => () => undefined },
      },
      {
        provide: KeyActionProposalService,
        useValue: { list: async () => [], listForReader: async () => [] },
      },
      {
        provide: BlueprintService,
        useValue: {
          getBlueprint: async (businessId: string) => ({
            businessId,
            genomeIntegrity: 80,
            executiveReadinessScore: 75,
            genomeStage: 'OPERATING',
            genomeDnaScores: {
              founder: 80,
              business: 80,
              market: 80,
              operations: 80,
              sales: 80,
              marketing: 80,
              financial: 80,
              risk: 80,
            },
          }),
          calculateGenomeIntegrity: async () => ({
            genomeIntegrity: 80,
            threePillarMinimumMet: true,
            genomeDnaScores: { founder: 80, business: 80, market: 80 },
            genomeDnaConfidence: {},
            genomeStage: 'OPERATING',
            dnaSections: [],
            executiveReadinessScore: 75,
            readinessBreakdown: {},
          }),
          updateDnaSection: async () => undefined,
        },
      },
      { provide: BusinessAssetsService, useValue: { list: async () => [] } },
      {
        provide: ConstitutionVersionService,
        useValue: {
          latest: async () => null,
          staleness: async () => ({
            stale: false,
            reason: '',
            currentGenomeIntegrity: 80,
            constitutionGenomeIntegrity: null,
          }),
        },
      },
      {
        provide: GenomeScoringService,
        useValue: {
          computeFactScores: async () => [],
          computeBusinessScore: () => ({
            businessId: ID.biz,
            overall: 80,
            integrity: 80,
            readiness: 75,
            confidence: 0.8,
            sections: [],
            computedAt: new Date().toISOString(),
          }),
        },
      },
      { provide: GenomeModuleReadinessService, useValue: { computeReadiness: async () => [] } },
      { provide: GenomeSignalService, useValue: { list: async () => [], listSignals: async () => [] } },
      {
        provide: GenomeRecommendationService,
        useValue: { list: async () => [], listRecommendations: async () => [] },
      },
      {
        provide: CommandCenterKeyGenomeBridgeService,
        useValue: { buildCrossDomainBrief: async () => undefined },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  organAdapter = moduleRef.get(TemporalFlowAdapterService);
  connectorAdapter = moduleRef.get(TemporalAdapterService);
  genomeEvolution = moduleRef.get(GenomeEvolutionService);

  await cleanup();

  for (const id of USERS) {
    await db.user.create({
      data: {
        id,
        email: `${P}${id.slice(P.length)}@example.test`,
        name: id,
        role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER',
      },
    });
  }

  await db.business.create({
    data: { id: ID.biz, name: `${P}Biz`, slug: `${P}biz`, ownerId: ID.owner },
  });
  await db.business.create({
    data: { id: ID.bizOther, name: `${P}BizOther`, slug: `${P}bizother`, ownerId: ID.crossTenant },
  });

  const memberships: Array<{ id: string; userId: string; businessId: string; role: string; permissionScopes?: any }> = [
    { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
    {
      id: `${P}m_bookings`,
      userId: ID.bookingsOnly,
      businessId: ID.biz,
      role: 'STAFF',
      permissionScopes: { bookings: 'read', ai: 'write', settings: 'write' },
    },
    {
      id: `${P}m_revenue`,
      userId: ID.revenueOnly,
      businessId: ID.biz,
      role: 'STAFF',
      permissionScopes: { revenue: 'read', ai: 'read' },
    },
    {
      id: `${P}m_ops`,
      userId: ID.opsOnly,
      businessId: ID.biz,
      role: 'STAFF',
      permissionScopes: { operations: 'read', ai: 'read' },
    },
    { id: `${P}m_cross_other`, userId: ID.crossTenant, businessId: ID.bizOther, role: 'OWNER' },
    {
      id: `${P}m_cross_biz`,
      userId: ID.crossTenant,
      businessId: ID.biz,
      role: 'STAFF',
      permissionScopes: { bookings: 'read', ai: 'write', settings: 'write' },
    },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: m });
  }

  // Real financial KeyActionProposal row so TemporalFlowService.forReader classifies proposalFin as financial
  await db.keyActionProposal.create({
    data: {
      id: ID.propFin,
      businessId: ID.biz,
      sourceType: 'KEY_CHAT',
      title: 'Send overdue invoice $8,500',
      actionType: 'SEND_INVOICE',
      payload: { amount: 8500, currency: 'TTD' },
      status: 'PENDING',
    },
  });

  for (const s of EVENT_SEEDS) {
    await db.temporalFlowEvent.create({
      data: {
        id: idOf(s.key),
        businessId: s.businessId ?? ID.biz,
        source: s.source,
        type: s.type,
        module: s.module ?? null,
        entityType: s.entityType ?? null,
        entityId: s.entityId ?? null,
        title: s.title,
        summary: s.summary ?? null,
        occurredAt: s.occurredAt,
        importance: s.importance ?? 'NORMAL',
        status: s.status ?? 'RECORDED',
        visibility: 'USER',
        payload: s.payload ?? {},
      },
    });
  }

  await db.temporalFlowMemory.create({
    data: {
      id: MEM_INBOX_ID,
      businessId: ID.biz,
      entityType: 'thread',
      entityId: `${P}thread1`,
      type: 'summary',
      content: INBOX_MEM_SECRET,
      sourceModule: 'key_inbox',
      sourceEventIds: [idOf('inboxAnalyzed')],
      confidence: 0.9,
    },
  });
}, 120_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
}, 60_000);

const getAs = (userId: string | undefined, url: string) => {
  const req = request(app.getHttpServer()).get(url);
  return userId ? req.set('x-test-user', userId) : req;
};

const postAs = (userId: string | undefined, url: string) => {
  const req = request(app.getHttpServer()).post(url);
  return userId ? req.set('x-test-user', userId) : req;
};

const keysOf = (events: Array<{ id: string }>) =>
  events.map((e) => keyOfId.get(e.id) ?? e.id).sort();

describe('FU-TIMELINE-CALLERS-SCOPE: every member-facing timeline reader & mutator applies readerFilter', () => {
  describe('1. KEY Cortex Organ Adapter (TemporalFlowAdapterService)', () => {
    it('T1: temporal_flow.list_events withholds operations/revenue/storefront/unclassified events by acting member scope and fails closed without userId', async () => {
      // Bookings-only member: sees bookings + business-wide ONLY
      const bookingsRes = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, userId: ID.bookingsOnly },
        { limit: 100 },
      );
      expect(bookingsRes.success).toBe(true);
      expect(keysOf(bookingsRes.data.events)).toEqual([...BOOKINGS_KEYS, ...WIDE_KEYS].sort());
      const bookingsJson = JSON.stringify(bookingsRes.data);
      for (const secret of [
        INBOX_AI_SECRET,
        INBOX_SENDER_SECRET,
        OVERDUE_INV_SECRET,
        FIN_PROPOSAL_SECRET,
        SHOPIFY_SECRET,
        UNCLASSIFIED_SECRET,
        OTHER_TENANT_SECRET,
      ]) {
        expect(bookingsJson).not.toContain(secret);
      }

      // Revenue-only member: sees revenue + business-wide, NEVER KEY Inbox or bookings
      const revRes = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, userId: ID.revenueOnly },
        { limit: 100 },
      );
      expect(revRes.success).toBe(true);
      expect(keysOf(revRes.data.events)).toEqual([...REVENUE_KEYS, ...WIDE_KEYS].sort());
      expect(JSON.stringify(revRes.data)).not.toContain(INBOX_AI_SECRET);
      expect(JSON.stringify(revRes.data)).not.toContain(INBOX_SENDER_SECRET);

      // Operations-only member: sees KEY Inbox + business-wide, NEVER overdue invoice or financial proposal
      const opsRes = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, userId: ID.opsOnly },
        { limit: 100 },
      );
      expect(opsRes.success).toBe(true);
      expect(keysOf(opsRes.data.events)).toEqual([...OPS_KEYS, ...WIDE_KEYS].sort());
      expect(JSON.stringify(opsRes.data)).not.toContain(OVERDUE_INV_SECRET);
      expect(JSON.stringify(opsRes.data)).not.toContain(FIN_PROPOSAL_SECRET);

      // Owner sees every event of biz (never bizOther)
      const ownerRes = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, userId: ID.owner },
        { limit: 100 },
      );
      expect(ownerRes.success).toBe(true);
      expect(keysOf(ownerRes.data.events)).toEqual([...ALL_BIZ_KEYS].sort());
      expect(JSON.stringify(ownerRes.data)).not.toContain(OTHER_TENANT_SECRET);

      // Platform SUPER_ADMIN (passed by ctx.userId alone, no membership row) sees every event of biz
      const superRes = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, userId: ID.superAdmin },
        { limit: 100 },
      );
      expect(superRes.success).toBe(true);
      expect(keysOf(superRes.data.events)).toEqual([...ALL_BIZ_KEYS].sort());

      // No userId (even with auditUserId: owner) fails closed -> only business-wide non-financial events
      const noUserRes = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, auditUserId: ID.owner },
        { limit: 100 },
      );
      expect(noUserRes.success).toBe(true);
      expect(keysOf(noUserRes.data.events)).toEqual([...WIDE_KEYS].sort());

      // Cross-tenant OWNER of bizOther with bookings-only in biz -> bookings + business-wide of biz ONLY
      const crossRes = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, userId: ID.crossTenant },
        { limit: 100 },
      );
      expect(crossRes.success).toBe(true);
      expect(keysOf(crossRes.data.events)).toEqual([...BOOKINGS_KEYS, ...WIDE_KEYS].sort());
      expect(JSON.stringify(crossRes.data)).not.toContain(OTHER_TENANT_SECRET);
    });

    it('T2: temporal_flow.analyze_timeline withholds inbox titles, WhatsApp leads, overdue invoices, financial proposals, and inbox memories by reader scope', async () => {
      // Bookings-only member
      const bookingsRes = await organAdapter.executeTool(
        'temporal_flow.analyze_timeline',
        { businessId: ID.biz, userId: ID.bookingsOnly },
        {},
      );
      expect(bookingsRes.success).toBe(true);
      const bText = JSON.stringify(bookingsRes.data);
      for (const secret of [
        INBOX_AI_SECRET,
        INBOX_SENDER_SECRET,
        INBOX_MEM_SECRET,
        OVERDUE_INV_SECRET,
        'Overdue invoices need follow-up',
        'Cash flow risk from overdue invoices',
        'WhatsApp is becoming a lead channel',
        FIN_PROPOSAL_SECRET,
        OTHER_TENANT_SECRET,
      ]) {
        expect(bText).not.toContain(secret);
      }
      // Bookings-only member still sees their own bookings opportunity
      expect(bText).toContain('Booking volume rising');

      // Revenue-only member: sees overdue invoice, NEVER KEY Inbox or WhatsApp leads or inbox memory
      const revRes = await organAdapter.executeTool(
        'temporal_flow.analyze_timeline',
        { businessId: ID.biz, userId: ID.revenueOnly },
        {},
      );
      expect(revRes.success).toBe(true);
      const rText = JSON.stringify(revRes.data);
      expect(rText).toContain(OVERDUE_INV_SECRET);
      expect(rText).not.toContain(INBOX_AI_SECRET);
      expect(rText).not.toContain('WhatsApp is becoming a lead channel');
      expect(rText).not.toContain(INBOX_MEM_SECRET);

      // No userId (even with auditUserId: owner) fails closed
      const noUserRes = await organAdapter.executeTool(
        'temporal_flow.analyze_timeline',
        { businessId: ID.biz, auditUserId: ID.owner },
        {},
      );
      expect(noUserRes.success).toBe(true);
      const nText = JSON.stringify(noUserRes.data);
      expect(nText).not.toContain(INBOX_AI_SECRET);
      expect(nText).not.toContain(OVERDUE_INV_SECRET);
      expect(nText).not.toContain(INBOX_MEM_SECRET);
      expect(nText).not.toContain('Booking volume rising');

      // Owner gets the full analysis
      const ownerRes = await organAdapter.executeTool(
        'temporal_flow.analyze_timeline',
        { businessId: ID.biz, userId: ID.owner },
        {},
      );
      expect(ownerRes.success).toBe(true);
      const oText = JSON.stringify(ownerRes.data);
      expect(oText).toContain(INBOX_AI_SECRET);
      expect(oText).toContain(OVERDUE_INV_SECRET);
      expect(oText).toContain('WhatsApp is becoming a lead channel');
      expect(oText).toContain(INBOX_MEM_SECRET);
    });

    it('T3: temporal_flow.mark_resolved refuses withheld, financial-proposal, cross-tenant, and non-existent events identically (fail-closed, zero mutation, zero existence oracle)', async () => {
      const withheldTargets = [
        idOf('inboxResolvable'),
        idOf('invoiceOverdue'),
        idOf('proposalFin'),
        idOf('shopifyOrder'),
        idOf('webhookEvent'),
        idOf('otherInbox'),
        `${P}nonexistent_event`,
      ];

      // Bookings-only member gets identical refusal for every withheld / foreign / missing event
      const responses = [];
      for (const eventId of withheldTargets) {
        const res = await organAdapter.executeTool(
          'temporal_flow.mark_resolved',
          { businessId: ID.biz, userId: ID.bookingsOnly },
          { eventId },
        );
        expect(res.success).toBe(false);
        responses.push(res);
      }
      // No existence oracle: every refused call has the exact same error message
      const uniqueErrors = new Set(responses.map((r) => r.error));
      expect(uniqueErrors.size).toBe(1);

      // No-user context (even with auditUserId: owner) is also refused on withheld event
      const noUserRes = await organAdapter.executeTool(
        'temporal_flow.mark_resolved',
        { businessId: ID.biz, auditUserId: ID.owner },
        { eventId: idOf('inboxResolvable') },
      );
      expect(noUserRes.success).toBe(false);

      // Verify NONE of the withheld rows were mutated in Postgres
      for (const key of ['inboxResolvable', 'invoiceOverdue', 'proposalFin', 'shopifyOrder', 'webhookEvent', 'otherInbox']) {
        const row = await db.temporalFlowEvent.findUnique({ where: { id: idOf(key) } });
        expect(row.status).not.toBe('RESOLVED');
        expect(row.completedAt).toBeNull();
      }

      // Bookings-only member CAN resolve a visible bookings event
      const calRes = await organAdapter.executeTool(
        'temporal_flow.mark_resolved',
        { businessId: ID.biz, userId: ID.bookingsOnly },
        { eventId: idOf('calendarSynced') },
      );
      expect(calRes.success).toBe(true);
      expect(calRes.data).toEqual({ updated: 1 });
      const calRow = await db.temporalFlowEvent.findUnique({ where: { id: idOf('calendarSynced') } });
      expect(calRow.status).toBe('RESOLVED');

      // Owner CAN resolve an inbox event
      const ownerRes = await organAdapter.executeTool(
        'temporal_flow.mark_resolved',
        { businessId: ID.biz, userId: ID.owner },
        { eventId: idOf('inboxResolvable') },
      );
      expect(ownerRes.success).toBe(true);
      expect(ownerRes.data).toEqual({ updated: 1 });
      const inboxRow = await db.temporalFlowEvent.findUnique({ where: { id: idOf('inboxResolvable') } });
      expect(inboxRow.status).toBe('RESOLVED');
    });

    it('T4: TemporalFlowAdapterService.getState scopes counts when given a reader', async () => {
      const bookingsState = await organAdapter.getState(ID.biz, { id: ID.bookingsOnly, role: 'USER' });
      expect(bookingsState.healthy).toBe(true);
      // Bookings-only has no CRITICAL visible events and no overdue invoices
      expect(bookingsState.metadata.urgentItems).toBe(0);
      expect(bookingsState.metadata.risks).toBe(0);

      const ownerState = await organAdapter.getState(ID.biz, { id: ID.owner, role: 'USER' });
      expect(ownerState.healthy).toBe(true);
      expect(ownerState.metadata.urgentItems).toBeGreaterThan(0);
      expect(ownerState.metadata.risks).toBeGreaterThan(0);
    });
  });

  describe('2. KEY Cortex Connector Adapter (TemporalAdapterService.getTimeline)', () => {
    it('T5: get_timeline applies readerFilter for bookingsOnly, revenueOnly, owner, SUPER_ADMIN (by id only), and fails closed for missing/non-string actorId', async () => {
      const cmd = (userId?: any) => ({
        module: 'temporal',
        action: 'get_timeline',
        businessId: ID.biz,
        userId,
        parameters: { limit: 100 },
        source: 'key_cortex',
        timestamp: new Date(),
        correlationId: `${P}corr`,
      });

      const bookingsRes = await connectorAdapter.execute(cmd(ID.bookingsOnly));
      expect(bookingsRes.success).toBe(true);
      expect(keysOf(bookingsRes.data)).toEqual([...BOOKINGS_KEYS, ...WIDE_KEYS].sort());

      const revRes = await connectorAdapter.execute(cmd(ID.revenueOnly));
      expect(revRes.success).toBe(true);
      expect(keysOf(revRes.data)).toEqual([...REVENUE_KEYS, ...WIDE_KEYS].sort());

      const ownerRes = await connectorAdapter.execute(cmd(ID.owner));
      expect(ownerRes.success).toBe(true);
      expect(keysOf(ownerRes.data)).toEqual([...ALL_BIZ_KEYS].sort());

      // SUPER_ADMIN passed via actorId only (no membership row, no role on command)
      const superRes = await connectorAdapter.execute(cmd(ID.superAdmin));
      expect(superRes.success).toBe(true);
      expect(keysOf(superRes.data)).toEqual([...ALL_BIZ_KEYS].sort());

      // Missing / non-string actorId fails closed to business-wide non-financial events
      const noneRes = await connectorAdapter.execute(cmd(undefined));
      expect(noneRes.success).toBe(true);
      expect(keysOf(noneRes.data)).toEqual([...WIDE_KEYS].sort());

      const badActor = await connectorAdapter.getTimeline({ businessId: ID.biz, actorId: { bad: true } as any });
      expect(keysOf(badActor)).toEqual([...WIDE_KEYS].sort());
    });
  });

  describe('3. Genome Evolution (GenomeEvolutionService / Controller + findGenomeSignals)', () => {
    const clearProposals = async () => {
      await db.$executeRawUnsafe(`DELETE FROM genome_evolution_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`);
    };

    it('T6: POST .../evolution-proposals/generate-from-temporal-flow withholds WhatsApp (operations) and paid-invoice (revenue) signals from bookings-only and cross-tenant members', async () => {
      await clearProposals();

      // Bookings-only member (has settings:write + bookings:read, NO operations or revenue)
      const bRes = await postAs(
        ID.bookingsOnly,
        `/business-genome/businesses/${ID.biz}/evolution-proposals/generate-from-temporal-flow`,
      );
      expect(bRes.status).toBe(201);
      const bSections = bRes.body.map((p: any) => p.section).sort();
      expect(bSections).toEqual(['operations']); // from 5 booking.created events only
      const bText = JSON.stringify(bRes.body);
      expect(bText).not.toContain('WhatsApp');
      expect(bText).not.toContain('paid invoice');
      expect(bText).not.toContain(idOf('waLead1'));
      expect(bText).not.toContain(idOf('invoicePaid1'));

      await clearProposals();

      // Cross-tenant OWNER of bizOther (bookings-only in biz)
      const cRes = await postAs(
        ID.crossTenant,
        `/business-genome/businesses/${ID.biz}/evolution-proposals/generate-from-temporal-flow`,
      );
      expect(cRes.status).toBe(201);
      expect(cRes.body.map((p: any) => p.section).sort()).toEqual(['operations']);

      await clearProposals();

      // Null reader (direct service fail-closed): no operations/revenue/bookings signals
      const nullProposals = await genomeEvolution.generateFromTemporalFlow(ID.biz, undefined, null);
      expect(nullProposals).toEqual([]);

      await clearProposals();

      // Owner gets ALL signals: marketing (WhatsApp), operations (bookings), sales (paid invoices)
      const oRes = await postAs(
        ID.owner,
        `/business-genome/businesses/${ID.biz}/evolution-proposals/generate-from-temporal-flow`,
      );
      expect(oRes.status).toBe(201);
      expect(oRes.body.map((p: any) => p.section).sort()).toEqual(['marketing', 'operations', 'sales']);

      await clearProposals();
    });
  });

  describe('4. Business Command Center (GET /business-command-center/businesses/:businessId/snapshot)', () => {
    it('T7: snapshot withholds inbox titles/summaries, WhatsApp leads, overdue-invoice evidence, financial proposals, and inbox memories from bookings-only, revenue-only, and cross-tenant members', async () => {
      const bRes = await getAs(ID.bookingsOnly, `/business-command-center/businesses/${ID.biz}/snapshot`);
      expect(bRes.status).toBe(200);
      const bText = JSON.stringify(bRes.body);
      for (const secret of [
        INBOX_AI_SECRET,
        INBOX_SENDER_SECRET,
        INBOX_MEM_SECRET,
        OVERDUE_INV_SECRET,
        'Overdue invoices need follow-up',
        'Cash flow risk from overdue invoices',
        'WhatsApp is becoming a lead channel',
        FIN_PROPOSAL_SECRET,
        OTHER_TENANT_SECRET,
      ]) {
        expect(bText).not.toContain(secret);
      }
      expect(bText).toContain('Booking volume rising');

      // Revenue-only: sees overdue invoice, NEVER KEY Inbox or WhatsApp leads
      const rRes = await getAs(ID.revenueOnly, `/business-command-center/businesses/${ID.biz}/snapshot`);
      expect(rRes.status).toBe(200);
      const rText = JSON.stringify(rRes.body);
      expect(rText).toContain(OVERDUE_INV_SECRET);
      expect(rText).not.toContain(INBOX_AI_SECRET);
      expect(rText).not.toContain('WhatsApp is becoming a lead channel');
      expect(rText).not.toContain(INBOX_MEM_SECRET);

      // Cross-tenant OWNER of bizOther (bookings-only in biz): no biz inbox/revenue, no bizOther secret
      const cRes = await getAs(ID.crossTenant, `/business-command-center/businesses/${ID.biz}/snapshot`);
      expect(cRes.status).toBe(200);
      const cText = JSON.stringify(cRes.body);
      expect(cText).not.toContain(INBOX_AI_SECRET);
      expect(cText).not.toContain(OVERDUE_INV_SECRET);
      expect(cText).not.toContain(OTHER_TENANT_SECRET);

      // Owner sees both inbox & overdue-invoice evidence
      const oRes = await getAs(ID.owner, `/business-command-center/businesses/${ID.biz}/snapshot`);
      expect(oRes.status).toBe(200);
      const oText = JSON.stringify(oRes.body);
      expect(oText).toContain(INBOX_AI_SECRET);
      expect(oText).toContain(OVERDUE_INV_SECRET);
      expect(oText).toContain('WhatsApp is becoming a lead channel');
    });
  });

  describe('5. Business Intelligence & KEY Executive Modes', () => {
    it('T8: GET /intelligence/businesses/:businessId/executive-brief scopes temporal analysis by reader', async () => {
      const bRes = await getAs(ID.bookingsOnly, `/intelligence/businesses/${ID.biz}/executive-brief`);
      expect(bRes.status).toBe(200);
      const bText = JSON.stringify(bRes.body);
      for (const secret of [
        INBOX_AI_SECRET,
        INBOX_SENDER_SECRET,
        OVERDUE_INV_SECRET,
        'Overdue invoices need follow-up',
        'Cash flow risk from overdue invoices',
        'WhatsApp is becoming a lead channel',
        FIN_PROPOSAL_SECRET,
        OTHER_TENANT_SECRET,
      ]) {
        expect(bText).not.toContain(secret);
      }
      expect(bText).toContain('Booking volume rising');

      const rRes = await getAs(ID.revenueOnly, `/intelligence/businesses/${ID.biz}/executive-brief`);
      expect(rRes.status).toBe(200);
      const rText = JSON.stringify(rRes.body);
      expect(rText).toContain(OVERDUE_INV_SECRET);
      expect(rText).not.toContain(INBOX_AI_SECRET);
      expect(rText).not.toContain('WhatsApp is becoming a lead channel');

      const oRes = await getAs(ID.owner, `/intelligence/businesses/${ID.biz}/executive-brief`);
      expect(oRes.status).toBe(200);
      const oText = JSON.stringify(oRes.body);
      expect(oText).toContain(INBOX_AI_SECRET);
      expect(oText).toContain(OVERDUE_INV_SECRET);
      expect(oText).toContain('WhatsApp is becoming a lead channel');
    });

    it('T9: GET /intelligence/businesses/:businessId/key-modes/:mode scopes temporal analysis by reader across RISK_OFFICER, CFO, CMO, EXECUTIVE_ASSISTANT', async () => {
      for (const mode of ['RISK_OFFICER', 'CFO', 'CMO', 'EXECUTIVE_ASSISTANT']) {
        const bRes = await getAs(ID.bookingsOnly, `/intelligence/businesses/${ID.biz}/key-modes/${mode}`);
        expect(bRes.status).toBe(200);
        const bText = JSON.stringify(bRes.body);
        for (const secret of [
          INBOX_AI_SECRET,
          INBOX_SENDER_SECRET,
          OVERDUE_INV_SECRET,
          'Overdue invoices need follow-up',
          'Cash flow risk from overdue invoices',
          'WhatsApp is becoming a lead channel',
          FIN_PROPOSAL_SECRET,
          OTHER_TENANT_SECRET,
        ]) {
          expect(bText).not.toContain(secret);
        }
      }

      // Revenue-only on CMO & EXECUTIVE_ASSISTANT must never see KEY Inbox / WhatsApp leads
      for (const mode of ['CMO', 'EXECUTIVE_ASSISTANT']) {
        const rRes = await getAs(ID.revenueOnly, `/intelligence/businesses/${ID.biz}/key-modes/${mode}`);
        expect(rRes.status).toBe(200);
        const rText = JSON.stringify(rRes.body);
        expect(rText).not.toContain(INBOX_AI_SECRET);
        expect(rText).not.toContain('WhatsApp is becoming a lead channel');
      }

      // Owner sees overdue invoice in CFO/RISK_OFFICER, inbox critical in EXECUTIVE_ASSISTANT, WhatsApp leads in CMO
      const oCfo = await getAs(ID.owner, `/intelligence/businesses/${ID.biz}/key-modes/CFO`);
      expect(oCfo.status).toBe(200);
      expect(JSON.stringify(oCfo.body)).toContain(OVERDUE_INV_SECRET);

      const oEa = await getAs(ID.owner, `/intelligence/businesses/${ID.biz}/key-modes/EXECUTIVE_ASSISTANT`);
      expect(oEa.status).toBe(200);
      expect(JSON.stringify(oEa.body)).toContain(INBOX_AI_SECRET);

      const oCmo = await getAs(ID.owner, `/intelligence/businesses/${ID.biz}/key-modes/CMO`);
      expect(oCmo.status).toBe(200);
      expect(JSON.stringify(oCmo.body)).toContain('WhatsApp is becoming a lead channel');
    });
  });
});
