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
    @Body() body: { name: string; trigger: string; actionData?: any },
  ) {
    return this.prisma.client.automation.create({
      data: {
        businessId,
        name: body.name,
        trigger: body.trigger,
        actionData: body.actionData ?? null,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/playbooks/:playbookId')
  updatePlaybook(
    @Param('businessId') businessId: string,
    @Param('playbookId') playbookId: string,
    @Body() body: { name?: string; trigger?: string; actionData?: any },
  ) {
    return this.prisma.client.automation.update({
      where: { id: playbookId, businessId },
      data: body,
    });
  }
}
