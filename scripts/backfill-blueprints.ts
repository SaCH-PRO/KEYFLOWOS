/**
 * KEY-1 backfill — seeds a BusinessBlueprint row for every existing
 * Business by mining the legacy Business profile fields and the
 * BusinessGuidanceProfile sub-tables.
 *
 * Idempotent and *safe by default*: when a blueprint already exists, the
 * inferred values are deep-merged behind any existing operator-confirmed
 * keys (existing wins). Pass `FORCE=1` to overwrite existing keys with
 * the freshly inferred values — only do this if you know operators have
 * not edited anything.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/backfill-blueprints.ts              # all, safe merge
 *   pnpm tsx scripts/backfill-blueprints.ts <bizId>      # one business
 *   FORCE=1 pnpm tsx scripts/backfill-blueprints.ts      # overwrite mode
 *   DRY_RUN=1 pnpm tsx scripts/backfill-blueprints.ts    # plan only
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.env.DRY_RUN === '1';
  const force = process.env.FORCE === '1';
  const onlyId = process.argv[2];

  const businesses = await prisma.business.findMany({
    where: onlyId ? { id: onlyId } : undefined,
    select: { id: true, name: true },
  });

  console.log(
    `[blueprint:backfill] ${dryRun ? 'DRY ' : ''}processing ${businesses.length} business${businesses.length === 1 ? '' : 'es'}`,
  );

  let seeded = 0;
  let updated = 0;
  let skipped = 0;

  for (const biz of businesses) {
    const existing = await prisma.businessBlueprint.findUnique({
      where: { businessId: biz.id },
    });

    const business = await prisma.business.findUnique({
      where: { id: biz.id },
      select: {
        name: true,
        tagline: true,
        description: true,
        archetype: true,
        industry: true,
        country: true,
        primaryColor: true,
        secondaryColor: true,
        revenueModel: true,
        teamSize: true,
        timeCommitment: true,
        positioningStatement: true,
        bio: true,
      },
    });

    const guidance = await prisma.businessGuidanceProfile.findUnique({
      where: { businessId: biz.id },
      include: {
        identity: true,
        offer: true,
        customer: true,
        revenue: true,
        goals: true,
      },
    });

    if (!business) {
      skipped++;
      continue;
    }

    const identity: Record<string, unknown> = {
      ...(business.name && { name: business.name }),
      ...(business.tagline && { tagline: business.tagline }),
      ...(business.description && { story: business.description }),
      ...(business.archetype && { archetype: business.archetype }),
      ...(business.industry && { industry: business.industry }),
      ...(business.country && { country: business.country }),
      ...(guidance?.identity?.missionStatement && { missionStatement: guidance.identity.missionStatement }),
      ...(guidance?.identity?.visionStatement && { visionStatement: guidance.identity.visionStatement }),
    };

    const operatingModel: Record<string, unknown> = {
      ...(business.revenueModel && { revenueModel: business.revenueModel }),
      ...(business.teamSize && { teamSize: business.teamSize }),
      ...(business.timeCommitment && { timeCommitment: business.timeCommitment }),
      ...(guidance?.offer?.deliveryMethod && { deliveryMethod: guidance.offer.deliveryMethod }),
      ...(guidance?.offer?.pricingModel && { pricingModel: guidance.offer.pricingModel }),
    };

    const brand: Record<string, unknown> = {
      ...(business.primaryColor && { primaryColor: business.primaryColor }),
      ...(business.secondaryColor && { secondaryColor: business.secondaryColor }),
      ...(business.positioningStatement && { positioningStatement: business.positioningStatement }),
      ...(guidance?.identity?.brandPersonality && { voice: guidance.identity.brandPersonality }),
    };

    const customerModel: Record<string, unknown> = {
      ...(guidance?.customer?.targetDemographic && { demographics: guidance.customer.targetDemographic }),
      ...(guidance?.customer?.customerPainPoints?.length && { painPoints: guidance.customer.customerPainPoints }),
      ...(guidance?.customer?.acquisitionChannels?.length && {
        acquisitionChannels: guidance.customer.acquisitionChannels,
      }),
      ...(guidance?.customer?.customerLifetimeValue != null && {
        lifetimeValueTtd: guidance.customer.customerLifetimeValue,
      }),
    };

    const financials: Record<string, unknown> =
      guidance?.offer?.priceRangeLow != null || guidance?.offer?.priceRangeHigh != null
        ? {
            priceRange: {
              low: guidance?.offer?.priceRangeLow ?? null,
              high: guidance?.offer?.priceRangeHigh ?? null,
            },
            ...(guidance?.offer?.marginPercent != null && { avgMargin: guidance.offer.marginPercent }),
          }
        : {};

    const completeness = scoreCompleteness({
      identity,
      operatingModel,
      brand,
      customerModel,
      financials,
    });

    if (dryRun) {
      const mode = existing ? (force ? 'OVERWRITE' : 'safe-merge') : 'seed';
      console.log(`  ${mode} ${biz.id} (${biz.name}) — completeness ${completeness}%`);
      if (existing) updated++;
      else seeded++;
      continue;
    }

    if (existing) {
      // Safe by default: existing operator-confirmed keys win. In FORCE
      // mode, the inferred values overwrite any existing keys.
      const mergedIdentity = force
        ? { ...(existing.identity as Record<string, unknown>), ...identity }
        : { ...identity, ...(existing.identity as Record<string, unknown>) };
      const mergedOperatingModel = force
        ? { ...(existing.operatingModel as Record<string, unknown>), ...operatingModel }
        : { ...operatingModel, ...(existing.operatingModel as Record<string, unknown>) };
      const mergedBrand = force
        ? { ...(existing.brand as Record<string, unknown>), ...brand }
        : { ...brand, ...(existing.brand as Record<string, unknown>) };
      const mergedCustomerModel = force
        ? { ...(existing.customerModel as Record<string, unknown>), ...customerModel }
        : { ...customerModel, ...(existing.customerModel as Record<string, unknown>) };
      const mergedFinancials = force
        ? { ...(existing.financials as Record<string, unknown>), ...financials }
        : { ...financials, ...(existing.financials as Record<string, unknown>) };

      const mergedCompleteness = scoreCompleteness({
        identity: mergedIdentity,
        operatingModel: mergedOperatingModel,
        brand: mergedBrand,
        customerModel: mergedCustomerModel,
        financials: mergedFinancials,
        goals: (existing.goals as Record<string, unknown>) ?? {},
        constraints: (existing.constraints as Record<string, unknown>) ?? {},
      });

      await prisma.businessBlueprint.update({
        where: { businessId: biz.id },
        data: {
          identity: mergedIdentity,
          operatingModel: mergedOperatingModel,
          brand: mergedBrand,
          customerModel: mergedCustomerModel,
          financials: mergedFinancials,
          completeness: mergedCompleteness,
        },
      });
      updated++;
    } else {
      await prisma.businessBlueprint.create({
        data: {
          businessId: biz.id,
          identity: identity,
          operatingModel: operatingModel,
          brand: brand,
          customerModel: customerModel,
          financials: financials,
          completeness,
        },
      });
      seeded++;
    }
  }

  console.log(
    `[blueprint:backfill] done — seeded=${seeded} updated=${updated} skipped=${skipped} dryRun=${dryRun} force=${force}`,
  );

  await prisma.$disconnect();
}

const SECTION_WEIGHTS = {
  identity: 25,
  operatingModel: 20,
  goals: 15,
  customerModel: 15,
  brand: 10,
  financials: 10,
  constraints: 5,
} as const;

const SECTION_FIELDS: Record<keyof typeof SECTION_WEIGHTS, string[]> = {
  identity: ['name', 'archetype', 'industry', 'tagline', 'missionStatement'],
  operatingModel: ['revenueModel', 'deliveryMethod', 'teamSize', 'timeCommitment', 'pricingModel'],
  goals: ['primaryGoal', 'northStarMetric', 'horizonMonths', 'revenueTarget'],
  customerModel: ['targetSegments', 'painPoints', 'acquisitionChannels', 'demographics'],
  brand: ['primaryColor', 'voice', 'positioningStatement', 'keywords'],
  financials: ['priceRange', 'avgMargin', 'cashPositionTier'],
  constraints: ['budgetCeiling', 'timeAvailable', 'doNotDoList'],
};

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isFilled);
  return Boolean(value);
}

function scoreCompleteness(bp: Record<string, Record<string, unknown>>): number {
  let score = 0;
  for (const key of Object.keys(SECTION_WEIGHTS) as Array<keyof typeof SECTION_WEIGHTS>) {
    const sectionWeight = SECTION_WEIGHTS[key];
    const fields = SECTION_FIELDS[key];
    const sectionData = bp[key] ?? {};
    const filled = fields.filter((f) => isFilled(sectionData[f])).length;
    score += sectionWeight * (filled / fields.length);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

main().catch((err) => {
  console.error('[blueprint:backfill] failed:', err);
  process.exit(1);
});
