import { Controller, Get, Param, Query, Req, UseGuards, Inject, ForbiddenException, HttpException, HttpStatus, Header } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AiUsageService } from './ai-usage.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Request } from 'express';

@Controller('api/admin/ai-usage')
@UseGuards(AuthGuard)
export class AiUsageAdminController {
  constructor(
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private assertSuperAdmin(req: Request) {
    const user = (req as { user?: { role?: string } }).user;
    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin access required');
    }
  }

  @Get('businesses/:businessId/summary')
  async businessSummary(@Req() req: Request, @Param('businessId') businessId: string) {
    this.assertSuperAdmin(req);
    return this.aiUsage.getUsageSummary(businessId);
  }

  @Get('businesses/:businessId/history')
  async businessHistory(
    @Req() req: Request,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.assertSuperAdmin(req);
    return this.aiUsage.getUsageHistory(
      businessId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get('businesses/:businessId/alerts')
  async businessAlerts(
    @Req() req: Request,
    @Param('businessId') businessId: string,
    @Query('notified') notified?: string,
  ) {
    this.assertSuperAdmin(req);
    const where: Record<string, unknown> = { businessId };
    if (notified !== undefined) {
      where.notified = notified === 'true';
    }
    return this.prisma.client.aiUsageAlert.findMany({
      where,
      orderBy: { triggeredAt: 'desc' },
      take: 100,
    });
  }

  @Get('platform-summary')
  @Header('Cache-Control', 'max-age=30, stale-while-revalidate=60')
  async platformSummary(@Req() req: Request) {
    this.assertSuperAdmin(req);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalAgg,
      topBusinesses,
      byFeature,
      byProvider,
      totalAlerts,
      unnotifiedAlerts,
    ] = await Promise.all([
      this.prisma.client.aiUsageLog.aggregate({
        where: { createdAt: { gte: periodStart } },
        _sum: { creditsUsed: true, estimatedCost: true, totalTokens: true },
        _count: true,
      }),
      this.prisma.client.aiUsageLog.groupBy({
        by: ['businessId'],
        where: { createdAt: { gte: periodStart } },
        _sum: { creditsUsed: true, estimatedCost: true },
        _count: true,
        orderBy: { _sum: { creditsUsed: 'desc' } },
        take: 20,
      }),
      this.prisma.client.aiUsageLog.groupBy({
        by: ['feature'],
        where: { createdAt: { gte: periodStart } },
        _sum: { creditsUsed: true, estimatedCost: true },
        _count: true,
        orderBy: { _sum: { creditsUsed: 'desc' } },
      }),
      this.prisma.client.aiUsageLog.groupBy({
        by: ['provider'],
        where: { createdAt: { gte: periodStart } },
        _sum: { creditsUsed: true, estimatedCost: true, totalTokens: true },
        _count: true,
      }),
      this.prisma.client.aiUsageAlert.count(),
      this.prisma.client.aiUsageAlert.count({ where: { notified: false } }),
    ]);

    return {
      periodStart,
      periodEnd: now,
      totals: {
        calls: totalAgg._count,
        creditsUsed: totalAgg._sum.creditsUsed ?? 0,
        estimatedCost: Math.round((totalAgg._sum.estimatedCost ?? 0) * 100) / 100,
        totalTokens: totalAgg._sum.totalTokens ?? 0,
      },
      topBusinesses: topBusinesses.map((b) => ({
        businessId: b.businessId,
        credits: b._sum.creditsUsed ?? 0,
        calls: b._count,
        cost: Math.round((b._sum.estimatedCost ?? 0) * 100) / 100,
      })),
      byFeature: byFeature.map((f) => ({
        feature: f.feature,
        credits: f._sum.creditsUsed ?? 0,
        calls: f._count,
        cost: Math.round((f._sum.estimatedCost ?? 0) * 100) / 100,
      })),
      byProvider: byProvider.map((p) => ({
        provider: p.provider,
        credits: p._sum.creditsUsed ?? 0,
        calls: p._count,
        tokens: p._sum.totalTokens ?? 0,
        cost: Math.round((p._sum.estimatedCost ?? 0) * 100) / 100,
      })),
      alerts: { total: totalAlerts, unnotified: unnotifiedAlerts },
    };
  }

  @Get('platform-alerts')
  @Header('Cache-Control', 'max-age=30, stale-while-revalidate=60')
  async platformAlerts(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.assertSuperAdmin(req);

    const take = limit ? parseInt(limit, 10) : 50;
    const skip = offset ? parseInt(offset, 10) : 0;

    const [alerts, total] = await Promise.all([
      this.prisma.client.aiUsageAlert.findMany({
        where: { notified: false },
        orderBy: { triggeredAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.client.aiUsageAlert.count({ where: { notified: false } }),
    ]);

    return { alerts, total, limit: take, offset: skip };
  }

  @Get('health')
  @Header('Cache-Control', 'no-store')
  async health(@Req() req: Request) {
    this.assertSuperAdmin(req);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [recentLogsAgg, errorLogs, alertCount] = await Promise.all([
      this.prisma.client.aiUsageLog.aggregate({
        where: { createdAt: { gte: periodStart } },
        _count: true,
        _sum: { creditsUsed: true, estimatedCost: true },
      }),
      this.prisma.client.aiUsageLog.count({
        where: {
          createdAt: { gte: periodStart },
          errorCode: { not: null },
        },
      }),
      this.prisma.client.aiUsageAlert.count({
        where: { notified: false },
      }),
    ]);

    const totalCalls = recentLogsAgg._count ?? 0;
    const errorRate = totalCalls > 0 ? errorLogs / totalCalls : 0;

    const status = errorRate > 0.1 || alertCount > 50 ? 'degraded' : 'healthy';

    const body = {
      status,
      module: 'ai-usage',
      checkedAt: now.toISOString(),
      today: {
        calls: totalCalls,
        creditsUsed: recentLogsAgg._sum.creditsUsed ?? 0,
        estimatedCost: Math.round((recentLogsAgg._sum.estimatedCost ?? 0) * 100) / 100,
        errors: errorLogs,
        errorRate: Math.round(errorRate * 10000) / 10000,
      },
      alerts: {
        unnotified: alertCount,
      },
    };

    if (status === 'degraded') {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }
}
