import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PaymentReceiptService, type CreateReceiptInput, type UpdateReceiptInput } from './payment-receipt.service';

@Controller('continental-ops/businesses/:businessId/receipts')
@UseGuards(AuthGuard, BusinessGuard)
export class ReceiptController {
  constructor(@Inject(PaymentReceiptService) private readonly svc: PaymentReceiptService) {}

  @Get()
  async list(@Param('businessId') businessId: string) {
    const items = await this.svc.list(businessId);
    return { items };
  }

  @Post()
  create(@Param('businessId') businessId: string, @Body() body: CreateReceiptInput) {
    return this.svc.create(businessId, body);
  }

  @Get(':id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.get(businessId, id);
  }

  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateReceiptInput) {
    return this.svc.update(businessId, id, body);
  }

  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.remove(businessId, id);
  }
}
