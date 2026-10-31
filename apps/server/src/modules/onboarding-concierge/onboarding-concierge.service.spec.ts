import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnboardingConciergeService } from './onboarding-concierge.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { CatalogService } from '../catalog/catalog.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { DemoDataSeederService } from './demo-data-seeder.service';
import type { BlueprintData } from '../blueprint/blueprint.types';
import { runWithTenant } from '../../core/tenant/tenant-context';

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
  membership?: { role: string; permissionScopes?: Record<string, string> | null } | null;
  userRole?: string;
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
    teamActivityLog: {
      create: vi.fn().mockResolvedValue({}),
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
      membership: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.membership === undefined ? { role: 'OWNER', permissionScopes: null } : overrides.membership,
        ),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: overrides.userRole ?? 'USER' }),
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
    // Owner ruling D-03: the gate is the minimal profile (name, currency,
    // timezone); the three-pillar minimum is a recommendation, not a gate.
    const minimalProfile = { name: 'Biz One', currency: 'TTD', timezone: 'America/Port_of_Spain' };
    // The request's tenant context, as TenantInterceptor binds it for POST /complete.
    const asUser = <T>(userId: string, fn: () => Promise<T>, businessId = 'biz_1') => runWithTenant(businessId, userId, fn);

    it('throws ForbiddenException listing the missing fields when the minimal profile is absent (D-03)', async () => {
      const { service, prisma, demoSeeder } = makeService({ integrity: { threePillarMinimumMet: true } });
      const error = await asUser('user_owner', () => service.markOnboardingComplete('biz_1')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'ONBOARDING_PROFILE_INCOMPLETE',
        missingFields: ['name', 'currency', 'timezone'],
      });
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(demoSeeder.seedDemoData).not.toHaveBeenCalled();
    });

    it('a three-pillar score below the minimum no longer blocks completion (D-03)', async () => {
      const { service, demoSeeder } = makeService({
        business: minimalProfile,
        integrity: { threePillarMinimumMet: false, genomeDnaScores: { founder: 30, business: 80, market: 80 } },
      });
      const result = await asUser('user_owner', () => service.markOnboardingComplete('biz_1'));
      expect(result.complete).toBe(true);
      expect(demoSeeder.seedDemoData).toHaveBeenCalledWith('biz_1', expect.any(Object));
      expect(result).toMatchObject({ genomeRecommendation: { threePillarMinimumMet: false, missingPillars: ['founder'] } });
    });

    it('marks onboarding complete and seeds demo data when the gate passes', async () => {
      const { service, prisma, demoSeeder } = makeService({ business: minimalProfile, integrity: { threePillarMinimumMet: true } });
      const result = await asUser('user_owner', () => service.markOnboardingComplete('biz_1'));

      expect(result.complete).toBe(true);
      expect(demoSeeder.seedDemoData).toHaveBeenCalledWith('biz_1', expect.any(Object));
      expect(prisma.client.$transaction).toHaveBeenCalled();
    });

    // Review ST-R032-1: completion needs the owner or settings write access,
    // and the actor is recorded in the completion transaction.
    const expectRefused = (error: unknown, prisma: PrismaService, demoSeeder: DemoDataSeederService) => {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'ONBOARDING_COMPLETE_FORBIDDEN' });
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(demoSeeder.seedDemoData).not.toHaveBeenCalled();
    };

    it('ST-R032-1: a STAFF member with role-default scopes (settings none) is refused before anything is written', async () => {
      const { service, prisma, demoSeeder } = makeService({ business: minimalProfile, membership: { role: 'STAFF', permissionScopes: null } });
      const error = await asUser('user_staff', () => service.markOnboardingComplete('biz_1')).catch((e: unknown) => e);
      expectRefused(error, prisma, demoSeeder);
    });

    it('ST-R032-1: an explicit scope map with settings read only is refused', async () => {
      const { service, prisma, demoSeeder } = makeService({
        business: minimalProfile,
        membership: { role: 'ADMIN', permissionScopes: { settings: 'read', crm: 'admin' } },
      });
      const error = await asUser('user_admin', () => service.markOnboardingComplete('biz_1')).catch((e: unknown) => e);
      expectRefused(error, prisma, demoSeeder);
    });

    it('ST-R032-1: the replay of an already-complete business is refused to a member without settings write', async () => {
      const { service, prisma, demoSeeder } = makeService({
        business: { ...minimalProfile, onboardingComplete: true, onboardingCompletedAt: new Date() },
        membership: { role: 'STAFF', permissionScopes: null },
      });
      const error = await asUser('user_staff', () => service.markOnboardingComplete('biz_1')).catch((e: unknown) => e);
      expectRefused(error, prisma, demoSeeder);
    });

    it('ST-R032-1: without a request tenant context, or with one for another business, completion fails closed', async () => {
      const none = makeService({ business: minimalProfile });
      expectRefused(await none.service.markOnboardingComplete('biz_1').catch((e: unknown) => e), none.prisma, none.demoSeeder);
      const other = makeService({ business: minimalProfile });
      const error = await asUser('user_owner', () => other.service.markOnboardingComplete('biz_1'), 'biz_2').catch((e: unknown) => e);
      expectRefused(error, other.prisma, other.demoSeeder);
    });

    it('ST-R032-1: a non-member who is not the owner is refused', async () => {
      const { service, prisma, demoSeeder } = makeService({ business: minimalProfile, membership: null });
      const error = await asUser('user_stranger', () => service.markOnboardingComplete('biz_1')).catch((e: unknown) => e);
      expectRefused(error, prisma, demoSeeder);
    });

    it.each([
      ['the business owner (ownerId, no membership row)', { business: { ...minimalProfile, ownerId: 'user_x' }, membership: null }],
      ['an OWNER membership', { business: minimalProfile, membership: { role: 'OWNER', permissionScopes: { settings: 'none' } } }],
      ['an ADMIN with role-default scopes', { business: minimalProfile, membership: { role: 'ADMIN', permissionScopes: null } }],
      ['a STAFF member granted settings:write', { business: minimalProfile, membership: { role: 'STAFF', permissionScopes: { settings: 'write' } } }],
      ['a SUPER_ADMIN without a membership', { business: minimalProfile, membership: null, userRole: 'SUPER_ADMIN' }],
    ])('ST-R032-1: %s may complete, and the completion is recorded against them', async (_label, overrides) => {
      const { service, tx } = makeService(overrides as Parameters<typeof makeService>[0]);
      const result = await asUser('user_x', () => service.markOnboardingComplete('biz_1'));
      expect(result.complete).toBe(true);
      expect(tx.teamActivityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          businessId: 'biz_1',
          userId: 'user_x',
          module: 'settings',
          action: 'onboarding_completed',
          entityType: 'business',
          entityId: 'biz_1',
          meta: { demoContactId: 'c1', demoInvoiceId: 'i1', demoInvoiceNumber: 'DEMO-001' },
        }),
      });
    });

    it('ST-R032-1: the legal disclaimer acceptance this completion records is attributed to the actor', async () => {
      const { service, tx, blueprint } = makeService({ business: minimalProfile, blueprint: EMPTY_BLUEPRINT });
      (blueprint as unknown as { updateBlueprint: unknown }).updateBlueprint = vi.fn().mockResolvedValue({});
      await asUser('user_owner', () => service.markOnboardingComplete('biz_1'));
      const rows = tx.teamActivityLog.create.mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data);
      expect(rows).toEqual([
        expect.objectContaining({ action: 'onboarding_completed', userId: 'user_owner' }),
        expect.objectContaining({ action: 'legal_disclaimer_accepted', userId: 'user_owner', meta: { disclaimerAcceptedAt: expect.any(String) } }),
      ]);
    });

    // Review ST-R032-2: the D-03 invariant "onboarding completes only on a valid
    // minimal profile, by an authorised actor" holds on POST /complete, but the
    // generic profile PATCH still bypasses it. The fix is outside this packet's
    // write set (identity.controller.ts, identity.service.ts:351,
    // dto/update-business.dto.ts) and is R0-09-ID-HARDEN's (D-11 owner-only profile).
    it.todo(
      'ST-R032-2: PATCH /identity/businesses/:id cannot set onboardingComplete or blank name/currency/timezone, and STAFF cannot change them (R0-09-ID-HARDEN)',
    );

    it('ST-R032-1: a disclaimer accepted earlier is not re-attributed', async () => {
      const { service, tx } = makeService({ business: minimalProfile, blueprint: FULL_BLUEPRINT });
      await asUser('user_owner', () => service.markOnboardingComplete('biz_1'));
      expect(tx.teamActivityLog.create).toHaveBeenCalledTimes(1);
      expect((tx.teamActivityLog.create.mock.calls[0][0] as { data: { action: string } }).data.action).toBe('onboarding_completed');
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
