import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QuickbooksConnector } from '../../core/connectors/implementations/quickbooks.connector';
import { XeroConnector } from '../../core/connectors/implementations/xero.connector';

type AccountingProvider = 'quickbooks' | 'xero';

@Controller('accounting')
@UseGuards(AuthGuard, BusinessGuard)
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

  @Post('businesses/:businessId/invoices/push')
  async pushInvoice(@Param('businessId') businessId: string, @Body() body: { invoiceIds: string[] }) {
    const ids = (body?.invoiceIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) throw new BadRequestException('invoiceIds required');
    const resolved = await this.resolveProvider(businessId);
    if (!resolved) throw new ForbiddenException('No accounting provider is connected');

    const results: Array<{ invoiceId: string; success: boolean; externalId?: string; error?: string }> = [];
    let succeeded = 0;
    for (const id of ids) {
      const out = await resolved.connector.pushInvoice(businessId, id);
      results.push({ invoiceId: id, ...out });
      if (out.success) succeeded += 1;
    }
    return { provider: resolved.provider, total: ids.length, succeeded, failed: ids.length - succeeded, results };
  }

  @Post('businesses/:businessId/customers/push')
  async pushCustomers(@Param('businessId') businessId: string, @Body() body: { contactIds?: string[] }) {
    const resolved = await this.resolveProvider(businessId);
    if (!resolved) throw new ForbiddenException('No accounting provider is connected');

    let contactIds = body?.contactIds;
    if (!contactIds || contactIds.length === 0) {
      // Default: push all contacts that have at least one invoice (treated as customers).
      const customers = await this.prisma.client.contact.findMany({
        where: { businessId, deletedAt: null, invoices: { some: {} } },
        select: { id: true },
        take: 200,
      });
      contactIds = customers.map((c) => c.id);
    }
    if (contactIds.length === 0) {
      return { provider: resolved.provider, total: 0, succeeded: 0, failed: 0, results: [] };
    }

    const results: Array<{ contactId: string; success: boolean; externalId?: string; error?: string }> = [];
    let succeeded = 0;
    for (const id of contactIds) {
      const out = await resolved.connector.pushCustomer(businessId, id);
      results.push({ contactId: id, ...out });
      if (out.success) succeeded += 1;
    }
    return { provider: resolved.provider, total: contactIds.length, succeeded, failed: contactIds.length - succeeded, results };
  }

  @Get('businesses/:businessId/chart-of-accounts')
  async chartOfAccounts(@Param('businessId') businessId: string) {
    const resolved = await this.resolveProvider(businessId);
    if (!resolved) throw new ForbiddenException('No accounting provider is connected');
    const out = await resolved.connector.listChartOfAccounts(businessId);
    if (!out.success) throw new BadRequestException(out.error ?? 'Failed to fetch chart of accounts');
    return { provider: resolved.provider, accounts: out.accounts ?? [] };
  }
}
