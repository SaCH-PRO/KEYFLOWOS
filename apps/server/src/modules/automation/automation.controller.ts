import { Body, Controller, Get, Inject, Param, Post, Patch, UseGuards } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('automation')
export class AutomationController {
  constructor(
    @Inject(AutomationService) private readonly automation: AutomationService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return this.automation.health();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/playbooks')
  async listPlaybooks(@Param('businessId') businessId: string) {
    const rows = await this.prisma.client.automation.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      triggerEvent: r.trigger,
      actions: r.actionData ?? [],
      enabled: r.enabled ?? true,
      lastRunAt: r.lastRunAt,
      runCount: r.runCount ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/playbooks')
  async createPlaybook(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; triggerEvent?: string; trigger?: string; actions?: any; actionData?: any },
  ) {
    const row = await this.prisma.client.automation.create({
      data: {
        businessId,
        name: body.name,
        trigger: body.triggerEvent || body.trigger || '',
        actionData: body.actions || body.actionData || null,
      },
    });
    return {
      id: row.id,
      name: row.name,
      triggerEvent: row.trigger,
      actions: row.actionData ?? [],
      enabled: (row as any).enabled ?? true,
      lastRunAt: (row as any).lastRunAt,
      runCount: (row as any).runCount ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/playbooks/:playbookId')
  async updatePlaybook(
    @Param('businessId') businessId: string,
    @Param('playbookId') playbookId: string,
    @Body() body: { name?: string; triggerEvent?: string; trigger?: string; actions?: any; actionData?: any; enabled?: boolean },
  ) {
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.triggerEvent !== undefined || body.trigger !== undefined) updateData.trigger = body.triggerEvent || body.trigger;
    if (body.actions !== undefined || body.actionData !== undefined) updateData.actionData = body.actions || body.actionData;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    const row = await this.prisma.client.automation.update({
      where: { id: playbookId, businessId },
      data: updateData,
    });
    return {
      id: row.id,
      name: row.name,
      triggerEvent: row.trigger,
      actions: row.actionData ?? [],
      enabled: (row as any).enabled ?? true,
      lastRunAt: (row as any).lastRunAt,
      runCount: (row as any).runCount ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
