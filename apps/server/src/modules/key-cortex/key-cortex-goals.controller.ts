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
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GuardedBusinessId } from '../../core/auth/request-business-id';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { KeyCortexPlannerService, CreateGoalInput } from './key-cortex-planner.service';
import { KeyCortexTriggerService } from './key-cortex-trigger.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { graphPlanReadScope, visiblePlanSteps } from '../ai/graph-actions.controller';
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

// The four body DTOs below are exported only so
// test/key-cortex-tenant-binding.integration.test.ts can write the parameter
// types tsc emits (vitest's transform emits none).
export class CreateGoalDto implements CreateGoalInput {
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

// `userId` on the two plan bodies below is accepted and IGNORED (R0-09e, as
// KeyCortexController's DTOs since R0-09c): the plan's actor is the principal,
// requestActor(). It is kept so clients that still send it are not refused.
export class CreatePlanFromGoalDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  businessId?: string;
}

export class CreatePlanFromCommandDto {
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

export class UpdateTriggerRuleDto {
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

/**
 * R0-09e-KEY-PLAN-ACTOR (R0-09c review ST-5 / CR-2): the human a KEY plan
 * request acts for. It is the principal AuthGuard admitted (`req.user`, read
 * with @CurrentUser()), never the body `userId`: POST plans and POST
 * goals/:goalId/plans handed the planner `dto.userId`, so a STAFF member wrote
 * a plan as the OWNER's, and POST plans/:planId/execute took no actor at all,
 * so the planner ran that plan's steps as the OWNER. A body `userId` is IGNORED,
 * not refused, exactly as KeyCortexController's requestActorId (R0-09c); with no
 * authenticated user the handler answers 401 (AuthGuard already refuses such a
 * request; this keeps a handler reached any other way from running
 * unattributed).
 */
function requestActor(user: AuthenticatedUser | undefined): AuthenticatedUser & { id: string } {
  const id = user?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new UnauthorizedException('Authenticated user required');
  }
  return { ...user, id };
}

/**
 * R0-34b-KEY-TENANT-BINDING: mounted at `/api/v1/cortex` with no `:businessId`
 * segment, so BusinessGuard checks the tenant the request names (params, then
 * body, then query). The four handlers that read `@Query('businessId')` acted on
 * the query's tenant while the guard had checked the body's; they take
 * `@GuardedBusinessId()` now.
 *
 * Review ST-2: four body handlers typed their `@Body()` as `Dto & { businessId }`.
 * tsc emits an intersection as `Object` and the global ValidationPipe skips
 * `Object`, so those bodies were never validated or whitelisted, and a
 * `businessId` that is not a string (which the guard skips, checking the query
 * instead) reached the service raw: on its own the handler updated another
 * tenant's trigger rule. They take the class DTO (validated again) and
 * `@GuardedBusinessId()`. createTriggerRule keeps `dto.businessId`: its class
 * DTO validates it as a string, which the guard resolved first.
 */
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
  async createGoal(@Body() dto: CreateGoalDto, @GuardedBusinessId() businessId: string) {
    if (!businessId || !dto.title) {
      throw new BadRequestException('businessId and title are required');
    }
    this.logger.log(`[goals] create goal for ${businessId}: ${dto.title}`);
    return this.planner.createGoal(businessId, dto);
  }

  @Get('goals')
  async listGoals(
    @GuardedBusinessId() businessId: string,
    @Query('status') status?: string,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    return this.planner.listGoals(businessId, status);
  }

  @Get('goals/:goalId')
  async getGoal(
    @Param('goalId') goalId: string,
    @GuardedBusinessId() businessId: string,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    return this.planner.getGoal(businessId, goalId);
  }

  @Post('goals/:goalId/plans')
  async createPlanFromGoal(
    @Param('goalId') goalId: string,
    @Body() _dto: CreatePlanFromGoalDto,
    @GuardedBusinessId() businessId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    // businessId was absent here entirely, so the goal id from the URL was
    // resolved against every business. Every sibling route on this controller
    // already demanded it; this one did not, and it is the only one that wrote.
    if (!businessId) throw new BadRequestException('businessId is required');
    const actor = requestActor(user);
    this.logger.log(`[goals] create plan from goal ${goalId}`);
    return this.planner.createPlanFromGoal(businessId, goalId, actor.id);
  }

