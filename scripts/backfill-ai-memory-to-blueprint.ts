/**
 * Backfill legacy AiMemory profile interview rows into the canonical
 * BusinessBlueprint (Business Genome).
 *
 * Sources data collected by ProfileIntelligenceService:
 *   - category 'goals'       → blueprint.goals
 *   - category 'tone'        → blueprint.brand.tone
 *   - category 'riskTolerance' → blueprint.constraints.riskTolerance
 *   - category 'outreachStyle' → blueprint.aiPreferences.outreachStyle
 *   - category 'reportingCadence' → blueprint.aiPreferences.reportingCadence
 *   - category 'priorities'  → blueprint.goals.priorities
 *
 * Safe by default: existing blueprint values win. Pass FORCE=1 to overwrite.
 * Pass DRY_RUN=1 to preview. Pass a business id as the first arg to target one.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-ai-memory-to-blueprint.ts
 *   pnpm tsx scripts/backfill-ai-memory-to-blueprint.ts <bizId>
 *   FORCE=1 pnpm tsx scripts/backfill-ai-memory-to-blueprint.ts
 *   DRY_RUN=1 pnpm tsx scripts/backfill-ai-memory-to-blueprint.ts
 */

import { PrismaClient } from '@prisma/client';

const PROFILE_CATEGORIES = [
  'goals',
  'tone',
  'riskTolerance',
  'outreachStyle',
  'reportingCadence',
  'priorities',
];

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.env.DRY_RUN === '1';
  const force = process.env.FORCE === '1';
  const onlyId = process.argv[2];

  try {
    const businesses = await prisma.business.findMany({
      where: onlyId ? { id: onlyId } : undefined,
      select: { id: true, name: true },
    });

    console.log(
      `[ai-memory:backfill] ${dryRun ? 'DRY ' : ''}processing ${businesses.length} business${businesses.length === 1 ? '' : 'es'}`,
    );

    let updated = 0;
    let skipped = 0;

    for (const biz of businesses) {
      const memories = await prisma.aiMemory.findMany({
        where: {
          businessId: biz.id,
          category: { in: PROFILE_CATEGORIES },
        },
      });

      if (memories.length === 0) {
        skipped++;
        continue;
      }

      let existing = await prisma.businessBlueprint.findUnique({
        where: { businessId: biz.id },
      });

      if (!existing) {
        existing = await prisma.businessBlueprint.create({
          data: {
            businessId: biz.id,
            sections: {},
            completeness: 0,
            confidenceScores: {},
          },
        });
      }

      const sections = (existing.sections ?? {}) as Record<string, Record<string, unknown>>;

      const goals: Record<string, unknown> = { ...(sections.goals ?? {}) };
      const brand: Record<string, unknown> = { ...(sections.brand ?? {}) };
      const constraints: Record<string, unknown> = { ...(sections.constraints ?? {}) };
      const aiPreferences: Record<string, unknown> = { ...(sections.aiPreferences ?? {}) };

      const goalValues: string[] = [];
      const priorityValues: string[] = [];

      for (const mem of memories) {
        const value = String(mem.value ?? '');
        if (!value) continue;

        switch (mem.category) {
          case 'goals':
            goalValues.push(value);
            break;
          case 'priorities':
            priorityValues.push(value);
            break;
          case 'tone':
            if (force || !brand.tone) brand.tone = value;
            break;
          case 'riskTolerance':
            if (force || !constraints.riskTolerance) constraints.riskTolerance = value;
            break;
          case 'outreachStyle':
            if (force || !aiPreferences.outreachStyle) aiPreferences.outreachStyle = value;
            break;
          case 'reportingCadence':
            if (force || !aiPreferences.reportingCadence) aiPreferences.reportingCadence = value;
            break;
        }
      }

      if (goalValues.length > 0 && (force || !goals.northStar)) {
        goals.northStar = goalValues[0];
      }
      if (goalValues.length > 1 && (force || !(goals.twelveMonthGoals as string[])?.length)) {
        goals.twelveMonthGoals = goalValues.slice(1);
      }
      if (priorityValues.length > 0 && (force || !(goals.priorities as string[])?.length)) {
        goals.priorities = priorityValues;
      }

      const patch: Record<string, Record<string, unknown>> = {};
      if (Object.keys(goals).length > 0) patch.goals = goals;
      if (Object.keys(brand).length > 0) patch.brand = brand;
      if (Object.keys(constraints).length > 0) patch.constraints = constraints;
      if (Object.keys(aiPreferences).length > 0) patch.aiPreferences = aiPreferences;

      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`[ai-memory:backfill] ${biz.id} (${biz.name ?? 'unnamed'}) would update:`, JSON.stringify(patch));
        updated++;
        continue;
      }

      await prisma.businessBlueprint.update({
        where: { businessId: biz.id },
        data: {
          sections: {
            ...sections,
            ...patch,
          },
        },
      });

      updated++;
    }

    console.log(`[ai-memory:backfill] done — updated ${updated}, skipped ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[ai-memory:backfill] failed:', err);
  process.exit(1);
});
