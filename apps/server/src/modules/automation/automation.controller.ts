import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('health')
  health() {
    return this.automation.health();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  list(@Param('businessId') businessId: string) {
    return this.automation.listAutomations(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId')
  create(@Param('businessId') businessId: string, @Body() body: CreateAutomationDto) {
    return this.automation.createAutomation({
      businessId,
      name: body.name,
      trigger: body.trigger,
      actionData: body.actionData ?? {},
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/:automationId')
  update(
    @Param('businessId') businessId: string,
    @Param('automationId') automationId: string,
    @Body() body: UpdateAutomationDto,
  ) {
    return this.automation.updateAutomation({
      businessId,
      automationId,
      name: body.name,
      trigger: body.trigger,
      actionData: body.actionData,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/:automationId')
  remove(@Param('businessId') businessId: string, @Param('automationId') automationId: string) {
    return this.automation.deleteAutomation({ businessId, automationId });
  }
}
