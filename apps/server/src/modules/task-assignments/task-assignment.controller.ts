import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { TaskAssignmentService, TaskType, AssignableType } from './task-assignment.service';
import { TaskAssignmentRecommenderService } from './task-assignment-recommender.service';
import { AssignTaskDto } from './dto/assign-task.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { TransferAssignmentsDto } from './dto/transfer-assignments.dto';
import { UnassignTaskDto } from './dto/unassign-task.dto';

@Controller()
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
export class TaskAssignmentController {
  constructor(
    private readonly service: TaskAssignmentService,
    private readonly recommender: TaskAssignmentRecommenderService,
  ) {}

  @Post('businesses/:businessId/task-assignments')
  @RateLimit(30, 60_000)
  async assign(
    @Param('businessId') _businessId: string,
    @Body() body: AssignTaskDto,
    @Request() _req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.service.assign({
      taskType: body.taskType as TaskType,
      taskId: body.taskId,
      assignableType: body.assignableType as AssignableType,
      assignableId: body.assignableId,
      assignedBy: _req.user?.id ?? 'system',
      reason: body.reason,
    });
  }

  @Post('businesses/:businessId/task-assignments/bulk')
  @RateLimit(10, 60_000)
  async bulkAssign(
    @Param('businessId') _businessId: string,
    @Body() body: BulkAssignDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.service.bulkAssign(
      body.taskIds.map((t) => ({ taskType: t.taskType as TaskType, taskId: t.taskId })),
      body.assignableType as AssignableType,
      body.assignableId,
      req.user?.id ?? 'system',
    );
  }

  @Post('businesses/:businessId/task-assignments/transfer')
  @RateLimit(10, 60_000)
  async transfer(
    @Param('businessId') _businessId: string,
    @Body() body: TransferAssignmentsDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.service.transferAssignments(
      body.fromType as AssignableType,
      body.fromId,
      body.toType as AssignableType,
      body.toId,
      req.user?.id ?? 'system',
    );
  }

  @Get('businesses/:businessId/task-assignments/for-task/:taskType/:taskId')
  @RateLimit(60, 60_000)
  async forTask(
    @Param('taskType') taskType: TaskType,
    @Param('taskId') taskId: string,
  ) {
    return this.service.getAssignmentsForTask(taskType, taskId);
  }

  @Get('businesses/:businessId/task-assignments/for-assignee/:assignableType/:assignableId')
  @RateLimit(60, 60_000)
  async forAssignee(
    @Param('businessId') _businessId: string,
    @Param('assignableType') assignableType: AssignableType,
    @Param('assignableId') assignableId: string,
    @Query('taskType') taskType?: TaskType,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.getTasksForAssignee(assignableType, assignableId, {
      taskType,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('businesses/:businessId/task-assignments/options')
  @RateLimit(60, 60_000)
  async options(@Param('businessId') businessId: string) {
    return this.service.getAssignableOptions(businessId);
  }

  @Post('businesses/:businessId/task-assignments/recommend')
  @RateLimit(30, 60_000)
  async recommend(
    @Param('businessId') businessId: string,
    @Body() body: { taskType: TaskType; taskId?: string; taskTitle?: string },
  ) {
    return this.recommender.recommend(businessId, body);
  }

  @Delete('businesses/:businessId/task-assignments')
  @RateLimit(20, 60_000)
  async unassign(
    @Param('businessId') _businessId: string,
    @Body() body: UnassignTaskDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.service.unassign({
      taskType: body.taskType as TaskType,
      taskId: body.taskId,
      assignableType: body.assignableType as AssignableType,
      assignableId: body.assignableId,
      reason: body.reason,
    });
  }
}
