import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { assertMayExport, contactIdsEveryReceiverMayOpen } from '../../core/auth/receiver-reads';
import type { ModuleLevelActor } from '../../core/auth/member-module-level';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CONNECTOR_EXPORT_READS, exportAudience } from '../../core/connectors/connector-exports';
import { QuickbooksConnector } from '../../core/connectors/implementations/quickbooks.connector';
import { XeroConnector } from '../../core/connectors/implementations/xero.connector';

type AccountingProvider = 'quickbooks' | 'xero';
type AccountingRequest = { user?: ModuleLevelActor };

/** Why a record was not sent: its contact is outside the view of someone who receives it. */
const NOT_IN_VIEW = 'Not sent: the contact is outside the view of the member pushing it or of the account it would go to';

/**
 * SWEEP-P0-SCOPES round 2 class repair (CLASS A; finding WHP-1): the accounting push sends each
 * invoice's lines and amounts and each customer's name, email, company and phone to the QuickBooks
 * realm or Xero tenant in the stored credentials. Every route here ran AuthGuard and BusinessGuard only:
 * a STAFF member with every module none listed every unsynced invoice with its contact and pushed any
 * contact, and an ADMIN whose map said revenue none and crm none bound an account of their own and
 * pushed a PRIVATE contact and its invoices to it.
 *
 * Now (D-57: money reads need revenue read):
 *   - the reads (summary, unsynced invoices, chart of accounts) need revenue read;
 *   - a push needs revenue write (it writes the external id back on the invoice and the contact
 *     mapping), read on what it sends (assertMayExport: revenue and crm, CONNECTOR_EXPORT_READS), and it
 *     sends only the records every receiver may open: the member pushing and the member who bound the
 *     account (exportAudience; contactIdsEveryReceiverMayOpen). A record outside that view is answered
 *     as not sent, with why.
 */
