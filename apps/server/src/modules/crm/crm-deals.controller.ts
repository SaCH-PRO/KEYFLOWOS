import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PickType } from '@nestjs/mapped-types';
import { IsArray, IsString } from 'class-validator';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { CrmDealsService } from './crm-deals.service';
import {
  BulkMoveStageDto,
  CreateDealDto,
  CreateDealStageDto,
  CreateWonLostReasonDto,
  LoseDealDto,
  UpdateDealDto,
  UpdateDealStageDto,
  UpdateWonLostReasonDto,
  WinDealDto,
} from './dto/deal.dto';
import { DealForecastService } from './deal-forecast.service';
import { DealVelocityService } from './deal-velocity.service';
import { WonLostReasonService } from './won-lost-reason.service';

/**
 * The POST deals/bulk/move-stage body (R0-13f): BulkMoveStageDto's stageId rule
 * (PickType copies its validation metadata) and dealIds an array of strings.
 * BulkMoveStageDto checks only that dealIds is an array, so an element such as
 * `{ not: '' }` passed the global ValidationPipe and reached moveStage's
 * findFirst({ where: { id, businessId } }) as a Prisma filter, matching a deal
 * of the tenant the caller never named. The empty-list and 100-id checks stay
 * in CrmDealsService.bulkMoveStage with their own messages. Declared before
 * CrmDealsController, whose decorator metadata names it when the class is
 * defined.
 */
