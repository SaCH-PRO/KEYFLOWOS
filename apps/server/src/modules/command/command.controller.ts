import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CommandService } from './command.service';
import { CommandGeneratorService } from './command-generator.service';
import { CommandSchedulerService } from './command-scheduler.service';
import { CreateCommandItemDto } from './dto/create-command-item.dto';
import { UpdateCommandItemDto } from './dto/update-command-item.dto';
import { ListCommandItemsDto } from './dto/list-command-items.dto';
import { ListDueObligationsDto } from './dto/list-due-obligations.dto';
import { DischargeObligationDto } from './dto/discharge-obligation.dto';
import { BulkCommandItemsDto } from './dto/bulk-command-items.dto';

/**
 * Command-centre items. Every route requires the 'operations' module scope
 * (owner ruling D-40, R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT): read for a GET,
 * write for every mutation, approve included (the level the operations
 * vocabulary gives an approval: payroll, data inbox and KEY approvals are
 * operations write). OWNER and ADMIN hold operations admin by role default,
 * STAFF read. ModuleScopeGuard reads the HANDLER's @RequireModuleScope, so each
 * route names its own level; a route without one runs ungated, and
 * test/ops-scope-command-procurement.integration.test.ts fails on it.
 */
@Controller('command/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class CommandController {
  constructor(
    @Inject(CommandService) private readonly commandService: CommandService,
    @Inject(CommandGeneratorService) private readonly generator: CommandGeneratorService,
    @Inject(CommandSchedulerService) private readonly scheduler: CommandSchedulerService,
  ) {}

  @RequireModuleScope('operations', 'read')
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

  /**
   * "What is due this week."
   *
   * Declared BEFORE `items/:id` on purpose — Nest matches routes in
   * declaration order, and `due` under a sibling path would be shadowed the
   * moment anyone moved it below a `:id` parameter route.
   */
  @RequireModuleScope('operations', 'read')
  @Get('items/due')
  async due(
    @Param('businessId') businessId: string,
    @Query() query: ListDueObligationsDto,
  ) {
    return this.commandService.findDue(businessId, {
      windowDays: query.windowDays,
      includeOverdue: query.includeOverdue,
      limit: query.limit,
    });
  }

  @RequireModuleScope('operations', 'read')
  @Get('items/:id')
  async getOne(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.findOne(businessId, id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items')
  async create(
    @Param('businessId') businessId: string,
    @Body() dto: CreateCommandItemDto,
  ) {
    return this.commandService.create(businessId, dto);
  }

  @RequireModuleScope('operations', 'write')
  @Patch('items/:id')
  async update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommandItemDto,
  ) {
    return this.commandService.update(businessId, id, dto);
  }

  /**
   * Bulk complete, dismiss and delete of the path business's items.
   *
   * Declared BEFORE the `items/:id/...` routes (R0-13f): below them
   * `items/bulk/complete` and `items/bulk/dismiss` were answered by complete and
   * dismiss as item 'bulk' (404). The service scopes every id to the path
   * business and refuses the whole call when any id is not one of its items,
   * so another tenant's id answers exactly as an unknown one. The guards are
   * the class's (AuthGuard, BusinessGuard, ModuleScopeGuard) and the scope the
   * single-item routes require (operations write, D-40).
   * route-shadowing.spec.ts keeps the order.
   */
  @RequireModuleScope('operations', 'write')
  @Post('items/bulk/complete')
  async bulkComplete(
    @Param('businessId') businessId: string,
    @Body() dto: BulkCommandItemsDto,
  ) {
    return this.commandService.bulkComplete(businessId, dto.ids);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/bulk/dismiss')
  async bulkDismiss(
    @Param('businessId') businessId: string,
    @Body() dto: BulkCommandItemsDto,
  ) {
    return this.commandService.bulkDismiss(businessId, dto.ids);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/bulk/delete')
  async bulkDelete(
    @Param('businessId') businessId: string,
    @Body() dto: BulkCommandItemsDto,
  ) {
    return this.commandService.bulkDelete(businessId, dto.ids);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/:id/dismiss')
  async dismiss(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.dismiss(businessId, id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/:id/snooze')
  async snooze(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { until: string },
  ) {
    return this.commandService.snooze(businessId, id, new Date(body.until));
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/:id/approve')
  async approve(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.approve(businessId, id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/:id/execute')
  async execute(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { result?: Record<string, unknown> },
  ) {
    return this.commandService.execute(businessId, id, body.result);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/:id/complete')
  async complete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.complete(businessId, id);
  }

  /**
   * Record that an obligation has been met.
   *
   * Distinct from `complete`, which is a person ticking something off a list.
   * Discharged means the thing owed actually happened, and `dischargeRef` names
   * what did it. Both remove the row from "what is due"; only this one leaves a
   * record of why.
   *
   * It exists because KEY has `command_discharge_obligation` and manual parity
   * is not optional here — anything KEY can change, a person must be able to
   * change too, or the guarantee that KEY is optional stops being true.
   */
  @RequireModuleScope('operations', 'write')
  @Post('items/:id/discharge')
  async discharge(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: DischargeObligationDto,
  ) {
    return this.commandService.discharge(businessId, id, body?.dischargeRef);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/:id/assign')
  async assign(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { ownerType: string; ownerId: string },
  ) {
    return this.commandService.assign(businessId, id, body.ownerType, body.ownerId);
  }

  @RequireModuleScope('operations', 'write')
  @Post('items/:id/reopen')
  async reopen(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.reopen(businessId, id);
  }

  @RequireModuleScope('operations', 'write')
  @Delete('items/:id')
  async delete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.commandService.delete(businessId, id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('generate')
  async generate(
    @Param('businessId') businessId: string,
  ) {
    return this.generator.generateForBusiness(businessId);
  }

  @RequireModuleScope('operations', 'read')
  @Get('summary')
  async summary(
    @Param('businessId') businessId: string,
  ) {
    return this.commandService.summary(businessId);
  }

  @RequireModuleScope('operations', 'read')
  @Get('last-scan')
  async lastScan(@Param('businessId') businessId: string) {
    const lastScan = await this.scheduler.getLastScanTime(businessId);
    const shouldAutoScan = await this.scheduler.shouldAutoScan(businessId);
    return { lastScan, shouldAutoScan };
  }

  @RequireModuleScope('operations', 'write')
  @Post('auto-scan')
  async autoScan(@Param('businessId') businessId: string) {
    const should = await this.scheduler.shouldAutoScan(businessId);
    if (!should) return { scanned: false, reason: 'Recent scan exists' };
    const result = await this.generator.generateForBusiness(businessId);
    return { scanned: true, result };
  }
}
