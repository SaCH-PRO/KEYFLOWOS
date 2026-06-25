import { Injectable, Logger } from '@nestjs/common';
import { LearningEntry } from './key-mind.types';

/**
 * =============================================================================
 * Learning Loop — Records Outcomes and Learns from Experience
 * =============================================================================
 * Tracks what worked, what failed, and what needs follow-up.
 * Enables KEY to improve recommendations over time.
 * =============================================================================
 */

@Injectable()
export class KeyLearningLoop {
  private readonly logger = new Logger(KeyLearningLoop.name);

  // In-memory storage — in production this would be Prisma/DB
  private entries: LearningEntry[] = [];

  /**
   * Record an outcome from a recommendation.
   */
  async recordOutcome(
    roleId: string,
    context: string,
    action: string,
    outcome: 'success' | 'failure' | 'partial',
    lessons: string[],
  ): Promise<LearningEntry> {
    const entry: LearningEntry = {
      id: `learn-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      roleId,
      context,
      action,
      outcome,
      lessons,
      confidenceDelta: outcome === 'success' ? 0.05 : outcome === 'failure' ? -0.03 : 0.01,
      createdAt: new Date(),
    };

    this.entries.push(entry);
    this.logger.log(`[LearningLoop] Recorded ${outcome} outcome for role ${roleId}: ${lessons.join('; ')}`);

    return entry;
  }

  /**
   * Get lessons learned for a specific role.
   */
  async getLessonsForRole(roleId: string): Promise<string[]> {
    const lessons = this.entries
      .filter(e => e.roleId === roleId)
      .flatMap(e => e.lessons);
    return [...new Set(lessons)];
  }

  /**
   * Get overall learning statistics.
   */
  async getStats(): Promise<{ totalEntries: number; successRate: number; byRole: Record<string, number> }> {
    const totalEntries = this.entries.length;
    const successes = this.entries.filter(e => e.outcome === 'success').length;
    const successRate = totalEntries > 0 ? Math.round((successes / totalEntries) * 100) : 0;

    const byRole: Record<string, number> = {};
    for (const entry of this.entries) {
      byRole[entry.roleId] = (byRole[entry.roleId] || 0) + 1;
    }

    return { totalEntries, successRate, byRole };
  }
}
