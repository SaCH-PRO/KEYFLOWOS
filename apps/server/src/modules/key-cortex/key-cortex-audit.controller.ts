import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { EvalHarnessService } from './eval-harness.service';
import { SelfAssessmentService } from './self-assessment.service';
import { DigitalEmployeeAcceptanceService } from './digital-employee-acceptance.service';
import { ValueLearningService } from './value-learning.service';
import { ComplianceMapService } from '../key-autonomy/compliance-map.service';

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

  @Get('eval/suites')
  evalSuiteNames() {
    return { suites: this.evalHarness.getSuiteNames() };
  }

  /**
   * Run the eval harness. NOT business-scoped, despite the route.
   *
   * The businessId in the path is there because this controller is mounted
   * under a per-business prefix, and it is the guard's input — it is NOT an
   * input to the eval. `EvalHarnessService.runAll()` and `runSuite()` take no
   * businessId and read no tenant data; they exercise the autonomy
   * orchestrator against a hardcoded synthetic `eval_biz`.
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
  async runEval(
    @Param('businessId') _businessId: string,
    @Body() body: { suite?: string },
  ) {
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
  async auditDecisions(
    @Param('businessId') businessId: string,
    @Body() _body: Record<string, never>,
  ) {
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
  async auditValues(@Param('businessId') businessId: string) {
    const constraints = await this.valueLearning.getValueConstraints(businessId, 0);
    const drift = await this.valueLearning.detectDrift(businessId);
    return { businessId, constraints, drift };
  }

  @Get('audit/assessment')
  async auditAssessment(@Param('businessId') businessId: string) {
    const report = await this.selfAssessment.generate(businessId);
    const compliance = this.compliance.getAll();
    return { businessId, report, compliance };
  }

  @Get('audit/acceptance')
  async auditAcceptance(@Param('businessId') businessId: string) {
    const scenario = this.acceptance.getScenario();
    const result = await this.acceptance.evaluate(businessId);
    return { businessId, scenario, result };
  }
}
