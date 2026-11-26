import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateTemporalFlowEventDto } from './dto/create-temporal-flow-event.dto';
import { TemporalFlowQueryDto } from './dto/temporal-flow-query.dto';
import { TemporalFlowMemoryQueryDto } from './dto/temporal-flow-memory-query.dto';
import { TemporalFlowService, type TemporalFlowReader } from './temporal-flow.service';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';
import { TemporalFlowMemoryQueueService } from './temporal-flow-memory.queue.service';
import { TemporalFlowGenomeBridgeService } from './temporal-flow-genome-bridge.service';
import { HiddenModuleWrites } from '../../core/auth/hidden-module-writes.decorator';

/** The member a request acts for, as AuthMiddleware attaches it. */
type ReaderRequest = { user?: TemporalFlowReader };

/**
 * FU-PROPOSAL-REVENUE-SIGHT (D-238): the request's reader, so a financial KEY proposal's events are withheld from a
 * member without revenue read (TemporalFlowService.forReader). A request with no user reads as null (none).
 */
const genomeReaderOf = (req?: ReaderRequest) =>
  req?.user?.id ? { id: req.user.id, role: req.user.role } : null;

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE (NAV-A1 security review; D-100, D-179): every read of the timeline (the list, the
 * calendar, the reminders and the analysis, which answers event titles and counts) answers only the events of the
 * modules its reader may read (TemporalFlowService.readerFilter, applied in the query before its order and limit): the
 * KEY Inbox's events need operations read, calendar events bookings read, money events revenue read (D-100). Review
 * repair (SEC N-2, N-3): the writes that name an existing event (resolve, an upsert by external id) do not reach one.
 * Delta (item 1): the memory reads (memory, memory/search, memory/by-entity, the analysis's memory insights) answer
 * only memories the reader may see (TemporalFlowService.readerMemoryFilter; MEM-TEMPORAL-MEMORY-ROUTES-SIGHT adds
 * MEM-SEMANTIC-SIGHT's rule for a summary, its text and source events included: TemporalFlowService.memorySight, for
 * every reader, the owner included), and compaction and pattern detection,
 * which summarise every event of the business, are refused (403) to a reader who misses an event-owning module.
 */
@HiddenModuleWrites('flow_hubs', 'bookings')
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
  async list(
    @Param('businessId') businessId: string,
    @Query() query: TemporalFlowQueryDto,
    @Req() req?: ReaderRequest,
  ) {
    const readerFilter = await this.temporal.readerFilter(businessId, req?.user);
    return this.temporal.list(businessId, {
      source: query.source,
      type: query.type,
      module: query.module,
      status: query.status,
      importance: query.importance,
      from: query.from,
      to: query.to,
      limit: query.limit ? Number(query.limit) : undefined,
    }, genomeReaderOf(req), readerFilter);
  }

  @Get('calendar')
  async calendar(
    @Param('businessId') businessId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Req() req?: ReaderRequest,
  ) {
    return this.temporal.calendarRange(
      businessId,
      from,
      to,
      genomeReaderOf(req),
      await this.temporal.readerFilter(businessId, req?.user),
    );
  }

  @Get('reminders')
  async reminders(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    return this.temporal.remindersDue(
      businessId,
      genomeReaderOf(req),
      await this.temporal.readerFilter(businessId, req?.user),
    );
  }

  @Post()
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateTemporalFlowEventDto,
    @Req() req?: ReaderRequest,
  ) {
    const writerFilter = await this.temporal.readerFilter(businessId, req?.user);
    return this.temporal.emit({
      ...body,
      businessId,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      reminderAt: body.reminderAt ? new Date(body.reminderAt) : undefined,
    }, writerFilter, genomeReaderOf(req));
  }

  @Patch(':eventId/resolve')
  async resolve(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Req() req?: ReaderRequest,
  ) {
    return this.temporal.markResolved(
      businessId,
      eventId,
      await this.temporal.readerFilter(businessId, req?.user),
      genomeReaderOf(req),
    );
  }

  @Post('analyze')
  async analyze(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    return this.temporal.analyze(
      businessId,
      await this.temporal.readerFilter(businessId, req?.user),
      await this.temporal.memorySight(businessId, req?.user),
      genomeReaderOf(req),
    );
  }

  @Get('memory')
  async listMemory(
    @Param('businessId') businessId: string,
    @Query() query: TemporalFlowMemoryQueryDto,
    @Req() req?: ReaderRequest,
  ) {
    return this.temporal.listMemory(businessId, query, await this.temporal.memorySight(businessId, req?.user));
  }

  @Get('memory/search')
  async searchMemory(
    @Param('businessId') businessId: string,
    @Query('q') q: string,
    @Req() req?: ReaderRequest,
    @Query('limit') limit?: string,
  ) {
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: withheld hits are dropped inside the search, before the limit.
    const wanted = limit ? Number(limit) : 10;
    return this.temporal.searchVisibleMemory(businessId, q, wanted, await this.temporal.memorySight(businessId, req?.user));
  }

  @Get('memory/by-entity/:entityType/:entityId')
  async memoryByEntity(
    @Param('businessId') businessId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Req() req?: ReaderRequest,
  ) {
    return this.temporal.listMemory(businessId, { entityType, entityId }, await this.temporal.memorySight(businessId, req?.user));
  }

  @Post('memory/compact')
  async compactMemory(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    await this.assertReadsEveryOwner(businessId, req);
    return this.memoryQueue.enqueue({ businessId, operation: 'compact' });
  }

  @Post('memory/detect-patterns')
  async detectPatterns(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    await this.assertReadsEveryOwner(businessId, req);
    return this.memoryQueue.enqueue({ businessId, operation: 'detect_patterns' });
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): compaction and pattern detection summarise every event of the
   * business into memories; a writer who cannot read every event-owning module is refused them.
   */
  private async assertReadsEveryOwner(businessId: string, req?: ReaderRequest) {
    if (await this.temporal.readerFilter(businessId, req?.user)) {
      throw new ForbiddenException('Memory compaction needs read access to every module whose events it summarises');
    }
  }
}
