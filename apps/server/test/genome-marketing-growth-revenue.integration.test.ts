/**
 * FU-GENOME-SURFACES-REVENUE round 2 (D-234, D-100): marketing-growth channels hold monthlyBudget, targetCac and
 * targetConversionRate, and the marketing-growth snapshot derives blendedCac, leadVolumeEstimate,
 * funnelConversionEstimate, channelDiversificationScore, overallRisk and channelMix[*].sharePercent from them (money /
 * commercial data). For a STAFF member whose explicit scope map says revenue:'none':
 *
 *   MGR-01  GET marketing-growth/channels serves each channel without monthlyBudget, targetCac, targetConversionRate
 *           (null, named in withheldForRevenue); POST and PATCH answer the channel the same way.
 *   MGR-02  GET marketing-growth/snapshot, GET snapshots (ignoring riskLevel filter to block oracle filtering) and
 *           POST snapshot/compute serve no blended CAC, lead volume, funnel conversion, budget share, diversification
 *           score or overall risk, and no warning or recommendation that states CAC, budget or conversion.
 *   MGR-03  POST signals/generate and recommendations/generate answer no money (finance or sales) row.
 *   MGR-04  Controls: the owner and a revenue-read member are served every figure; a member of another business is
 *           refused.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, the global
 * TenantInterceptor, KeyGenomeController, GenomeGrowthChannelService, GenomeContentStrategyService and
 * MarketingGenomeService's snapshot reads and compute run against the database at DATABASE_URL. The signal and
 * recommendation generators are spied to answer fixed rows (one money, one not). Identity attachment is a stand-in
 * (`x-test-user`).
 *
 * Fixtures: prefix `v80m_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL in beforeAll and
 * afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v80m_';
const HEADER = 'x-test-user';
const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  biz2: `${P}biz2`,
};
/** Figures only the money fields of this fixture carry (non-digit lookbehind + 73.1 prevent any ISO-8601 timestamp match). */
const FIGURES = /(?<!\d)(?:1234\.5|87\.65|0\.731|73\.1)/;
const MONEY_CHANNEL_FIELDS = ['monthlyBudget', 'targetCac', 'targetConversionRate'];
const MONEY_SNAPSHOT_FIELDS = [
  'blendedCac',
  'leadVolumeEstimate',
  'funnelConversionEstimate',
  'channelDiversificationScore',
  'overallRisk',
];

let db: any;
let app: any;
let marketing: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM genome_marketing_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_growth_channels WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_content_strategies WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

const get = (url: string, as: string) => request(app.getHttpServer()).get(url).set(HEADER, as);
const post = (url: string, as: string, body: Record<string, unknown> = {}) =>
  request(app.getHttpServer()).post(url).set(HEADER, as).send(body);
