import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  filterOutSecretRows,
  getMemoryClassReadMode,
  projectEpisodicLogRowsForReader,
  type MemoryReaderContext,
} from '../key-cortex/memory-class-read-projection';

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
  role?: string;
  idempotencyKey?: string;
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
          role: entry.role ?? null,
          idempotencyKey: entry.idempotencyKey ?? null,
        },
      });
      return record.id;
    } catch (err: any) {
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
    opts?: { mode?: string; rationale?: string; planId?: string; planStepId?: string; riskTier?: number; role?: string; idempotencyKey?: string },
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
      role: opts?.role,
      idempotencyKey: opts?.idempotencyKey,
    });
  }

  async getHistory(
    businessId: string,
    filter?: LogFilter,
    limit = 50,
    offset = 0,
    readerContext?: MemoryReaderContext,
  ) {
    const mode = getMemoryClassReadMode();
    const activeScoped = Boolean(readerContext) && mode === 'ACTIVE';
    if (activeScoped && readerContext?.reader === null) {
      return { logs: [], total: 0, limit, offset };
    }
    const where: any = { businessId };
    if (activeScoped && readerContext?.reader) where.userId = readerContext.reader;
    if (filter?.module) where.module = filter.module;
    if (filter?.toolName) where.toolName = filter.toolName;
    if (filter?.success !== undefined) where.success = filter.success;
    if (filter?.mode) where.mode = filter.mode;
    if (filter?.startDate || filter?.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    const [rawLogs, rawTotal] = await Promise.all([
      this.prisma.client.aiExecutionLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: activeScoped ? Math.min(limit + offset + 100, 500) : limit,
        skip: activeScoped ? 0 : offset,
      }),
      this.prisma.client.aiExecutionLog.count({ where }),
    ]);

    const projected = readerContext
      ? projectEpisodicLogRowsForReader(rawLogs, readerContext, {
          businessId,
          store: 'ai_execution_log',
          path: 'AiExecutionLogService.getHistory',
          logger: this.logger,
        })
      : filterOutSecretRows(rawLogs, (l) => ({
          dataClass: null,
          texts: [l.action, l.toolName, l.module, l.rationale, l.errorMessage],
        }));

    if (activeScoped) {
      return {
        logs: projected.slice(offset, offset + limit),
        total: projected.length,
        limit,
        offset,
      };
    }

    return { logs: projected, total: rawTotal, limit, offset };
  }

  async getStats(businessId: string, days = 30, readerContext?: MemoryReaderContext) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const mode = getMemoryClassReadMode();
    const activeScoped = Boolean(readerContext) && mode === 'ACTIVE';
    if (activeScoped && readerContext?.reader === null) {
      return {
        period: { days, since },
        totalActions: 0,
        successRate: 100,
        byModule: [],
        byMode: [],
      };
    }
    const baseWhere: any = {
      businessId,
      createdAt: { gte: since },
      ...(activeScoped && readerContext?.reader ? { userId: readerContext.reader } : {}),
    };
    const [totalCount, successCount, byModule, byMode] = await Promise.all([
      this.prisma.client.aiExecutionLog.count({ where: baseWhere }),
      this.prisma.client.aiExecutionLog.count({ where: { ...baseWhere, success: true } }),
      this.prisma.client.aiExecutionLog.groupBy({
        by: ['module'],
        where: baseWhere,
        _count: true,
      }),
      this.prisma.client.aiExecutionLog.groupBy({
        by: ['mode'],
        where: baseWhere,
        _count: true,
      }),
    ]);

    const visibleByModule =
      activeScoped && readerContext
        ? byModule.filter((m) => !m.module || projectEpisodicLogRowsForReader(
            [{ userId: readerContext.reader, module: m.module }],
            readerContext,
            { businessId, store: 'ai_execution_log', path: 'AiExecutionLogService.getStats' },
          ).length > 0)
        : byModule;

    const effectiveTotal = activeScoped
      ? visibleByModule.reduce(
          (sum, m) => sum + (typeof m._count === 'number' ? m._count : (m._count as Record<string, number>)?._all ?? 0),
          0,
        )
      : totalCount;

    return {
      period: { days, since },
      totalActions: effectiveTotal,
      successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100,
      byModule: visibleByModule.map(m => ({ module: m.module ?? 'unknown', count: typeof m._count === 'number' ? m._count : (m._count as Record<string, number>)?._all ?? 0 })),
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
    if (toolName.startsWith('fetch_')) return 'intelligence';
    if (toolName.startsWith('draft_')) return 'drafts';
    if (toolName.startsWith('create_') || toolName.startsWith('tag_') || toolName.startsWith('segment_') || toolName.startsWith('schedule_')) return 'organize';
    if (toolName.startsWith('queue_') || toolName.startsWith('send_') || toolName.startsWith('apply_') || toolName.startsWith('enable_') || toolName.startsWith('update_status')) return 'execute';
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
