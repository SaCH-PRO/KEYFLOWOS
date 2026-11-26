import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { assertMemberModuleLevel, memberModuleLevel, type ModuleLevelActor } from '../../core/auth/member-module-level';
import { LEVEL_RANK, rankOf } from '../../core/authority/module-vocabulary';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RulesService } from './rules.service';
import { SignalsService } from './signals.service';
import { HealthScoreService } from './health-score.service';
import { ScheduledScansService } from './scheduled-scans.service';
import { EntityResolverService, type EntityResolutionInput } from './entity-resolver.service';
import { CreateBusinessRuleDto, UpdateBusinessRuleDto } from './dto/create-rule.dto';

@Controller('intelligence/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class IntelligenceController {
  constructor(
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(SignalsService) private readonly signals: SignalsService,
    @Inject(HealthScoreService) private readonly health: HealthScoreService,
    @Inject(ScheduledScansService) private readonly scans: ScheduledScansService,
    @Inject(EntityResolverService) private readonly resolver: EntityResolverService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ─── Rules ───
  @Get('rules')
  @RequireModuleScope('settings', 'read')
  async listRules(@Param('businessId') businessId: string, @Query('module') module?: string) {
    return this.rules.listRules(businessId, { module });
  }

  @Post('rules')
  @RequireModuleScope('settings', 'write')
  async createRule(@Param('businessId') businessId: string, @Body() dto: CreateBusinessRuleDto) {
    return this.rules.createRule(businessId, dto);
  }

  @Patch('rules/:id')
  @RequireModuleScope('settings', 'write')
  async updateRule(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateBusinessRuleDto) {
    return this.rules.updateRule(businessId, id, dto);
  }

  @Delete('rules/:id')
  @RequireModuleScope('settings', 'write')
  async deleteRule(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.rules.deleteRule(businessId, id);
  }

  @Post('rules/seed')
  @RequireModuleScope('settings', 'write')
  async seedRules(@Param('businessId') businessId: string) {
    await this.rules.seedSystemRules(businessId);
    return { success: true };
  }

  // ─── Signals ───
  @Get('signals')
  @RequireModuleScope('settings', 'read')
  async listSignals(
    @Param('businessId') businessId: string,
    @Query('module') module?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
  ) {
    return this.signals.listSignals(businessId, { module, status, severity });
  }

  @Post('signals/:id/resolve')
  @RequireModuleScope('settings', 'write')
  async resolveSignal(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.signals.resolveSignal(businessId, id);
  }

  @Post('signals/:id/dismiss')
  @RequireModuleScope('settings', 'write')
  async dismissSignal(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.signals.dismissSignal(businessId, id);
  }

  // ─── Health ───
  // FU-HEALTH-MONEY-SCOPE (P101, D-259/D-100/D-234): snapshots always persist full money metrics
  // and reasons; the response projects the money area to strip figures and amount-bearing reasons
  // whenever the caller lacks revenue:read, leaving score, status, and other areas unchanged.
  @Get('health')
  @RequireModuleScope('settings', 'read')
  async getHealth(@Param('businessId') businessId: string, @Req() req: { user?: ModuleLevelActor }) {
    const hasRevenueRead = rankOf(await memberModuleLevel(this.prisma, businessId, req?.user, 'revenue')) >= LEVEL_RANK.read;
    const snapshots = await this.health.getLatestSnapshots(businessId);
    if (snapshots.length === 0) {
      const calculated = await this.health.calculateAll(businessId);
      for (const r of calculated) await this.health.saveSnapshot(businessId, r);
      return this.health.projectHealthForReader(calculated, hasRevenueRead);
    }
    return this.health.projectHealthForReader(snapshots, hasRevenueRead);
  }

  @Post('health/refresh')
  @RequireModuleScope('settings', 'write')
  async refreshHealth(@Param('businessId') businessId: string, @Req() req: { user?: ModuleLevelActor }) {
    const hasRevenueRead = rankOf(await memberModuleLevel(this.prisma, businessId, req?.user, 'revenue')) >= LEVEL_RANK.read;
    const results = await this.health.calculateAll(businessId);
    for (const r of results) await this.health.saveSnapshot(businessId, r);
    return this.health.projectHealthForReader(results, hasRevenueRead);
  }

  // ─── Entity Resolver ───
  @Get('entities/resolve')
  @RequireModuleScope('settings', 'read')
  async resolveEntities(
    @Param('businessId') businessId: string,
    @Query('type') type: string,
    @Query('id') id: string,
  ) {
    return this.resolver.resolveOne(businessId, type, id);
  }

  @Post('entities/resolve-many')
  @RequireModuleScope('settings', 'read')
  async resolveEntitiesMany(
    @Param('businessId') businessId: string,
    @Body() body: { entities: EntityResolutionInput[] },
  ) {
    return this.resolver.resolveMany(businessId, body.entities);
  }

  // ─── Scans ───
  // FU-FINANCE-INTEL-DOORS (owner ruling D-258: "POST intelligence scan (finance and the intelligence module's scan)
  // needs revenue read"): the scan writes money signals and command items (overdue invoices, open quotes,
  // uncategorised expenses), so beside the route's settings write (ModuleScopeGuard, unchanged) it needs revenue read,
  // checked first in the handler with the guard's words, before anything is read or written. The scheduled run
  // (runAllScans) has no member and is unchanged.
  @Post('scan')
  @RequireModuleScope('settings', 'write')
  async runScan(@Param('businessId') businessId: string, @Req() req: { user?: ModuleLevelActor }) {
    await assertMemberModuleLevel(this.prisma, businessId, req?.user, 'revenue', 'read');
    await this.scans.scanBusiness(businessId);
    return { success: true };
  }
}
