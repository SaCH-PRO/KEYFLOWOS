import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiMemoryService } from '../ai/ai-memory.service';

/**
 * The cerebellum — compare intended against actual, and correct the error.
 *
 * This is the last open loop in KEY's nervous system, and the one that decides
 * whether it gets better with use or merely keeps working.
 *
 * WHAT WAS ALREADY THERE, AND WHY IT IS NOT THIS
 *
 *   KeyCortexLearningService  a prompt-variant bandit, inert three separate
 *                             ways: recordVariantOutcome has zero callers, the
 *                             PromptVariant table has no seeder, and its only
 *                             reader sits on the cortex query pipeline the web
 *                             never calls.
 *   AiMemoryService.summarizePatterns
 *                             real, and reaches the prompt — but it produces
 *                             USAGE telemetry ("most used tools", "peak
 *                             activity hour"). Descriptions of behaviour, never
 *                             corrections to it.
 *   FeedbackLoopService       genuinely corrective, but guarded on planId and
 *                             planStepId, so it only ever sees plan execution.
 *                             Chat tool calls pass planId: '' and are invisible
 *                             to it.
 *
 * So every tool failure on the path users actually use was logged and then
 * forgotten. KEY would make the same mistake indefinitely.
 *
 * WHAT THIS DOES
 *
 * Reads its own execution history, groups failures by tool and by normalised
 * error signature, and writes a corrective lesson for anything that has
 * recurred. Those lessons land in AiMemory under `learned_corrections`, which
 * FlowOrchestrator already renders into the prompt as "Lessons from past
 * failures" — so the loop closes through machinery that exists.
 *
 * TWO PROPERTIES THAT MATTER MORE THAN THE MINING
 *
 *  1. RECURRENCE, NOT INCIDENT. A single failure is noise — a network blip, a
 *     row that genuinely did not exist. Only a repeated signature becomes a
 *     lesson, or KEY would accumulate superstitions.
 *
 *  2. LESSONS EXPIRE. Written with a TTL and refreshed each time the failure
 *     recurs, so a fixed bug fades out of the prompt instead of haunting it
 *     forever. Motor learning that cannot unlearn is pathology, and this is the
 *     same decay principle the endocrine system uses.
 *
 * Like homeostasis, this has no hands: it writes memory, never actions.
 */

/** How far back a consolidation pass looks. */
const WINDOW_HOURS = 24;

/** Bound on rows read per business. */
const SAMPLE_LIMIT = 400;

/**
 * Failures of the same signature before it counts as a pattern.
 *
 * Two is deliberate: once is an incident, twice is a habit. Higher would make
 * KEY slow to learn from a genuinely broken tool.
 */
const MIN_OCCURRENCES = 2;

/**
 * How long a lesson survives without recurring.
 *
 * Long enough to shape behaviour across a working week, short enough that a
 * fixed problem stops being mentioned. Each recurrence pushes it out again.
 */
const LESSON_TTL_HOURS = 24 * 7;

/** Distinct lessons kept per business, so the prompt cannot be flooded. */
const MAX_LESSONS = 5;

export interface ToolLesson {
  toolName: string;
  signature: string;
  occurrences: number;
  failureRate: number;
  lesson: string;
}

@Injectable()
export class KeyCortexCerebellumService {
  private readonly logger = new Logger(KeyCortexCerebellumService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() private readonly memory?: AiMemoryService,
  ) {}

