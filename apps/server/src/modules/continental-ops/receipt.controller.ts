import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ReceiptService, type CreateReceiptInput, type UpdateReceiptInput } from './receipt.service';

@Controller('continental-ops/businesses/:businessId/receipts')
@UseGuards(AuthGuard, BusinessGuard)
export class ReceiptController {
  constructor(@Inject(ReceiptService) private readonly svc: ReceiptService) {}

  @Get()
  list(@Param('businessId') businessId: string) {
    return this.svc.list(businessId);
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
