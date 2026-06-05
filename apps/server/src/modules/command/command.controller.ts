import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CommandService } from './command.service';
import { CommandGeneratorService } from './command-generator.service';
import { CommandSchedulerService } from './command-scheduler.service';
import { CreateCommandItemDto } from './dto/create-command-item.dto';
import { UpdateCommandItemDto } from './dto/update-command-item.dto';
import { ListCommandItemsDto } from './dto/list-command-items.dto';

@Controller('command/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class CommandController {
  constructor(
    @Inject(CommandService) private readonly commandService: CommandService,
    @Inject(CommandGeneratorService) private readonly generator: CommandGeneratorService,
    @Inject(CommandSchedulerService) private readonly scheduler: CommandSchedulerService,
  ) {}

  @Get('items')
  async list(
    @Param('businessId') businessId: string,
    @Query() query: ListCommandItemsDto,
  ) {
    return this.commandService.findMany(businessId, {
      status: query.status,
      category: query.category,
      sourceModule: query.sourceModule,
      ownerId: query.ownerId,
      ownerType: query.ownerType,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('items/:id')
  async getOne(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.findOne(businessId, id);
  }

  @Post('items')
  async create(
    @Param('businessId') businessId: string,
    @Body() dto: CreateCommandItemDto,
  ) {
    return this.commandService.create(businessId, dto);
  }

  @Patch('items/:id')
  async update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommandItemDto,
  ) {
    return this.commandService.update(businessId, id, dto);
  }

  @Post('items/:id/dismiss')
  async dismiss(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.dismiss(businessId, id);
  }

  @Post('items/:id/snooze')
  async snooze(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { until: string },
  ) {
    return this.commandService.snooze(businessId, id, new Date(body.until));
  }

  @Post('items/:id/approve')
  async approve(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.approve(businessId, id);
  }

  @Post('items/:id/execute')
  async execute(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { result?: Record<string, unknown> },
  ) {
    return this.commandService.execute(businessId, id, body.result);
  }

  @Post('items/:id/complete')
  async complete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.complete(businessId, id);
  }

  @Post('items/:id/assign')
  async assign(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { ownerType: string; ownerId: string },
  ) {
    return this.commandService.assign(businessId, id, body.ownerType, body.ownerId);
  }

  @Post('items/:id/reopen')
  async reopen(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.reopen(businessId, id);
  }

  @Delete('items/:id')
  async delete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.delete(businessId, id);
  }

  @Post('generate')
  async generate(
    @Param('businessId') businessId: string,
  ) {
    return this.generator.generateForBusiness(businessId);
  }

  @Get('summary')
  async summary(
    @Param('businessId') businessId: string,
  ) {
    return this.commandService.summary(businessId);
  }

  @Get('last-scan')
  async lastScan(@Param('businessId') businessId: string) {
    const lastScan = await this.scheduler.getLastScanTime(businessId);
    const shouldAutoScan = await this.scheduler.shouldAutoScan(businessId);
    return { lastScan, shouldAutoScan };
  }

  @Post('auto-scan')
  async autoScan(@Param('businessId') businessId: string) {
    const should = await this.scheduler.shouldAutoScan(businessId);
    if (!should) return { scanned: false, reason: 'Recent scan exists' };
    const result = await this.generator.generateForBusiness(businessId);
    return { scanned: true, result };
  }
}