  /**
   * Consolidation runs while nothing is asking anything of KEY — the same
   * reason biological motor learning consolidates offline rather than mid-
   * movement. Six-hourly gives four passes a day without making the log read
   * a meaningful load.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledConsolidation(): Promise<void> {
    const businesses = await this.findAllActiveBusinesses();
    for (const businessId of businesses) {
      try {
        await this.consolidate(businessId);
      } catch (err: unknown) {
        this.logger.warn(
          `[cerebellum] ${businessId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Learn from recent failures and write the lessons.
   *
   * Returns them so this is observable rather than a silent background effect.
   */
  async consolidate(businessId: string): Promise<ToolLesson[]> {
    const lessons = await this.detectLessons(businessId);
    if (lessons.length === 0 || !this.memory) return lessons;

    const expiresAt = new Date(Date.now() + LESSON_TTL_HOURS * 3600_000);

    for (const lesson of lessons) {
      try {
        await this.memory.upsert(businessId, {
          // The category FlowOrchestrator already renders as "Lessons from past
          // failures". Writing anywhere else would be a reader with no writer,
          // which is the defect this repo keeps producing.
          category: 'learned_corrections',
          // Keyed by tool + signature so a recurrence REFRESHES the existing
          // lesson rather than accumulating near-duplicates.
          key: `${lesson.toolName}:${lesson.signature}`,
          value: JSON.stringify({
            category: 'tool_failure_pattern',
            reason: `${lesson.occurrences} failures in ${WINDOW_HOURS}h`,
            learnedPattern: lesson.lesson,
          }),
          source: 'pattern_analysis',
          confidence: Math.min(0.5 + lesson.occurrences * 0.1, 0.95),
          expiresAt,
        });
      } catch (err: unknown) {
        this.logger.warn(
          `[cerebellum] could not store lesson for ${lesson.toolName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `[cerebellum] ${businessId}: ${lessons.length} lesson(s) — ${lessons
        .map((l) => `${l.toolName} x${l.occurrences}`)
        .join(', ')}`,
    );
    return lessons;
  }

  /** Group recent failures into recurring, actionable patterns. Never throws. */
  async detectLessons(businessId: string): Promise<ToolLesson[]> {
    let rows: Array<{ toolName: string | null; success: boolean; errorMessage: string | null }>;

    try {
      rows = await this.prisma.client.aiExecutionLog.findMany({
        where: {
          businessId,
          createdAt: { gte: new Date(Date.now() - WINDOW_HOURS * 3600_000) },
          toolName: { not: null },
        },
        select: { toolName: true, success: true, errorMessage: true },
        take: SAMPLE_LIMIT,
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      return [];
    }

    // Total attempts per tool, so a lesson can state a failure RATE rather than
    // a bare count. "Failed twice" means nothing without "out of three".
    const attempts = new Map<string, number>();
    const failures = new Map<string, { tool: string; signature: string; count: number }>();

    for (const row of rows) {
      if (!row.toolName) continue;
      attempts.set(row.toolName, (attempts.get(row.toolName) ?? 0) + 1);
      if (row.success) continue;

      const signature = this.signature(row.errorMessage);
      const key = `${row.toolName}::${signature}`;
      const existing = failures.get(key);
      if (existing) existing.count += 1;
      else failures.set(key, { tool: row.toolName, signature, count: 1 });
    }

    return [...failures.values()]
      .filter((f) => f.count >= MIN_OCCURRENCES)
      .map((f) => {
        const total = attempts.get(f.tool) ?? f.count;
        return {
          toolName: f.tool,
          signature: f.signature,
          occurrences: f.count,
          failureRate: f.count / total,
          lesson: this.phrase(f.tool, f.signature, f.count, total),
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, MAX_LESSONS);
  }

  /**
   * Reduce an error message to a groupable signature.
   *
   * Without this, "Contact abc123 not found" and "Contact xyz789 not found" are
   * two separate one-off incidents and neither ever reaches MIN_OCCURRENCES —
   * so the most common class of recurring failure would be invisible precisely
   * because each instance names a different record.
   */
  private signature(message: string | null): string {
    if (!message) return 'unspecified';

    return (
      message
        .toLowerCase()
        // uuids first — the dashes stop the generic rule below seeing them as
        // one token.
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
        // Any long alphanumeric token CONTAINING A DIGIT. The digit requirement
        // is what stops it eating ordinary words like "unavailable" or
        // "permission", and the alphanumeric class is what makes it match
        // cuids: an earlier version used [0-9a-f]{8,} and missed every real id,
        // because cuids are base36 — `cm3x9a2b0001` has x, z, k in it. The
        // effect was that the commonest recurring failure stayed invisible,
        // since each instance named a different record and none of them grouped.
        .replace(/\b(?=[a-z0-9]*\d)[a-z0-9]{8,}\b/g, '<id>')
        .replace(/\b\d+\b/g, '<n>')
        .replace(/["'`].*?["'`]/g, '<val>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
    );
  }

  /**
   * Turn a pattern into an instruction.
   *
   * Deliberately imperative. "crm_create_contact failed 4 times" is telemetry
   * and the model can do nothing with it; "verify the contact exists before
   * calling crm_create_contact" changes the next attempt. The distinction
   * between this and summarizePatterns is exactly the distinction between
   * describing behaviour and correcting it.
   */
  private phrase(tool: string, signature: string, count: number, total: number): string {
    const rate = Math.round((count / total) * 100);
    const base = `${tool} has failed ${count} of ${total} recent attempts (${rate}%) with "${signature}".`;

    if (/not found|no such|does not exist|missing/.test(signature)) {
      return `${base} Confirm the record exists — search for it first — before calling ${tool} again.`;
    }
    if (/permission|forbidden|unauthor|denied/.test(signature)) {
      return `${base} This is an access problem, not a data one: do not retry ${tool}, tell the user what is blocked.`;
    }
    if (/required|invalid|validation|must be|expected/.test(signature)) {
      return `${base} Check every required argument against the tool schema before calling ${tool}, and ask the user for anything you are inferring.`;
    }
    if (/timeout|timed out|econnrefused|unavailable|network/.test(signature)) {
      return `${base} The underlying service is unreliable right now — warn the user it may not complete rather than silently retrying.`;
    }
    if (/already|duplicate|conflict|exists/.test(signature)) {
      return `${base} Check for an existing record before creating another with ${tool}.`;
    }
    return `${base} Treat ${tool} as unreliable for now: confirm its arguments with the user before calling it.`;
  }

  private async findAllActiveBusinesses(): Promise<string[]> {
    const businesses = await this.prisma.client.business
      .findMany({ where: { deletedAt: null }, select: { id: true } })
      .catch(() => []);

    return (businesses as Array<{ id: string }>).map((b) => b.id);
  }
}
