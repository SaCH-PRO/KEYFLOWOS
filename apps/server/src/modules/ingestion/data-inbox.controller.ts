import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { DataInboxService } from './data-inbox.service';
import { CorrectItemDto, RejectItemDto, ListIngestionItemsQuery } from './dto/ingestion-item.dto';

@Controller('data-inbox/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class DataInboxController {
  constructor(@Inject(DataInboxService) private readonly service: DataInboxService) {}

  @Get('items')
  @RequireModuleScope('operations')
  async listItems(
    @Param('businessId') businessId: string,
    @Query() query: ListIngestionItemsQuery,
  ) {
    return this.service.listItems(businessId, query);
  }

  @Get('items/:itemId')
  @RequireModuleScope('operations')
  async getItem(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.service.getItem(businessId, itemId);
  }

  @Post('items/:itemId/approve')
  @RequireModuleScope('operations', 'write')
  async approve(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.approveItem(businessId, itemId, req.user?.id ?? 'user');
  }

  @Post('items/:itemId/reject')
  @RequireModuleScope('operations', 'write')
  async reject(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
    @Body() body: RejectItemDto,
  ) {
    return this.service.rejectItem(businessId, itemId, body.reason);
  }

  @Post('items/:itemId/correct')
  @RequireModuleScope('operations', 'write')
  async correct(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
    @Body() body: CorrectItemDto,
  ) {
    return this.service.correctItem(businessId, itemId, body.correctedActions, body.note);
  }
}