const patch = (url: string, as: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(url).set(HEADER, as).send(body);
const mg = (suffix: string, biz = ID.biz) => `/business-genome/businesses/${biz}/key-genome/marketing-growth${suffix}`;

function expectChannelProjected(row: any) {
  for (const field of MONEY_CHANNEL_FIELDS) expect(row[field] ?? null, field).toBeNull();
  expect(row.withheldForRevenue).toEqual(expect.arrayContaining(MONEY_CHANNEL_FIELDS));
  expect(typeof row.label).toBe('string');
}

function expectSnapshotProjected(row: any) {
  for (const field of MONEY_SNAPSHOT_FIELDS) expect(row[field] ?? null, field).toBeNull();
  for (const item of row.channelMix ?? []) expect(item.sharePercent ?? null, 'sharePercent').toBeNull();
  expect(JSON.stringify(row.warnings ?? [])).not.toMatch(/cac|acquisition|budget|conversion|spend/i);
  expect(JSON.stringify(row.recommendations ?? [])).not.toMatch(/cac|acquisition|budget|conversion|spend/i);
  expect(JSON.stringify(row)).not.toMatch(FIGURES);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { KeyGenomeController } = await import('../src/modules/business-genome/key-genome/key-genome.controller');
  const { GenomeGrowthChannelService } = await import(
    '../src/modules/business-genome/key-genome/genome-growth-channel.service'
  );
  const { GenomeContentStrategyService } = await import(
    '../src/modules/business-genome/key-genome/genome-content-strategy.service'
  );
  const { MarketingGenomeService } = await import('../src/modules/business-genome/key-genome/marketing-genome.service');

  const stubTokens = await Promise.all([
    import('../src/modules/business-genome/key-genome/genome-signal.service').then((m) => m.GenomeSignalService),
    import('../src/modules/business-genome/key-genome/genome-recommendation.service').then(
      (m) => m.GenomeRecommendationService,
    ),
    import('../src/modules/business-genome/key-genome/genome-experiment.service').then(
      (m) => m.GenomeExperimentService,
    ),
    import('../src/modules/business-genome/key-genome/key-genome-governance.service').then(
      (m) => m.KeyGenomeGovernanceService,
    ),
    import('../src/modules/business-genome/key-genome/genome-memory.service').then((m) => m.GenomeMemoryService),
    import('../src/modules/business-genome/key-genome/genome-department.service').then(
      (m) => m.GenomeDepartmentService,
    ),
    import('../src/modules/business-genome/key-genome/department-readiness.service').then(
      (m) => m.DepartmentReadinessService,
    ),
    import('../src/modules/business-genome/key-genome/genome-financial-metric.service').then(
      (m) => m.GenomeFinancialMetricService,
    ),
    import('../src/modules/business-genome/key-genome/finance-genome.service').then((m) => m.FinanceGenomeService),
    import('../src/modules/business-genome/key-genome/genome-customer-segment.service').then(
      (m) => m.GenomeCustomerSegmentService,
    ),
    import('../src/modules/business-genome/key-genome/genome-sales-motion.service').then(
      (m) => m.GenomeSalesMotionService,
    ),
    import('../src/modules/business-genome/key-genome/customer-sales-genome.service').then(
      (m) => m.CustomerSalesGenomeService,
    ),
    import('../src/modules/business-genome/key-genome/genome-operational-process.service').then(
      (m) => m.GenomeOperationalProcessService,
    ),
    import('../src/modules/business-genome/key-genome/genome-delivery-capability.service').then(
      (m) => m.GenomeDeliveryCapabilityService,
    ),
    import('../src/modules/business-genome/key-genome/operations-genome.service').then(
      (m) => m.OperationsGenomeService,
    ),
    import('../src/modules/business-genome/key-genome/genome-cross-domain.service').then(
      (m) => m.GenomeCrossDomainService,
    ),
    import('../src/modules/business-genome/key-genome/genome-recommendation-ranker.service').then(
      (m) => m.GenomeRecommendationRankerService,
    ),
    import('../src/modules/business-genome/key-genome/genome-opportunity-detector.service').then(
      (m) => m.GenomeOpportunityDetectorService,
    ),
    import('../src/modules/business-genome/key-genome/genome-autonomy-gate.service').then(
      (m) => m.GenomeAutonomyGateService,
    ),
    import('../src/modules/business-genome/key-genome/genome-recommendation-outcome.service').then(
      (m) => m.GenomeRecommendationOutcomeService,
    ),
  ]);

  const built: Record<string, any> = {};
  const once = (name: string, make: () => any) => (built[name] ??= make());
  const channelsOf = (prisma: any) => once('channels', () => new GenomeGrowthChannelService(prisma));
  const strategiesOf = (prisma: any) => once('strategies', () => new GenomeContentStrategyService(prisma));
  const noop = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => null) });
  const marketingOf = (prisma: any) =>
    once(
      'marketing',
      () =>
        new MarketingGenomeService(
          prisma,
          channelsOf(prisma),
          strategiesOf(prisma),
          noop as any,
          noop as any,
          noop as any,
          noop as any,
        ),
    );
  const live = (token: any, make: (prisma: any) => any) => ({ provide: token, inject: [PrismaService], useFactory: make });

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyGenomeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      live(GenomeGrowthChannelService, channelsOf),
      live(GenomeContentStrategyService, strategiesOf),
      live(MarketingGenomeService, marketingOf),
      ...stubTokens.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  const prisma = moduleRef.get(PrismaService);
  marketing = moduleRef.get(MarketingGenomeService);
  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const id = req.headers[HEADER];
    if (typeof id === 'string' && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  for (const id of [ID.owner, ID.staffNone, ID.staffRead, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({
    data: { id: ID.biz, name: 'V80M Growth', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' },
  });
  await db.business.create({
    data: { id: ID.biz2, name: 'V80M Other', slug: `${P}biz2`, ownerId: ID.outsider, currency: 'TTD' },
  });
  for (const [user, biz, role, permissionScopes] of [
    [ID.owner, ID.biz, 'OWNER', undefined],
    [ID.staffNone, ID.biz, 'STAFF', { revenue: 'none', crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    [ID.staffRead, ID.biz, 'STAFF', { revenue: 'read', crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    [ID.outsider, ID.biz2, 'OWNER', undefined],
  ] as const) {
    await db.membership.create({
      data: { userId: user, businessId: biz, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }
  const channels = channelsOf(prisma);
  await channels.create(ID.biz, {
    key: 'ads',
    label: 'Paid ads',
    channelType: 'paid',
    status: 'ACTIVE',
    monthlyBudget: 1234.5,
    currency: 'TTD',
    targetCac: 87.65,
    targetConversionRate: 0.731,
  } as any);
  await channels.create(ID.biz, {
    key: 'seo',
    label: 'SEO',
    channelType: 'owned',
    status: 'ACTIVE',
    monthlyBudget: 300,
    currency: 'TTD',
    targetCac: 400,
    targetConversionRate: 0.02,
  } as any);
  // The owner's compute writes the snapshot every read below serves (its CAC above the warning threshold).
  await marketing.computeMarketingGrowthSnapshot(ID.biz);
}, 120_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('FU-GENOME-SURFACES-REVENUE round 2: marketing-growth money only to revenue readers', () => {
  it('MGR-01 channels are served without budget, CAC or conversion target', async () => {
    const list = await get(mg('/channels'), ID.staffNone);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    list.body.forEach(expectChannelProjected);
    expect(JSON.stringify(list.body)).not.toMatch(FIGURES);
    const created = await post(mg('/channels'), ID.staffNone, {
      key: 'email',
      label: 'Email',
      channelType: 'owned',
      status: 'ACTIVE',
      currency: 'TTD',
      monthlyBudget: 1234.5,
    });
    expect(created.status).toBeLessThan(300);
    expectChannelProjected(created.body);
    const updated = await patch(mg(`/channels/${created.body.id}`), ID.staffNone, { label: 'Email list' });
    expect(updated.status).toBeLessThan(300);
    expectChannelProjected(updated.body);
    expect(JSON.stringify(updated.body)).not.toMatch(FIGURES);
  });

  it('MGR-02 snapshots are served without CAC, lead volume, conversion, budget share or the risk read from them', async () => {
    const latest = await get(mg('/snapshot'), ID.staffNone);
    expect(latest.status).toBe(200);
    expectSnapshotProjected(latest.body);
    const list = await get(mg('/snapshots'), ID.staffNone);
    expect(list.body.length).toBeGreaterThan(0);
    list.body.forEach(expectSnapshotProjected);
    // riskLevel query filter is ignored for non-revenue readers to block oracle probing
    const probed = await get(mg('/snapshots?riskLevel=LOW'), ID.staffNone);
    expect(probed.status).toBe(200);
    expect(probed.body.length).toBe(list.body.length);
    probed.body.forEach(expectSnapshotProjected);
    const computed = await post(mg('/snapshot/compute'), ID.staffNone);
    expect(computed.status).toBeLessThan(300);
    expectSnapshotProjected(computed.body);
    // Regression pins for ISO-8601 computedAt collisions (run 46139929502 :13.734Z and unanchored :10.731Z).
    expectSnapshotProjected({ ...computed.body, computedAt: '2026-11-28T11:33:13.734Z' });
    expectSnapshotProjected({ ...computed.body, computedAt: '2026-11-28T11:33:10.731Z' });
    expect(JSON.stringify({ ...computed.body, funnelConversionEstimate: 0.731 })).toMatch(FIGURES);
  });

  it('MGR-03 the generated signals and recommendations answer no money row', async () => {
    const sig = vi.spyOn(marketing, 'generateMarketingGrowthSignals').mockResolvedValue([
      {
        id: `${P}s1`,
        sourceModule: 'marketing',
        section: 'MARKETING_GROWTH',
        domain: 'acquisition_cost',
        signalType: 'RISK',
        field: 'blended_cac',
        reason: 'CAC 87.65',
      },
      {
        id: `${P}s2`,
        sourceModule: 'marketing',
        section: 'MARKETING_GROWTH',
        domain: 'content',
        signalType: 'GAP',
        field: 'cadence',
        reason: 'No cadence',
      },
    ] as any);
    const rec = vi.spyOn(marketing, 'generateMarketingGrowthRecommendations').mockResolvedValue([
      { id: `${P}r1`, domain: 'MARKETING_GROWTH', title: 'Cut acquisition cost to 87.65', diagnosis: 'CAC high' },
      { id: `${P}r2`, domain: 'MARKETING_GROWTH', title: 'Publish weekly', diagnosis: 'Cadence' },
    ] as any);
    try {
      const signals = await post(mg('/signals/generate'), ID.staffNone);
      expect(signals.body.map((r: any) => r.id)).toEqual([`${P}s2`]);
      const recs = await post(mg('/recommendations/generate'), ID.staffNone);
      expect(recs.body.map((r: any) => r.id)).toEqual([`${P}r2`]);
      const owner = await post(mg('/signals/generate'), ID.owner);
      expect(owner.body).toHaveLength(2);
    } finally {
      sig.mockRestore();
      rec.mockRestore();
    }
  });

  it('MGR-04 controls: owner and revenue reader served every figure; outsider refused', async () => {
    for (const reader of [ID.owner, ID.staffRead]) {
      const list = await get(mg('/channels'), reader);
      const ads = list.body.find((c: any) => c.key === 'ads');
      expect(ads.monthlyBudget).toBe(1234.5);
      expect(ads.targetCac).toBe(87.65);
      expect(ads.targetConversionRate).toBe(0.731);
      expect(ads.withheldForRevenue).toBeUndefined();
      const snapshot = await get(mg('/snapshot'), reader);
      expect(typeof snapshot.body.blendedCac).toBe('number');
      expect(typeof snapshot.body.overallRisk).toBe('string');
    }
    const outsider = await get(mg('/channels'), ID.outsider);
    expect(outsider.status).toBe(403);
  });
});
