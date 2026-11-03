import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
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

/**
 * V1-31b-KEY-ACTION-ROUTES-BIND (V1-31 review): the member resolving an item is
 * the authenticated caller. These routes resolved as `req.user?.id ?? 'user'`,
 * so a request without a principal was recorded as a user named 'user'; it is
 * now 401 before anything is resolved.
 */
function resolvingUserId(req: { user?: { id?: string } } | undefined): string {
  const userId = req?.user?.id;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new UnauthorizedException('Authenticated user required to resolve approvals');
  }
  return userId;
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
    return this.service.resolveItem(businessId, itemId, body.resolution, resolvingUserId(req));
  }

  @Post('items/bulk-resolve')
  @RequireModuleScope('operations', 'write')
  async bulkResolve(
    @Param('businessId') businessId: string,
    @Body() body: BulkResolveAiApprovalsDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.service.resolveBatch(businessId, body.ids, body.resolution, resolvingUserId(req));
  }

  @Get('stats')
  @RequireModuleScope('operations')
  async getStats(@Param('businessId') businessId: string) {
    return this.service.getStats(businessId);
  }
}
