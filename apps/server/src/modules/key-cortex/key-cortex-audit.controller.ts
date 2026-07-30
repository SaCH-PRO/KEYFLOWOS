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

  @Post('eval/run')
  async runEval(
    @Param('businessId') businessId: string,
    @Body() body: { suite?: string },
  ) {
    const results = body.suite
      ? [await this.evalHarness.runSuite(body.suite)]
      : await this.evalHarness.runAll();
    return { businessId, results, allPass: results.every((r) => r.failed === 0) };
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
