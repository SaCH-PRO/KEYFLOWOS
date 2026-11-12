import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { ProcurementService } from './procurement.service';
import { CreateProcurementRequestDto } from './dto/create-procurement-request.dto';
import { UpdateProcurementRequestDto } from './dto/update-procurement-request.dto';

/** The authenticated member AuthGuard attached: who moved the request (W7-OPS-AUDIT-ACTOR). */
type ActorRequest = { user?: { id?: string } };

/**
 * Procurement requests. Every route requires the 'operations' module scope
 * (owner ruling D-40, R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT), checked after
 * BusinessGuard: read for a GET, write for every mutation, approve, reject,
 * issue-po and invoice included (the level the operations vocabulary gives an
 * approval: payroll, data inbox and KEY approvals are operations write). OWNER
 * and ADMIN hold operations admin by role default, STAFF read. ModuleScopeGuard
 * reads the HANDLER's @RequireModuleScope, so each route names its own level;
 * test/ops-scope-command-procurement.integration.test.ts fails on a route
 * without one.
 */
@Controller('procurement')
@UseGuards(AuthGuard, CrmRateLimitGuard)
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(60, 60_000)
  async list(@Param('businessId') businessId: string) {
    return this.service.list(businessId);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
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
   * loaded. Both read only the path business's rows, behind the guards and
   * the scope (operations read, D-40) the single-request read runs behind.
   * route-shadowing.spec.ts keeps the order.
   */
  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId/suppliers')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(60, 60_000)
  async listSuppliers(@Param('businessId') businessId: string) {
    return this.service.listSuppliers(businessId);
  }

  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId/stats')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(60, 60_000)
  async stats(@Param('businessId') businessId: string) {
    return this.service.getStats(businessId);
  }

  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId/:id')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(60, 60_000)
  async get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.get(businessId, id);
  }

  @RequireModuleScope('operations', 'write')
  @Patch('businesses/:businessId/:id')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateProcurementRequestDto) {
    return this.service.update(businessId, id, dto);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/submit')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async submit(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: ActorRequest) {
    return this.service.submitForReview(businessId, id, req.user?.id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/approve')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async approve(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    return this.service.updateStatus(businessId, id, 'APPROVED', req.user?.id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/reject')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async reject(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any, @Body() body: { reason?: string }) {
    return this.service.updateStatus(businessId, id, 'REJECTED', req.user?.id, body.reason);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/vendor')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async selectVendor(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: { supplierConnectionId?: string | null }) {
    return this.service.selectVendor(businessId, id, body.supplierConnectionId ?? null);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/issue-po')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async issuePO(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    return this.service.issuePO(businessId, id, req.user?.id);
  }

  /**
   * The three vendor-side transitions. ProcurementService.acknowledgeVendor, markFulfilled and
   * markInvoiced update the request by its bare id, so each route first finds the request in the
   * path business (get, 404 otherwise), as submit, vendor and issue-po do inside the service.
   * Without it only the ambient Prisma tenant kept a member of one business off another's
   * request, and the miss surfaced as 500 (review SEC-R013g-2). Each names the member who moved the
   * request on its feed row (W7-OPS-AUDIT-ACTOR, review SEC-R013g-4), and moves it only from the step
   * before (acknowledge from PO_ISSUED, fulfill from VENDOR_ACKNOWLEDGED, invoice from FULFILLED),
   * once: any other status answers 409 and writes nothing (review SEC-W7OAA-1, D-40).
   */
  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/acknowledge')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async acknowledgeVendor(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: ActorRequest) {
    await this.service.get(businessId, id);
    return this.service.acknowledgeVendor(businessId, id, req.user?.id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/fulfill')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async markFulfilled(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: ActorRequest) {
    await this.service.get(businessId, id);
    return this.service.markFulfilled(businessId, id, req.user?.id);
  }

  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/:id/invoice')
  @UseGuards(BusinessGuard, ModuleScopeGuard)
  @CrmRateLimit(30, 60_000)
  async markInvoiced(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: ActorRequest) {
    await this.service.get(businessId, id);
    return this.service.markInvoiced(businessId, id, req.user?.id);
  }
}
