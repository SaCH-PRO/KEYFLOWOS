import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { BusinessAssetsService } from './business-assets.service';
import { CreateBusinessAssetDto } from './dto/create-business-asset.dto';
import { UpdateBusinessAssetDto } from './dto/update-business-asset.dto';

@Controller('businesses/:businessId/business-assets')
@UseGuards(AuthGuard, BusinessGuard)
export class BusinessAssetsController {
  constructor(
    @Inject(BusinessAssetsService) private readonly assets: BusinessAssetsService,
  ) {}

  @Get()
  async list(@Param('businessId') businessId: string) {
    return this.assets.list(businessId);
  }

  @Get('summary')
  async summary(@Param('businessId') businessId: string) {
    return this.assets.summarizeForGenome(businessId);
  }

  @Post()
  async create(
    @Param('businessId') businessId: string,
    @Body() body: CreateBusinessAssetDto,
  ) {
    return this.assets.create(businessId, body);
  }

  @Patch(':assetId')
  async update(
    @Param('businessId') businessId: string,
    @Param('assetId') assetId: string,
    @Body() body: UpdateBusinessAssetDto,
  ) {
    return this.assets.update(businessId, assetId, body);
  }

  @Delete(':assetId')
  async remove(
    @Param('businessId') businessId: string,
    @Param('assetId') assetId: string,
  ) {
    await this.assets.remove(businessId, assetId);
    return { deleted: true };
  }
}
