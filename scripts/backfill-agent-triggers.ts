/**
 * Backfill autopilot rules + AutopilotSettings for businesses that predate the
 * seeder having a caller.
 *
 * WHY THIS EXISTS
 *
 * `DefaultTriggersService.seedForBusiness` writes 22 AgentTrigger rows and the
 * single AutopilotSettings row. Until recently it had NO production caller
 * anywhere, so both tables were empty for every business. Two consequences, both
 * silent:
 *
 *   1. AgentTriggerService installs an `events.onAny(...)` firehose and, for
 *      every emitted event, runs `agentTrigger.findMany({ businessId, enabled:
 *      true, eventPattern })`. With an empty table that returns zero rows
 *      forever, so the whole event -> plan -> execute loop never fired. The
 *      planner, executor, BullMQ workers, dispatcher and feedback loop were all
 *      live and idle.
 *
 *   2. AutopilotSettings has FIVE live readers — the daily auto-action cap in
 *      AgentTriggerService, the autonomy mode and maxAutoTier in
 *      AiOversightService, morning briefings, journey orchestration and
 *      KeyAutonomySafetyService. All five read null forever and fell back, so
 *      the daily action cap was never enforced.
 *
 * `IdentityService.createBusiness` now seeds on creation, so NEW businesses are
 * covered. This script covers the ones created before that.
 *
 * SAFETY
 *
 * Rules are seeded DISABLED, exactly as `seedForBusiness` does by default. This
 * script must never be the thing that starts KEY acting on production data —
 * that is a decision a human makes per rule, in the UI. What it restores is the
 * ability to make that decision at all, plus the daily cap that was never
 * enforced.
 *
 * `seedForBusiness` is idempotent (`if (existing > 0) return 0`), so re-running
 * is safe.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/backfill-agent-triggers.ts              # all businesses
 *   pnpm tsx scripts/backfill-agent-triggers.ts <bizId>      # one business
 *   DRY_RUN=1 pnpm tsx scripts/backfill-agent-triggers.ts    # plan only
 */

import { PrismaClient } from '@prisma/client';
import { DEFAULT_AGENT_TRIGGERS } from '../apps/server/src/modules/ai/default-triggers.constants';

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.env.DRY_RUN === '1';
  const onlyId = process.argv[2];

  const businesses = await prisma.business.findMany({
    where: onlyId ? { id: onlyId } : undefined,
    select: { id: true, name: true },
  });

  console.log(
    `${dryRun ? '[DRY RUN] ' : ''}Checking ${businesses.length} business(es) ` +
      `against ${DEFAULT_AGENT_TRIGGERS.length} default rules\n`,
  );

  let seededTriggers = 0;
  let seededSettings = 0;
  let alreadyDone = 0;

  for (const business of businesses) {
    const [triggerCount, settings] = await Promise.all([
      prisma.agentTrigger.count({ where: { businessId: business.id } }),
      prisma.autopilotSettings.findUnique({ where: { businessId: business.id } }),
    ]);

    const needsTriggers = triggerCount === 0;
    const needsSettings = !settings;

    if (!needsTriggers && !needsSettings) {
      alreadyDone += 1;
      continue;
    }

    console.log(
      `${business.name} (${business.id}): ` +
        `${needsTriggers ? 'no rules' : `${triggerCount} rules`}, ` +
        `${needsSettings ? 'NO settings row' : 'settings ok'}`,
    );

    if (dryRun) continue;

    if (needsTriggers) {
      // enabled: false — deliberately. Seeding does not switch KEY on.
      await prisma.agentTrigger.createMany({
        data: DEFAULT_AGENT_TRIGGERS.map((t) => ({
          businessId: business.id,
          name: t.name,
          eventPattern: t.eventPattern,
          objective: t.objective,
          autoExecute: t.autoExecute,
          maxRiskTier: t.maxRiskTier,
          enabled: false,
        })),
        skipDuplicates: true,
      });
      seededTriggers += 1;
    }

    if (needsSettings) {
      // The row five live readers need. Without it the daily auto-action cap
      // is unenforceable.
      await prisma.autopilotSettings.create({
        data: { businessId: business.id, autonomyLevel: 2 },
      });
      seededSettings += 1;
    }
  }

  console.log(
    `\n${dryRun ? '[DRY RUN] would seed' : 'Seeded'} rules for ${seededTriggers} business(es), ` +
      `settings for ${seededSettings}. ${alreadyDone} already had both.`,
  );
  if (!dryRun && seededTriggers > 0) {
    console.log(
      'All rules are DISABLED. Enable them per business in the autopilot UI ' +
        'when you actually want KEY acting unprompted.',
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
