import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

export interface SubscriptionConfig {
  enabled: boolean;
  billingInterval: 'week' | 'month' | 'year';
  intervalCount: number; // e.g., 1 = every month, 3 = every 3 months
  trialDays: number;
  setupFee: number;
  cancellationPolicy: 'anytime' | 'end_of_period' | 'minimum_term';
}

@Injectable()
export class MerchantSubscriptionService {
  private readonly logger = new Logger(MerchantSubscriptionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async getSubscriptionConfig(businessId: string, productId: string): Promise<SubscriptionConfig | null> {
    const product = await this.prisma.client.product.findUnique({
      where: { id: productId, businessId },
      select: { executionMeta: true },
    });
    if (!product?.executionMeta) return null;
    const meta = product.executionMeta as Record<string, any>;
    return meta.subscriptionConfig as SubscriptionConfig | undefined ?? null;
  }

  async setSubscriptionConfig(
    businessId: string,
    productId: string,
    config: SubscriptionConfig,
  ) {
    const product = await this.prisma.client.product.findUnique({
      where: { id: productId, businessId },
      select: { executionMeta: true },
    });
    if (!product) throw new Error('Product not found');

    const meta = (product.executionMeta as Record<string, any>) ?? {};
    await this.catalog.updateProduct({
      businessId,
      productId,
      executionMeta: { ...meta, subscriptionConfig: config },
    });
  }

  async listSubscriptionProducts(businessId: string) {
    const products = await this.prisma.client.product.findMany({
      where: { businessId, isActive: true, deletedAt: null },
      select: { id: true, name: true, price: true, currency: true, executionMeta: true },
    });

    return products
      .filter((p) => {
        const meta = p.executionMeta as Record<string, any>;
        return meta?.subscriptionConfig?.enabled === true;
      })
      .map((p) => {
        const meta = p.executionMeta as Record<string, any>;
        return {
          id: p.id,
          name: p.name,
          price: p.price,
          currency: p.currency,
          config: meta.subscriptionConfig as SubscriptionConfig,
        };
      });
  }

  async createSubscriptionCheckout(
    businessId: string,
    productId: string,
    contactId: string,
  ) {
    const config = await this.getSubscriptionConfig(businessId, productId);
    if (!config?.enabled) throw new Error('Subscription not enabled for this product');

    const product = await this.prisma.client.product.findUnique({
      where: { id: productId, businessId },
    });
    if (!product) throw new Error('Product not found');

    // In a full implementation, this would create a Stripe/PayPal subscription
    // For now, create an invoice with subscription metadata
    const invoice = await this.prisma.client.invoice.create({
      data: {
        businessId,
        contactId,
        invoiceNumber: `SUB-${Date.now()}`,
        status: 'DRAFT',
        subtotal: product.price,
        total: product.price + (config.setupFee ?? 0),
        currency: product.currency,
        notes: `Subscription: ${product.name} (${config.billingInterval}ly)`,
      },
    });

    this.logger.log(`Created subscription checkout invoice ${invoice.id} for product ${productId}`);
    return invoice;
  }
}
