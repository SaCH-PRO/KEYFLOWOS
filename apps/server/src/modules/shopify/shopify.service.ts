import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CatalogService } from '../catalog/catalog.service';

export interface ShopifyCredentials {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  variants: Array<{
    id: number;
    title: string;
    price: string;
    sku?: string;
    inventory_quantity?: number;
  }>;
  images: Array<{ src: string }>;
  tags?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  created_at: string;
  customer?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
  };
  line_items: Array<{
    product_id: number | null;
    variant_id: number | null;
    title: string;
    quantity: number;
    price: string;
  }>;
}

export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  default_address?: {
    address1?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
  };
  orders_count: number;
  total_spent: string;
  created_at: string;
}

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);
  private readonly DEFAULT_API_VERSION = '2024-04';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  private async getCredentials(businessId: string): Promise<ShopifyCredentials | null> {
    const status = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'shopify' } },
    });

    if (!status?.metadata) return null;
    const meta = status.metadata as any;
    if (!meta.shopDomain || !meta.accessToken) return null;

    return {
      shopDomain: meta.shopDomain,
      accessToken: meta.accessToken,
      apiVersion: meta.apiVersion ?? this.DEFAULT_API_VERSION,
    };
  }

  private async shopifyRequest<T>(
    creds: ShopifyCredentials,
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any,
  ): Promise<T> {
    const url = `https://${creds.shopDomain}/admin/api/${creds.apiVersion}/${endpoint}`;

    const res = await fetch(url, {
      method,
      headers: {
        'X-Shopify-Access-Token': creds.accessToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async testConnection(businessId: string): Promise<{ success: boolean; shopName?: string; error?: string }> {
    try {
      const creds = await this.getCredentials(businessId);
      if (!creds) return { success: false, error: 'Shopify not configured' };

      const data = await this.shopifyRequest<{ shop: { name: string; domain: string } }>(creds, 'shop.json');
      return { success: true, shopName: data.shop.name };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async syncProducts(businessId: string, options?: { sinceId?: number; limit?: number }): Promise<{ imported: number; updated: number }> {
    const creds = await this.getCredentials(businessId);
    if (!creds) throw new Error('Shopify not configured');

    const limit = options?.limit ?? 50;
    const endpoint = `products.json?limit=${limit}${options?.sinceId ? `&since_id=${options.sinceId}` : ''}`;

    const data = await this.shopifyRequest<{ products: ShopifyProduct[] }>(creds, endpoint);
    let imported = 0;
    let updated = 0;

    for (const product of data.products) {
      for (const variant of product.variants) {
        const shopifyVariantId = `shopify:${variant.id}`;
        // Use sku field to track Shopify variant ID for dedup
        const existing = await this.prisma.client.product.findFirst({
          where: { businessId, sku: shopifyVariantId },
        });

        const productData: any = {
          businessId,
          name: `${product.title}${product.variants.length > 1 ? ` — ${variant.title}` : ''}`,
          description: product.body_html?.replace(/<[^>]+>/g, '') ?? '',
          sku: variant.sku ?? shopifyVariantId,
          price: parseFloat(variant.price) || 0,
          category: product.product_type || 'PRODUCT',
          isActive: product.status === 'active',
          imageUrl: product.images[0]?.src ?? null,
          executionMeta: {
            shopifyProductId: product.id,
            shopifyVariantId: variant.id,
            vendor: product.vendor,
            inventoryQuantity: variant.inventory_quantity,
            tags: product.tags ? product.tags.split(',').map((t: string) => t.trim()) : [],
          },
        };

        if (existing) {
          await this.catalog.updateProduct({
            businessId,
            productId: existing.id,
            ...productData,
          });
          updated++;
        } else {
          await this.catalog.createProduct(productData);
          imported++;
        }
      }
    }

    this.events.emit('shopify.products_synced', { businessId, imported, updated });
    return { imported, updated };
  }

  async syncOrders(businessId: string, options?: { sinceId?: number; limit?: number }): Promise<{ imported: number; updated: number }> {
    const creds = await this.getCredentials(businessId);
    if (!creds) throw new Error('Shopify not configured');

    const limit = options?.limit ?? 50;
    const endpoint = `orders.json?status=any&limit=${limit}${options?.sinceId ? `&since_id=${options.sinceId}` : ''}`;

    const data = await this.shopifyRequest<{ orders: ShopifyOrder[] }>(creds, endpoint);
    let imported = 0;
    let updated = 0;

    for (const order of data.orders) {
      const shopifyOrderId = `shopify:${order.id}`;
      const existing = await this.prisma.client.marketplaceOrder.findFirst({
        where: { businessId, metadata: { path: ['shopifyOrderId'], equals: order.id } },
      });

      // Resolve or create customer
      let customerName = order.customer ? `${order.customer.first_name} ${order.customer.last_name}`.trim() : 'Guest';
      if (!customerName) customerName = 'Guest';

      if (order.customer?.email) {
        const contact = await this.prisma.client.contact.findFirst({
          where: { businessId, email: order.customer.email },
        });
        if (!contact) {
          await this.prisma.client.contact.create({
            data: {
              businessId,
              firstName: order.customer.first_name || 'Shopify',
              lastName: order.customer.last_name || 'Customer',
              email: order.customer.email,
              phone: order.customer.phone || null,
              status: 'CUSTOMER',
              source: 'shopify',
              custom: { shopifyCustomerId: order.customer.id },
            },
          });
        }
      }

      const orderData: any = {
        businessId,
        orderNumber: order.name,
        customerName,
        customerEmail: order.email || order.customer?.email || null,
        total: parseFloat(order.total_price) || 0,
        currency: order.currency,
        paymentStatus: this.mapPaymentStatus(order.financial_status),
        metadata: {
          shopifyOrderId: order.id,
          lineItems: order.line_items,
          financialStatus: order.financial_status,
          fulfillmentStatus: order.fulfillment_status,
          source: 'shopify',
        },
      };

      if (existing) {
        await this.prisma.client.marketplaceOrder.update({
          where: { id: existing.id },
          data: orderData,
        });
        updated++;
      } else {
        await this.prisma.client.marketplaceOrder.create({ data: orderData });
        imported++;
      }
    }

    this.events.emit('shopify.orders_synced', { businessId, imported, updated });
    return { imported, updated };
  }

  async syncCustomers(businessId: string, options?: { sinceId?: number; limit?: number }): Promise<{ imported: number; updated: number }> {
    const creds = await this.getCredentials(businessId);
    if (!creds) throw new Error('Shopify not configured');

    const limit = options?.limit ?? 50;
    const endpoint = `customers.json?limit=${limit}${options?.sinceId ? `&since_id=${options.sinceId}` : ''}`;

    const data = await this.shopifyRequest<{ customers: ShopifyCustomer[] }>(creds, endpoint);
    let imported = 0;
    let updated = 0;

    for (const customer of data.customers) {
      const existing = await this.prisma.client.contact.findFirst({
        where: {
          businessId,
          OR: [
            { email: customer.email },
            { custom: { path: ['shopifyCustomerId'], equals: customer.id } },
          ],
        },
      });

      const contactData: any = {
        businessId,
        firstName: customer.first_name || 'Shopify',
        lastName: customer.last_name || 'Customer',
        email: customer.email,
        phone: customer.phone || null,
        status: customer.orders_count > 0 ? 'CUSTOMER' : 'LEAD',
        source: 'shopify',
        addressLine1: customer.default_address?.address1 || null,
        city: customer.default_address?.city || null,
        country: customer.default_address?.country || null,
        custom: {
          shopifyCustomerId: customer.id,
          shopifyTotalSpent: customer.total_spent,
          shopifyOrdersCount: customer.orders_count,
        },
      };

      if (existing) {
        await this.prisma.client.contact.update({
          where: { id: existing.id },
          data: contactData,
        });
        updated++;
      } else {
        await this.prisma.client.contact.create({ data: contactData });
        imported++;
      }
    }

    this.events.emit('shopify.customers_synced', { businessId, imported, updated });
    return { imported, updated };
  }

  private mapPaymentStatus(financial: string): string {
    if (financial === 'paid') return 'PAID';
    if (financial === 'pending') return 'UNPAID';
    if (financial === 'refunded') return 'REFUNDED';
    if (financial === 'partially_paid') return 'PARTIAL';
    return 'UNPAID';
  }
}
