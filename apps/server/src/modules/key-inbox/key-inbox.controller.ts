import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeyInboxService } from './key-inbox.service';
import type { CreateInboxMessageInput, CreateInboxThreadInput } from './key-inbox.types';

@Controller('key-inbox/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyInboxController {
  constructor(@Inject(KeyInboxService) private readonly keyInbox: KeyInboxService) {}

  @Get('threads')
  async listThreads(
    @Param('businessId') businessId: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.keyInbox.listThreads(businessId, {
      channel,
      status,
      priority,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('threads/:threadId')
  async getThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    const thread = await this.keyInbox.getThread(businessId, threadId);
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  @Post('threads/:threadId/analyze')
  async analyzeThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.keyInbox.analyzeThread(businessId, threadId);
  }

  @Get('brief')
  async getBrief(
    @Param('businessId') businessId: string,
    @Query('scope') scope: 'DAILY' | 'WEEKLY' | 'CUSTOM' = 'DAILY',
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const insights = await this.keyInbox.listInsights(businessId, scope, 1);
    if (insights.length > 0) return insights[0];

    return this.keyInbox.generateBrief(
      businessId,
      scope,
      start ? new Date(start) : undefined,
      end ? new Date(end) : undefined,
    );
  }

  @Post('brief/generate')
  async generateBrief(
    @Param('businessId') businessId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const scope = (body.scope as 'DAILY' | 'WEEKLY' | 'CUSTOM') ?? 'DAILY';
    return this.keyInbox.generateBrief(
      businessId,
      scope,
      body.start ? new Date(String(body.start)) : undefined,
      body.end ? new Date(String(body.end)) : undefined,
    );
  }

  @Post('ingest')
  async ingest(
    @Param('businessId') businessId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const threadInput = body.thread as CreateInboxThreadInput | undefined;
    const messageInput = body.message as CreateInboxMessageInput | undefined;

    if (!messageInput) {
      throw new ForbiddenException('message is required');
    }

    if (messageInput.businessId && messageInput.businessId !== businessId) {
      throw new ForbiddenException('businessId mismatch');
    }
    if (threadInput?.businessId && threadInput.businessId !== businessId) {
      throw new ForbiddenException('businessId mismatch');
    }

    let threadId: string | undefined;

    if (threadInput) {
      const thread = await this.keyInbox.upsertThread({ ...threadInput, businessId });
      threadId = thread.id;
    }

    return this.keyInbox.addMessage({ ...messageInput, businessId, threadId });
  }
}
