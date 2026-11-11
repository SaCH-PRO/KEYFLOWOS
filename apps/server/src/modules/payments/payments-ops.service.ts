import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { StripeConnector } from '../../core/connectors/implementations/stripe.connector';
import { PayPalConnector } from '../../core/connectors/implementations/paypal.connector';
import { WiPayConnector } from '../../core/connectors/implementations/wipay.connector';
import {
  GatewayNotSupportedError,
  IPaymentGatewayConnector,
  PaymentGatewayTransaction,
  PaymentLinkInput,
  PaymentLinkResult,
  RefundInput,
  RefundResult,
} from '../../core/connectors/payment-gateway.interface';
import { CurrencyRatesService } from './currency-rates.service';
import { PaymentsService } from './payments.service';
import { balanceOfStoredRows } from '../commerce/invoice-workflow.service';

export type GatewayId = 'stripe' | 'paypal' | 'wipay';

export interface GatewayStatus {
  id: GatewayId;
  name: string;
  connected: boolean;
  supports: { transactions: boolean; paymentLinks: boolean; refunds: boolean };
}

export interface MergedTransaction extends PaymentGatewayTransaction {
  amountTtd: number | null;
}

@Injectable()
export class PaymentsOpsService {
  private readonly logger = new Logger(PaymentsOpsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StripeConnector) private readonly stripe: StripeConnector,
    @Inject(PayPalConnector) private readonly paypal: PayPalConnector,
    @Inject(WiPayConnector) private readonly wipay: WiPayConnector,
    @Inject(CurrencyRatesService) private readonly fx: CurrencyRatesService,
    // W10-REFUND-CHARGE-DOOR: the provider refund door refundCharge records through.
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  private getGateway(id: GatewayId): IPaymentGatewayConnector {
    if (id === 'stripe') return this.stripe;
    if (id === 'paypal') return this.paypal;
    if (id === 'wipay') return this.wipay;
    throw new BadRequestException(`Gateway ${id} is not registered`);
  }

  async getGatewayStatuses(businessId: string): Promise<GatewayStatus[]> {
    const all: Array<{ id: GatewayId; name: string; connector: { isConnected(b: string): Promise<boolean> } }> = [
      { id: 'stripe', name: 'Stripe', connector: this.stripe },
      { id: 'paypal', name: 'PayPal', connector: this.paypal },
      { id: 'wipay', name: 'WiPay', connector: this.wipay },
    ];
    const statuses: GatewayStatus[] = [];
    for (const g of all) {
      const connected = await g.connector.isConnected(businessId).catch(() => false);
      const supports: { transactions: boolean; paymentLinks: boolean; refunds: boolean } = {
        transactions: true,
        paymentLinks: g.id !== 'wipay',
        refunds: g.id !== 'wipay',
      };
      statuses.push({ id: g.id, name: g.name, connected, supports });
    }
    return statuses;
  }

