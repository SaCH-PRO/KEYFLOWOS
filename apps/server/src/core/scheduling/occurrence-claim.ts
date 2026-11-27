/**
 * RR-CRON-OCCURRENCE-LOCK (D-261, D-262, D-17, D-257):
 *
 * Cross-replica / restart single-execution claiming for `@Cron` handlers.
 *
 * Uses Redis `SET key value PX ttlMs NX` keyed by `(job, occurrenceKey)` so
 * two replicas or a container restart inside the same scheduled slot execute
 * the job once. When Redis is unavailable or rejects, `claimOccurrence` fails
 * open (`true`) to preserve single-container availability and records the
 * degradation in `errorRegistry` (never silent, never throws).
 */
import type { RedisService } from '../redis/redis.service';
import { errorRegistry, type ErrorRegistry } from '../observability/error-registry';

export type OccurrenceRedisClient = Pick<RedisService, 'setNx'>;

export interface ClaimOccurrenceOptions {
  registry?: ErrorRegistry;
  holderId?: string;
}

const DEFAULT_HOLDER = `pid:${process.pid}`;

/** Canonical Redis key for a scheduled occurrence claim. */
export function occurrenceRedisKey(job: string, occurrenceKey: string): string {
  return `kf:cron:occ:${job}:${occurrenceKey}`;
}

/** UTC calendar date slot (`YYYY-MM-DD`) for daily jobs. */
export function utcDateSlot(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** UTC hour slot (`YYYY-MM-DDTHH`) for hourly jobs. */
export function utcHourSlot(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13);
}

/** UTC fixed-interval bucket (`Math.floor(ms / intervalMs)`) for sub-hourly / multi-hour jobs. */
export function utcIntervalSlot(intervalMs: number, now: Date = new Date()): string {
  const safeInterval = Math.max(1000, Math.floor(intervalMs));
  return String(Math.floor(now.getTime() / safeInterval));
}

