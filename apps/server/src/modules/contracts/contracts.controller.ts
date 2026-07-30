import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { ExtractContractTermsDto } from './dto/extract-contract-terms.dto';

@Controller('contracts/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class ContractsController {
  constructor(@Inject(ContractsService) private readonly contracts: ContractsService) {}

  @Get()
  @RequireModuleScope('operations', 'read')
  list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('tagIds') tagIds?: string,
    @Query('expiringWithinDays') expiringWithinDays?: string,
    @Query('sourceType') sourceType?: 'asset' | 'business_asset' | 'document_instance' | 'drive',
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contracts.listContracts(businessId, {
      status: status as any,
      search,
      tagIds: tagIds ? tagIds.split(',').filter(Boolean) : undefined,
      expiringWithinDays: expiringWithinDays ? Number(expiringWithinDays) : undefined,
      sourceType,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('stats')
  @RequireModuleScope('operations', 'read')
  stats(@Param('businessId') businessId: string) {
    return this.contracts.getStats(businessId);
  }

  @Get('tags')
  @RequireModuleScope('operations', 'read')
  listTags(@Param('businessId') businessId: string) {
    return this.contracts.listTags(businessId);
  }

  @Post('tags')
  @RequireModuleScope('operations', 'write')
  createTag(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; color?: string },
  ) {
    return this.contracts.createTag(businessId, body.name, body.color);
  }

  @Delete('tags/:tagId')
  @RequireModuleScope('operations', 'write')
  deleteTag(@Param('businessId') businessId: string, @Param('tagId') tagId: string) {
    return this.contracts.deleteTag(businessId, tagId);
  }

  @Get(':contractId')
  @RequireModuleScope('operations', 'read')
  get(@Param('businessId') businessId: string, @Param('contractId') contractId: string) {
    return this.contracts.getContract(businessId, contractId);
  }

  @Post()
  @RequireModuleScope('operations', 'write')
  create(
    @Param('businessId') businessId: string,
    @Body(new ValidationPipe({ transform: true })) body: CreateContractDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.contracts.createContract(businessId, body, req.user?.id);
  }

  @Patch(':contractId')
  @RequireModuleScope('operations', 'write')
  update(
    @Param('businessId') businessId: string,
    @Param('contractId') contractId: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateContractDto,
  ) {
    return this.contracts.updateContract(businessId, contractId, body);
  }

  @Delete(':contractId')
  @RequireModuleScope('operations', 'write')
  remove(@Param('businessId') businessId: string, @Param('contractId') contractId: string) {
    return this.contracts.deleteContract(businessId, contractId);
  }

  @Post(':contractId/extract')
  @RequireModuleScope('operations', 'write')
  extractTerms(
    @Param('businessId') businessId: string,
    @Param('contractId') contractId: string,
    @Body(new ValidationPipe({ transform: true })) body: ExtractContractTermsDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.contracts.extractTermsFromDocument(businessId, contractId, body, req.user?.id);
  }

  @Post(':contractId/acknowledge-alert/:alertId')
  @RequireModuleScope('operations', 'write')
  acknowledgeAlert(
    @Param('businessId') businessId: string,
    @Param('alertId') alertId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.contracts.acknowledgeAlert(businessId, alertId, req.user?.id);
  }
}
