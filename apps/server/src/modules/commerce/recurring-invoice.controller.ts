import { Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { OPERATOR_INVOICE_CONTACT_SELECT } from './commerce.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { TeamAuditInterceptor, AuditAction } from '../../core/interceptors/team-audit.interceptor';
import { PrismaService } from '../../core/prisma/prisma.service';

/** The caller as AuthGuard attaches it. */
type ActorRequest = { user?: { id?: string; role?: string } };

/**
 * The contact keys a schedule write response carries: the invoice write
 * projection (CommerceController's INVOICE_WRITE_CONTACT_KEYS): the operator
 * invoice read's customer fields (OPERATOR_INVOICE_CONTACT_SELECT) plus `id`
 * and `businessId`, which repeat the schedule's own `contactId` and the path
 * tenant and so disclose nothing new.
 */
type ScheduleWriteContactKey = 'id' | 'businessId' | keyof typeof OPERATOR_INVOICE_CONTACT_SELECT;
const SCHEDULE_WRITE_CONTACT_KEYS: readonly ScheduleWriteContactKey[] = [
  'id',
  'businessId',
  ...(Object.keys(OPERATOR_INVOICE_CONTACT_SELECT) as Array<keyof typeof OPERATOR_INVOICE_CONTACT_SELECT>),
];

/**
 * W3-D46-CREATE-AND-RECURRING (D-64; FOLLOW3-D6 review SEC-D6-2): the HTTP
 * body of a schedule. RecurringInvoiceService answers every write with the
 * whole Contact row (`include: { contact: true }`, which the
 * recurring_invoice.* listeners read), and the routes handed it back: a
 * revenue:write member received the contact's internal notes, phone, owner and
 * visibility. The body now carries only SCHEDULE_WRITE_CONTACT_KEYS, as the
 * invoice writes do; a schedule without a loaded contact passes through.
 *
 * Review SEC-W3D46R-1 (D-64): the two reads (list and :id) loaded the same
 * whole row and handed it to any revenue:read member, a crm_view 'owned' STAFF
 * member included, for a schedule the OWNER bound to a PRIVATE contact. They
 * answer through this projection too, so every schedule route discloses of its
 * contact what the operator invoice read discloses of its customer
 * (OPERATOR_INVOICE_CONTACT_SELECT) and nothing more. An unknown :id (no
 * schedule) passes through as before. Proven by
 * test/commerce-contact-bind-visibility.integration.test.ts CB-01g, CB-04a
 * (reads) and CB-04b (PATCH, pause, resume, DELETE; review SEC-W3D46R-2), and
 * d46-commerce-writes D46-S07a..e's admitted controls.
 */
function toScheduleResponse<S extends { contact?: Record<ScheduleWriteContactKey, unknown> | null }>(schedule: S) {
  const contact = schedule.contact;
  if (!contact) return schedule;
  return {
    ...schedule,
    contact: Object.fromEntries(SCHEDULE_WRITE_CONTACT_KEYS.map((key) => [key, contact[key]])) as Pick<
      NonNullable<S['contact']>,
      ScheduleWriteContactKey
    >,
  };
}

@Controller('commerce')
export class RecurringInvoiceController {
  constructor(
    @Inject(RecurringInvoiceService) private readonly service: RecurringInvoiceService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * W3-D46-CREATE-AND-RECURRING (owner ruling D-46): a platform SUPER_ADMIN
   * who is not a member of the business stays refused on tenant invoice
   * writes, and a schedule is one: the scheduler turns it into real invoices.
   * BusinessGuard and ModuleScopeGuard both admit SUPER_ADMIN to every tenant
   * and skip the module scope, and RecurringInvoiceService checks no
   * Membership, so a non-member SUPER_ADMIN created, edited, paused, resumed
   * and cancelled schedules in any business (FOLLOW3-A1 review SEC-A1-2, its
   * census OPEN set). Every write below calls this first: FOLLOW3-A1's rule,
   * as CommerceController.assertSuperAdminMayWriteRevenue applies it to the
   * other commerce invoice writes (private there; restated here as
   * PaymentsOpsController restates it, FOLLOW3-A2). That role needs a
   * Membership in :businessId whose scope map (or, without one, the role
   * defaults) holds revenue:write. No membership answers 403 'Not authorized
   * to update this invoice'; a membership below revenue:write answers the
   * guard's message. Refused before any read or write. Every other caller is
   * unchanged and costs no query (the guards already applied this rule to it).
   * The recurring run (processRecurringInvoices) acts as the system, not as a
   * caller, and is not affected. d46-write-routes.spec.ts lists these writes
   * as GUARDED.
   */
  private async assertSuperAdminMayWriteRevenue(req: ActorRequest | undefined, businessId: string): Promise<void> {
    const user = req?.user;
    if (user?.role !== 'SUPER_ADMIN') return;
    const membership = user.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: user.id, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    if (!membership) throw new ForbiddenException('Not authorized to update this invoice');
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.revenue || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires write access (you have ${level})`);
    }
  }

  // Review SEC-W3D46R-1 (D-64): each schedule's contact is projected
  // (toScheduleResponse), as on every schedule write.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/recurring-invoices')
  async list(@Param('businessId') businessId: string) {
    return (await this.service.listRecurringInvoices(businessId)).map((schedule) => toScheduleResponse(schedule));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/recurring-invoices/:id')
  async get(@Param('businessId') businessId: string, @Param('id') id: string) {
    const schedule = await this.service.getRecurringInvoice(businessId, id);
    return schedule ? toScheduleResponse(schedule) : schedule;
  }

  // W3-D46-CREATE-AND-RECURRING: D-46 first; D-64: the acting member is
  // forwarded, so the service binds only a contact that member may open (a
  // hidden one is the 404 of an unknown id), and the body carries the
  // projected contact.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_created', 'recurring_invoice')
  @Post('businesses/:businessId/recurring-invoices')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: {
      contactId: string;
      name: string;
      description?: string;
      frequency: string;
      amount: number;
      currency?: string;
      startDate: string;
      endDate?: string | null;
      nextRunDate: string;
      metadata?: Record<string, unknown> | null;
    },
    @Req() req?: ActorRequest,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    // The actor is set after the body spread: the inline body type is not
    // validated or whitelisted, so a body field can never name it.
    return toScheduleResponse(await this.service.createRecurringInvoice({ ...body, businessId, actorUserId: req?.user?.id }));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_updated', 'recurring_invoice')
  @Patch('businesses/:businessId/recurring-invoices/:id')
  async update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: {
      contactId?: string;
      name?: string;
      description?: string | null;
      frequency?: string;
      amount?: number;
      currency?: string;
      startDate?: string;
      endDate?: string | null;
      nextRunDate?: string;
      status?: string;
      metadata?: Record<string, unknown> | null;
    },
    @Req() req?: ActorRequest,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    return toScheduleResponse(await this.service.updateRecurringInvoice({ ...body, id, businessId }));
  }

  // The recurring panel's history drawer has always called this path; it was
  // never served, so the drawer opened empty rather than erroring visibly.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/recurring-invoices/:id/history')
  history(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.listGenerationHistory(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_paused', 'recurring_invoice')
  @Post('businesses/:businessId/recurring-invoices/:id/pause')
  async pause(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req?: ActorRequest) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    return toScheduleResponse(await this.service.pauseRecurringInvoice(businessId, id));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_resumed', 'recurring_invoice')
  @Post('businesses/:businessId/recurring-invoices/:id/resume')
  async resume(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req?: ActorRequest) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    return toScheduleResponse(await this.service.resumeRecurringInvoice(businessId, id));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_cancelled', 'recurring_invoice')
  @Delete('businesses/:businessId/recurring-invoices/:id')
  async cancel(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req?: ActorRequest) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    return toScheduleResponse(await this.service.cancelRecurringInvoice(businessId, id));
  }
}
