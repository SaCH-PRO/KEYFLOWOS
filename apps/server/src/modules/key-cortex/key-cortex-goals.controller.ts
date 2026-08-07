import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeyCortexPlannerService, CreateGoalInput } from './key-cortex-planner.service';
import { KeyCortexTriggerService } from './key-cortex-trigger.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

/*
 * These DTOs carry validator metadata because the global ValidationPipe runs
 * with `whitelist: true`, which DELETES any property without it. Undecorated,
 * every body here arrived as {} and the handlers' own guard clauses threw 400 —
 * so goal and plan creation were unreachable over HTTP.
 *
 * businessId is declared explicitly on the bodies that carry it: BusinessGuard
 * reads the RAW pre-pipe body so it passed, but the handler then read a
 * stripped value and rejected the request itself.
 */

class CreateGoalDto implements CreateGoalInput {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  targetDate?: string;

  // Ownership is enforced in KeyCortexPlannerService.createGoal, which proves
  // the parent belongs to the same business before writing it. Validating the
  // shape here is not sufficient on its own.
  @IsOptional()
  @IsString()
  parentGoalId?: string;

  @IsString()
  businessId: string;
}

class CreatePlanFromGoalDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  businessId?: string;
}

class CreatePlanFromCommandDto {
  @IsString()
  objective: string;

  @IsOptional()
  @IsString()
  rawInput?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'critical'])
  urgency?: 'low' | 'normal' | 'high' | 'critical';

  @IsOptional()
  @IsArray()
  modules?: string[];

  @IsOptional()
  @IsArray()
  scope?: string[];

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  businessId?: string;
}

class CreateTriggerRuleDto {
  @IsString()
  businessId: string;

  @IsString()
  eventType: string;

  // @Allow: a free-form filter document validated by the trigger service, not
  // a shape this DTO can usefully constrain.
  @IsOptional()
  @Allow()
  filterJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  goalTemplateId?: string;

  @IsOptional()
  @IsInt()
  cooldownMinutes?: number;

  @IsOptional()
  @IsInt()
  maxDailyFirings?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class UpdateTriggerRuleDto {
  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @Allow()
  filterJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  goalTemplateId?: string;

  @IsOptional()
  @IsInt()
  cooldownMinutes?: number;

  @IsOptional()
  @IsInt()
  maxDailyFirings?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  businessId?: string;
}

@Controller('/api/v1/cortex')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyCortexGoalsController {
  private readonly logger = new Logger(KeyCortexGoalsController.name);

  constructor(
    private readonly planner: KeyCortexPlannerService,
    private readonly triggerService: KeyCortexTriggerService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('goals')
  async createGoal(@Body() dto: CreateGoalDto & { businessId: string }) {
    if (!dto.businessId || !dto.title) {
      throw new BadRequestException('businessId and title are required');
    }
    this.logger.log(`[goals] create goal for ${dto.businessId}: ${dto.title}`);
    return this.planner.createGoal(dto.businessId, dto);
  }

  @Get('goals')
  async listGoals(
    @Query('businessId') businessId: string,
    @Query('status') status?: string,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    return this.planner.listGoals(businessId, status);
  }

  @Get('goals/:goalId')
  async getGoal(
    @Param('goalId') goalId: string,
    @Query('businessId') businessId: string,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    return this.planner.getGoal(businessId, goalId);
  }

  @Post('goals/:goalId/plans')
  async createPlanFromGoal(
    @Param('goalId') goalId: string,
    @Body() dto: CreatePlanFromGoalDto & { businessId?: string },
  ) {
    // businessId was absent here entirely, so the goal id from the URL was
    // resolved against every business. Every sibling route on this controller
    // already demanded it; this one did not, and it is the only one that wrote.
    if (!dto.businessId) throw new BadRequestException('businessId is required');
    this.logger.log(`[goals] create plan from goal ${goalId}`);
    return this.planner.createPlanFromGoal(dto.businessId, goalId, dto.userId);
  }

  @Post('plans')
  async createPlanFromCommand(
    @Body() dto: CreatePlanFromCommandDto & { businessId: string },
  ) {
    if (!dto.businessId || !dto.objective) {
      throw new BadRequestException('businessId and objective are required');
    }
    return this.planner.createPlanFromCommand(dto.businessId, dto, dto.userId);
  }

  @Get('plans/:planId')
  async getPlan(@Param('planId') planId: string) {
    return this.planner.getPlan(planId);
  }

  @Post('plans/:planId/execute')
  async executePlan(
    @Param('planId') planId: string,
    @Body() options: { traceId?: string; skipApproval?: boolean },
  ) {
    this.logger.log(`[plans] execute ${planId}`);
    return this.planner.executePlan(planId, {
      traceId: options.traceId,
      skipApproval: options.skipApproval,
    });
  }

  @Delete('goals/:goalId')
  async deleteGoal(
    @Param('goalId') goalId: string,
    @Query('businessId') businessId: string,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    const goal = await this.prisma.client.aiGoal.findFirst({
      where: { id: goalId, businessId },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    await this.prisma.client.aiGoal.delete({ where: { id: goalId } });
    return { success: true };
  }

  // -- Phase 4: Trigger Rules --

  @Get('triggers')
  async listTriggerRules(@Query('businessId') businessId: string) {
    if (!businessId) throw new BadRequestException('businessId is required');
    return this.triggerService.listRules(businessId);
  }

  @Post('triggers')
  async createTriggerRule(@Body() dto: CreateTriggerRuleDto) {
    if (!dto.businessId || !dto.eventType) {
      throw new BadRequestException('businessId and eventType are required');
    }
    return this.triggerService.createRule(dto);
  }

  @Patch('triggers/:id')
  async updateTriggerRule(
    @Param('id') id: string,
    @Body() dto: UpdateTriggerRuleDto & { businessId: string },
  ) {
    if (!dto.businessId) throw new BadRequestException('businessId is required');
    return this.triggerService.updateRule(dto.businessId, id, dto);
  }
}
