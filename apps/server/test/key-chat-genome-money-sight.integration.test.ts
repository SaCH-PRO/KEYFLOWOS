/**
 * FU-KEY-CHAT-GENOME-MONEY-SIGHT (security review of W11-CORTEX-SESSION-SNAPSHOT-SCOPE, finding 1;
 * D-128, D-100, D-57). A KEY chat turn (KeyCortexQueryPipelineService.processQuery, the POST cortex/chat
 * body, and streamQuery, the SSE and WS key:chat streams) loads the business genome
 * (KeyCortexGenomeContextService: cached per business, no viewer) and hands it, unprojected, to:
 *   - the model prompt (KeyCortexSystemPromptService.buildGenomeContextBlock: URGENT SIGNALS, TOP
 *     RECOMMENDATIONS, and TOP OPPORTUNITIES with their dollar values);
 *   - the answer (genomeInsights.urgentSignals / topRecommendation / proactiveSuggestions and
 *     proactiveSuggestions);
 *   - the stream's "thought" chunks (the genome alert lists the urgent signals' messages).
 * A member without revenue read must get none of the finance genome rows (isFinanceSignal /
 * isFinanceRecommendation, the projection the gated genome routes apply, D-128) and no opportunity
 * (each carries an estimatedValue). Operations rows stay. The owner and a revenue reader keep all.
 *
 * Real: Postgres (users, business, memberships; the pipeline's own memberAuthority read), the
 * pipeline, the real genome prompt block. Stand-ins: the model provider, the genome collaborators
 * (they answer a fixed genome), session store, the other prompt parts. No provider traffic.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71p_';
const ID = {
  biz: `${P}biz`,
  owner: `${P}owner`, // OWNER membership
  blind: `${P}blind`, // STAFF, revenue none
  revenue: `${P}revenue`, // STAFF, revenue read
  emptyAdmin: `${P}empty_admin`, // ADMIN, explicit map naming no module (JSON array)
  superAdmin: `${P}super`, // platform SUPER_ADMIN, no membership
};
const READS_REVENUE: Record<string, boolean> = { owner: true, revenue: true, superAdmin: true, blind: false, emptyAdmin: false };

const FIN = {
  signal: 'v71p runway is 0.8 months',
  autoSignal: 'v71p 3 pending invoices require attention',
  rec: 'v71p raise prices on retainers',
  sugg: 'v71p chase the overdue invoices',
  opp: 'v71p upsell the maintenance plan',
  value: 98765,
};
const OPS = {
  signal: 'v71p delivery backlog growing',
  rec: 'v71p automate the intake form',
  sugg: 'v71p schedule the crew earlier',
};
const MONEY_MARKERS = [FIN.signal, FIN.autoSignal, FIN.rec, FIN.sugg, FIN.opp, '98,765', '98765'];

function genome() {
  return {
    dnaScores: { finance: 40, operations: 70 },
    genomeStage: 'growth',
    executiveReadiness: 55,
    recommendations: [
      { id: `${P}rec_fin`, title: FIN.rec, description: 'fin', impact: 'high', category: 'FINANCIAL', confidence: 0.9, genomeScore: 9 },
      { id: `${P}rec_ops`, title: OPS.rec, description: 'ops', impact: 'high', category: 'OPERATIONS', confidence: 0.9, genomeScore: 8 },
    ],
    signals: [
      { id: `${P}sig_fin`, type: 'risk', message: FIN.signal, module: 'finance', section: 'FINANCIAL', domain: 'finance', severity: 'high', createdAt: new Date() },
      { id: `${P}sig_ops`, type: 'risk', message: OPS.signal, module: 'operations', section: 'OPERATIONS_DELIVERY', domain: 'operations', severity: 'high', createdAt: new Date() },
      // As key-proactive-engine files it: another module, section FINANCE (review BLOCKING-1).
      { id: `${P}sig_auto_fin`, type: 'risk', message: FIN.autoSignal, module: 'key_autonomy', section: 'FINANCE', domain: 'cashflow', severity: 'high', createdAt: new Date() },
    ],
    opportunities: [{ id: `${P}opp`, title: FIN.opp, estimatedValue: FIN.value, category: 'revenue', confidence: 0.8 }],
    autonomyMap: {},
    timestamp: new Date(),
  };
}

let db: any;
let turn: (userId: string, path: 'processQuery' | 'streamQuery', legacy?: boolean) => Promise<{ prompt: string; output: string }>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

beforeAll(async () => {
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const prisma = new PrismaService();
  db = (await import('@keyflow/db')).db;
  const { KeyCortexQueryPipelineService } = await import('../src/modules/key-cortex/key-cortex-query-pipeline.service');
  const { KeyCortexSystemPromptService } = await import('../src/modules/key-cortex/key-cortex-system-prompt.service');
  const realPrompt = new KeyCortexSystemPromptService({} as any);

  turn = async (userId, path, legacy = false) => {
    const prompts: string[] = [];
    const session = { id: `${P}sess`, businessId: ID.biz, userId, status: 'active', persona: 'jarvis', messages: [], detectedRole: null, detectedFunction: null };
    const route = {
      taskCategory: 'general', layers: ['reasoning'], promptVariant: 'standard', includeGenomeContext: true, includeMemoryContext: false,
      includeActions: false, complexity: 'simple', domain: 'general', urgency: 'low', emotionalWeight: 'low', timeHorizon: 'tactical', dataRequirement: 'none',
    };
    const genomeContextService = {
      getGenomeEnrichedContext: async () => genome(),
      getRankedRecommendations: async () => genome().recommendations,
      shouldSuggestProactiveAction: async () => true,
      getProactiveSuggestions: async () => [
        { id: `${P}s_fin`, title: FIN.sugg, description: 'fin', impact: 'high', category: 'FINANCIAL', source: 'genome', confidence: 0.9, action: FIN.sugg },
        { id: `${P}s_ops`, title: OPS.sugg, description: 'ops', impact: 'high', category: 'operations', source: 'genome', confidence: 0.9, action: OPS.sugg },
      ],
    };
    const pipeline = new KeyCortexQueryPipelineService(
      {
        complete: async () => ({ content: 'ok', provider: 'openai', model: 'stand-in', usage: { totalTokens: 1, estimatedCost: 0 }, fallbackUsed: false }),
        streamComplete: async function* () {
          yield { content: 'ok', provider: 'openai', model: 'stand-in' };
        },
      } as any,
      prisma,
      { get: async () => null, setex: async () => undefined } as any,
      {
        getPersonalityConfig: () => ({ persona: 'jarvis', temperature: 0.5 }),
        // As KeyCortexPersonalityService.buildBusinessContextBlock renders the snapshot (legacy prompt).
        buildSystemPrompt: (_p: unknown, c: any) =>
          `LEGACY DNA Scores: ${Object.entries(c.genomeDna ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')}\nPending: ${c.pendingInvoices} invoices\nMetrics: ${JSON.stringify(c.keyMetrics ?? {})}`,
        buildValueBlock: async () => '',
        classifyPersona: async () => undefined,
        selectTone: async () => ({ tone: '', temperatureAdjustment: 0 }),
      } as any,
      {
        buildContextSnapshot: async () => ({
          businessId: ID.biz, genomeStage: 'growth', executiveReadiness: 55,
          genomeDna: { finance: 41, sales: 72, operations: 70 }, pendingInvoices: 7, keyMetrics: { totalRevenue: 98765, openTasks: 3 },
          recentTasks: [], recentEvents: [], activeProjects: [], unreadMessages: 0,
        }),
        formatContextForPrompt: () => '',
      } as any,
      { buildToolDefinitions: async () => [], executeActions: async () => [] } as any,
      {
        getOrCreateSession: async () => session,
        generateId: () => `${P}msg`,
        saveMessage: async () => undefined,
        updateSessionCognitionMetadata: async () => undefined,
        updateRunningSummary: async () => undefined,
      } as any,
      {
        buildMemoryContext: async () => ({}),
        buildMessages: (_q: unknown, _c: unknown, systemPrompt: string) => {
          prompts.push(systemPrompt);
          return [];
        },
      } as any,
      { handleToolCalls: async () => null } as any,
      { detectActions: () => [] } as any,
      { generateSuggestions: async () => [] } as any,
      genomeContextService as any,
      {
        buildV2SystemPrompt: () => 'V2',
        // The real genome block: exactly the genome data the model would be handed.
        buildV3SystemPrompt: (_p: unknown, _c: unknown, _v: unknown, g: any, r: any) => `V3\n${realPrompt.buildGenomeContextBlock(g, r)}`,
        enrichSnapshotFromV2: () => undefined,
        enrichSnapshotFromGenome: () => undefined,
      } as any,
      {
        classifyTaskCategory: () => 'general',
        buildStructuredOutputInstructions: () => '',
        parseStructuredResponse: () => ({ role: 'assistant', recommendation: 'ok', confidence: 80 }),
      } as any,
      { detectMood: () => 'casual' } as any,
      undefined,
      { route: async () => route } as any,
      undefined, // connector
      undefined, // command
      undefined, // executor
      undefined, // contextV2
      {} as any, // genome bridge: present, so the genome path runs
      undefined, // events
    );
    const query = { text: 'how is the business doing', businessId: ID.biz, userId } as any;
    const flags = { integrationV2Enabled: false, genomeV3Enabled: !legacy };
    let output: string;
    if (path === 'processQuery') {
      output = JSON.stringify(await pipeline.processQuery(query, flags));
    } else {
      const chunks: unknown[] = [];
      for await (const chunk of pipeline.streamQuery(query, flags)) chunks.push(chunk);
      output = JSON.stringify(chunks);
    }
    expect(prompts, `${path}: one model prompt`).toHaveLength(1);
    return { prompt: prompts[0], output };
  };

  await cleanup();
  for (const id of Object.values(ID).filter((v) => v !== ID.biz)) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71P Biz', ownerId: ID.owner } });
  for (const [userId, role, permissionScopes] of [
    [ID.owner, 'OWNER', undefined],
    [ID.blind, 'STAFF', { revenue: 'none' }],
    [ID.revenue, 'STAFF', { revenue: 'read' }],
    [ID.emptyAdmin, 'ADMIN', []],
  ] as const) {
    await db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: ID.biz, role, ...(permissionScopes ? { permissionScopes } : {}) } });
  }
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
});

describe('FU-KEY-CHAT-GENOME-MONEY-SIGHT (D-128, D-100): a KEY chat turn hands finance genome rows and opportunity values only to members who may read revenue', () => {
  for (const reader of ['owner', 'revenue', 'superAdmin', 'blind', 'emptyAdmin'] as const) {
    for (const path of ['processQuery', 'streamQuery'] as const) {
      const kind = READS_REVENUE[reader] ? 'control' : 'RED-BEFORE';
      it(`${kind}: ${reader} (${path}): the prompt ${READS_REVENUE[reader] ? 'keeps' : 'carries no'} finance signal, finance recommendation or opportunity value, and operations rows stay`, async () => {
        const { prompt } = await turn(ID[reader], path);
        for (const ops of [OPS.signal, OPS.rec]) expect(prompt, `${reader} ${path}: ${ops}`).toContain(ops);
        for (const marker of [FIN.signal, FIN.autoSignal, FIN.rec, FIN.opp, '98,765']) {
          if (READS_REVENUE[reader]) expect(prompt, `${reader} ${path}: ${marker}`).toContain(marker);
          else expect(prompt, `${reader} ${path}: ${marker}`).not.toContain(marker);
        }
      });

      it(`${kind}: ${reader} (${path}): the answer ${READS_REVENUE[reader] ? 'keeps' : 'carries no'} finance genome insight or suggestion`, async () => {
        const { output } = await turn(ID[reader], path);
        if (READS_REVENUE[reader]) {
          if (path === 'processQuery') for (const marker of [FIN.signal, FIN.rec, FIN.sugg]) expect(output, `${reader} ${path}: ${marker}`).toContain(marker);
          else for (const marker of [FIN.signal, FIN.autoSignal]) expect(output, `${reader} ${path}: the genome alert`).toContain(marker);
        } else {
          for (const marker of MONEY_MARKERS) expect(output, `${reader} ${path}: ${marker}`).not.toContain(marker);
        }
        if (path === 'processQuery') for (const ops of [OPS.signal, OPS.sugg]) expect(output, `${reader} ${path}: ${ops}`).toContain(ops);
      });

      it(`${kind} (D-233, KC-SEC-3; review MAJOR-1): ${reader} (${path}, legacy prompt): the snapshot the prompt renders ${READS_REVENUE[reader] ? 'keeps' : 'carries no'} finance or sales DNA score, pending-invoice count or revenue figure`, async () => {
        const { prompt } = await turn(ID[reader], path, true);
        expect(prompt, `${reader} ${path}: operations DNA`).toContain('operations: 70');
        for (const marker of ['finance: 41', 'sales: 72', 'Pending: 7 invoices', '98765']) {
          if (READS_REVENUE[reader]) expect(prompt, `${reader} ${path}: ${marker}`).toContain(marker);
          else expect(prompt, `${reader} ${path}: ${marker}`).not.toContain(marker);
        }
      });

      it(`${kind} (D-233): ${reader} (${path}): the finance DNA score ${READS_REVENUE[reader] ? 'reaches' : 'reaches neither'} the prompt${path === 'processQuery' ? ' nor the genomeInsights' : ''}; other DNA scores stay`, async () => {
        const { prompt, output } = await turn(ID[reader], path);
        expect(prompt, `${reader} ${path}: operations DNA`).toMatch(/operations: [█░]+ 70%/);
        if (READS_REVENUE[reader]) {
          expect(prompt, `${reader} ${path}: finance DNA`).toMatch(/finance: [█░]+ 40%/);
        } else {
          expect(prompt, `${reader} ${path}: finance DNA`).not.toMatch(/finance: /);
          expect(output, `${reader} ${path}: finance DNA in the answer`).not.toContain('"finance":40');
        }
      });
    }
  }
});
