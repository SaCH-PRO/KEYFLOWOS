import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { ProcurementService } from './procurement.service';
import { CreateProcurementRequestDto } from './dto/create-procurement-request.dto';
import { UpdateProcurementRequestDto } from './dto/update-procurement-request.dto';

@Controller('procurement')
@UseGuards(AuthGuard, CrmRateLimitGuard)
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  @Get('businesses/:businessId')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async list(@Param('businessId') businessId: string) {
    return this.service.list(businessId);
  }

  @Post('businesses/:businessId')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async create(@Param('businessId') businessId: string, @Req() req: any, @Body() dto: CreateProcurementRequestDto) {
    return this.service.create(businessId, dto, req.user?.id);
  }

  /**
   * The business's active supplier connections and its request counts.
   *
   * Declared BEFORE `businesses/:businessId/:id` (R0-13f): below it both were
   * answered by get as request 'suppliers' / 'stats' (404), so the suppliers
   * page, the vendor picker on a request and the procurement stats never
   * loaded. Both read only the path business's rows, behind the guards the
   * single-request read runs behind. route-shadowing.spec.ts keeps the order.
   */
  @Get('businesses/:businessId/suppliers')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async listSuppliers(@Param('businessId') businessId: string) {
    return this.service.listSuppliers(businessId);
  }

  @Get('businesses/:businessId/stats')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async stats(@Param('businessId') businessId: string) {
    return this.service.getStats(businessId);
  }

  @Get('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.get(businessId, id);
  }

  @Patch('businesses/:businessId/:id')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateProcurementRequestDto) {
    return this.service.update(businessId, id, dto);
  }

  @Post('businesses/:businessId/:id/submit')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async submit(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.submitForReview(businessId, id);
  }

  @Post('businesses/:businessId/:id/approve')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async approve(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    return this.service.updateStatus(businessId, id, 'APPROVED', req.user?.id);
  }

  @Post('businesses/:businessId/:id/reject')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async reject(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any, @Body() body: { reason?: string }) {
    return this.service.updateStatus(businessId, id, 'REJECTED', req.user?.id, body.reason);
  }

  @Post('businesses/:businessId/:id/vendor')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async selectVendor(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: { supplierConnectionId?: string | null }) {
    return this.service.selectVendor(businessId, id, body.supplierConnectionId ?? null);
  }

  @Post('businesses/:businessId/:id/issue-po')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async issuePO(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    return this.service.issuePO(businessId, id, req.user?.id);
  }

  @Post('businesses/:businessId/:id/acknowledge')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async acknowledgeVendor(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.acknowledgeVendor(businessId, id);
  }

  @Post('businesses/:businessId/:id/fulfill')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async markFulfilled(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.markFulfilled(businessId, id);
  }

  @Post('businesses/:businessId/:id/invoice')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(30, 60_000)
  async markInvoiced(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.markInvoiced(businessId, id);
  }
}
