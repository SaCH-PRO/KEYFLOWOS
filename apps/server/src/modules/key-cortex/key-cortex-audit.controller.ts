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
import { getTenantContext, runWithTenant } from '../../core/tenant/tenant-context';
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
 * not check — and they run their reads with the ambient tenant (the one the
 * Prisma tenant extension injects) pinned to that same tenant; see
 * `inGuardedTenant`.
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

  /**
   * Run an audit read for the guard-checked tenant, with the ambient tenant
   * pinned to it.
   *
   * R0-34 review ST-1. In production the global TenantInterceptor
   * (app.module.ts) installs the ambient tenant from
   * `params.businessId || body.businessId || query.businessId` with no type
   * check, and the Prisma tenant extension (packages/db) then overwrites every
   * scoped query's `where.businessId` with it. BusinessGuard and
   * @GuardedBusinessId take the first non-empty STRING instead. So
   * `GET audit/decisions?businessId=A` with the JSON body
   * `{"businessId":{"not":"x"}}` (or `{"equals":"B"}`, or the urlencoded
   * `businessId[not]=x`) passed the guard against A and reached this handler
   * with A, and the extension replaced the handler's `where.businessId: 'A'`
   * with the object, which Prisma reads as a filter: every tenant's rows, or
   * B's, under a response that said A.
   *
   * Re-binding the ambient tenant to the guard-checked string makes the
   * extension inject exactly what the handler and the guard agreed on. When no
   * ambient tenant is installed (the interceptor did not run) the extension is
   * inert and the explicit `where` binds alone. The interceptor itself is
   * outside this packet; once it resolves the tenant with
   * resolveRequestBusinessId, this re-bind is a no-op.
   *
   * `read` must await its queries itself: a Prisma query runs when it is
   * awaited, so one returned un-awaited would execute after this context ends.
   */
  private async inGuardedTenant<T>(
    guardedBusinessId: string | undefined,
    read: (businessId: string) => Promise<T>,
  ): Promise<T> {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const ambient = getTenantContext();
    if (!ambient) return read(businessId);
    return runWithTenant(businessId, ambient.userId, () => read(businessId));
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
    return this.inGuardedTenant(guardedBusinessId, async (businessId) => {
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
    });
  }

  @Get('audit/values')
  async auditValues(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    return this.inGuardedTenant(guardedBusinessId, async (businessId) => {
      const constraints = await this.valueLearning.getValueConstraints(businessId, 0);
      const drift = await this.valueLearning.detectDrift(businessId);
      return { businessId, constraints, drift };
    });
  }

  @Get('audit/assessment')
  async auditAssessment(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    return this.inGuardedTenant(guardedBusinessId, async (businessId) => {
      const report = await this.selfAssessment.generate(businessId);
      const compliance = this.compliance.getAll();
      return { businessId, report, compliance };
    });
  }

  @Get('audit/acceptance')
  async auditAcceptance(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    return this.inGuardedTenant(guardedBusinessId, async (businessId) => {
      const scenario = this.acceptance.getScenario();
      const result = await this.acceptance.evaluate(businessId);
      return { businessId, scenario, result };
    });
  }
}
