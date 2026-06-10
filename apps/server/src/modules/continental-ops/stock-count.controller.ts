import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { StockCountService, type CreateStockCountInput, type UpdateStockCountInput } from './stock-count.service';

@Controller('continental-ops/businesses/:businessId/stock-counts')
@UseGuards(AuthGuard, BusinessGuard)
export class StockCountController {
  constructor(@Inject(StockCountService) private readonly svc: StockCountService) {}

  @Get()
  list(@Param('businessId') businessId: string) {
    return this.svc.list(businessId);
  }

  @Post()
  create(@Param('businessId') businessId: string, @Body() body: CreateStockCountInput) {
    return this.svc.create(businessId, body);
  }

  @Get(':id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.get(businessId, id);
  }

  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateStockCountInput) {
    return this.svc.update(businessId, id, body);
  }

  @Post(':id/adjust')
  adjust(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.adjust(businessId, id);
  }

  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.remove(businessId, id);
  }
}
