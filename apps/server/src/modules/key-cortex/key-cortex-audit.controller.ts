import {
  Controller,
  Get,
  Post,
  Body,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GuardedBusinessId } from '../../core/auth/request-business-id';
import { EvalHarnessService } from './eval-harness.service';
import { SelfAssessmentService } from './self-assessment.service';
import { DigitalEmployeeAcceptanceService } from './digital-employee-acceptance.service';
import { ValueLearningService } from './value-learning.service';
import { ComplianceMapService } from '../key-autonomy/compliance-map.service';

/**
 * Mounted at `/api/v1/cortex` with no `:businessId` path segment, so the tenant
 * is named by the request (`?businessId=` from the web compliance page) and
 * BusinessGuard resolves and checks it from params, then body, then query.
 *
 * R0-34-KEY-AUDIT-TENANT (PRS-M30): the audit handlers used to read
 * `@Param('businessId')`, which on these paths is always `undefined`, and pass
 * it to Prisma, where `where: { businessId: undefined }` is no filter at all —
 * a member of business A who named A got every tenant's AutonomyVerdict and
 * ValueConstraint rows. They now take `@GuardedBusinessId()`, the same
 * resolver the guard ran, so a handler cannot act on a tenant the guard did
 * not check.
 */
@Controller('/api/v1/cortex')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyCortexAuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evalHarness: EvalHarnessService,
    private readonly selfAssessment: SelfAssessmentService,
    private readonly acceptance: DigitalEmployeeAcceptanceService,
    private readonly valueLearning: ValueLearningService,
    private readonly compliance: ComplianceMapService,
  ) {}

  /**
   * The tenant an audit route reads. `undefined` only when no request field
   * named one: BusinessGuard already refuses that for every ordinary user, and
   * SUPER_ADMIN — who bypasses the guard — is refused here for the same
   * reason, because a tenant that reaches Prisma as `undefined` reads every
   * tenant's rows.
   */
  private requireGuardedTenant(businessId: string | undefined): string {
    if (!businessId) throw new ForbiddenException('businessId is required');
    return businessId;
  }

  @Get('eval/suites')
  evalSuiteNames() {
    return { suites: this.evalHarness.getSuiteNames() };
  }

  /**
   * Run the eval harness. NOT business-scoped.
   *
   * BusinessGuard still requires the caller to name a business they belong to,
   * but that tenant is NOT an input to the eval. `EvalHarnessService.runAll()`
   * and `runSuite()` take no businessId and read no tenant data; they exercise
   * the autonomy orchestrator against a hardcoded synthetic `eval_biz`. (The
   * handler used to declare an unused `@Param('businessId')` on a path with no
   * such segment; it is gone, and nothing here reads a tenant.)
   *
   * This used to return `{ businessId, results, allPass }`, which read as "your
   * business's eval results" for a run the businessId had no effect on. That is
   * the fabricated-scope shape this codebase keeps finding — the response
   * describes something that did not happen, and no caller could tell. It is
   * not a tenant leak (nothing crosses, because nothing tenant-scoped is read),
   * which is precisely why it would have survived a security review and gone on
   * misleading whoever wired a UI to it.
   *
   * `scope: 'synthetic'` is the honest answer. Verified safe to change: this
   * endpoint has zero callers in apps/web and apps/server.
   */
  @Post('eval/run')
  async runEval(@Body() body: { suite?: string }) {
    const results = body.suite
      ? [await this.evalHarness.runSuite(body.suite)]
      : await this.evalHarness.runAll();
    return {
      scope: 'synthetic' as const,
      results,
      allPass: results.every((r) => r.failed === 0),
    };
  }

  @Get('audit/decisions')
  async auditDecisions(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const [recent, total, blocked] = await Promise.all([
      this.prisma.client.autonomyVerdict.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.autonomyVerdict.count({ where: { businessId } }),
      this.prisma.client.autonomyVerdict.count({ where: { businessId, allowed: false } }),
    ]);

    return { businessId, total, blocked, recent };
  }

  @Get('audit/values')
  async auditValues(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const constraints = await this.valueLearning.getValueConstraints(businessId, 0);
    const drift = await this.valueLearning.detectDrift(businessId);
    return { businessId, constraints, drift };
  }

  @Get('audit/assessment')
  async auditAssessment(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const report = await this.selfAssessment.generate(businessId);
    const compliance = this.compliance.getAll();
    return { businessId, report, compliance };
  }

  @Get('audit/acceptance')
  async auditAcceptance(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const scenario = this.acceptance.getScenario();
    const result = await this.acceptance.evaluate(businessId);
    return { businessId, scenario, result };
  }
}