@Controller('accounting')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class AccountingController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QuickbooksConnector) private readonly quickbooks: QuickbooksConnector,
    @Inject(XeroConnector) private readonly xero: XeroConnector,
  ) {}

  private async resolveProvider(businessId: string): Promise<{ provider: AccountingProvider; connector: QuickbooksConnector | XeroConnector } | null> {
    const [qb, xero] = await Promise.all([
      this.quickbooks.isConnected(businessId).catch(() => false),
      this.xero.isConnected(businessId).catch(() => false),
    ]);
    if (qb) return { provider: 'quickbooks', connector: this.quickbooks };
    if (xero) return { provider: 'xero', connector: this.xero };
    return null;
  }

  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/summary')
  async summary(@Param('businessId') businessId: string) {
    const resolved = await this.resolveProvider(businessId);
    if (!resolved) {
      const [invoicesTotal, customersTotal] = await Promise.all([
        this.prisma.client.invoice.count({ where: { businessId, deletedAt: null } }).catch(() => 0),
        this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }).catch(() => 0),
      ]);
      return {
        connected: false,
        provider: null,
        connectedAccount: null,
        lastSyncAt: null,
        invoicesTotal,
        invoicesSynced: 0,
        invoicesUnsynced: invoicesTotal,
        customersTotal,
        customersSynced: 0,
        customersUnsynced: customersTotal,
      };
    }
    return resolved.connector.getSyncSummary(businessId);
  }

  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/invoices/unsynced')
  async unsyncedInvoices(@Param('businessId') businessId: string, @Query('limit') limit?: string) {
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const invoices = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, externalAccountingId: null },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, displayName: true, companyName: true, email: true } },
      },
    });
    return { invoices };
  }

  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/invoices/push')
  async pushInvoice(@Param('businessId') businessId: string, @Body() body: { invoiceIds: string[] }, @Req() req?: AccountingRequest) {
    const ids = (body?.invoiceIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) throw new BadRequestException('invoiceIds required');
    const resolved = await this.resolveProvider(businessId);
    if (!resolved) throw new ForbiddenException('No accounting provider is connected');
    await assertMayExport(this.prisma, businessId, req?.user, CONNECTOR_EXPORT_READS[resolved.provider], `pushing invoices to ${resolved.provider}`);
    const audience = await exportAudience(this.prisma, businessId, resolved.provider, req?.user);
    const rows: Array<{ id: string; contactId: string }> = await this.prisma.client.invoice.findMany({
      where: { id: { in: ids }, businessId, deletedAt: null },
      select: { id: true, contactId: true },
    });
    const inView = await contactIdsEveryReceiverMayOpen(this.prisma, businessId, audience, rows.map((r) => r.contactId));
    const contactOf = new Map(rows.map((r) => [r.id, r.contactId]));

    const results: Array<{ invoiceId: string; success: boolean; externalId?: string; error?: string }> = [];
    let succeeded = 0;
    for (const id of ids) {
      const contactId = contactOf.get(id);
      if (contactId !== undefined && !inView.has(contactId)) {
        results.push({ invoiceId: id, success: false, error: NOT_IN_VIEW });
        continue;
      }
      const out = await resolved.connector.pushInvoice(businessId, id);
      results.push({ invoiceId: id, ...out });
      if (out.success) succeeded += 1;
    }
    return { provider: resolved.provider, total: ids.length, succeeded, failed: ids.length - succeeded, results };
  }

  @RequireModuleScope('revenue', 'write')
  @Post('businesses/:businessId/customers/push')
  async pushCustomers(@Param('businessId') businessId: string, @Body() body: { contactIds?: string[] }, @Req() req?: AccountingRequest) {
    const resolved = await this.resolveProvider(businessId);
    if (!resolved) throw new ForbiddenException('No accounting provider is connected');
    await assertMayExport(this.prisma, businessId, req?.user, CONNECTOR_EXPORT_READS[resolved.provider], `pushing customers to ${resolved.provider}`);
    const audience = await exportAudience(this.prisma, businessId, resolved.provider, req?.user);

    let contactIds = (body?.contactIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
    const requested = contactIds.length > 0;
    if (!requested) {
      // Default: push all contacts that have at least one invoice (treated as customers).
      const customers = await this.prisma.client.contact.findMany({
        where: { businessId, deletedAt: null, invoices: { some: {} } },
        select: { id: true },
        take: 200,
      });
      contactIds = customers.map((c) => c.id);
    }
    const inView = await contactIdsEveryReceiverMayOpen(this.prisma, businessId, audience, contactIds);
    // the default set holds only what every receiver may open; an id asked for outside it is answered
    if (!requested) contactIds = contactIds.filter((id) => inView.has(id));
    if (contactIds.length === 0) {
      return { provider: resolved.provider, total: 0, succeeded: 0, failed: 0, results: [] };
    }

    const results: Array<{ contactId: string; success: boolean; externalId?: string; error?: string }> = [];
    let succeeded = 0;
    for (const id of contactIds) {
      if (!inView.has(id)) {
        results.push({ contactId: id, success: false, error: NOT_IN_VIEW });
        continue;
      }
      const out = await resolved.connector.pushCustomer(businessId, id);
      results.push({ contactId: id, ...out });
      if (out.success) succeeded += 1;
    }
    return { provider: resolved.provider, total: contactIds.length, succeeded, failed: contactIds.length - succeeded, results };
  }

  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/chart-of-accounts')
  async chartOfAccounts(@Param('businessId') businessId: string) {
    const resolved = await this.resolveProvider(businessId);
    if (!resolved) throw new ForbiddenException('No accounting provider is connected');
    const out = await resolved.connector.listChartOfAccounts(businessId);
    if (!out.success) throw new BadRequestException(out.error ?? 'Failed to fetch chart of accounts');
    return { provider: resolved.provider, accounts: out.accounts ?? [] };
  }
}
