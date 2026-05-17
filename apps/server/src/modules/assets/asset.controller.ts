import {
  Controller,
  Post,
  Get,
  Patch,
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
import {
  ModuleScopeGuard,
  RequireModuleScope,
} from '../../core/auth/module-scope.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { ListAssetsQueryDto } from './dto/list-assets-query.dto';
import { TrackUsageDto } from './dto/track-usage.dto';

@Controller()
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard, ModuleScopeGuard)
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @Post('businesses/:businessId/assets')
  @RateLimit(20, 60_000)
  @RequireModuleScope('content', 'write')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateAssetDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.assets.createAsset({
      ...body,
      businessId,
      uploadedBy: body.uploadedBy ?? req.user?.id ?? 'system',
    });
  }

  @Get('businesses/:businessId/assets')
  @RateLimit(60, 60_000)
  @RequireModuleScope('content', 'read')
  async list(
    @Param('businessId') businessId: string,
    @Query() query: ListAssetsQueryDto,
  ) {
    return this.assets.listAssets(businessId, {
      type: query.type,
      folder: query.folder,
      tag: query.tag,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('businesses/:businessId/assets/:assetId')
  @RateLimit(60, 60_000)
  @RequireModuleScope('content', 'read')
  async getById(@Param('assetId') assetId: string) {
    return this.assets.getAsset(assetId);
  }

  @Patch('businesses/:businessId/assets/:assetId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('content', 'write')
  async update(
    @Param('assetId') assetId: string,
    @Body() body: UpdateAssetDto,
  ) {
    return this.assets.updateAsset(assetId, body);
  }

  @Post('businesses/:businessId/assets/:assetId/tag')
  @RateLimit(20, 60_000)
  @RequireModuleScope('content', 'write')
  async tag(
    @Param('assetId') assetId: string,
    @Body() body: { tags: string[] },
  ) {
    return this.assets.tagAsset(assetId, body.tags);
  }

  @Post('businesses/:businessId/assets/:assetId/untag')
  @RateLimit(20, 60_000)
  @RequireModuleScope('content', 'write')
  async untag(
    @Param('assetId') assetId: string,
    @Body() body: { tags: string[] },
  ) {
    return this.assets.untagAsset(assetId, body.tags);
  }

  @Post('businesses/:businessId/assets/:assetId/track-usage')
  @RateLimit(20, 60_000)
  @RequireModuleScope('content', 'write')
  async trackUsage(
    @Param('assetId') assetId: string,
    @Body() body: TrackUsageDto,
  ) {
    return this.assets.trackUsage(assetId, body);
  }

  @Delete('businesses/:businessId/assets/:assetId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('content', 'write')
  async delete(@Param('assetId') assetId: string) {
    return this.assets.deleteAsset(assetId);
  }

  @Get('businesses/:businessId/assets/folders/list')
  @RateLimit(60, 60_000)
  @RequireModuleScope('content', 'read')
  async getFolders(@Param('businessId') businessId: string) {
    return this.assets.getFolders(businessId);
  }
}
