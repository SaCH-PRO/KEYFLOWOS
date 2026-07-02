import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BusinessGenesisService } from './business-genesis.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { GenesisProjectionService } from './projection-engine.service';
import { GenesisReadinessScorer } from './readiness-scorer.service';
import { GenesisActionPlanBuilder } from './action-plan-builder.service';
import { GenesisDocumentPackService } from './genesis-document-pack.service';
import { GenesisRiskRegisterService } from './genesis-risk-register.service';
import { GenomeFactService } from '../business-genome/key-genome/genome-fact.service';
import { GenomeEvidenceService } from '../business-genome/key-genome/genome-evidence.service';

describe('BusinessGenesisService', () => {
  let service: BusinessGenesisService;
  let blueprint: {
    inferFromOnboarding: ReturnType<typeof vi.fn>;
    updateBlueprint: ReturnType<typeof vi.fn>;
    getBlueprint: ReturnType<typeof vi.fn>;
  };
  let genomeFact: { upsertFact: ReturnType<typeof vi.fn>; prisma?: any };
  let genomeEvidence: { attachEvidence: ReturnType<typeof vi.fn> };
  let readiness: { calculate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    blueprint = {
      inferFromOnboarding: vi.fn(),
      updateBlueprint: vi.fn(),
      getBlueprint: vi.fn(),
    };
    genomeFact = {
      upsertFact: vi.fn(),
      prisma: { client: { genomeFact: { updateMany: vi.fn() } } },
    };
    genomeEvidence = { attachEvidence: vi.fn() };
    readiness = { calculate: vi.fn() };

    service = new BusinessGenesisService(
      blueprint as unknown as BlueprintService,
      {} as ModelGatewayService,
      {} as GenesisProjectionService,
      readiness as unknown as GenesisReadinessScorer,
      {} as GenesisActionPlanBuilder,
      {} as GenesisDocumentPackService,
      {} as GenesisRiskRegisterService,
      genomeFact as unknown as GenomeFactService,
      genomeEvidence as unknown as GenomeEvidenceService,
    );
  });

  it('submitAnswers writes genome facts and evidence for answered fields', async () => {
    blueprint.inferFromOnboarding.mockResolvedValue({
      identity: { name: 'Acme' },
      operatingModel: { revenueModel: 'subscription' },
      complianceProfile: { complianceItems: [] },
      readinessScore: 50,
    });
    blueprint.updateBlueprint.mockResolvedValue({
      businessId: 'b1',
      identity: { name: 'Acme' },
      operatingModel: { revenueModel: 'subscription' },
      complianceProfile: { complianceItems: [] },
      updatedAt: new Date(),
    });
    readiness.calculate.mockReturnValue({ overall: 50, legal: 50, finance: 50, market: 50, operations: 50, compliance: 50, blockers: [] });
    genomeFact.upsertFact.mockResolvedValue({ id: 'fact_1' });

    const result = await service.submitAnswers('b1', {
      'identity.name': 'Acme',
      'operatingModel.revenueModel': 'subscription',
      emptyField: '',
    });

    expect(result.readiness.overall).toBe(50);
    expect(genomeFact.upsertFact).toHaveBeenCalledTimes(2);
    expect(genomeFact.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'b1',
        section: 'identity',
        field: 'name',
        sourceType: 'BUSINESS_GENESIS',
      }),
    );
    expect(genomeEvidence.attachEvidence).toHaveBeenCalledTimes(2);
    expect(genomeEvidence.attachEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'b1', factId: 'fact_1', sourceModule: 'business_genesis' }),
    );
  });

  it('submitAnswers maps legacy flat keys to genome facts', async () => {
    blueprint.inferFromOnboarding.mockResolvedValue({
      identity: { name: 'Acme' },
      complianceProfile: { complianceItems: [] },
    });
    blueprint.updateBlueprint.mockResolvedValue({
      businessId: 'b1',
      identity: { name: 'Acme' },
      complianceProfile: { complianceItems: [] },
      updatedAt: new Date(),
    });
    readiness.calculate.mockReturnValue({ overall: 50, legal: 50, finance: 50, market: 50, operations: 50, compliance: 50, blockers: [] });
    genomeFact.upsertFact.mockResolvedValue({ id: 'fact_2' });

    await service.submitAnswers('b1', { businessName: 'Acme' });

    expect(genomeFact.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'b1',
        section: 'identity',
        field: 'name',
        value: { raw: 'Acme', type: 'JSON' },
      }),
    );
  });

  it('submitAnswers marks confirmed answers as USER_VERIFIED', async () => {
    blueprint.inferFromOnboarding.mockResolvedValue({
      identity: { name: 'Acme' },
      complianceProfile: { complianceItems: [] },
    });
    blueprint.updateBlueprint.mockResolvedValue({
      businessId: 'b1',
      identity: { name: 'Acme' },
      complianceProfile: { complianceItems: [] },
      updatedAt: new Date(),
    });
    readiness.calculate.mockReturnValue({ overall: 50, legal: 50, finance: 50, market: 50, operations: 50, compliance: 50, blockers: [] });
    genomeFact.upsertFact.mockResolvedValue({ id: 'fact_3' });

    await service.submitAnswers('b1', { 'identity.name': { value: 'Acme', confirmed: true } });

    expect(genomeFact.upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({ verificationStatus: 'USER_VERIFIED' }),
    );
  });
});
