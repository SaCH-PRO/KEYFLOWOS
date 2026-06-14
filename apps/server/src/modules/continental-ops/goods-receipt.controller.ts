import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GoodsReceiptService, type CreateGoodsReceiptInput, type UpdateGoodsReceiptInput } from './goods-receipt.service';

@Controller('continental-ops/businesses/:businessId/goods-receipts')
@UseGuards(AuthGuard, BusinessGuard)
export class GoodsReceiptController {
  constructor(@Inject(GoodsReceiptService) private readonly svc: GoodsReceiptService) {}

  @Get()
  async list(@Param('businessId') businessId: string) {
    const items = await this.svc.list(businessId);
    return { items };
  }

  @Post()
  create(@Param('businessId') businessId: string, @Body() body: CreateGoodsReceiptInput) {
    return this.svc.create(businessId, body);
  }

  @Get(':id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.get(businessId, id);
  }

  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateGoodsReceiptInput) {
    return this.svc.update(businessId, id, body);
  }

  @Post(':id/post')
  post(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.post(businessId, id);
  }

  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.remove(businessId, id);
  }
}
