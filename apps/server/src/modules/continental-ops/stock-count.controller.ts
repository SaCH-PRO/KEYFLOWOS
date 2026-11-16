import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { StockCountService, type CreateStockCountInput, type UpdateStockCountInput } from './stock-count.service';

/**
 * SWEEP-P0-SCOPES (REST scope census, browser sweep BUG-015 family): a stock count's adjust writes InventoryStock,
 * so its writes need the storefront module's write scope, as the marketplace stock routes do
 * (ModuleScopeGuard after BusinessGuard; reads stay open to members).
 */
@Controller('continental-ops/businesses/:businessId/stock-counts')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class StockCountController {
  constructor(@Inject(StockCountService) private readonly svc: StockCountService) {}

  @Get()
  async list(@Param('businessId') businessId: string) {
    const items = await this.svc.list(businessId);
    return { items };
  }

  @RequireModuleScope('storefront', 'write')
  @Post()
  create(@Param('businessId') businessId: string, @Body() body: CreateStockCountInput) {
    return this.svc.create(businessId, body);
  }

  @Get(':id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.get(businessId, id);
  }

  @RequireModuleScope('storefront', 'write')
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateStockCountInput) {
    return this.svc.update(businessId, id, body);
  }

  @RequireModuleScope('storefront', 'write')
  @Post(':id/adjust')
  adjust(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.adjust(businessId, id);
  }

  @RequireModuleScope('storefront', 'write')
  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.remove(businessId, id);
  }
}
