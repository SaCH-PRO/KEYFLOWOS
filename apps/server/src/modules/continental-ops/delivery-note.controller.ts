import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { DeliveryNoteService, type CreateDeliveryNoteInput, type UpdateDeliveryNoteInput } from './delivery-note.service';

@Controller('continental-ops/businesses/:businessId/delivery-notes')
@UseGuards(AuthGuard, BusinessGuard)
export class DeliveryNoteController {
  constructor(@Inject(DeliveryNoteService) private readonly svc: DeliveryNoteService) {}

  @Get()
  async list(@Param('businessId') businessId: string) {
    const items = await this.svc.list(businessId);
    return { items };
  }

  @Post()
  create(@Param('businessId') businessId: string, @Body() body: CreateDeliveryNoteInput) {
    return this.svc.create(businessId, body);
  }

  @Get(':id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.get(businessId, id);
  }

  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateDeliveryNoteInput) {
    return this.svc.update(businessId, id, body);
  }

  @Post(':id/fulfill')
  fulfill(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { delivererName?: string; delivererSignature?: string; receiverName?: string; receiverSignature?: string },
  ) {
    return this.svc.fulfill(businessId, id, body);
  }

  @Post(':id/cancel')
  cancel(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.cancel(businessId, id);
  }

  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.remove(businessId, id);
  }
}