export class BulkMoveDealsStageDto extends PickType(BulkMoveStageDto, ['stageId'] as const) {
  @IsArray()
  @IsString({ each: true })
  dealIds!: string[];
}

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmDealsController {
  constructor(
    @Inject(CrmDealsService) private readonly deals: CrmDealsService,
    @Inject(DealForecastService) private readonly forecast: DealForecastService,
    @Inject(DealVelocityService) private readonly velocity: DealVelocityService,
    @Inject(WonLostReasonService) private readonly reasons: WonLostReasonService,
  ) {}

  // ---- intelligence ----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/deals/intelligence/forecast')
  getForecast(
    @Param('businessId') businessId: string,
    @Query('windowDays') windowDays?: string,
    @Query('currency') currency?: string,
  ) {
    return this.forecast.getForecast({
      businessId,
      windowDays: windowDays ? Number(windowDays) : undefined,
      currency: currency || undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/deals/intelligence/velocity')
  getVelocity(@Param('businessId') businessId: string) {
    return this.velocity.getReport(businessId);
  }

  // ---- won/lost reasons ----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/won-lost-reasons')
  listReasons(
    @Param('businessId') businessId: string,
    @Query('kind') kind?: string,
  ) {
    const validKind = kind === 'WON' || kind === 'LOST' ? kind : undefined;
    return this.reasons.list({ businessId, kind: validKind });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/won-lost-reasons')
  createReason(@Param('businessId') businessId: string, @Body() body: CreateWonLostReasonDto) {
    return this.reasons.create({ ...body, businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/won-lost-reasons/:reasonId')
  updateReason(
    @Param('businessId') businessId: string,
    @Param('reasonId') reasonId: string,
    @Body() body: UpdateWonLostReasonDto,
  ) {
    return this.reasons.update({ ...body, businessId, reasonId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/won-lost-reasons/:reasonId')
  deleteReason(
    @Param('businessId') businessId: string,
    @Param('reasonId') reasonId: string,
  ) {
    return this.reasons.remove({ businessId, reasonId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/deal-stages')
  listStages(@Param('businessId') businessId: string) {
    return this.deals.listStages(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/deal-stages')
  createStage(@Param('businessId') businessId: string, @Body() body: CreateDealStageDto) {
    return this.deals.createStage({ ...body, businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/deal-stages/:stageId')
  updateStage(
    @Param('businessId') businessId: string,
    @Param('stageId') stageId: string,
    @Body() body: UpdateDealStageDto,
  ) {
    return this.deals.updateStage({ ...body, businessId, stageId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/deal-stages/:stageId')
  deleteStage(
    @Param('businessId') businessId: string,
    @Param('stageId') stageId: string,
    @Query('reassignToStageId') reassignToStageId?: string,
  ) {
    return this.deals.deleteStage({ businessId, stageId, reassignToStageId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/deals')
  listDeals(
    @Param('businessId') businessId: string,
    @Query('stageIds') stageIds?: string | string[],
    @Query('ownerId') ownerId?: string,
    @Query('status') status?: string,
    @Query('contactId') contactId?: string,
    @Query('minValue') minValue?: string,
    @Query('maxValue') maxValue?: string,
    @Query('expectedCloseFrom') expectedCloseFrom?: string,
    @Query('expectedCloseTo') expectedCloseTo?: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string | string[],
    @Query('accountId') accountId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const toArr = (v?: string | string[]) => (Array.isArray(v) ? v : v ? v.split(',').filter(Boolean) : undefined);
    const validStatus = ['OPEN', 'WON', 'LOST', 'ALL'];
    return this.deals.listDeals({
      businessId,
      stageIds: toArr(stageIds),
      ownerId: ownerId || undefined,
      status: status && validStatus.includes(status) ? (status as 'OPEN' | 'WON' | 'LOST' | 'ALL') : undefined,
      contactId: contactId || undefined,
      minValue: minValue ? Number(minValue) : undefined,
      maxValue: maxValue ? Number(maxValue) : undefined,
      expectedCloseFrom: expectedCloseFrom ? new Date(expectedCloseFrom) : undefined,
      expectedCloseTo: expectedCloseTo ? new Date(expectedCloseTo) : undefined,
      search: search || undefined,
      tags: toArr(tags),
      accountId: accountId || undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/deals')
  createDeal(
    @Param('businessId') businessId: string,
    @Body() body: CreateDealDto,
    @Req() req: any,
  ) {
    return this.deals.createDeal({ ...body, businessId, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/deals/:dealId')
  getDeal(@Param('businessId') businessId: string, @Param('dealId') dealId: string) {
    return this.deals.getDeal({ businessId, dealId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/deals/:dealId')
  updateDeal(
    @Param('businessId') businessId: string,
    @Param('dealId') dealId: string,
    @Body() body: UpdateDealDto,
    @Req() req: any,
  ) {
    return this.deals.updateDeal({ ...body, businessId, dealId, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/deals/:dealId')
  deleteDeal(
    @Param('businessId') businessId: string,
    @Param('dealId') dealId: string,
    @Req() req: any,
  ) {
    return this.deals.deleteDeal({ businessId, dealId, actorId: req?.user?.id });
  }

  /**
   * Move several deals of the path business to one of its stages.
   *
   * Declared BEFORE `deals/:dealId/move-stage` (R0-13f): below it this route
   * was answered by moveStage as deal 'bulk' (404), so the deals board's and
   * list's bulk move never worked. It needs the single move's guards and crm
   * 'write', and CrmDealsService.bulkMoveStage hands each id to moveStage, the
   * single move's own tenant check: another tenant's deal or an unknown id is
   * skipped with the same per-id result, and another tenant's stage moves
   * nothing. route-shadowing.spec.ts keeps the order.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/deals/bulk/move-stage')
  bulkMoveStage(
    @Param('businessId') businessId: string,
    @Body() body: BulkMoveDealsStageDto,
    @Req() req: any,
  ) {
    return this.deals.bulkMoveStage({ businessId, dealIds: body.dealIds, stageId: body.stageId, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Post('businesses/:businessId/deals/:dealId/move-stage')
  moveStage(
    @Param('businessId') businessId: string,
    @Param('dealId') dealId: string,
    @Body() body: { stageId: string },
    @Req() req: any,
  ) {
    return this.deals.moveStage({ businessId, dealId, stageId: body.stageId, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/deals/:dealId/win')
  winDeal(
    @Param('businessId') businessId: string,
    @Param('dealId') dealId: string,
    @Body() body: WinDealDto,
    @Req() req: any,
  ) {
    return this.deals.winDeal({ ...body, businessId, dealId, actorId: req?.user?.id ?? undefined });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/deals/:dealId/lose')
  loseDeal(
    @Param('businessId') businessId: string,
    @Param('dealId') dealId: string,
    @Body() body: LoseDealDto,
    @Req() req: any,
  ) {
    return this.deals.loseDeal({ ...body, businessId, dealId, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/deals')
  listContactDeals(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('status') status?: string,
  ) {
    const validStatus = ['OPEN', 'WON', 'LOST', 'ALL'];
    return this.deals.listContactDeals({
      businessId,
      contactId,
      status: status && validStatus.includes(status) ? (status as 'OPEN' | 'WON' | 'LOST' | 'ALL') : undefined,
    });
  }
}
