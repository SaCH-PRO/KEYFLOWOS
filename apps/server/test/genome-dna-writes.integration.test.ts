/**
 * FU-GENOME-DNA-WRITES-AND-INTEGRITY (owner rulings D-128, D-233, D-238). Found by the FU-GENOME-EVOLUTION-SURFACES
 * reviews: the revenue-write gate on approving a financial genome-evolution proposal can be bypassed by writing the DNA
 * directly or by having KEY create the proposal, and KEY's execute answer hands the actor the autonomy verdict's raw,
 * finance-derived reason.
 *
 *   DW-01  PATCH blueprint/.../genome/dna/:section of the financial or sales section, of an unknown section, or whose data
 *          states money or a figure (the evolution gate's rule, isFinancialGenomeEvolution) needs revenue write
 *          (ModuleScopeGuard's 403 message); the DNA is not written. A neutral non-money section edit is unchanged.
 *   DW-02  PATCH blueprint/... (the whole blueprint) touching a column that feeds the financial or sales DNA, an unknown
 *          column, or stating money or a figure, needs revenue write; a neutral edit of another column is unchanged.
 *   DW-03  KEY executing CREATE_GENOME_EVOLUTION_PROPOSAL with a financial payload needs the executing member's revenue
 *          write (GenomeEvolutionService.create's actor opt-in); no proposal is made. A revenue writer, and KEY's own
 *          execution with no member, are unchanged.
 *   DW-04  KeyActionProposalService.execute answers a member without revenue read a neutral message in place of an
 *          autonomy or genome-policy reason that states money or cross-domain risk; a revenue reader gets it as before.
 *
 * Round 2 (the round-1 reviews):
 *   DW-06  BLOCKING: a member without revenue write executing an owner-approved financial evolution proposal is refused
 *          before the execution claim, so the proposal stays APPROVED and the owner can then execute it; the executor
 *          itself answers a refusal as a failed outcome (the row ends FAILED, never EXECUTING).
 *   DW-07  The stored failure reason of a proposal blocked for hyphenated cross-domain risk is withheld from a member
 *          without revenue read on the proposal read (the shared vocabulary reads cross-domain, cross_domain, cross domain).
 *   DW-08  KEY's system actor ('key_ai') is no member: its execution makes a financial evolution proposal, and it is
 *          answered the verdict's reason as an execution with no member is.
 *   DW-09  The genome-risk confirmation answer for a member without revenue read is its own neutral text, which says
 *          "requires confirmation" (the web proposal card offers the confirmation on that text).
 *   DW-10  The write rule (agreed with the orchestrator in round 1): revenue write is needed for the financial, sales or
 *          an unknown section or column, a listed money field set anywhere in the patch, or a value that states money
 *          by the shared vocabulary. Field names and bare digits alone do not: the legal card (vatStatus), operations
 *          ("take orders"), founder hours, a phone number and growth steps with numbers are written by any member who
 *          may write the genome. Residual, accepted: a target written as a bare figure with no money word ("Hit 120k
 *          this quarter") is writable by such a member; it is withheld on read.
 *   DW-11  POST infer/onboarding (flat and dotted answers) is gated by the same rule on the patch it builds.
 *   DW-12  POST genome-chat/.../apply-updates is gated by the same rule as the DNA write.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, the global TenantInterceptor, the
 * BlueprintController with GenomeGateGuard, GenomeEvolutionService, KeyActionExecutorService's genome-proposal step and
 * KeyActionProposalService.execute run against the database at DATABASE_URL. Stand-ins: BlueprintService records the
 * writes it is asked for (its own write pipeline is off these routes) and answers a genome with the three-pillar minimum
 * met; the autonomy orchestrator and the genome policy answer fixed verdicts; collaborators off these paths throw if
 * reached.
 *
 * Fixtures: prefix `v79d_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL in beforeAll and
 * afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v79d_';
const HEADER = 'x-test-user';

const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  biz2: `${P}biz2`,
  propEvoFin: `${P}prop_evofin`,
  propEvoOps: `${P}prop_evoops`,
  propBlocked: `${P}prop_blocked`,
  propApproval: `${P}prop_approval`,
  propGenome: `${P}prop_genome`,
  propEvoFin2: `${P}prop_evofin2`,
  propEvoFin3: `${P}prop_evofin3`,
  propCross: `${P}prop_cross`,
  propConfirm: `${P}prop_confirm`,
};

const WRITE_DENIED = (has: 'none' | 'read') => `Insufficient permissions: revenue requires write access (you have ${has})`;
const GENOME = { genomeIntegrity: 57, threePillarMinimumMet: true, genomeStage: 'GROWTH', executiveReadinessScore: 61, genomeDnaScores: { founder: 70, business: 70, market: 70 } };

let db: any;
let app: any;
let executor: any;
let proposals: any;
/** A KeyActionProposalService whose executor is the real KeyActionExecutorService (DW-06, DW-08). */
let executing: any;
const onboardingWrites: Array<{ businessId: string; answers: unknown }> = [];
const dnaWrites: Array<{ businessId: string; section: string; data: unknown }> = [];
const blueprintWrites: Array<{ businessId: string; patch: unknown }> = [];
/** What the autonomy orchestrator and the genome policy stand-ins answer next. */
const verdicts: { autonomy: any; genome: any } = { autonomy: null, genome: null };

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_chat_messages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_evolution_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function attachIdentity(nest: any) {
  nest.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
}

