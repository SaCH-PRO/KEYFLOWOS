import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
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

const FX_TO_TTD: Record<string, number> = {
  TTD: 1,
  USD: 6.78,
  EUR: 7.4,
  GBP: 8.6,
  CAD: 5.0,
  AUD: 4.5,
  JMD: 0.043,
  BBD: 3.39,
  XCD: 2.51,
  GYD: 0.032,
};

function toTtd(amount: number, currency: string): number | null {
  const rate = FX_TO_TTD[currency.toUpperCase()];
  if (!rate) return null;
  return Math.round(amount * rate * 100) / 100;
}

@Injectable()
export class PaymentsOpsService {
  private readonly logger = new Logger(PaymentsOpsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StripeConnector) private readonly stripe: StripeConnector,
    @Inject(PayPalConnector) private readonly paypal: PayPalConnector,
    @Inject(WiPayConnector) private readonly wipay: WiPayConnector,
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`listRecentTransactions failed for ${s.id}: ${msg}`);
          return [] as PaymentGatewayTransaction[];
        }
      });
    const results = await Promise.all(tasks);
    const merged = results.flat();
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged.slice(0, limit).map((t) => ({ ...t, amountTtd: toTtd(t.amount, t.currency) }));
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
    } catch (err) {
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
        } catch (err) {
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
    } catch (err) {
      if (err instanceof GatewayNotSupportedError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  async refundCharge(
    businessId: string,
    gatewayId: GatewayId,
    input: RefundInput,
  ): Promise<RefundResult> {
    if (!input.chargeId) throw new BadRequestException('Charge id is required');
    const gw = this.getGateway(gatewayId);
    try {
      const refund = await gw.refundCharge(businessId, input);
      // Best-effort: record in our payments table
      try {
        const orig = await this.prisma.client.payment.findFirst({
          where: { businessId, providerPaymentId: input.chargeId },
        });
        if (orig) {
          await this.prisma.client.payment.create({
            data: {
              businessId,
              invoiceId: orig.invoiceId,
              amount: -Math.abs(refund.amount),
              currency: refund.currency,
              status: 'REFUNDED',
              provider: gatewayId,
              providerPaymentId: refund.id,
              reference: input.chargeId,
              notes: input.reason ?? null,
            },
          });
        }
      } catch (e) {
        this.logger.warn(`Failed to persist refund row: ${e instanceof Error ? e.message : e}`);
      }
      return refund;
    } catch (err) {
      if (err instanceof GatewayNotSupportedError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
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
