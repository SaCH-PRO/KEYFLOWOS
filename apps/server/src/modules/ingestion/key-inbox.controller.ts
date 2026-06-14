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
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { KeyInboxService, ListItemsFilters } from './key-inbox.service';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';
import { CorrectItemDto, ListIngestionItemsQuery, RejectItemDto } from './dto/ingestion-item.dto';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { id: string };
}

@Controller('key-inbox')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class KeyInboxController {
  constructor(
    @Inject(KeyInboxService) private readonly inbox: KeyInboxService,
    @Inject(IngestionOrchestrator) private readonly orchestrator: IngestionOrchestrator,
  ) {}

  @Get('businesses/:businessId/items')
  @RequireModuleScope('operations', 'read')
  async listItems(
    @Param('businessId') businessId: string,
    @Query() query: ListIngestionItemsQuery,
  ) {
    const filters: ListItemsFilters = {
      status: query.status,
      sourceType: query.sourceType,
      search: query.search,
      intentType: query.intentType,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
    };
    return this.inbox.listItems(businessId, filters);
  }

  @Get('businesses/:businessId/items/:itemId')
  @RequireModuleScope('operations', 'read')
  async getItem(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inbox.getItem(businessId, itemId);
  }

  @Post('businesses/:businessId/items/:itemId/approve')
  @RequireModuleScope('operations', 'write')
  async approve(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new NotFoundException('Authenticated user required');
    return this.inbox.approve(businessId, itemId, userId);
  }

  @Post('businesses/:businessId/items/:itemId/reject')
  @RequireModuleScope('operations', 'write')
  async reject(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: RejectItemDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new NotFoundException('Authenticated user required');
    return this.inbox.reject(businessId, itemId, userId, body.reason);
  }

  @Post('businesses/:businessId/items/:itemId/correct')
  @RequireModuleScope('operations', 'write')
  async correct(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
    @Body() body: CorrectItemDto,
  ) {
    return this.inbox.correct(businessId, itemId, body.correctedActions as unknown as Record<string, unknown>[], body.note);
  }

  /**
   * Dev-only helper to inject a synthetic ingestion item without an external provider.
   * Guards are deliberately strict: only available in NODE_ENV=development.
   */
  @Post('businesses/:businessId/test/receive')
  @RequireModuleScope('operations', 'write')
  async testReceive(
    @Param('businessId') businessId: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (process.env.NODE_ENV !== 'development') {
      throw new ForbiddenException('Test receive is only available in development');
    }
    return this.orchestrator.receive(body as any, businessId);
  }
}
