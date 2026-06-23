import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateGenomeMemoryEventInput,
  GenomeLearningSummary,
  GenomeMemoryEventData,
  GenomeMemoryEventType,
  ListGenomeMemoryEventsQuery,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toDomain(row: {
  id: string;
  businessId: string;
  sourceType: string;
  sourceEntityId: string | null;
  eventType: string;
  domain: string | null;
  section: string | null;
  title: string;
  summary: string;
  outcome: string | null;
  impactScore: number;
  confidenceDelta: number;
  evidence: Prisma.JsonValue;
  lessons: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  occurredAt: Date | null;
  createdAt: Date;
}): GenomeMemoryEventData {
  return {
    id: row.id,
    businessId: row.businessId,
    sourceType: row.sourceType,
    sourceEntityId: row.sourceEntityId ?? null,
    eventType: row.eventType as GenomeMemoryEventType,
    domain: row.domain ?? null,
    section: row.section ?? null,
    title: row.title,
    summary: row.summary,
    outcome: (row.outcome ?? null) as GenomeMemoryEventData['outcome'],
    impactScore: row.impactScore,
    confidenceDelta: row.confidenceDelta,
    evidence: Array.isArray(row.evidence) ? (row.evidence as Array<Record<string, unknown>>) : [],
    lessons: Array.isArray(row.lessons)
      ? (row.lessons as unknown as GenomeMemoryEventData['lessons'])
      : [],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const DEDUPE_EVENT_TYPES: Set<string> = new Set([
  'RECOMMENDATION_ACCEPTED',
  'RECOMMENDATION_DISMISSED',
  'RECOMMENDATION_APPLIED',
  'EXPERIMENT_STARTED',
  'EXPERIMENT_COMPLETED',
  'EXPERIMENT_FAILED',
  'EXPERIMENT_CANCELLED',
  'SIGNAL_ACCEPTED',
  'SIGNAL_REJECTED',
  'SIGNAL_MERGED',
]);

@Injectable()
export class GenomeMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async createMemoryEvent(input: CreateGenomeMemoryEventInput): Promise<GenomeMemoryEventData> {
    if (input.sourceEntityId && DEDUPE_EVENT_TYPES.has(input.eventType)) {
      const existing = await this.prisma.client.genomeMemoryEvent.findFirst({
        where: {
          businessId: input.businessId,
          sourceType: input.sourceType,
          sourceEntityId: input.sourceEntityId,
          eventType: input.eventType,
        },
      });
      if (existing) {
        return toDomain(existing);
      }
    }

    const created = await this.prisma.client.genomeMemoryEvent.create({
      data: {
        businessId: input.businessId,
        sourceType: input.sourceType,
        sourceEntityId: input.sourceEntityId ?? null,
        eventType: input.eventType,
        domain: input.domain ?? null,
        section: input.section ?? null,
        title: input.title,
        summary: input.summary,
        outcome: input.outcome ?? null,
        impactScore: input.impactScore ?? 0.5,
        confidenceDelta: input.confidenceDelta ?? 0,
        evidence: asJsonValue(input.evidence ?? []),
        lessons: asJsonValue(input.lessons ?? []),
        metadata: asJsonValue(input.metadata ?? {}),
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      },
    });

    return toDomain(created);
  }

  async listMemoryEvents(
    businessId: string,
    filters: ListGenomeMemoryEventsQuery = {},
  ): Promise<GenomeMemoryEventData[]> {
    const rows = await this.prisma.client.genomeMemoryEvent.findMany({
      where: {
        businessId,
        ...(filters.sourceType ? { sourceType: filters.sourceType } : {}),
        ...(filters.eventType ? { eventType: filters.eventType } : {}),
        ...(filters.domain ? { domain: filters.domain } : {}),
        ...(filters.section ? { section: filters.section } : {}),
        ...(filters.outcome ? { outcome: filters.outcome } : {}),
        ...(filters.minImpactScore !== undefined
          ? { impactScore: { gte: filters.minImpactScore } }
          : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async getMemoryEvent(businessId: string, memoryEventId: string): Promise<GenomeMemoryEventData> {
    const row = await this.prisma.client.genomeMemoryEvent.findUnique({
      where: { id: memoryEventId },
    });

    if (!row || row.businessId !== businessId) {
      throw new NotFoundException('Genome memory event not found');
    }

    return toDomain(row);
  }

  async summarizeMemory(businessId: string): Promise<GenomeLearningSummary> {
    const events = await this.listMemoryEvents(businessId, { limit: 1000 });

    const successCount = events.filter((e) => e.outcome === 'SUCCESS').length;
    const failureCount = events.filter((e) => e.outcome === 'FAILURE').length;
    const mixedCount = events.filter((e) => e.outcome === 'MIXED').length;
    const unknownCount = events.filter((e) => e.outcome === 'UNKNOWN' || !e.outcome).length;

    const averageImpactScore =
      events.length > 0 ? events.reduce((sum, e) => sum + e.impactScore, 0) / events.length : 0;
    const averageConfidenceDelta =
      events.length > 0
        ? events.reduce((sum, e) => sum + e.confidenceDelta, 0) / events.length
        : 0;

    const lessonMap = new Map<
      string,
      { count: number; totalImpact: number }
    >();
    for (const event of events) {
      for (const lesson of event.lessons) {
        const key = lesson.lesson;
        const existing = lessonMap.get(key) ?? { count: 0, totalImpact: 0 };
        existing.count += 1;
        existing.totalImpact += event.impactScore;
        lessonMap.set(key, existing);
      }
    }
    const topLessons = Array.from(lessonMap.entries())
      .map(([lesson, data]) => ({
        lesson,
        count: data.count,
        averageImpactScore: data.totalImpact / data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const domainMap = new Map<
      string,
      { successCount: number; totalImpact: number; failureCount: number }
    >();
    for (const event of events) {
      const domain = event.domain ?? 'unknown';
      const existing = domainMap.get(domain) ?? {
        successCount: 0,
        totalImpact: 0,
        failureCount: 0,
      };
      if (event.outcome === 'SUCCESS') existing.successCount += 1;
      if (event.outcome === 'FAILURE') existing.failureCount += 1;
      existing.totalImpact += event.impactScore;
      domainMap.set(domain, existing);
    }
    const domains = Array.from(domainMap.entries()).map(([domain, data]) => ({
      domain,
      successCount: data.successCount,
      failureCount: data.failureCount,
      averageImpactScore: data.totalImpact / (data.successCount + data.failureCount) || data.totalImpact,
    }));

    const strongestDomains = [...domains]
      .filter((d) => d.successCount > 0)
      .sort((a, b) => b.successCount - a.successCount || b.averageImpactScore - a.averageImpactScore)
      .slice(0, 5);
    const weakestDomains = [...domains]
      .filter((d) => d.failureCount > 0)
      .sort((a, b) => b.failureCount - a.failureCount || a.averageImpactScore - b.averageImpactScore)
      .slice(0, 5);

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      totalMemoryEvents: events.length,
      successCount,
      failureCount,
      mixedCount,
      unknownCount,
      averageImpactScore: Math.round(averageImpactScore * 100) / 100,
      averageConfidenceDelta: Math.round(averageConfidenceDelta * 100) / 100,
      topLessons,
      strongestDomains,
      weakestDomains,
      recentMemory: events.slice(0, 25),
    };
  }

  async findSimilarMemory(
    businessId: string,
    input: {
      domain?: string;
      eventType?: string;
      outcome?: string;
      limit?: number;
    },
  ): Promise<GenomeMemoryEventData[]> {
    return this.listMemoryEvents(businessId, {
      domain: input.domain,
      eventType: input.eventType,
      outcome: input.outcome as any,
      limit: input.limit ?? 25,
    });
  }

  async countRecentMemoryEvents(businessId: string, days: number): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.prisma.client.genomeMemoryEvent.count({
      where: {
        businessId,
        createdAt: { gte: since },
      },
    });
  }

  async countRecentFailedOutcomes(businessId: string, days: number): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.prisma.client.genomeMemoryEvent.count({
      where: {
        businessId,
        outcome: 'FAILURE',
        createdAt: { gte: since },
      },
    });
  }
}
