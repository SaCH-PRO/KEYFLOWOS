import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiExecutionLogService } from './ai-execution-log.service';

export type MemoryCategory =
  | 'goals'
  | 'tone'
  | 'riskTolerance'
  | 'outreachStyle'
  | 'reportingCadence'
  | 'priorities'
  | 'bottlenecks'
  | 'corrections'
  | 'patterns'
  | 'preferences'
  | 'learned_corrections'
  | 'execution_patterns'
  | 'role_activity';

export type MemorySource = 'user' | 'inferred' | 'approval_signal' | 'pattern_analysis' | 'feedback_loop' | 'role_engine';

export interface MemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryUpsertInput {
  category: MemoryCategory;
  key: string;
  value: string;
  confidence?: number;
  source?: MemorySource;
  expiresAt?: Date | null;
}

export interface MemoryContextBlock {
  goals: string[];
  tone: string | null;
  riskTolerance: string | null;
  outreachStyle: string | null;
  reportingCadence: string | null;
  priorities: string[];
  bottlenecks: string[];
  corrections: string[];
  patterns: string[];
}

@Injectable()
export class AiMemoryService {
  private readonly logger = new Logger(AiMemoryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
  ) {}

  async getAll(businessId: string): Promise<MemoryEntry[]> {
    const records = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
    });
    return records;
  }

  async getByCategory(businessId: string, category: MemoryCategory): Promise<MemoryEntry[]> {
    return this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(businessId: string, category: MemoryCategory, key: string): Promise<MemoryEntry | null> {
    return this.prisma.client.aiMemory.findUnique({
      where: {
        businessId_category_key: { businessId, category, key },
      },
    });
  }

  async upsert(businessId: string, input: MemoryUpsertInput): Promise<MemoryEntry> {
    const { category, key, value, confidence = 1.0, source = 'user', expiresAt = null } = input;

    return this.prisma.client.aiMemory.upsert({
      where: {
        businessId_category_key: { businessId, category, key },
      },
      create: {
        businessId,
        category,
        key,
        value,
        confidence,
        source,
        expiresAt,
      },
      update: {
        value,
        confidence,
        source,
        expiresAt,
      },
    });
  }

  async upsertMany(businessId: string, inputs: MemoryUpsertInput[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    for (const input of inputs) {
      results.push(await this.upsert(businessId, input));
    }
    return results;
  }

  async remove(businessId: string, category: MemoryCategory, key: string): Promise<boolean> {
    try {
      await this.prisma.client.aiMemory.delete({
        where: {
          businessId_category_key: { businessId, category, key },
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async removeCategory(businessId: string, category: MemoryCategory): Promise<number> {
    const result = await this.prisma.client.aiMemory.deleteMany({
      where: { businessId, category },
    });
    return result.count;
  }

  async buildContextBlock(businessId: string): Promise<MemoryContextBlock> {
    const memories = await this.getAll(businessId);

    const block: MemoryContextBlock = {
      goals: [],
      tone: null,
      riskTolerance: null,
      outreachStyle: null,
      reportingCadence: null,
      priorities: [],
      bottlenecks: [],
      corrections: [],
      patterns: [],
    };

    for (const mem of memories) {
      switch (mem.category) {
        case 'goals':
          block.goals.push(mem.value);
          break;
        case 'tone':
          if (mem.key === 'preferred') block.tone = mem.value;
          break;
        case 'riskTolerance':
          if (mem.key === 'level') block.riskTolerance = mem.value;
          break;
        case 'outreachStyle':
          if (mem.key === 'preferred') block.outreachStyle = mem.value;
          break;
        case 'reportingCadence':
          if (mem.key === 'preferred') block.reportingCadence = mem.value;
          break;
        case 'priorities':
          block.priorities.push(mem.value);
          break;
        case 'bottlenecks':
          block.bottlenecks.push(mem.value);
          break;
        case 'corrections':
          block.corrections.push(mem.value);
          break;
        case 'patterns':
          block.patterns.push(mem.value);
          break;
      }
    }

    return block;
  }

  buildPromptSection(ctx: MemoryContextBlock): string {
    const lines: string[] = [];

    if (ctx.tone) lines.push(`- Preferred communication tone: ${ctx.tone}`);
    if (ctx.riskTolerance) lines.push(`- Risk tolerance: ${ctx.riskTolerance}`);
    if (ctx.outreachStyle) lines.push(`- Outreach style: ${ctx.outreachStyle}`);
    if (ctx.reportingCadence) lines.push(`- Reporting cadence: ${ctx.reportingCadence}`);
    if (ctx.goals.length > 0) lines.push(`- Business goals: ${ctx.goals.join('; ')}`);
    if (ctx.priorities.length > 0) lines.push(`- Current priorities: ${ctx.priorities.join('; ')}`);
    if (ctx.bottlenecks.length > 0) lines.push(`- Known bottlenecks: ${ctx.bottlenecks.join('; ')}`);
    if (ctx.corrections.length > 0) lines.push(`- User corrections (respect these): ${ctx.corrections.join('; ')}`);
    if (ctx.patterns.length > 0) lines.push(`- Behavioral patterns: ${ctx.patterns.join('; ')}`);

    if (lines.length === 0) return '';

    return `\nUSER PREFERENCES & MEMORY:\n${lines.join('\n')}`;
  }

  async recordApprovalSignal(
    businessId: string,
    toolName: string,
    resolution: 'approved' | 'rejected' | 'deferred',
    context?: { rationale?: string; inputPayload?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const signalKey = `${resolution}_${toolName}`;
      const existing = await this.get(businessId, 'corrections', signalKey);

      if (resolution === 'rejected') {
        const description = context?.rationale
          ? `User rejected ${toolName}: ${context.rationale}`
          : `User rejected ${toolName} action`;

        await this.upsert(businessId, {
          category: 'corrections',
          key: signalKey,
          value: description,
          confidence: existing ? Math.min(existing.confidence + 0.1, 1.0) : 0.7,
          source: 'approval_signal',
        });
      }

      if (resolution === 'approved') {
        const rejectionKey = `rejected_${toolName}`;
        const rejectionMemory = await this.get(businessId, 'corrections', rejectionKey);
        if (rejectionMemory && rejectionMemory.confidence > 0.3) {
          await this.upsert(businessId, {
            category: 'corrections',
            key: rejectionKey,
            value: rejectionMemory.value,
            confidence: rejectionMemory.confidence - 0.15,
            source: 'approval_signal',
          });
        }
      }
    } catch (err) {
      this.logger.error(`Failed to record approval signal: ${(err as Error).message}`);
    }
  }

  async summarizePatterns(businessId: string): Promise<string[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const logs = await this.prisma.client.aiExecutionLog.findMany({
        where: {
          businessId,
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          action: true,
          toolName: true,
          module: true,
          success: true,
          createdAt: true,
          riskTier: true,
        },
      });

      if (logs.length < 5) return [];

      const patterns: string[] = [];

      const toolCounts: Record<string, number> = {};
      for (const log of logs) {
        if (log.toolName) {
          toolCounts[log.toolName] = (toolCounts[log.toolName] || 0) + 1;
        }
      }
      const topTools = Object.entries(toolCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);
      if (topTools.length > 0) {
        patterns.push(`Most used tools: ${topTools.map(([name, count]) => `${name} (${count}x)`).join(', ')}`);
      }

      const hourCounts: Record<number, number> = {};
      for (const log of logs) {
        const hour = new Date(log.createdAt).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
      const peakHour = Object.entries(hourCounts)
        .sort(([, a], [, b]) => b - a)[0];
      if (peakHour) {
        const h = parseInt(peakHour[0]);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        patterns.push(`Peak activity hour: ${h12}${ampm}`);
      }

      const dayCounts: Record<number, number> = {};
      for (const log of logs) {
        const day = new Date(log.createdAt).getDay();
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const peakDay = Object.entries(dayCounts)
        .sort(([, a], [, b]) => b - a)[0];
      if (peakDay) {
        patterns.push(`Most active day: ${dayNames[parseInt(peakDay[0])]}`);
      }

      const failedTools: Record<string, number> = {};
      for (const log of logs) {
        if (!log.success && log.toolName) {
          failedTools[log.toolName] = (failedTools[log.toolName] || 0) + 1;
        }
      }
      const frequentFailures = Object.entries(failedTools)
        .filter(([, count]) => count >= 3)
        .sort(([, a], [, b]) => b - a);
      if (frequentFailures.length > 0) {
        patterns.push(`Frequently failing tools: ${frequentFailures.map(([name, count]) => `${name} (${count} failures)`).join(', ')}`);
      }

      const moduleCounts: Record<string, number> = {};
      for (const log of logs) {
        if (log.module) {
          moduleCounts[log.module] = (moduleCounts[log.module] || 0) + 1;
        }
      }
      const topModules = Object.entries(moduleCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);
      if (topModules.length > 0) {
        patterns.push(`Most active modules: ${topModules.map(([name, count]) => `${name} (${count}x)`).join(', ')}`);
      }

      for (const pattern of patterns) {
        await this.upsert(businessId, {
          category: 'patterns',
          key: pattern.split(':')[0]?.trim().toLowerCase().replace(/\s+/g, '_') || 'general',
          value: pattern,
          confidence: 0.8,
          source: 'pattern_analysis',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }

      return patterns;
    } catch (err) {
      this.logger.error(`Pattern summarization failed: ${(err as Error).message}`);
      return [];
    }
  }
}
