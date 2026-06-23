import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateTemporalFlowEventDto } from './dto/create-temporal-flow-event.dto';
import { TemporalFlowQueryDto } from './dto/temporal-flow-query.dto';
import { TemporalFlowMemoryQueryDto } from './dto/temporal-flow-memory-query.dto';
import { TemporalFlowService } from './temporal-flow.service';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';
import { TemporalFlowMemoryQueueService } from './temporal-flow-memory.queue.service';
import { TemporalFlowGenomeBridgeService } from './temporal-flow-genome-bridge.service';

@Controller('temporal-flow/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class TemporalFlowController {
  constructor(
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
    @Inject(TemporalFlowMemoryService) private readonly memory: TemporalFlowMemoryService,
    @Inject(TemporalFlowMemoryQueueService) private readonly memoryQueue: TemporalFlowMemoryQueueService,
    @Inject(TemporalFlowGenomeBridgeService) private readonly genomeBridge: TemporalFlowGenomeBridgeService,
  ) {}

  @Get()
  list(@Param('businessId') businessId: string, @Query() query: TemporalFlowQueryDto) {
    return this.temporal.list(businessId, {
      source: query.source,
      type: query.type,
      module: query.module,
      status: query.status,
      importance: query.importance,
      from: query.from,
      to: query.to,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Get('calendar')
  calendar(
    @Param('businessId') businessId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.temporal.calendarRange(businessId, from, to);
  }

  @Get('reminders')
  reminders(@Param('businessId') businessId: string) {
    return this.temporal.remindersDue(businessId);
  }

  @Post()
  create(
    @Param('businessId') businessId: string,
    @Body() body: CreateTemporalFlowEventDto,
  ) {
    return this.temporal.emit({
      ...body,
      businessId,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      reminderAt: body.reminderAt ? new Date(body.reminderAt) : undefined,
    });
  }

  @Patch(':eventId/resolve')
  resolve(@Param('businessId') businessId: string, @Param('eventId') eventId: string) {
    return this.temporal.markResolved(businessId, eventId);
  }

  @Post('analyze')
  analyze(@Param('businessId') businessId: string) {
    return this.temporal.analyze(businessId);
  }

  @Get('memory')
  listMemory(
    @Param('businessId') businessId: string,
    @Query() query: TemporalFlowMemoryQueryDto,
  ) {
    return this.memory.findMany(businessId, {
      entityType: query.entityType,
      entityId: query.entityId,
      type: query.type,
      limit: query.limit,
    });
  }

  @Get('memory/search')
  searchMemory(
    @Param('businessId') businessId: string,
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    return this.memory.searchMemory(businessId, q, limit ? Number(limit) : 10);
  }

  @Get('memory/by-entity/:entityType/:entityId')
  memoryByEntity(
    @Param('businessId') businessId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.memory.findByEntity(businessId, entityType, entityId);
  }

  @Post('memory/compact')
  compactMemory(@Param('businessId') businessId: string) {
    return this.memoryQueue.enqueue({ businessId, operation: 'compact' });
  }

  @Post('memory/detect-patterns')
  detectPatterns(@Param('businessId') businessId: string) {
    return this.memoryQueue.enqueue({ businessId, operation: 'detect_patterns' });
  }
}
