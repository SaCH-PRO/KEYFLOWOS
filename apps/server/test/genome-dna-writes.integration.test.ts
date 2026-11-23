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
};

const WRITE_DENIED = (has: 'none' | 'read') => `Insufficient permissions: revenue requires write access (you have ${has})`;
const GENOME = { genomeIntegrity: 57, threePillarMinimumMet: true, genomeStage: 'GROWTH', executiveReadinessScore: 61, genomeDnaScores: { founder: 70, business: 70, market: 70 } };

let db: any;
let app: any;
let executor: any;
let proposals: any;
const dnaWrites: Array<{ businessId: string; section: string; data: unknown }> = [];
const blueprintWrites: Array<{ businessId: string; patch: unknown }> = [];
/** What the autonomy orchestrator and the genome policy stand-ins answer next. */
const verdicts: { autonomy: any; genome: any } = { autonomy: null, genome: null };

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

  const offRoute = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' || (typeof prop === 'string' && /^(on|before)(Module|Application)/.test(prop))
      ? undefined
      : () => { throw new Error(`${name}.${String(prop)} is off the paths under test`); }),
  });

  const blueprintStandIn = {
    calculateGenomeIntegrity: async () => GENOME,
    updateDnaSection: async (businessId: string, section: string, data: unknown) => { dnaWrites.push({ businessId, section, data }); return { ok: true }; },
    updateBlueprint: async (businessId: string, patchBody: unknown) => { blueprintWrites.push({ businessId, patch: patchBody }); return { ok: true }; },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [BlueprintController],
    providers: [
      PrismaService,
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
    data: { id, businessId: ID.biz, sourceType: 'KEY_CHAT', title, actionType, riskLevel: 'LOW', status: 'APPROVED', payload },
  });
  await proposal(ID.propEvoFin, 'CREATE_GENOME_EVOLUTION_PROPOSAL', 'Update pricing DNA', { section: 'financial', proposedPatch: { pricingModel: 'retainer' }, reason: 'Pricing review' });
  await proposal(ID.propEvoOps, 'CREATE_GENOME_EVOLUTION_PROPOSAL', 'Update operations DNA', { section: 'operations', proposedPatch: { coreWorkflows: ['walk-ins'] }, reason: 'Walk-in handling' });
  await proposal(ID.propBlocked, 'CREATE_TASK', 'Follow up with Maria', { title: 'Follow up with Maria' });
  await proposal(ID.propApproval, 'CREATE_TASK', 'Call the landlord about the door', { title: 'Call about the door' });
  await proposal(ID.propGenome, 'CREATE_TASK', 'Send the weekly roster', { title: 'Send the weekly roster' });
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
    await expect(executor.executeCreateGenomeProposal(ID.biz, fin, ID.staffNone)).rejects.toThrow(WRITE_DENIED('none'));
    await expect(executor.executeCreateGenomeProposal(ID.biz, fin, ID.staffRead)).rejects.toThrow(WRITE_DENIED('read'));
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
});
