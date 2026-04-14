import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface LogEntry {
  businessId: string;
  action: string;
  toolName?: string;
  module?: string;
  riskTier?: number;
  mode?: string;
  actor?: string;
  userId?: string;
  rationale?: string;
  inputSummary?: any;
  outputSummary?: any;
  success?: boolean;
  errorMessage?: string;
  durationMs?: number;
  planId?: string;
  planStepId?: string;
}

export interface LogFilter {
  module?: string;
  toolName?: string;
  success?: boolean;
  mode?: string;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class AiExecutionLogService {
  private readonly logger = new Logger(AiExecutionLogService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async log(entry: LogEntry): Promise<string> {
    try {
      const record = await this.prisma.client.aiExecutionLog.create({
        data: {
          businessId: entry.businessId,
          action: entry.action,
          toolName: entry.toolName ?? null,
          module: entry.module ?? null,
          riskTier: entry.riskTier ?? 1,
          mode: entry.mode ?? 'assisted',
          actor: entry.actor ?? 'user',
          userId: entry.userId ?? null,
          rationale: entry.rationale ?? null,
          inputSummary: entry.inputSummary ?? null,
          outputSummary: entry.outputSummary ?? null,
          success: entry.success ?? true,
          errorMessage: entry.errorMessage ?? null,
          durationMs: entry.durationMs ?? null,
          planId: entry.planId ?? null,
          planStepId: entry.planStepId ?? null,
        },
      });
      return record.id;
    } catch (err) {
      this.logger.error(`Failed to write execution log: ${(err as Error).message}`);
      return '';
    }
  }

  async logToolExecution(
    businessId: string,
    toolName: string,
    args: Record<string, any>,
    result: any,
    success: boolean,
    durationMs: number,
    opts?: { mode?: string; rationale?: string; planId?: string; planStepId?: string; riskTier?: number },
  ): Promise<string> {
    const module = this.inferModule(toolName);
    return this.log({
      businessId,
      action: `tool:${toolName}`,
      toolName,
      module: module ?? undefined,
      riskTier: opts?.riskTier ?? 1,
      mode: opts?.mode ?? 'assisted',
      actor: 'flow',
      rationale: opts?.rationale,
      inputSummary: this.sanitizePayload(args),
      outputSummary: success ? this.sanitizePayload(result) : null,
      success,
      errorMessage: success ? undefined : (typeof result === 'string' ? result : JSON.stringify(result)),
      durationMs,
      planId: opts?.planId,
      planStepId: opts?.planStepId,
    });
  }

  async getHistory(businessId: string, filter?: LogFilter, limit = 50, offset = 0) {
    const where: any = { businessId };
    if (filter?.module) where.module = filter.module;
    if (filter?.toolName) where.toolName = filter.toolName;
    if (filter?.success !== undefined) where.success = filter.success;
    if (filter?.mode) where.mode = filter.mode;
    if (filter?.startDate || filter?.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.client.aiExecutionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.client.aiExecutionLog.count({ where }),
    ]);

    return { logs, total, limit, offset };
  }

  async getStats(businessId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [totalCount, successCount, byModule, byMode] = await Promise.all([
      this.prisma.client.aiExecutionLog.count({ where: { businessId, createdAt: { gte: since } } }),
      this.prisma.client.aiExecutionLog.count({ where: { businessId, createdAt: { gte: since }, success: true } }),
      this.prisma.client.aiExecutionLog.groupBy({
        by: ['module'],
        where: { businessId, createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.client.aiExecutionLog.groupBy({
        by: ['mode'],
        where: { businessId, createdAt: { gte: since } },
        _count: true,
      }),
    ]);

    return {
      period: { days, since },
      totalActions: totalCount,
      successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100,
      byModule: byModule.map(m => ({ module: m.module ?? 'unknown', count: typeof m._count === 'number' ? m._count : (m._count as Record<string, number>)?._all ?? 0 })),
      byMode: byMode.map(m => ({ mode: m.mode, count: typeof m._count === 'number' ? m._count : (m._count as Record<string, number>)?._all ?? 0 })),
    };
  }

  private inferModule(toolName: string): string | null {
    if (toolName.startsWith('crm_')) return 'crm';
    if (toolName.startsWith('commerce_')) return 'commerce';
    if (toolName.startsWith('bookings_')) return 'bookings';
    if (toolName.startsWith('marketing_')) return 'marketing';
    if (toolName.startsWith('social_')) return 'content';
    if (toolName.startsWith('automations_')) return 'automations';
    return null;
  }

  private sanitizePayload(payload: any): any {
    if (!payload) return null;
    try {
      const str = JSON.stringify(payload);
      if (str.length > 5000) {
        return { _truncated: true, _size: str.length, _preview: str.slice(0, 500) };
      }
      return payload;
    } catch {
      return { _error: 'Could not serialize payload' };
    }
  }
}
