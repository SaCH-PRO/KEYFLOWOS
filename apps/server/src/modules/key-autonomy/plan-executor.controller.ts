import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { PlanExecutor, type ExecutionTrace, type ExecutionStatus } from './services/plan-executor.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateExecutionPlanDto } from './dto/create-execution-plan.dto';

/**
 * PlanExecutorController — REST API for managing ExecutionPlans.
 *
 * Endpoints:
 *   POST   /api/v1/key/plan                    — Create a plan
 *   GET    /api/v1/key/plan/:id/status         — Check plan status
 *   POST   /api/v1/key/plan/:id/execute        — Execute a plan
 *   POST   /api/v1/key/plan/:id/cancel         — Cancel execution
 *   GET    /api/v1/key/plans                   — List plans for business
 */
@Controller('key-autonomy/businesses/:businessId/plans')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class PlanExecutorController {
  constructor(
    @Inject(PlanExecutor) private readonly planExecutor: PlanExecutor,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private userId(req: { user?: { id?: string } }): string | undefined {
    return req.user?.id;
  }

  /**
   * POST /api/v1/key/plan
   * Create a new execution plan.
   */
  @Post()
  async createPlan(
    @Param('businessId') businessId: string,
    @Body() body: CreateExecutionPlanDto,
  ) {
    const plan = await this.prisma.executionPlan.create({
      data: {
        businessId,
        title: body.title,
        description: body.description ?? null,
        triggerType: body.triggerType ?? 'manual',
        status: body.status ?? 'draft',
        steps: body.steps as any,
        currentStepIndex: 0,
      },
    });

    return {
      id: plan.id,
      businessId: plan.businessId,
      title: plan.title,
      description: plan.description,
      triggerType: plan.triggerType,
      status: plan.status,
      steps: plan.steps,
      currentStepIndex: plan.currentStepIndex,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  /**
   * GET /api/v1/key/plan/:id/status
   * Check the execution status of a plan.
   */
  @Get(':planId/status')
  async getPlanStatus(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ): Promise<ExecutionStatus> {
    const plan = await this.prisma.executionPlan.findFirst({
      where: { id: planId, businessId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan ${planId} not found for business ${businessId}`);
    }

    const steps = (plan.steps as any[]) ?? [];

    return {
      planId: plan.id,
      status: plan.status,
      currentStepIndex: plan.currentStepIndex,
      totalSteps: steps.length,
      isRunning: plan.status === 'running',
    };
  }

  /**
   * POST /api/v1/key/plan/:id/execute
   * Execute a plan.
   */
  @Post(':planId/execute')
  async executePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: { user?: { id?: string } },
  ): Promise<ExecutionTrace> {
    // Verify plan belongs to business
    const plan = await this.prisma.executionPlan.findFirst({
      where: { id: planId, businessId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan ${planId} not found for business ${businessId}`);
    }

    return this.planExecutor.executePlan(planId, this.userId(req));
  }

  /**
   * POST /api/v1/key/plan/:id/cancel
   * Cancel a running plan execution.
   */
  @Post(':planId/cancel')
  async cancelPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    const plan = await this.prisma.executionPlan.findFirst({
      where: { id: planId, businessId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan ${planId} not found for business ${businessId}`);
    }

    this.planExecutor.cancelExecution(planId);

    // Also update DB status in case the execution loop already finished
    await this.prisma.executionPlan.update({
      where: { id: planId },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    return { success: true, planId, status: 'cancelled' };
  }

  /**
   * GET /api/v1/key/plans
   * List plans for a business with optional filters.
   */
  @Get()
  async listPlans(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('triggerType') triggerType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: { businessId: string; status?: string; triggerType?: string } = {
      businessId,
    };

    if (status) {
      where.status = status;
    }
    if (triggerType) {
      where.triggerType = triggerType;
    }

    const take = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const skip = offset ? parseInt(offset, 10) : 0;

    const [plans, total] = await Promise.all([
      this.prisma.executionPlan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.executionPlan.count({ where }),
    ]);

    return {
      data: plans,
      pagination: {
        total,
        limit: take,
        offset: skip,
        hasMore: skip + plans.length < total,
      },
    };
  }
}
