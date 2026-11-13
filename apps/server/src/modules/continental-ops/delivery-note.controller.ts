import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { DeliveryNoteService, type CreateDeliveryNoteInput, type UpdateDeliveryNoteInput } from './delivery-note.service';

/**
 * SWEEP-P0-SCOPES (REST scope census, browser sweep BUG-015 family): a delivery note's fulfil writes InventoryStock,
 * so its writes need the storefront module's write scope, as the marketplace stock routes do
 * (ModuleScopeGuard after BusinessGuard; reads stay open to members).
 */
@Controller('continental-ops/businesses/:businessId/delivery-notes')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class DeliveryNoteController {
  constructor(@Inject(DeliveryNoteService) private readonly svc: DeliveryNoteService) {}

  @Get()
  async list(@Param('businessId') businessId: string) {
    const items = await this.svc.list(businessId);
    return { items };
  }

  @RequireModuleScope('storefront', 'write')
  @Post()
  create(@Param('businessId') businessId: string, @Body() body: CreateDeliveryNoteInput) {
    return this.svc.create(businessId, body);
  }

  @Get(':id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.get(businessId, id);
  }

  @RequireModuleScope('storefront', 'write')
  @Patch(':id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateDeliveryNoteInput) {
    return this.svc.update(businessId, id, body);
  }

  @RequireModuleScope('storefront', 'write')
  @Post(':id/fulfill')
  fulfill(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { delivererName?: string; delivererSignature?: string; receiverName?: string; receiverSignature?: string },
  ) {
    return this.svc.fulfill(businessId, id, body);
  }

  @RequireModuleScope('storefront', 'write')
  @Post(':id/cancel')
  cancel(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.cancel(businessId, id);
  }

  @RequireModuleScope('storefront', 'write')
  @Delete(':id')
  remove(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.remove(businessId, id);
  }
}