const patch = (url: string, as: string, body: Record<string, unknown>) => request(app.getHttpServer()).patch(url).set(HEADER, as).send(body);
const dnaUrl = (section: string, biz = ID.biz) => `/blueprint/businesses/${biz}/genome/dna/${section}`;
const blueprintUrl = (biz = ID.biz) => `/blueprint/businesses/${biz}`;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { GenomeGateGuard } = await import('../src/core/auth/genome-gate.guard');
  const { BlueprintController } = await import('../src/modules/blueprint/blueprint.controller');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { GenomeEvolutionService } = await import('../src/modules/business-genome/genome-evolution.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { KeyActionExecutorService } = await import('../src/modules/key-autonomy/key-action-executor.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { GenomeChatController } = await import('../src/modules/business-genesis/genome-chat.controller');
  const { GenomeChatService } = await import('../src/modules/business-genesis/genome-chat.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');

  const offRoute = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' || (typeof prop === 'string' && /^(on|before)(Module|Application)/.test(prop))
      ? undefined
      : () => { throw new Error(`${name}.${String(prop)} is off the paths under test`); }),
  });

  const blueprintStandIn = {
    calculateGenomeIntegrity: async () => GENOME,
    updateDnaSection: async (businessId: string, section: string, data: unknown) => { dnaWrites.push({ businessId, section, data }); return { ok: true }; },
    updateBlueprint: async (businessId: string, patchBody: unknown) => { blueprintWrites.push({ businessId, patch: patchBody }); return { ok: true }; },
    inferFromOnboarding: async (businessId: string, answers: unknown) => { onboardingWrites.push({ businessId, answers }); return { ok: true }; },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [BlueprintController, GenomeChatController],
    providers: [
      PrismaService,
      // RateLimitGuard (on genome-chat's send route, off these paths) is built with the Redis client.
      { provide: REDIS_CLIENT, useValue: offRoute('Redis') },
      { provide: GenomeChatService, inject: [PrismaService], useFactory: (prisma: any) => new GenomeChatService(prisma, blueprintStandIn as any, offRoute('ModelGatewayService') as any) },
      AuthGuard,
      BusinessGuard,
      { provide: BlueprintService, useValue: blueprintStandIn },
      { provide: GenomeGateGuard, inject: [PrismaService], useFactory: (prisma: any) => new GenomeGateGuard(blueprintStandIn as any, prisma) },
    ],
  }).compile();
  const prisma = moduleRef.get(PrismaService);

  const temporal = new TemporalFlowService(prisma, undefined as any, undefined as any);
  const evolution = new GenomeEvolutionService(prisma, blueprintStandIn as any, temporal);
  executor = new KeyActionExecutorService(
    temporal, evolution, offRoute('ConstitutionVersionService') as any, offRoute('GenomeDocumentPackService') as any,
    offRoute('KeyActionExecutorRegistryService') as any, offRoute('SafetyShellService') as any, offRoute('ActionAuditService') as any,
  );
  proposals = new KeyActionProposalService(
    prisma, temporal, offRoute('EventEmitter2') as any,
    { isExecutable: () => true, requiresApproval: () => true } as any,
    offRoute('KeyActionExecutorService') as any,
    { evaluateExecution: async () => verdicts.genome } as any,
    { evaluateAction: async () => verdicts.autonomy } as any,
    { governs: () => false } as any,
  );
  // The real executor for the execution path (DW-06, DW-08): the safety shell passes, the audit records nothing, no plugin.
  const realExecutor = new KeyActionExecutorService(
    temporal, evolution, offRoute('ConstitutionVersionService') as any, offRoute('GenomeDocumentPackService') as any,
    { hasPlugin: () => false } as any,
    { check: async () => ({ safe: true, rollbackActions: [] }), rollback: async () => undefined } as any,
    { recordExecuted: async () => undefined, recordFailed: async () => undefined, recordBlocked: async () => undefined } as any,
  );
  executing = new KeyActionProposalService(
    prisma, temporal, { emit: () => true, emitAsync: async () => [] } as any,
    { isExecutable: () => true, requiresApproval: () => true } as any,
    realExecutor,
    { evaluateExecution: async () => ({ allowed: true }) } as any,
    { evaluateAction: async () => ({ allowed: true, requiresApproval: false, reason: 'ok', ruleTrace: [] }) } as any,
    { governs: () => false } as any,
  );

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  for (const id of [ID.owner, ID.staffNone, ID.staffRead, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V79D DNA', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.biz2, name: 'V79D Other', slug: `${P}biz2`, ownerId: ID.outsider, currency: 'TTD' } });
  for (const [user, biz, role, permissionScopes] of [
    [ID.owner, ID.biz, 'OWNER', undefined],
    [ID.staffNone, ID.biz, 'STAFF', { revenue: 'none', settings: 'write', ai: 'write', operations: 'write' }],
    [ID.staffRead, ID.biz, 'STAFF', { revenue: 'read', settings: 'write', ai: 'write', operations: 'write' }],
    [ID.outsider, ID.biz2, 'OWNER', undefined],
  ] as const) {
    await db.membership.create({ data: { id: `${user}_${biz}_m`, userId: user, businessId: biz, role, ...(permissionScopes ? { permissionScopes } : {}) } });
  }

  // KEY action proposals, APPROVED, as KeyActionProposalService writes them.
  const proposal = (id: string, actionType: string, title: string, payload: Record<string, unknown>) => db.keyActionProposal.create({
    data: { id, businessId: ID.biz, sourceType: 'KEY_CHAT', title, actionType, riskLevel: 'LOW', status: 'APPROVED', approvedBy: ID.owner, approvedAt: new Date(), payload },
  });
  await proposal(ID.propEvoFin, 'CREATE_GENOME_EVOLUTION_PROPOSAL', 'Update pricing DNA', { section: 'financial', proposedPatch: { pricingModel: 'retainer' }, reason: 'Pricing review' });
  await proposal(ID.propEvoOps, 'CREATE_GENOME_EVOLUTION_PROPOSAL', 'Update operations DNA', { section: 'operations', proposedPatch: { coreWorkflows: ['walk-ins'] }, reason: 'Walk-in handling' });
  await proposal(ID.propBlocked, 'CREATE_TASK', 'Follow up with Maria', { title: 'Follow up with Maria' });
  await proposal(ID.propApproval, 'CREATE_TASK', 'Call the landlord about the door', { title: 'Call about the door' });
  await proposal(ID.propGenome, 'CREATE_TASK', 'Send the weekly roster', { title: 'Send the weekly roster' });
  await proposal(ID.propEvoFin2, 'CREATE_GENOME_EVOLUTION_PROPOSAL', 'Update pricing DNA', { section: 'financial', proposedPatch: { pricingModel: 'per visit' }, reason: 'Pricing review' });
  await proposal(ID.propEvoFin3, 'CREATE_GENOME_EVOLUTION_PROPOSAL', 'Update pricing DNA', { section: 'financial', proposedPatch: { pricingModel: 'monthly plan' }, reason: 'Pricing review' });
  await proposal(ID.propCross, 'CREATE_TASK', 'Tidy the stockroom', { title: 'Tidy the stockroom' });
  await proposal(ID.propConfirm, 'CREATE_TASK', 'Book the van service', { title: 'Book the van service' });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128, D-233, D-238)', () => {
  it('DW-01 writing a financial, sales, unknown or money-stating DNA section needs revenue write; a neutral one does not', async () => {
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      for (const [section, data] of [
        ['financial', { pricingModel: 'retainer' }],
        ['sales', { salesChannels: ['direct'] }],
        ['treasury', { notes: ['x'] }],
        ['business', { revenueModel: 'commission on every sale' }],
        ['operations', { avgTicket: 4500 }],
      ] as const) {
        const res = await patch(dnaUrl(section), as, { data });
        expect(res.status, `${as} ${section}`).toBe(403);
        expect(JSON.stringify(res.body), `${as} ${section}`).toContain(WRITE_DENIED(has));
      }
    }
    expect(dnaWrites).toEqual([]);
    const ok = await patch(dnaUrl('operations'), ID.staffNone, { data: { coreWorkflows: ['walk-ins'] } });
    expect(ok.status).toBe(200);
    const owner = await patch(dnaUrl('financial'), ID.owner, { data: { pricingModel: 'retainer' } });
    expect(owner.status).toBe(200);
    expect(dnaWrites.map((w) => w.section)).toEqual(['operations', 'financial']);
  });

  it('DW-02 a blueprint patch touching the financial or sales DNA, an unknown column, or stating money needs revenue write', async () => {
    blueprintWrites.length = 0;
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      for (const body of [
        { financials: { pricingModel: 'retainer' } },
        { projectionProfile: { startupCapital: 5000 } },
        { salesSystem: { salesChannels: ['direct'] } },
        { mysteryColumn: { notes: 'x' } },
        { brand: { voice: 'Premium pricing for retainer clients' } },
      ]) {
        const res = await patch(blueprintUrl(), as, body);
        expect(res.status, `${as} ${JSON.stringify(body)}`).toBe(403);
        expect(JSON.stringify(res.body)).toContain(WRITE_DENIED(has));
      }
    }
    expect(blueprintWrites).toEqual([]);
    const ok = await patch(blueprintUrl(), ID.staffNone, { brand: { voice: 'Warm and direct' } });
    expect(ok.status).toBe(200);
    const owner = await patch(blueprintUrl(), ID.owner, { financials: { pricingModel: 'retainer' } });
    expect(owner.status).toBe(200);
    expect(blueprintWrites.length).toBe(2);
  });

  it('DW-03 KEY creating a financial evolution proposal needs the executing member\'s revenue write', async () => {
    const fin = await proposals.get(ID.biz, ID.propEvoFin);
    // Round 2: the refusal is a failed outcome (the proposal row ends FAILED, never EXECUTING).
    expect(await executor.executeCreateGenomeProposal(ID.biz, fin, ID.staffNone)).toEqual({ success: false, error: WRITE_DENIED('none') });
    expect(await executor.executeCreateGenomeProposal(ID.biz, fin, ID.staffRead)).toEqual({ success: false, error: WRITE_DENIED('read') });
    expect(await db.genomeEvolutionProposal.count({ where: { businessId: ID.biz, section: 'financial' } })).toBe(0);
    // A non-financial one is made for the same member; the owner and KEY's own execution make the financial one.
    const ops = await proposals.get(ID.biz, ID.propEvoOps);
    expect((await executor.executeCreateGenomeProposal(ID.biz, ops, ID.staffNone)).success).toBe(true);
    expect((await executor.executeCreateGenomeProposal(ID.biz, fin, ID.owner)).success).toBe(true);
    expect((await executor.executeCreateGenomeProposal(ID.biz, fin, undefined)).success).toBe(true);
    expect(await db.genomeEvolutionProposal.count({ where: { businessId: ID.biz, section: 'financial' } })).toBe(2);
  });

  it('DW-04 execute answers a member without revenue read no finance-derived autonomy or genome reason', async () => {
    const message = async (proposalId: string, as: string) => {
      try {
        await proposals.execute(ID.biz, proposalId, as);
        return 'no error';
      } catch (err: any) {
        return String(err?.response?.message ?? err?.message);
      }
    };
    verdicts.genome = { allowed: true };
    verdicts.autonomy = { allowed: false, requiresApproval: true, reason: 'Finance risk is HIGH; financial approval is recommended.', ruleTrace: [] };
    const blocked = await message(ID.propBlocked, ID.staffNone);
    expect(blocked).not.toMatch(/finance|financial|risk is/i);
    expect(blocked.length).toBeGreaterThan(0);
    verdicts.autonomy = { allowed: true, requiresApproval: true, reason: 'Cross-domain risk is CRITICAL.', ruleTrace: [] };
    expect(await message(ID.propApproval, ID.staffNone)).not.toMatch(/cross-domain|critical/i);
    verdicts.autonomy = { allowed: true, requiresApproval: false, reason: 'ok', ruleTrace: [] };
    verdicts.genome = { allowed: false, message: 'KEY cannot execute this action because revenue_quality readiness is only 41%.', blockedReasons: [], missingFacts: [] };
    expect(await message(ID.propGenome, ID.staffNone)).not.toMatch(/revenue|41%/i);
    // A revenue reader gets the reason as before.
    verdicts.genome = { allowed: true };
    verdicts.autonomy = { allowed: true, requiresApproval: true, reason: 'Cross-domain risk is CRITICAL.', ruleTrace: [] };
    expect(await message(ID.propApproval, ID.staffRead)).toBe('Cross-domain risk is CRITICAL.');
    // A neutral reason reaches every member unchanged.
    verdicts.autonomy = { allowed: true, requiresApproval: true, reason: 'This action needs your confirmation.', ruleTrace: [] };
    expect(await message(ID.propApproval, ID.staffNone)).toBe('This action needs your confirmation.');
  });

  it('DW-05 cross-tenant: another business\'s member is refused the DNA and blueprint writes', async () => {
    for (const res of [await patch(dnaUrl('operations'), ID.outsider, { data: { coreWorkflows: ['x'] } }), await patch(blueprintUrl(), ID.outsider, { brand: { voice: 'x' } })]) {
      expect(res.status).toBe(403);
    }
  });

  it('DW-06 BLOCKING: a refused KEY execution of a financial evolution proposal leaves it APPROVED for the owner', async () => {
    const status = async (id: string) => (await db.keyActionProposal.findUnique({ where: { id }, select: { status: true } })).status;
    const before = await db.genomeEvolutionProposal.count({ where: { businessId: ID.biz, section: 'financial' } });
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      await expect(executing.execute(ID.biz, ID.propEvoFin2, as)).rejects.toThrow(WRITE_DENIED(has));
      expect(await status(ID.propEvoFin2)).toBe('APPROVED');
    }
    const done = await executing.execute(ID.biz, ID.propEvoFin2, ID.owner);
    expect(done.status).toBe('EXECUTED');
    expect(await db.genomeEvolutionProposal.count({ where: { businessId: ID.biz, section: 'financial' } })).toBe(before + 1);
  });

  it('DW-07 a stored cross-domain block reason is withheld from a member without revenue read', async () => {
    verdicts.genome = { allowed: true };
    verdicts.autonomy = { allowed: false, requiresApproval: false, reason: 'Cross-domain risk is CRITICAL.', ruleTrace: [] };
    await expect(proposals.execute(ID.biz, ID.propCross, ID.staffRead)).rejects.toThrow('Cross-domain risk is CRITICAL.');
    const stored = await db.keyActionProposal.findUnique({ where: { id: ID.propCross }, select: { failureReason: true } });
    expect(stored.failureReason).toBe('Cross-domain risk is CRITICAL.');
    const forNone = await proposals.getForReader(ID.biz, ID.propCross, { id: ID.staffNone });
    expect(JSON.stringify(forNone)).not.toMatch(/cross[\s_-]?domain|critical/i);
    const listed = await proposals.listForReader(ID.biz, {}, { id: ID.staffNone });
    expect(JSON.stringify(listed)).not.toMatch(/cross[\s_-]?domain|critical/i);
    expect((await proposals.getForReader(ID.biz, ID.propCross, { id: ID.staffRead })).failureReason).toBe('Cross-domain risk is CRITICAL.');
  });

  it('DW-08 KEY\'s system actor is no member', async () => {
    const message = async (proposalId: string, as: string | undefined) => {
      try { await proposals.execute(ID.biz, proposalId, as); return 'no error'; } catch (err: any) { return String(err?.response?.message ?? err?.message); }
    };
    verdicts.genome = { allowed: true };
    verdicts.autonomy = { allowed: true, requiresApproval: true, reason: 'Cross-domain risk is CRITICAL.', ruleTrace: [] };
    expect(await message(ID.propApproval, undefined)).toBe('Cross-domain risk is CRITICAL.');
    expect(await message(ID.propApproval, 'key_ai')).toBe('Cross-domain risk is CRITICAL.');
    const fin = await proposals.get(ID.biz, ID.propEvoFin);
    expect((await executor.executeCreateGenomeProposal(ID.biz, fin, 'key_ai')).success).toBe(true);
    expect((await executing.execute(ID.biz, ID.propEvoFin3, 'key_ai')).status).toBe('EXECUTED');
  });

  it('DW-09 the genome-risk confirmation answer stays a "requires confirmation" answer without the finance reason', async () => {
    const message = async (as: string) => {
      try { await proposals.execute(ID.biz, ID.propConfirm, as); return 'no error'; } catch (err: any) { return String(err?.response?.message ?? err?.message); }
    };
    verdicts.autonomy = { allowed: true, requiresApproval: false, reason: 'ok', ruleTrace: [] };
    verdicts.genome = { allowed: true, requiresExtraConfirmation: true, message: 'Revenue readiness is 41%; this action requires confirmation.', blockedReasons: [], missingFacts: [] };
    const none = await message(ID.staffNone);
    expect(none.toLowerCase()).toContain('requires confirmation');
    expect(none).not.toMatch(/revenue|41%/i);
    expect(await message(ID.staffRead)).toBe('Revenue readiness is 41%; this action requires confirmation.');
  });

  it('DW-10 field names and bare digits alone do not need revenue write; money fields and money values still do', async () => {
    dnaWrites.length = 0;
    blueprintWrites.length = 0;
    // The real cards' payloads (the DNA drawer, the onboarding cards), written by a member without revenue read.
    for (const [section, data] of [
      ['legal', { vatStatus: 'REGISTERED', taxIdStatus: 'PENDING', country: 'TT' }],
      ['operations', { coreWorkflows: ['take orders', 'pack the van'] }],
      ['founder', { weeklyAvailabilityHours: 40, founderName: 'Asha' }],
      ['growth', { sevenDayPlan: ['post 3 reels', 'call 5 suppliers'] }],
      ['business', { name: 'Asha Cleaning', teamSize: '2-5', deliveryMode: 'on-site' }],
      // Residual, accepted (orchestrator, round 1): a bare figure with no money word is writable; it is withheld on read.
      ['growth', { thirtyDayPlan: ['Hit 120k this quarter'] }],
    ] as const) {
      const res = await patch(dnaUrl(section), ID.staffNone, { data });
      expect(res.status, `${section} ${JSON.stringify(data)}`).toBe(200);
    }
    expect(dnaWrites.length).toBe(6);
    for (const body of [
      { identity: { name: 'Asha Cleaning', phone: '+1 868 555 0100' } },
      { legalProfile: { regulatedIndustry: false }, registrationProfile: { vatStatus: 'NOT_REQUIRED' } },
      { founderProfile: { weeklyAvailabilityHours: 40 } },
      { operatingModel: { deliveryMode: 'on-site', teamSize: '2-5' } },
    ]) {
      const res = await patch(blueprintUrl(), ID.staffNone, body);
      expect(res.status, JSON.stringify(body)).toBe(200);
    }
    expect(blueprintWrites.length).toBe(4);
    // Still refused: a listed money field anywhere, or a value that states money.
    for (const [section, data] of [
      ['business', { budgetRange: 'small' }],
      ['business', { revenueModel: '' }],
      ['risk', { financialRisks: [{ risk: 'slow season' }] }],
      ['operations', { coreWorkflows: ['send invoices on Friday'] }],
      ['growth', { today: ['Raise prices'] }],
    ] as const) {
      const res = await patch(dnaUrl(section), ID.staffNone, { data });
      expect(res.status, `${section} ${JSON.stringify(data)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain(WRITE_DENIED('none'));
    }
    for (const body of [
      { operatingModel: { revenueModel: 'subscriptions' } },
      { constraints: { budgetRange: 'small' } },
      { taxProfile: { estimatedAnnualRevenue: 600000 } },
      { riskProfile: { financialRisks: [] } },
      { goals: { northStar: 'Double our monthly sales' } },
    ]) {
      const res = await patch(blueprintUrl(), ID.staffNone, body);
      expect(res.status, JSON.stringify(body)).toBe(403);
    }
    expect(dnaWrites.length).toBe(6);
    expect(blueprintWrites.length).toBe(4);
  });

  it('DW-11 POST infer/onboarding is gated by the same rule on the patch it builds', async () => {
    onboardingWrites.length = 0;
    const post = (as: string, answers: Record<string, unknown>) =>
      request(app.getHttpServer()).post(`${blueprintUrl()}/infer/onboarding`).set(HEADER, as).send({ answers });
    for (const answers of [
      { revenueModel: 'subscriptions' },
      { pricingModel: 'retainer' },
      { currency: 'TTD' },
      { 'financials.avgTicket': 50 },
      { 'operatingModel.revenueModel': 'commission' },
      { estimatedAnnualRevenue: 600000 },
      { salesChannels: ['direct'] },
      { startupCapital: 5000 },
      { 'mysteryColumn.notes': 'x' },
      { businessIntent: 'Sell discounted bundles' },
    ]) {
      const res = await post(ID.staffNone, answers);
      expect(res.status, JSON.stringify(answers)).toBe(403);
      expect(JSON.stringify(res.body)).toContain(WRITE_DENIED('none'));
    }
    expect(onboardingWrites).toEqual([]);
    const ok = await post(ID.staffNone, { businessName: 'Asha Cleaning', 'legalProfile.hasPhysicalLocation': true, weeklyAvailabilityHours: 40, coreWorkflows: ['take orders'] });
    expect(ok.status).toBe(201);
    const owner = await post(ID.owner, { revenueModel: 'subscriptions', 'financials.avgTicket': 50 });
    expect(owner.status).toBe(201);
    expect(onboardingWrites.length).toBe(2);
  });

  it('DW-12 POST genome-chat apply-updates is gated by the same rule as the DNA write', async () => {
    dnaWrites.length = 0;
    const apply = (as: string, section: string, data: Record<string, unknown>) =>
      request(app.getHttpServer()).post(`/genome-chat/businesses/${ID.biz}/apply-updates`).set(HEADER, as).send({ section, data });
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      for (const [section, data] of [
        ['financial', { pricingModel: 'retainer' }],
        ['sales', { salesChannels: ['direct'] }],
        ['business', { revenueModel: 'commission' }],
        ['operations', { coreWorkflows: ['chase overdue payments'] }],
      ] as const) {
        const res = await apply(as, section, data);
        expect(res.status, `${as} ${section}`).toBe(403);
        expect(JSON.stringify(res.body)).toContain(WRITE_DENIED(has));
      }
    }
    expect(dnaWrites).toEqual([]);
    expect((await apply(ID.staffNone, 'operations', { coreWorkflows: ['take orders'] })).status).toBe(201);
    expect((await apply(ID.owner, 'financial', { pricingModel: 'retainer' })).status).toBe(201);
    expect(dnaWrites.map((w) => w.section)).toEqual(['operations', 'financial']);
  });
});
