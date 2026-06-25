// ============================================================
// KEY Cortex — Genome Context Assembler
// Reads business genome data and assembles context snapshots
// for AI consumption with Redis-backed caching.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CortexContextSnapshot } from './key-cortex.types';

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const CONTEXT_CACHE_TTL_MS = 300_000; // 5 minutes (per spec Section 14)
const CONTEXT_CACHE_PREFIX = 'key-cortex:context';

// ─────────────────────────────────────────────────────────────
// Genome Context Assembler Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class KeyCortexContextService {
  private readonly logger = new Logger(KeyCortexContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── Main Assembly ─────────────────────────────────────────

  /**
   * Build a complete context snapshot for a business.
   * First checks the Redis cache; if stale/missing, re-assembles
   * from the database and caches the result.
   */
  async buildContextSnapshot(
    businessId: string,
  ): Promise<CortexContextSnapshot> {
    this.logger.debug(`Building context snapshot for business ${businessId}`);

    // Attempt cache hit
    const cached = await this.getCachedContext(businessId);
    if (cached) {
      this.logger.debug(`Cache HIT for business ${businessId}`);
      return cached;
    }

    // Cache miss — assemble from database
    this.logger.debug(`Cache MISS for business ${businessId} — assembling from DB`);

    const [
      genome,
      activity,
      keyMetrics,
      activeProjects,
      pendingInvoices,
    ] = await Promise.all([
      this.getGenomeData(businessId),
      this.getRecentActivity(businessId, 5),
      this.getKeyMetrics(businessId),
      this.getActiveProjects(businessId),
      this.getPendingInvoices(businessId),
    ]);

    const snapshot: CortexContextSnapshot = {
      businessId,
      genomeDna: genome.dna,
      genomeStage: genome.stage,
      executiveReadiness: genome.readiness,
      recentTasks: activity.tasks,
      recentEvents: activity.events,
      keyMetrics,
      activeProjects,
      pendingInvoices,
      unreadMessages: activity.messages,
      teamStatus: await this.getTeamStatus(businessId),
      timestamp: new Date(),
    };

    // Persist to cache
    await this.cacheContext(businessId, snapshot);

    return snapshot;
  }

  // ── Genome Data ───────────────────────────────────────────

  /**
   * Retrieve the business genome (DNA scores, stage, readiness).
   */
  async getGenomeData(
    businessId: string,
  ): Promise<{ dna: Record<string, number>; stage: string; readiness: number }> {
    try {
      const genome = await this.prisma.businessGenome.findUnique({
        where: { businessId },
      });

      if (!genome) {
        this.logger.warn(`No genome found for business ${businessId}`);
        return {
          dna: { execution: 50, strategy: 50, finance: 50, marketing: 50, operations: 50 },
          stage: 'unknown',
          readiness: 0,
        };
      }

      // Parse DNA scores from the genome record
      const dna = (genome.dnaScores as Record<string, number>) ?? {};
      const stage = (genome.stage as string) ?? 'unknown';
      const readiness = (genome.executiveReadiness as number) ?? 0;

      return { dna, stage, readiness };
    } catch (error) {
      this.logger.error(
        `Failed to load genome for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        dna: { execution: 50, strategy: 50, finance: 50, marketing: 50, operations: 50 },
        stage: 'unknown',
        readiness: 0,
      };
    }
  }

  // ── Recent Activity ───────────────────────────────────────

  /**
   * Fetch the most recent activity: tasks, events, and unread message count.
   */
  async getRecentActivity(
    businessId: string,
    limit = 5,
  ): Promise<{ tasks: string[]; events: string[]; messages: number }> {
    try {
      const [tasks, events, unreadMessages] = await Promise.all([
        this.prisma.task
          .findMany({
            where: { businessId },
            orderBy: { updatedAt: 'desc' },
            take: limit,
            select: { title: true },
          })
          .then((rows) => rows.map((r) => r.title)),

        this.prisma.event
          .findMany({
            where: { businessId },
            orderBy: { startTime: 'desc' },
            take: limit,
            select: { title: true },
          })
          .then((rows) => rows.map((r) => r.title)),

        this.prisma.message.count({
          where: { businessId, read: false },
        }),
      ]);

      return { tasks, events, messages: unreadMessages };
    } catch (error) {
      this.logger.error(
        `Failed to load recent activity for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { tasks: [], events: [], messages: 0 };
    }
  }

  // ── Key Metrics ───────────────────────────────────────────

  /**
   * Compute key business metrics for AI context.
   */
  async getKeyMetrics(businessId: string): Promise<Record<string, number>> {
    try {
      const [
        totalRevenue,
        activeClients,
        openTasks,
        conversionRate,
      ] = await Promise.all([
        this.prisma.invoice
          .aggregate({
            where: { businessId, status: 'paid' },
            _sum: { total: true },
          })
          .then((r) => r._sum.total ?? 0),

        this.prisma.client.count({
          where: { businessId, status: 'active' },
        }),

        this.prisma.task.count({
          where: { businessId, status: { in: ['todo', 'in_progress'] } },
        }),

        // Conversion rate placeholder — can be replaced with real funnel analytics
        Promise.resolve(0),
      ]);

      return {
        totalRevenue,
        activeClients,
        openTasks,
        conversionRate,
      };
    } catch (error) {
      this.logger.error(
        `Failed to compute key metrics for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { totalRevenue: 0, activeClients: 0, openTasks: 0, conversionRate: 0 };
    }
  }

  // ── Active Projects ───────────────────────────────────────

  /**
   * Get names of currently active projects for the business.
   */
  async getActiveProjects(businessId: string): Promise<string[]> {
    try {
      const projects = await this.prisma.project.findMany({
        where: { businessId, status: 'active' },
        select: { name: true },
      });
      return projects.map((p) => p.name);
    } catch (error) {
      this.logger.error(
        `Failed to load active projects for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ── Pending Invoices ──────────────────────────────────────

  /**
   * Count the number of pending (unpaid) invoices.
   */
  async getPendingInvoices(businessId: string): Promise<number> {
    try {
      return this.prisma.invoice.count({
        where: { businessId, status: { in: ['pending', 'sent', 'overdue'] } },
      });
    } catch (error) {
      this.logger.error(
        `Failed to count pending invoices for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  // ── Context Formatter ─────────────────────────────────────

  /**
   * Format a context snapshot into the exact prompt-friendly string
   * specified in Section 5.3 of the technical specification.
   */
  formatContextForPrompt(snapshot: CortexContextSnapshot): string {
    const dnaEntries = Object.entries(snapshot.genomeDna)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    const recentSummary = [...snapshot.recentTasks, ...snapshot.recentEvents]
      .slice(0, 5)
      .join('; ') || 'No recent activity';

    return `=== BUSINESS CONTEXT ===
Company: ${snapshot.businessId}
Genome Stage: ${snapshot.genomeStage}
Executive Readiness: ${snapshot.executiveReadiness}%
DNA Scores: ${dnaEntries}
Active: ${snapshot.recentTasks.length} tasks, ${snapshot.recentEvents.length} events, ${snapshot.activeProjects.length} projects
Pending: ${snapshot.pendingInvoices} invoices, ${snapshot.unreadMessages} unread messages
Recent: ${recentSummary}
========================`;
  }

  // ── Cache Management ──────────────────────────────────────

  /**
   * Retrieve a cached context snapshot from Redis.
   * Returns null if cache is empty or expired.
   */
  async getCachedContext(
    businessId: string,
  ): Promise<CortexContextSnapshot | null> {
    try {
      const key = `${CONTEXT_CACHE_PREFIX}:${businessId}`;
      const raw = await this.redis.get(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as CortexContextSnapshot;
      // Restore Date objects that were serialized as strings
      parsed.timestamp = new Date(parsed.timestamp);
      return parsed;
    } catch (error) {
      this.logger.warn(
        `Failed to read cached context for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Invalidate the cached context for a business.
   * Call this whenever business data changes significantly.
   */
  async invalidateCache(businessId: string): Promise<void> {
    try {
      const key = `${CONTEXT_CACHE_PREFIX}:${businessId}`;
      await this.redis.del(key);
      this.logger.debug(`Invalidated context cache for business ${businessId}`);
    } catch (error) {
      this.logger.error(
        `Failed to invalidate cache for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Internal Helpers ──────────────────────────────────────

  /**
   * Persist a context snapshot to Redis with TTL.
   */
  private async cacheContext(
    businessId: string,
    snapshot: CortexContextSnapshot,
  ): Promise<void> {
    try {
      const key = `${CONTEXT_CACHE_PREFIX}:${businessId}`;
      await this.redis.set(
        key,
        JSON.stringify(snapshot),
        'PX',
        CONTEXT_CACHE_TTL_MS,
      );
      this.logger.debug(
        `Cached context for business ${businessId} (TTL: ${CONTEXT_CACHE_TTL_MS}ms)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cache context for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Retrieve a short-form team status string for context.
   */
  private async getTeamStatus(businessId: string): Promise<string> {
    try {
      const memberCount = await this.prisma.teamMember.count({
        where: { businessId, status: 'active' },
      });
      return `${memberCount} active member${memberCount === 1 ? '' : 's'}`;
    } catch (error) {
      this.logger.warn(
        `Failed to load team status for business ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'unknown';
    }
  }
}