/** UTC ISO week-start Monday date (`YYYY-MM-DD`) for weekly jobs. */
export function utcWeekSlot(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday -> 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/** UTC year-month slot (`YYYY-MM`) for monthly jobs. */
export function utcMonthSlot(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Claim a single scheduled occurrence across replicas and restarts.
 *
 * Returns `true` if this process owns the slot (or failed open because Redis
 * is unavailable/errored, recording the event in `errorRegistry`), or `false`
 * if another replica or earlier run already claimed this slot.
 */
export async function claimOccurrence(
  redis: OccurrenceRedisClient | undefined | null,
  job: string,
  occurrenceKey: string,
  ttlMs: number,
  options?: ClaimOccurrenceOptions,
): Promise<boolean> {
  const registry = options?.registry ?? errorRegistry;
  const label = `occurrence-claim:${job}`;

  if (!redis || typeof redis.setNx !== 'function') {
    registry.record(
      'background',
      label,
      new Error(`Redis unavailable for occurrence claim (${job}/${occurrenceKey}); failing open`),
    );
    return true;
  }

  const safeTtlMs = Math.max(1000, Math.floor(ttlMs));
  const key = occurrenceRedisKey(job, occurrenceKey);
  const value = options?.holderId ?? DEFAULT_HOLDER;

  try {
    return await redis.setNx(key, value, safeTtlMs);
  } catch (err: unknown) {
    registry.record('background', label, err);
    return true;
  }
}

export type CronOccurrenceCensusEntry =
  | { mode: 'CLAIMED'; job: string }
  | { mode: 'IDEMPOTENT'; reason: string };

/**
 * Exhaustive census of every `@Cron` handler under `apps/server/src`.
 * Enforced by `cron-occurrence-census.spec.ts` — any newly added `@Cron`
 * fails CI until classified and either claimed or justified as idempotent.
 */
export const CRON_OCCURRENCE_CENSUS: Record<string, CronOccurrenceCensusEntry> = {
  'src/modules/analytics/analytics-scheduler.service.ts#assessMaturity': {
    mode: 'CLAIMED',
    job: 'analytics-maturity',
  },
  'src/modules/analytics/analytics-scheduler.service.ts#generateDailySnapshots': {
    mode: 'IDEMPOTENT',
    reason: 'AnalyticsEngineService.generateDailySnapshots uses businessSnapshot.upsert keyed by (businessId, period, date).',
  },
  'src/modules/analytics/analytics-scheduler.service.ts#generateInsights': {
    mode: 'CLAIMED',
    job: 'analytics-insights',
  },
  'src/modules/analytics/analytics-scheduler.service.ts#generateMonthlySnapshots': {
    mode: 'IDEMPOTENT',
    reason: 'AnalyticsEngineService.generateMonthlySnapshots uses businessSnapshot.upsert keyed by (businessId, period, date).',
  },
  'src/modules/analytics/analytics-scheduler.service.ts#generateProjections': {
    mode: 'CLAIMED',
    job: 'analytics-projections',
  },
  'src/modules/analytics/analytics-scheduler.service.ts#generateWeeklySnapshots': {
    mode: 'IDEMPOTENT',
    reason: 'AnalyticsEngineService.generateWeeklySnapshots uses businessSnapshot.upsert keyed by (businessId, period, date).',
  },
  'src/modules/business-genome/key-genome/genome-decay.service.ts#markStaleFacts': {
    mode: 'IDEMPOTENT',
    reason: 'Single genomeFact.updateMany transitioning idle ACTIVE facts to STALE; re-running in the same slot matches 0 rows.',
  },
  'src/modules/contracts/contract-renewal.sweep.ts#scheduledSweep': {
    mode: 'CLAIMED',
    job: 'contract-renewal',
  },
  'src/modules/finance/statement-source.service.ts#scheduledSweepAll': {
    mode: 'CLAIMED',
    job: 'statement-source-sweep',
  },
  'src/modules/key-cortex/key-bi-engine.service.ts#refreshAll': {
    mode: 'IDEMPOTENT',
    reason: 'Recomputes and overwrites cached per-business mental models in Redis with no duplicate side effects.',
  },
  'src/modules/key-cortex/key-cortex-cerebellum.service.ts#scheduledConsolidation': {
    mode: 'CLAIMED',
    job: 'key-cerebellum-consolidation',
  },
  'src/modules/key-cortex/key-cortex-creativity.service.ts#scheduledCreativeExploration': {
    mode: 'CLAIMED',
    job: 'key-creativity-exploration',
  },
  'src/modules/key-cortex/key-cortex-homeostasis.service.ts#scheduledHomeostasis': {
    mode: 'CLAIMED',
    job: 'key-homeostasis',
  },
  'src/modules/key-cortex/key-cortex-intuition.service.ts#scheduledChurnAnalysis': {
    mode: 'CLAIMED',
    job: 'key-intuition-churn',
  },
  'src/modules/key-cortex/key-cortex-intuition.service.ts#scheduledIntuitionScan': {
    mode: 'CLAIMED',
    job: 'key-intuition-scan',
  },
  'src/modules/key-cortex/key-cortex-reflection.service.ts#scheduledDream': {
    mode: 'CLAIMED',
    job: 'key-reflection-dream',
  },
  'src/modules/key-cortex/key-cortex-reflection.service.ts#scheduledMaintenance': {
    mode: 'CLAIMED',
    job: 'key-reflection-maintenance',
  },
  'src/modules/key-cortex/key-cortex-reflection.service.ts#scheduledReflection': {
    mode: 'CLAIMED',
    job: 'key-reflection',
  },
  'src/modules/key-cortex/key-cortex-reflection.service.ts#scheduledSynthesis': {
    mode: 'CLAIMED',
    job: 'key-reflection-synthesis',
  },
  'src/modules/key-cortex/key-cortex-salience.service.ts#scheduledAppraisal': {
    mode: 'CLAIMED',
    job: 'key-salience-appraisal',
  },
  'src/modules/key-cortex/key-proactive-engine.service.ts#evaluateProactiveActions': {
    mode: 'CLAIMED',
    job: 'key-proactive-evaluate',
  },
  'src/modules/key-cortex/key-proactive-engine.service.ts#generateEndOfDayReports': {
    mode: 'CLAIMED',
    job: 'key-proactive-eod-reports',
  },
  'src/modules/key-cortex/key-proactive-engine.service.ts#generateMorningBriefs': {
    mode: 'CLAIMED',
    job: 'key-proactive-morning-briefs',
  },
  'src/modules/key-cortex/key-proactive-engine.service.ts#generateWeeklyDigests': {
    mode: 'CLAIMED',
    job: 'key-proactive-weekly-digests',
  },
  'src/modules/key-cortex/memory-consolidation.service.ts#scheduledConsolidation': {
    mode: 'IDEMPOTENT',
    reason: 'Covered by MEM-CONSOLIDATION-CHECKPOINT (D-257) per-business checkpointing; intentionally untouched here.',
  },
  'src/modules/risc/risc-retention.service.ts#scheduledPurgeExpiredEvents': {
    mode: 'IDEMPOTENT',
    reason: 'Single riscEvent.deleteMany older than retention cutoff; re-running deletes 0 rows.',
  },
  'src/modules/whatsapp/whatsapp.service.ts#dispatchScheduledTick': {
    mode: 'IDEMPOTENT',
    reason: 'Atomically claims each due WhatsAppMessage row via updateMany(status SCHEDULED -> SENDING) before delivery.',
  },
};