  @Post('plans')
  async createPlanFromCommand(
    @Body() dto: CreatePlanFromCommandDto,
    @GuardedBusinessId() businessId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!businessId || !dto.objective) {
      throw new BadRequestException('businessId and objective are required');
    }
    const actor = requestActor(user);
    return this.planner.createPlanFromCommand(businessId, dto, actor.id);
  }

  /**
   * KEY-R3a-PLAN-READS (KEY-CORTEX-PLAN-READ, D-74): this returned any plan by id alone, with its
   * steps, inputPayload and outputResult, to any member (a member of another business naming their
   * own reached it too). The plan is read in the guarded business and answered by the rule of every
   * plan read route (graphPlanReadScope / visiblePlanSteps, as GET ai/plans/:planId): to its
   * proposer, the business OWNER, an ADMIN or a SUPER_ADMIN, another member's plan answered exactly
   * as an unknown id; within it the steps whose module the viewer reads, and each step's output
   * filtered by the viewer's contact visibility at read.
   */
  @Get('plans/:planId')
  async getPlan(
    @Param('planId') planId: string,
    @GuardedBusinessId() businessId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    const viewer = requestActor(user);
    const [mayRead, plan] = await Promise.all([
      graphPlanReadScope(this.prisma, businessId, { id: viewer.id, role: viewer.role }),
      this.planner.getPlan(planId, businessId),
    ]);
    if (!plan || (!mayRead.seesEveryPlan && plan.userId !== viewer.id)) return null;
    return { ...plan, steps: await visiblePlanSteps(plan.steps, mayRead) };
  }

  /**
   * R0-09e: the planner re-checks that the executing member may run this plan
   * (its creator, the business OWNER or SUPER_ADMIN; 403 otherwise, 404 for a
   * plan outside the checked tenant) and runs every step as that member. A
   * plan that is running or completed is refused 409 (R0-09e repair, ST-2).
   */
  @Post('plans/:planId/execute')
  async executePlan(
    @Param('planId') planId: string,
    @Body() options: { traceId?: string; skipApproval?: boolean },
    @GuardedBusinessId() businessId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    const actor = requestActor(user);
    this.logger.log(`[plans] execute ${planId}`);
    return this.planner.executePlan(
      planId,
      {
        traceId: options?.traceId,
        skipApproval: options?.skipApproval,
      },
      { userId: actor.id, role: actor.role, businessId },
    );
  }

  @Delete('goals/:goalId')
  async deleteGoal(
    @Param('goalId') goalId: string,
    @GuardedBusinessId() businessId: string,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    return this.planner.deleteGoal(businessId, goalId);
  }

  // -- Phase 4: Trigger Rules --

  @Get('triggers')
  async listTriggerRules(@GuardedBusinessId() businessId: string) {
    if (!businessId) throw new BadRequestException('businessId is required');
    return this.triggerService.listRules(businessId);
  }

  /**
   * KEY-R3b-PLAN-AUTHORITY (D-73): the rule records the authenticated member who creates it (a
   * creator in the body's filterJson is dropped), and the plans it fires run as that member.
   */
  @Post('triggers')
  async createTriggerRule(@Body() dto: CreateTriggerRuleDto, @CurrentUser() user?: AuthenticatedUser) {
    if (!dto.businessId || !dto.eventType) {
      throw new BadRequestException('businessId and eventType are required');
    }
    const actor = requestActor(user);
    return this.triggerService.createRule(dto, actor.id);
  }

  /** D-73: the member who changes a rule is the member its plans run as from then on. */
  @Patch('triggers/:id')
  async updateTriggerRule(
    @Param('id') id: string,
    @Body() dto: UpdateTriggerRuleDto,
    @GuardedBusinessId() businessId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!businessId) throw new BadRequestException('businessId is required');
    const actor = requestActor(user);
    return this.triggerService.updateRule(businessId, id, dto, actor.id);
  }
}
