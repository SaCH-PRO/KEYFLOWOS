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
import { AiApprovalsService, ListAiApprovalsQuery } from './ai-approvals.service';
import { IsArray, IsIn, IsString } from 'class-validator';

class ResolveAiApprovalDto {
  @IsString()
  @IsIn(['approved', 'rejected', 'deferred'])
  resolution!: 'approved' | 'rejected' | 'deferred';
}

class BulkResolveAiApprovalsDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsString()
  @IsIn(['approved', 'rejected', 'deferred'])
  resolution!: 'approved' | 'rejected' | 'deferred';
}

@Controller('ai-approvals/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class AiApprovalsController {
  constructor(@Inject(AiApprovalsService) private readonly service: AiApprovalsService) {}

  @Get('items')
  @RequireModuleScope('operations')
  async listItems(
    @Param('businessId') businessId: string,
    @Query() query: ListAiApprovalsQuery,
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

  @Post('items/:itemId/resolve')
  @RequireModuleScope('operations', 'write')
  async resolveItem(
    @Param('businessId') businessId: string,
    @Param('itemId') itemId: string,
    @Body() body: ResolveAiApprovalDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.resolveItem(businessId, itemId, body.resolution, req.user?.id ?? 'user');
  }

  @Post('items/bulk-resolve')
  @RequireModuleScope('operations', 'write')
  async bulkResolve(
    @Param('businessId') businessId: string,
    @Body() body: BulkResolveAiApprovalsDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.resolveBatch(businessId, body.ids, body.resolution, req.user?.id ?? 'user');
  }

  @Get('stats')
  @RequireModuleScope('operations')
  async getStats(@Param('businessId') businessId: string) {
    return this.service.getStats(businessId);
  }
}
