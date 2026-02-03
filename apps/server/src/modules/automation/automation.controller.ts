import { Body, Controller, Get, Param, Post, Patch, UseGuards } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('automation')
export class AutomationController {
  constructor(
    private readonly automation: AutomationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return this.automation.health();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/playbooks')
  listPlaybooks(@Param('businessId') businessId: string) {
    return this.prisma.client.automation.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/playbooks')
  createPlaybook(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; triggerEvent: string; actions: any },
  ) {
    return this.prisma.client.automation.create({
      data: {
        businessId,
        name: body.name,
        triggerEvent: body.triggerEvent,
        actions: body.actions,
        enabled: false,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/playbooks/:playbookId')
  updatePlaybook(
    @Param('businessId') businessId: string,
    @Param('playbookId') playbookId: string,
    @Body() body: { name?: string; triggerEvent?: string; actions?: any; enabled?: boolean },
  ) {
    return this.prisma.client.automation.update({
      where: { id: playbookId, businessId },
      data: body,
    });
  }
}
