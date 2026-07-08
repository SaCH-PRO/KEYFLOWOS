import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnboardingConciergeService } from './onboarding-concierge.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { CatalogService } from '../catalog/catalog.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { DemoDataSeederService } from './demo-data-seeder.service';
import type { BlueprintData } from '../blueprint/blueprint.types';

const EMPTY_BLUEPRINT = {
  legalProfile: {},
  registrationProfile: {},
  projectionProfile: {},
  customerModel: {},
  offerArchitecture: {},
  marketingSystem: {},
  operationsSystem: {},
  workflowModel: {},
  complianceProfile: {},
  aiPreferences: {},
} as unknown as BlueprintData;

const FULL_BLUEPRINT = {
  legalProfile: {
    recommendedEntityType: 'LIMITED_LIABILITY',
    disclaimerAcceptedAt: new Date().toISOString(),
  },
  registrationProfile: {
    companiesRegistryStatus: 'COMPLETED',
  },
  projectionProfile: {
    monthlyFixedCosts: 1000,
    breakEvenRevenue: 5000,
  },
  customerModel: {
    idealCustomer: 'Small businesses in Trinidad',
  },
  offerArchitecture: {
    coreOffer: { name: 'Test offer' },
  },
  marketingSystem: {
    channels: ['storefront'],
  },
  operationsSystem: {
    coreWorkflows: ['onboarding'],
  },
  workflowModel: {
    primaryWorkflow: 'Consult → Deliver → Invoice',
  },
  complianceProfile: {
    complianceItems: [{ status: 'DONE' }],
  },
  aiPreferences: {
    autonomyLevel: 3,
  },
} as unknown as BlueprintData;

function makeService(overrides: {
  business?: Record<string, unknown> | null;
  blueprint?: BlueprintData | null;
  productCount?: number;
  contactCount?: number;
  integrity?: { threePillarMinimumMet: boolean; genomeDnaScores?: Record<string, number> };
} = {}) {
  const tx = {
    product: {
      count: vi.fn().mockResolvedValue(overrides.productCount ?? 0),
    },
    business: {
      findUnique: vi.fn().mockResolvedValue(overrides.business ?? {}),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    contact: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'demo_contact_1' }),
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'demo_invoice_1', invoiceNumber: 'DEMO-001' }),
    },
  };

  const prisma = {
    client: {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
      business: {
        findUnique: vi.fn().mockResolvedValue(overrides.business ?? {}),
        update: vi.fn().mockResolvedValue({}),
      },
      product: {
        count: vi.fn().mockResolvedValue(overrides.productCount ?? 0),
      },
      contact: {
        count: vi.fn().mockResolvedValue(overrides.contactCount ?? 0),
      },
    },
  } as unknown as PrismaService;

  const aiUsage = {
    callAi: vi.fn().mockResolvedValue({ content: 'Hello! How can I help?' }),
  } as unknown as AiUsageService;

  const catalog = {
    createProduct: vi.fn().mockResolvedValue({ id: 'prod_1' }),
  } as unknown as CatalogService;

  const blueprint = {
    getBlueprint: vi.fn().mockResolvedValue(overrides.blueprint ?? null),
    inferFromOnboarding: vi.fn().mockResolvedValue({}),
    calculateGenomeIntegrity: vi.fn().mockResolvedValue({
      threePillarMinimumMet: overrides.integrity?.threePillarMinimumMet ?? true,
      genomeIntegrity: 75,
      genomeDnaScores: overrides.integrity?.genomeDnaScores ?? { founder: 80, business: 80, market: 80 },
    }),
  } as unknown as BlueprintService;

  const demoSeeder = {
    seedDemoData: vi.fn().mockResolvedValue({ contactId: 'c1', invoiceId: 'i1', invoiceNumber: 'DEMO-001' }),
  } as unknown as DemoDataSeederService;

  const service = new OnboardingConciergeService(prisma, aiUsage, catalog, blueprint, demoSeeder);

  return { service, prisma, tx, aiUsage, catalog, blueprint, demoSeeder };
}

