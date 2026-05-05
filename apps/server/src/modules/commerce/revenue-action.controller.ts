import {
  Body, Controller, ForbiddenException, Get, HttpException, HttpStatus,
  Inject, NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevenueActionService } from './revenue-action.service';

@Controller('commerce/businesses/:businessId/revenue-actions')
@UseGuards(AuthGuard, BusinessGuard)
export class RevenueActionController {
  constructor(
    @Inject(RevenueActionService) private readonly service: RevenueActionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async ensureAccess(userId: string, businessId: string) {
    const biz = await this.prisma.client.business.findFirst({
      where: { id: businessId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true },
    });
    if (!biz) throw new ForbiddenException('No access to this business');
  }

  @Get()
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.service.list(businessId, {
      status: status ?? 'PENDING',
      limit: limit ? Math.max(1, Math.min(200, parseInt(limit, 10) || 50)) : 50,
    });
    return { items };
  }

  @Get('overview')
  async overview(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const [kpis, pulse, top] = await Promise.all([
      this.service.overviewKpis(businessId),
      this.service.revenuePulse(businessId),
      this.service.topPriority(businessId, 5),
    ]);
    return { kpis, pulse, top };
  }

  @Post('reconcile')
  async reconcile(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const created = await this.service.reconcileBusiness(businessId);
    return { created };
  }

  @Post(':id/complete')
  async complete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { resolution?: string } | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    try {
      return await this.service.complete(businessId, id, req.user.id, body?.resolution ?? null);
    } catch (e) {
      throw new NotFoundException((e as Error).message);
    }
  }

  @Post(':id/dismiss')
  async dismiss(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { resolution?: string } | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    try {
      return await this.service.dismiss(businessId, id, req.user.id, body?.resolution ?? null);
    } catch (e) {
      throw new NotFoundException((e as Error).message);
    }
  }

  @Post(':id/snooze')
  async snooze(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { until?: string; hours?: number } | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    let until: Date;
    if (body?.until) {
      until = new Date(body.until);
      if (Number.isNaN(until.getTime())) {
        throw new HttpException('Invalid `until` timestamp', HttpStatus.BAD_REQUEST);
      }
    } else {
      const hours = Math.max(1, Math.min(24 * 30, body?.hours ?? 24));
      until = new Date(Date.now() + hours * 3600_000);
    }
    try {
      return await this.service.snooze(businessId, id, until, req.user.id);
    } catch (e) {
      throw new NotFoundException((e as Error).message);
    }
  }
}