  async listAllTransactions(businessId: string, limit = 50): Promise<MergedTransaction[]> {
    const statuses = await this.getGatewayStatuses(businessId);
    const tasks = statuses
      .filter((s) => s.connected)
      .map(async (s) => {
        try {
          const gw = this.getGateway(s.id);
          return await gw.listRecentTransactions(businessId, limit);
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`listRecentTransactions failed for ${s.id}: ${msg}`);
          return [] as PaymentGatewayTransaction[];
        }
      });
    const results = await Promise.all(tasks);
    const merged = results.flat();
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const top = merged.slice(0, limit);
    const converted = await Promise.all(
      top.map(async (t) => ({
        ...t,
        amountTtd: await this.fx.toTtd(t.amount, t.currency),
      })),
    );
    return converted;
  }

  async createPaymentLink(
    businessId: string,
    gatewayId: GatewayId,
    input: PaymentLinkInput,
  ): Promise<PaymentLinkResult> {
    if (input.amount <= 0) throw new BadRequestException('Amount must be greater than zero');
    if (!input.description?.trim()) throw new BadRequestException('Description is required');
    const gw = this.getGateway(gatewayId);
    try {
      return await gw.createPaymentLink(businessId, input);
    } catch (err: any) {
      if (err instanceof GatewayNotSupportedError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async listAllPaymentLinks(businessId: string): Promise<PaymentLinkResult[]> {
    const statuses = await this.getGatewayStatuses(businessId);
    const tasks = statuses
      .filter((s) => s.connected && s.supports.paymentLinks)
      .map(async (s) => {
        try {
          return await this.getGateway(s.id).listPaymentLinks(businessId);
        } catch (err: any) {
          this.logger.warn(`listPaymentLinks failed for ${s.id}: ${err instanceof Error ? err.message : err}`);
          return [];
        }
      });
    const results = await Promise.all(tasks);
    return results.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async revokePaymentLink(businessId: string, gatewayId: GatewayId, linkId: string): Promise<void> {
    const gw = this.getGateway(gatewayId);
    try {
      await gw.revokePaymentLink(businessId, linkId);
    } catch (err: any) {
      if (err instanceof GatewayNotSupportedError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * W10-REFUND-CHARGE-DOOR review SEC-RCD-1 (R0-PL-07, R0-CMF2, D-90):
   * `actorId` is who makes the refund, never a body field: the authenticated
   * user of the payments-ops route (PaymentsOpsController.refund, a D-46
   * SUPER_ADMIN member included) or KEY_SYSTEM_ACTOR_ID for KEY's
   * payments_refund_charge. The refund door names it on what it records.
   */
  async refundCharge(
    businessId: string,
    gatewayId: GatewayId,
    input: RefundInput,
    actorId: string | null,
  ): Promise<RefundResult> {
    if (!input.chargeId) throw new BadRequestException('Charge id is required');
    const gw = this.getGateway(gatewayId);
    // V1-15d-STRIPE-OPS-TENANCY (F1): only the business's own charge is
    // refunded; any other (another tenant's charge on the shared platform key,
    // or a charge that is no one's) is refused like an unknown charge, before
    // the provider is asked to move money. Stripe: the provider's own record
    // on the shared key (StripeConnector.isOwnCharge; review SEC-V15D-1/2/3,
    // CR-V15D-1/2). Other gateways: the business's own recorded payments.
    const own =
      gatewayId === 'stripe'
        ? await this.stripe.isOwnCharge(businessId, input.chargeId)
        : await this.ownsRecordedCharge(businessId, gatewayId, input.chargeId);
    if (!own) throw new NotFoundException('Charge not found');
    try {
      const refund = await gw.refundCharge(businessId, input);
      // W10-REFUND-CHARGE-DOOR (SOT-10b; V1-29 refund convention, D-14, D-102):
      // recorded through the provider refund door (PaymentsService
      // .recordGatewayRefund): the linked negative REFUNDED row and its posting
      // in one transaction, then the reconcile that reopens the invoice. This
      // wrote the row itself, unposted, and the provider's refund event then
      // posted nothing. Only a payment of this business recorded under the
      // charge id itself, as before: a refund of one recorded under its
      // Checkout Session or PaymentIntent id is recorded, linked and posted by
      // the provider's refund event (the V1-29c door). The provider refunded
      // already, so a recording that fails is logged, not thrown: it wrote
      // nothing, and the provider's refund event records the refund.
      try {
        await this.payments.recordGatewayRefund({
          businessId,
          provider: gatewayId,
          chargeId: input.chargeId,
          refund,
          reason: input.reason ?? null,
          // SEC-RCD-1 (R0-PL-07): the refunder, on the row, its posting and its feed row.
          actorId,
        });
      } catch (e) {
        this.logger.warn(
          `Refund ${refund.id} of ${gatewayId} charge ${input.chargeId} not recorded here (the provider's refund event records it): ` +
            `${e instanceof Error ? e.message : e}`,
        );
      }
      return refund;
    } catch (err: any) {
      if (err instanceof GatewayNotSupportedError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /**
   * V1-15d-STRIPE-OPS-TENANCY (F1), for a gateway with no provider-side owner
   * tag (PayPal): whether one of this business's SUCCESSFUL payments names
   * `chargeId` (providerPaymentId or reference). Payment is outside the tenant
   * extension (M31).
   *
   * On the business's own credentials only its own rows are read: no other
   * tenant can reach that account. On the platform credentials only rows the
   * provider's callback wrote (recordedBy null) count, and the charge is
   * refused when such a row of another business names it too. A row a member
   * typed through the manual payment route (recordedBy set, any method and
   * reference) is no evidence there, for or against: it can neither claim
   * another tenant's capture nor take one from its owner (review SEC-V15D-3).
   */
  private async ownsRecordedCharge(businessId: string, gatewayId: GatewayId, chargeId: string): Promise<boolean> {
    const ownCredentials = await this.hasOwnCredentials(businessId, gatewayId);
    const rows = await this.prisma.client.payment.findMany({
      where: {
        provider: gatewayId,
        status: 'SUCCESSFUL',
        OR: [{ providerPaymentId: chargeId }, { reference: chargeId }],
        ...(ownCredentials ? { businessId } : { recordedBy: null }),
      },
      select: { businessId: true },
    });
    return rows.length > 0 && rows.every((r) => r.businessId === businessId);
  }

  /** Whether the business stores its own credentials for `gatewayId` (PayPal: client id and secret), so its operations never run on the platform's. */
  private async hasOwnCredentials(businessId: string, gatewayId: GatewayId): Promise<boolean> {
    if (gatewayId !== 'paypal') return false;
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown> | null) ?? {};
    return !!meta.paypalClientId && !!meta.paypalClientSecret;
  }

  async searchCharges(
    businessId: string,
    query: { query?: string; limit?: number },
  ): Promise<MergedTransaction[]> {
    const all = await this.listAllTransactions(businessId, query.limit ?? 50);
    const q = query.query?.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) => {
      if (t.id.toLowerCase().includes(q)) return true;
      if (t.customerEmail?.toLowerCase().includes(q)) return true;
      if (t.customerName?.toLowerCase().includes(q)) return true;
      if (String(t.amount).includes(q)) return true;
      if (t.invoiceId?.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  async findTransactionLink(
    businessId: string,
    transactionId: string,
  ): Promise<{ invoiceId: string | null; provider: string | null; externalUrl: string | null }> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { businessId, providerPaymentId: transactionId },
    });
    const provider = payment?.provider ?? this.guessProvider(transactionId);
    return {
      invoiceId: payment?.invoiceId ?? null,
      provider,
      externalUrl: provider ? buildProviderUrl(provider, transactionId) : null,
    };
  }

  private guessProvider(id: string): string | null {
    if (id.startsWith('ch_') || id.startsWith('py_') || id.startsWith('pi_') || id.startsWith('re_') || id.startsWith('plink_')) return 'stripe';
    if (/^[A-Z0-9]{17}$/.test(id)) return 'paypal';
    return null;
  }

  async listOpenPayables(businessId: string) {
    const [invoices, orders, ticketHolders] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          status: { in: ['SENT', 'PENDING', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIAL'] },
        },
        include: {
          contact: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
              companyName: true,
              email: true,
            },
          },
          // Own-tenant rows only: Payment has no FK to Business (M31, review SEC-V29B-1).
          payments: { where: { businessId }, select: { amount: true, status: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 100,
      }),
      this.prisma.client.marketplaceOrder.findMany({
        where: {
          businessId,
          paymentStatus: { notIn: ['PAID', 'REFUNDED', 'COMPLETED'] },
          status: { not: 'CANCELLED' },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.client.eventAttendee.findMany({
        where: {
          businessId,
          paymentId: null,
          status: { not: 'CANCELLED' },
        },
        include: {
          event: { select: { name: true, startsAt: true } },
          ticketType: { select: { name: true, price: true, currency: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const regularInvoices: typeof invoices = [];
    const campaignInvoices: typeof invoices = [];
    for (const inv of invoices) {
      if (inv.campaignId) {
        campaignInvoices.push(inv);
      } else {
        regularInvoices.push(inv);
      }
    }

    const buildInvoicePayable = <T extends 'invoice' | 'mass_comm'>(inv: (typeof invoices)[number], type: T) => {
      // V1-29b-REFUND-READERS (V1-22 residual): what is still owed is the
      // balance read contract over the invoice's own-tenant rows, in integer
      // cents (a row tagged with another businessId is not this invoice's
      // money, M31; the receipt and the receivables read the same rows). The
      // status-blind float sum counted PENDING and FAILED rows and a row
      // flipped to REFUNDED before V1-29 as received (10.10 + 20.20 + 30.30
      // left 39.400000000000006 owed).
      const { remaining } = balanceOfStoredRows(Number(inv.total), inv.payments, inv.currency);
      const contact = inv.contact;
      const customerName =
        contact?.displayName ??
        (contact?.firstName || contact?.lastName
          ? [contact.firstName, contact.lastName].filter(Boolean).join(' ')
          : undefined) ??
        contact?.companyName ??
        contact?.email ??
        'Unknown';
      return {
        type,
        id: inv.id,
        title: type === 'mass_comm' ? `Campaign — ${inv.invoiceNumber}` : `Invoice ${inv.invoiceNumber}`,
        customer: customerName,
        amount: remaining,
        currency: inv.currency,
        status: inv.status,
        dueAt: inv.dueDate?.toISOString() ?? null,
        createdAt: inv.createdAt.toISOString(),
        href: `/app/commerce/invoices/${inv.id}`,
      };
    };

    const invoicePayables = regularInvoices.map((inv) => buildInvoicePayable(inv, 'invoice'));
    const massCommPayables = campaignInvoices.map((inv) => buildInvoicePayable(inv, 'mass_comm'));

    const orderPayables = orders.map((order) => ({
      type: 'storefront_order' as const,
      id: order.id,
      title: `Order ${order.orderNumber}`,
      customer: order.customerName ?? order.customerEmail ?? 'Unknown',
      amount: order.total,
      currency: order.currency,
      status: order.paymentStatus,
      dueAt: null,
      createdAt: order.createdAt.toISOString(),
      href: `/app/store`,
    }));

    const ticketPayables = ticketHolders
      .filter((a) => a.ticketType && Number(a.ticketType.price) > 0)
      .map((a) => ({
        type: 'event_ticket' as const,
        id: a.id,
        title: `${a.event.name} — ${a.ticketType!.name}`,
        customer: a.name ?? a.email,
        amount: Number(a.ticketType!.price),
        currency: a.ticketType!.currency ?? 'TTD',
        status: 'PENDING' as const,
        dueAt: a.event.startsAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        href: `/app/events/${a.eventId}`,
      }));

    return {
      payables: [...invoicePayables, ...massCommPayables, ...orderPayables, ...ticketPayables].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
      counts: {
        invoices: invoicePayables.length,
        massComms: massCommPayables.length,
        storefrontOrders: orderPayables.length,
        eventTickets: ticketPayables.length,
      },
    };
  }
}

function buildProviderUrl(provider: string, id: string): string | null {
  if (provider === 'stripe') {
    if (id.startsWith('re_')) return `https://dashboard.stripe.com/refunds/${id}`;
    if (id.startsWith('plink_')) return `https://dashboard.stripe.com/payment-links/${id}`;
    return `https://dashboard.stripe.com/payments/${id}`;
  }
  if (provider === 'paypal') {
    return `https://www.paypal.com/activity/payment/${id}`;
  }
  return null;
}