describe('OnboardingConciergeService', () => {
  describe('getSetupStatus', () => {
    it('returns 0% for a brand-new business', async () => {
      const { service } = makeService();
      const status = await service.getSetupStatus('biz_1');
      expect(status.percentage).toBe(0);
      expect(status.products).toBe(false);
      expect(status.businessHours).toBe(false);
    });

    it('returns 100% when all setup fields are populated', async () => {
      const { service } = makeService({
        business: {
          name: 'Acme',
          phone: '123',
          businessHours: { mon: { open: '09:00', close: '17:00', closed: false } },
          storeEnabled: true,
          slug: 'acme',
          metaData: { paymentMethodsConfigured: true },
        },
        blueprint: FULL_BLUEPRINT,
        productCount: 1,
        contactCount: 1,
      });
      const status = await service.getSetupStatus('biz_1');
      expect(status.percentage).toBe(100);
    });

    it('handles a missing blueprint gracefully', async () => {
      const { service } = makeService({ business: { name: 'Acme', email: 'a@b.com' } });
      const status = await service.getSetupStatus('biz_1');
      expect(status.legalProfile).toBe(false);
      expect(status.percentage).toBeGreaterThan(0);
    });
  });

  describe('getAvailableTemplates', () => {
    it('returns a list of templates with id, label and keywords', () => {
      const { service } = makeService();
      const templates = service.getAvailableTemplates();
      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0]).toHaveProperty('id');
      expect(templates[0]).toHaveProperty('label');
      expect(templates[0]).toHaveProperty('keywords');
    });
  });

  describe('getTemplatePreview', () => {
    it('returns a preview for a valid template', () => {
      const { service } = makeService();
      const preview = service.getTemplatePreview('consulting');
      expect(preview.id).toBe('consulting');
      expect(preview.products.length).toBeGreaterThan(0);
    });

    it('throws NotFoundException for an unknown template', () => {
      const { service } = makeService();
      expect(() => service.getTemplatePreview('unknown-template')).toThrow(NotFoundException);
    });
  });

  describe('autoConfigureFromTemplate', () => {
    it('creates products, hours, payments and storefront for an empty business', async () => {
      const { service, tx, catalog } = makeService({ business: { metaData: {}, storeEnabled: false } });
      const result = await service.autoConfigureFromTemplate('biz_1', 'consulting');

      expect(result.productsCreated).toBeGreaterThan(0);
      expect(result.businessHoursSet).toBe(true);
      expect(result.paymentMethodsSet).toBe(true);
      expect(result.storefrontEnabled).toBe(true);
      expect(catalog.createProduct).toHaveBeenCalled();
      expect(tx.business.update).toHaveBeenCalled();
    });

    it('skips product creation when products already exist', async () => {
      const { service, catalog } = makeService({ business: { metaData: {} }, productCount: 2 });
      const result = await service.autoConfigureFromTemplate('biz_1', 'consulting');

      expect(result.productsSkipped).toBe(true);
      expect(result.productsCreated).toBe(0);
      expect(catalog.createProduct).not.toHaveBeenCalled();
    });

    it('updates business name when customBusinessName is provided', async () => {
      const { service, tx } = makeService({ business: { metaData: {} } });
      await service.autoConfigureFromTemplate('biz_1', 'consulting', { customBusinessName: 'Custom Name ' });

      expect(tx.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Custom Name' }),
        }),
      );
    });

    it('throws NotFoundException for an unknown template', async () => {
      const { service } = makeService();
      await expect(service.autoConfigureFromTemplate('biz_1', 'unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('detectBusinessType', () => {
    it('returns high confidence when multiple keywords match', async () => {
      const { service } = makeService();
      const result = await service.detectBusinessType('biz_1', 'I run a consulting agency offering professional services');
      expect(result.confidence).toBe('high');
    });

    it('returns low confidence with no matches and falls back to consulting', async () => {
      const { service } = makeService();
      const result = await service.detectBusinessType('biz_1', 'xyz qwerty 12345');
      expect(result.confidence).toBe('low');
      expect(result.template.id).toBe('consulting');
    });
  });

  describe('generateConciergeResponse', () => {
    it('throws BadRequestException for an empty message', async () => {
      const { service } = makeService();
      await expect(service.generateConciergeResponse('biz_1', '', [])).rejects.toThrow(BadRequestException);
    });

    it('calls AI and returns a parsed response', async () => {
      const { service, aiUsage } = makeService();
      const result = await service.generateConciergeResponse('biz_1', 'Hi', []);
      expect(aiUsage.callAi).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'onboarding_concierge', businessId: 'biz_1' }),
      );
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello! How can I help?');
    });

    it('returns a fallback response when AI fails', async () => {
      const { service, aiUsage } = makeService();
      aiUsage.callAi = vi.fn().mockRejectedValue(new Error('AI down'));
      const result = await service.generateConciergeResponse('biz_1', 'Hi', []);
      expect(result.role).toBe('assistant');
      expect(result.content).toBeTruthy();
    });
  });

  describe('getWelcomeMessage', () => {
    it('returns a generic welcome when there is no business intent', async () => {
      const { service } = makeService();
      const msg = await service.getWelcomeMessage('biz_1');
      expect(msg.content).toContain('Welcome');
    });

    it('returns an intent-aware welcome when businessIntent exists', async () => {
      const { service } = makeService({ business: { businessIntent: 'sell handmade jewelry', industry: 'retail' } });
      const msg = await service.getWelcomeMessage('biz_1');
      expect(msg.content.toLowerCase()).toContain('retail');
    });
  });

  describe('markOnboardingComplete', () => {
    it('throws ForbiddenException when the three-pillar minimum is not met', async () => {
      const { service } = makeService({
        integrity: { threePillarMinimumMet: false, genomeDnaScores: { founder: 30, business: 80, market: 80 } },
      });
      await expect(service.markOnboardingComplete('biz_1')).rejects.toThrow(ForbiddenException);
    });

    it('marks onboarding complete and seeds demo data when the gate passes', async () => {
      const { service, prisma, demoSeeder } = makeService({ integrity: { threePillarMinimumMet: true } });
      const result = await service.markOnboardingComplete('biz_1');

      expect(result.complete).toBe(true);
      expect(demoSeeder.seedDemoData).toHaveBeenCalledWith('biz_1', expect.any(Object));
      expect(prisma.client.$transaction).toHaveBeenCalled();
    });
  });

  describe('nudge lifecycle', () => {
    it('snoozes a nudge by updating metadata', async () => {
      const { service, prisma } = makeService({
        business: { metaData: { conciergeNudges: [{ id: 'n1', snoozed: false }] } },
      });
      const result = await service.snoozeNudge('biz_1', 'n1', 7);
      expect(result.snoozed).toBe(true);
      expect(prisma.client.business.update).toHaveBeenCalled();
    });

    it('dismisses concierge via metadata', async () => {
      const { service, prisma } = makeService();
      const result = await service.dismissConcierge('biz_1');
      expect(result.dismissed).toBe(true);
      expect(prisma.client.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metaData: expect.objectContaining({ conciergeDismissed: true }),
          }),
        }),
      );
    });

    it('resumes concierge via metadata', async () => {
      const { service, prisma } = makeService({ business: { metaData: { conciergeDismissed: true } } });
      const result = await service.resumeConcierge('biz_1');
      expect(result.resumed).toBe(true);
      expect(prisma.client.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metaData: expect.objectContaining({ conciergeDismissed: false }),
          }),
        }),
      );
    });
  });
});
