/* eslint-disable no-console */
/**
 * scripts/backfill-genome-integrity.ts
 *
 * One-shot backfill that recalculates and persists Genome Integrity fields
 * (genomeIntegrity, genomeDnaScores, genomeDnaConfidence, genomeStage) for
 * every BusinessBlueprint row.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/backfill-genome-integrity.ts              # all businesses
 *   pnpm tsx scripts/backfill-genome-integrity.ts <businessId> # one business
 *   DRY_RUN=1 pnpm tsx scripts/backfill-genome-integrity.ts    # report only
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../apps/server/src/app.module';
import { PrismaService } from '../apps/server/src/core/prisma/prisma.service';
import { BlueprintService } from '../apps/server/src/modules/blueprint/blueprint.service';

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const targetBusinessId = process.argv[2];
  const logger = new Logger('GenomeIntegrityBackfill');

  logger.log(`Starting genome integrity backfill (dryRun=${dryRun})`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const blueprintService = app.get(BlueprintService);

    const rows = await prisma.client.businessBlueprint.findMany({
      where: targetBusinessId ? { businessId: targetBusinessId } : undefined,
      select: { businessId: true, genomeIntegrity: true, genomeStage: true },
      orderBy: { createdAt: 'asc' },
    });

    if (rows.length === 0) {
      logger.log('No BusinessBlueprint rows found.');
      return;
    }

    logger.log(`Found ${rows.length} BusinessBlueprint row(s) to backfill.`);

    let updated = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const before = `integrity=${row.genomeIntegrity ?? 'null'}, stage=${row.genomeStage ?? 'null'}`;

        if (!dryRun) {
          // updateBlueprint recalculates genome integrity and persists all cache fields.
          await blueprintService.updateBlueprint(row.businessId, {});
        }

        const after = dryRun
          ? await blueprintService.calculateGenomeIntegrity(row.businessId)
          : null;

        const afterText = after
          ? `integrity=${after.genomeIntegrity}, stage=${after.genomeStage}`
          : 'persisted';

        logger.log(`[${row.businessId}] ${before} → ${afterText}`);
        updated++;
      } catch (err) {
        failed++;
        logger.error(`[${row.businessId}] failed: ${(err as Error).message}`);
      }
    }

    logger.log(`Backfill complete. updated=${updated}, failed=${failed}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[genome-integrity:backfill] failed:', err);
  process.exit(1);
});
