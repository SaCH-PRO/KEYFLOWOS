/**
 * P82 R1 Hardening Regression Spec — pins all 7 R1 security & correctness findings
 * (real FullBusinessContext.summary/bookings/genome/arrays, real BlueprintService.getBlueprintContext
 * summary with `revenue:`, buildOnboardingDirective completeness, buildOnboardingCard,
 * BlueprintData intelligence/registration/ownership/workflow/businessAssets/free-text,
 * moduleReadiness blockedReasons/optionalFacts/score recomputation, genomeFacts unclassified +
 * paired figure-word fields + provenance + riskProfile, and genomeIntegrity allowlist + dnaSections scrub).
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowOrchestratorService } from '../../ai/flow-orchestrator.service';
import {
  blueprintForReader,
  genomeFactsForReader,
  genomeIntegrityForReader,
  moduleReadinessForReader,
  v2ContextForReader,
} from '../genome-read-projections';

function makePrismaForRole(role: 'OWNER' | 'STAFF' | 'ADMIN', permissionScopes: Record<string, string> | null = null) {
  return {
    client: {
      user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER' })) },
      membership: { findUnique: vi.fn(async () => ({ role, permissionScopes })) },
      business: { findUnique: vi.fn(async () => ({ name: 'Maria Studio', businessIntent: 'Wellness studio', industry: 'Wellness', archetype: 'SERVICE_STUDIO' })) },
    },
  };
}

describe('P82 R1-1: v2ContextForReader projects real FullBusinessContext shapes without mutation', () => {
  it('strips summary.totalRevenueOutstanding, healthScore, money alerts, bookings.todayBookings.totalValue, genome.stageProgress/growthTrajectory, and money V2 arrays', () => {
    const raw = {
      commerce: { outstandingInvoices: { total: 18450, overdue: 3 }, collectionRate: 42 },
      summary: {
        totalRevenueOutstanding: 18450,
        healthScore: 41,
        alerts: ['3 overdue invoice(s) totaling $18,450', 'Collection rate is low (42%)', '2 bookings need confirmation'],
        pendingCount: 5,
      },
      bookings: {
        upcomingCount: 5,
        todayBookings: { count: 2, totalValue: 1700 },
      },
      genome: {
        dnaScores: { operations: 75, financial: 15, sales: 25 },
        currentStage: 'REVENUE_ENGINE',
        stageProgress: 65,
        growthTrajectory: 'SCALING',
        readinessScore: 42,
        recommendations: ['Raise retainer pricing by 15%', 'Standardize client check-in SOP'],
      },
      crm: {
        contactCount: 12,
        recentActivity: [{ summary: 'Sent $950 invoice to Maria' }, { summary: 'Confirmed Friday appointment' }],
        overdueTasks: [{ title: 'Follow up on overdue payment' }, { title: 'Prepare studio room' }],
      },
      temporal: {
        recentMemories: [{ content: 'Cash runway dropped to 2 months' }, { content: 'Studio opens at 9am' }],
      },
      autopilot: {
        activeTasks: [{ title: 'Collect unpaid invoice #104' }, { title: 'Send booking reminder' }],
      },
      inbox: {
        aiSummary: 'Customer asking about refund of $450 invoice',
        urgentMessages: [{ snippet: 'Where is my invoice refund?' }, { snippet: 'Can I reschedule Tuesday 2pm?' }],
      },
      device: {
        recentCaptures: [
          { detectedType: 'receipt', summary: 'Supplier receipt $220' },
          { detectedType: 'note', summary: 'Restock fresh towels' },
        ],
        linkedCommandItems: [{ title: 'Record $220 expense' }, { title: 'Update studio hours' }],
      },
    };
    const snapshotBefore = JSON.stringify(raw);

    const projected = v2ContextForReader(raw, false) as any;

    // Input MUST NOT be mutated
    expect(JSON.stringify(raw)).toBe(snapshotBefore);

    expect(projected.commerce).toBeUndefined();
    expect(projected.summary.totalRevenueOutstanding).toBeUndefined();
    expect(projected.summary.healthScore).toBeUndefined();
    expect(projected.summary.alerts).toEqual(['2 bookings need confirmation']);
    expect(projected.bookings.todayBookings).toEqual({ count: 2 });
    expect(projected.genome.currentStage).toBeUndefined();
    expect(projected.genome.stageProgress).toBeUndefined();
    expect(projected.genome.growthTrajectory).toBeUndefined();
    expect(projected.genome.readinessScore).toBeUndefined();
    expect(projected.genome.dnaScores).toEqual({ operations: 75 });
    expect(projected.genome.recommendations).toEqual(['Standardize client check-in SOP']);
    expect(projected.crm.recentActivity).toEqual([{ summary: 'Confirmed Friday appointment' }]);
    expect(projected.crm.overdueTasks).toEqual([{ title: 'Prepare studio room' }]);
    expect(projected.temporal.recentMemories).toEqual([{ content: 'Studio opens at 9am' }]);
    expect(projected.autopilot.activeTasks).toEqual([{ title: 'Send booking reminder' }]);
    expect(projected.inbox.aiSummary).toBeUndefined();
    expect(projected.inbox.urgentMessages).toEqual([{ snippet: 'Can I reschedule Tuesday 2pm?' }]);
    expect(projected.device.recentCaptures).toEqual([{ detectedType: 'note', summary: 'Restock fresh towels' }]);
    expect(projected.device.linkedCommandItems).toEqual([{ title: 'Update studio hours' }]);
  });
});

describe('P82 R1-2 & R1-6: FlowOrchestratorService buildBlueprintSection real summary, buildOnboardingDirective, and buildOnboardingCard', () => {
  function makeOrchestrator(role: 'OWNER' | 'STAFF', scopes: Record<string, string> | null) {
    const svc = Object.create(FlowOrchestratorService.prototype) as any;
    svc.prisma = makePrismaForRole(role, scopes);
    svc.blueprint = {
      getBlueprintContext: vi.fn(async () => ({
        completeness: 68,
        // Exact production format built by BlueprintService.getBlueprintContext()
        summary: 'Maria Studio (SERVICE_STUDIO) — revenue: Retainer + VIP packages; north star: Hit $500k ARR',
        identity: { name: 'Maria Studio', archetype: 'SERVICE_STUDIO', industry: 'Wellness', oneLiner: 'Holistic massage studio' },
        operatingModel: { revenueModel: 'Retainer + VIP packages', deliveryMode: 'In-person' },
        goals: { northStar: 'Hit $500k ARR', ninetyDayGoals: ['Raise prices 20%', 'Standardize booking SOP'] },
        constraints: { budgetRange: 'TTD 45000/mo', timeCommitment: 'Full-time' },
        brand: { voice: 'Warm' },
        customerModel: { idealCustomer: 'Busy professionals' },
        financials: { avgTicket: 'TTD 850' },
        registrationProfile: { missingRegistrationSteps: ['VAT filing', 'Signage permit'] },
        projectionProfile: { runwayMonths: 2.5 },
        riskProfile: { riskScore: 72 },
        executionRoadmap: { today: ['Chase $5000 overdue invoice', 'Confirm Friday bookings'] },
        complianceProfile: { complianceScore: 80 },
      })),
      calculateGenomeIntegrity: vi.fn(async () => ({
        genomeIntegrity: 45,
        genomeDnaScores: { founder: 80, operations: 70, financial: 10, sales: 20 },
        genomeDnaConfidence: { founder: 85, operations: 75, financial: 90, sales: 60 },
        genomeStage: 'REVENUE_ENGINE',
        threePillarMinimumMet: true,
        dnaSections: [
          { key: 'business', label: 'Business', integrity: 70, confidence: 75, summary: 'Missing: revenueModel, deliveryMode', fieldsCaptured: 2, fieldsTotal: 4, missingFields: ['revenueModel', 'deliveryMode'], recommendation: 'Add revenue model details' },
          { key: 'operations', label: 'Operations', integrity: 80, confidence: 80, summary: 'Well documented', fieldsCaptured: 4, fieldsTotal: 5, missingFields: ['sopDoc'], recommendation: 'Add SOP doc' },
          { key: 'financial', label: 'Financial', integrity: 10, confidence: 90, summary: 'Low cash', fieldsCaptured: 1, fieldsTotal: 5, missingFields: ['cashBalance'], recommendation: 'Fix cash' },
        ],
        executiveReadinessScore: 45,
        readinessBreakdown: { operations: 80, finance: 10, unknownDimension: 99 },
      })),
    };
    svc.genomeFacts = { listTopFacts: vi.fn(async () => []) };
    svc.getOnboardingConcierge = () => ({
      getSetupStatus: vi.fn(async () => ({ percentage: 75, payments: true, storefront: true, contacts: true })),
      getConciergeState: vi.fn(async () => ({ onboardingComplete: false, templateId: 'tpl_1' })),
    });
    svc.getBusinessGenesis = () => ({});
    return svc;
  }

  it('never leaks ctx.summary revenue clause, VAT filing, money goals, or complianceScore in buildBlueprintSection for non-revenue STAFF', async () => {
    const svc = makeOrchestrator('STAFF', { bookings: 'read', revenue: 'none' });
    const prompt: string = await svc.buildBlueprintSection('biz_A', 'u1');

    expect(prompt).toContain('Maria Studio');
    expect(prompt).toContain('Holistic massage studio');
    expect(prompt).toContain('Standardize booking SOP');
    expect(prompt).toContain('Signage permit');
    expect(prompt).toContain('Confirm Friday bookings');

    expect(prompt).not.toContain('Retainer + VIP packages');
    expect(prompt).not.toContain('$500k ARR');
    expect(prompt).not.toContain('Raise prices');
    expect(prompt).not.toContain('VAT filing');
    expect(prompt).not.toContain('$5000');
    expect(prompt).not.toContain('Compliance score: 80%');
  });

  it('omits completeness percentage in buildOnboardingDirective for non-revenue STAFF, keeps it for OWNER', async () => {
    const staffSvc = makeOrchestrator('STAFF', { settings: 'read', revenue: 'none' });
    const staffDir: string = await staffSvc.buildOnboardingDirective('biz_A', { route: '/app/onboarding' }, 'u1');
    expect(staffDir).not.toContain('68%');
    expect(staffDir).toContain('still in progress');

    const ownerSvc = makeOrchestrator('OWNER', null);
    const ownerDir: string = await ownerSvc.buildOnboardingDirective('biz_A', { route: '/app/onboarding' }, 'u1');
    expect(ownerDir).toContain('68%');
  });

  it('projects buildOnboardingCard (present_onboarding_card) and restricts financials card for non-revenue STAFF', async () => {
    const staffSvc = makeOrchestrator('STAFF', { settings: 'read', revenue: 'none' });

    const finCard = await staffSvc.buildOnboardingCard('biz_A', 'financials', undefined, 'u1');
    expect(finCard.data).toEqual({ restricted: true, stepHint: undefined });

    const nextCard = await staffSvc.buildOnboardingCard('biz_A', 'next', undefined, 'u1');
    const json = JSON.stringify(nextCard.data);
    expect(nextCard.data.setupStatus.percentage).toBeUndefined();
    expect(nextCard.data.blueprintCtx.financials).toBeUndefined();
    expect(nextCard.data.blueprintCtx.summary).toBeUndefined();
    expect(nextCard.data.genomeIntegrity.genomeStage).toBeUndefined();
    expect(nextCard.data.genomeIntegrity.genomeDnaScores.financial).toBeUndefined();
    expect(json).not.toContain('REVENUE_ENGINE');
    expect(json).not.toContain('Retainer + VIP packages');
    expect(json).not.toContain('TTD 850');
  });
});

describe('P82 R1-3, R1-4, R1-5, R1-7: blueprintForReader, moduleReadinessForReader, genomeFactsForReader, genomeIntegrityForReader', () => {
  it('blueprintForReader strips intelligence revenue proxies, registration VAT/BIR/bank, ownershipProfile, workflowModel revenue flags, businessAssets, and money free-text', () => {
    const bp = {
      identity: { businessName: 'Maria Studio', industry: 'Wellness' },
      intelligence: { expenseRatio: 0.42, quoteConversionRate: 0.35, recentMomentumScore: 88, activeStaffCount: 4 },
      registrationProfile: { vatStatus: 'REGISTERED', birStatus: 'ACTIVE', businessBankStatus: 'OPEN', missingRegistrationSteps: ['VAT filing', 'Signage permit'] },
      ownershipProfile: { hasPartners: true, owners: [{ name: 'Maria', sharePct: 60 }] },
      workflowModel: { retainerCycle: true, quoteDrivenSales: true, ecommerceFulfillment: true, usesAppointments: true },
      businessAssets: { secretValuation: 2500000 },
      complianceProfile: { complianceScore: 80, complianceItems: [{ label: 'Annual VAT return' }, { label: 'Health inspection' }] },
      goals: { northStar: 'Reach $1M annual revenue', ninetyDayGoals: ['Improve checkout pricing', 'Train front desk'] },
      documentProfile: { generatedDocuments: [{ title: '2026 Financial Projections' }, { title: 'Staff Onboarding Guide' }] },
    };

    const out = blueprintForReader(bp, false) as any;
    expect(out.ownershipProfile).toBeUndefined();
    expect(out.businessAssets).toBeUndefined();
    expect(out.intelligence).toEqual({ activeStaffCount: 4 });
    expect(out.registrationProfile).toEqual({ missingRegistrationSteps: ['Signage permit'] });
    expect(out.workflowModel).toEqual({ usesAppointments: true });
    expect(out.complianceProfile).toEqual({ complianceItems: [{ label: 'Health inspection' }] });
    expect(out.goals).toEqual({ ninetyDayGoals: ['Train front desk'] });
    expect(out.documentProfile).toEqual({ generatedDocuments: [{ title: 'Staff Onboarding Guide' }] });
  });

  it('moduleReadinessForReader withholds all-financial modules (reports), strips blockedReasons/optionalFacts, and recomputes score/automationAllowed/riskLevel', () => {
    const rows = [
      {
        module: 'reports',
        readinessScore: 33,
        automationAllowed: false,
        riskLevel: 'HIGH',
        requiredFacts: [{ section: 'FINANCIAL', domain: 'finance', field: 'currency', impact: 'BLOCKING', reason: 'Missing blocking fact: finance.currency' }],
        missingFacts: [{ section: 'FINANCIAL', domain: 'finance', field: 'currency', impact: 'BLOCKING', reason: 'Missing blocking fact: finance.currency' }],
        optionalFacts: [],
        blockedReasons: ['Missing blocking fact: finance.currency'],
        recommendedSetupActions: ['Set finance currency'],
      },
      {
        module: 'key_autonomy',
        readinessScore: 50,
        automationAllowed: false,
        riskLevel: 'HIGH',
        requiredFacts: [
          { section: 'OPERATIONS', domain: 'ops', field: 'hours', impact: 'BLOCKING', reason: 'Missing hours' },
          { section: 'BUSINESS_MODEL', domain: 'model', field: 'revenue_model', impact: 'BLOCKING', reason: 'Missing blocking fact: model.revenue_model' },
        ],
        missingFacts: [
          { section: 'BUSINESS_MODEL', domain: 'model', field: 'revenue_model', impact: 'BLOCKING', reason: 'Missing blocking fact: model.revenue_model' },
        ],
        optionalFacts: [
          { section: 'MARKETING', domain: 'marketing', field: 'ad_budget', impact: 'DEGRADED', reason: 'Missing ad_budget' },
          { section: 'OPERATIONS', domain: 'ops', field: 'sop', impact: 'DEGRADED', reason: 'Missing SOP' },
        ],
        blockedReasons: ['Missing blocking fact: model.revenue_model'],
        recommendedSetupActions: ['Configure revenue model', 'Review booking schedule'],
      },
    ];

    const out = moduleReadinessForReader(rows, false) as any[];
    expect(out.map((r) => r.module)).toEqual(['key_autonomy']);
    expect(out[0].readinessScore).toBe(100);
    expect(out[0].automationAllowed).toBe(true);
    expect(out[0].riskLevel).toBe('LOW');
    expect(out[0].missingFacts).toEqual([]);
    expect(out[0].blockedReasons).toEqual([]);
    expect(out[0].optionalFacts.map((f: any) => f.field)).toEqual(['sop']);
    expect(out[0].recommendedSetupActions).toEqual(['Review booking schedule']);
  });

  it('genomeFactsForReader fails closed on unclassified facts, paired figure-word fields, money provenance, and riskProfile facts', () => {
    const facts = [
      { id: 'f_unclass', section: 'general', domain: 'general', field: 'target', value: { raw: 125000 } },
      { id: 'f_hourly', section: 'OPERATIONS_DELIVERY', domain: 'service', field: 'hourlyRate', value: { raw: 250 } },
      { id: 'f_rent', section: 'OPERATIONS_DELIVERY', domain: 'ops', field: 'monthlyRent', value: { raw: 4200 } },
      { id: 'f_prov', section: 'OPERATIONS_DELIVERY', domain: 'ops', field: 'summary', sourceModule: 'commerce', value: { raw: 'Active' } },
      { id: 'f_risk', section: 'RISK_RESILIENCE', domain: 'riskProfile.riskScore', field: 'value', value: { raw: 72 } },
      { id: 'f_clean', section: 'OPERATIONS_DELIVERY', domain: 'ops', field: 'openingTime', value: { raw: 'Opens 9am' } },
    ];
    const out = genomeFactsForReader(facts, false);
    expect(out.map((f) => f.id)).toEqual(['f_clean']);
  });

  it('genomeIntegrityForReader enforces D-233 allowlist on readinessBreakdown and scrubs money missingFields/summary/recommendation on kept dnaSections', () => {
    const raw = {
      genomeIntegrity: 45,
      genomeDnaScores: { business: 70, operations: 80, financial: 10, unknownDim: 99 },
      genomeDnaConfidence: { business: 75, operations: 80, financial: 90, unknownDim: 99 },
      genomeStage: 'REVENUE_ENGINE',
      threePillarMinimumMet: true,
      dnaSections: [
        { key: 'business', label: 'Business', integrity: 70, confidence: 75, summary: 'Missing: revenueModel, deliveryMode', fieldsCaptured: 2, fieldsTotal: 4, missingFields: ['revenueModel', 'budgetRange', 'deliveryMode'], recommendation: 'Add revenue model' },
        { key: 'operations', label: 'Operations', integrity: 80, confidence: 80, summary: 'Good SOPs', fieldsCaptured: 4, fieldsTotal: 5, missingFields: ['sopDoc'], recommendation: 'Add SOP doc' },
        { key: 'financial', label: 'Financial', integrity: 10, confidence: 90, summary: 'Low cash', fieldsCaptured: 1, fieldsTotal: 5, missingFields: ['cashBalance'], recommendation: 'Fix cash' },
      ],
      executiveReadinessScore: 45,
      readinessBreakdown: { operations: 80, finance: 10, mysteryMetric: 77 },
    };

    const out = genomeIntegrityForReader(raw, false) as any;
    expect(out.readinessBreakdown).toEqual({ operations: 80 });
    expect(out.genomeDnaScores).toEqual({ business: 70, operations: 80 });
    const bizSection = out.dnaSections.find((s: any) => s.key === 'business');
    expect(bizSection.missingFields).toEqual(['deliveryMode']);
    expect(bizSection.summary).toBe('');
    expect(bizSection.recommendation).toBe('');
  });
});
