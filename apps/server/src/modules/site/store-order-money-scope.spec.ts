import { describe, it, expect } from 'vitest';
import {
  redactOrderForFulfilment,
  redactOrderMetadataForFulfilment,
} from './store-order.service';

describe('FU-STORE-ORDERS-MONEY-SCOPE redaction helpers', () => {
  describe('redactOrderMetadataForFulfilment', () => {
    it('returns null for null, undefined, primitives, and arrays', () => {
      expect(redactOrderMetadataForFulfilment(null)).toBeNull();
      expect(redactOrderMetadataForFulfilment(undefined)).toBeNull();
      expect(redactOrderMetadataForFulfilment('raw')).toBeNull();
      expect(redactOrderMetadataForFulfilment(42)).toBeNull();
      expect(redactOrderMetadataForFulfilment(['a', 'b'])).toBeNull();
    });

    it('fails closed on financial and unknown keys while keeping safe fulfilment keys', () => {
      const redacted = redactOrderMetadataForFulfilment({
        source: 'QUICK_SALE',
        storefrontSlug: 'my-shop',
        referralCode: 'REF123',
        visitorId: 'vis-1',
        deliveryNotes: 'Call on arrival',
        deliveryInstructions: 'Side door',
        stockNotDecrementedProductIds: ['prod-1', 123, 'prod-2'],
        taxRate: 12.5,
        promoCode: 'SAVE50',
        refundedTotal: 80,
        shippingExpense: { expenseId: 'exp-1', amount: 25 },
        links: { contactId: 'c-1', invoiceId: 'inv-1' },
        publicToken: 'secret-token',
        platformFee: 4.5,
        sellerPayout: 95.5,
        unknownFutureMoneyField: 999,
        shipping: {
          zoneId: 'z-1',
          zoneName: 'Express',
          fee: 25,
          cost: 20,
          estimatedDays: '1-2',
          carrier: 'DHL',
        },
        statusTimeline: [
          { status: 'placed', timestamp: '2026-11-20T10:00:00Z', note: 'Placed' },
          { status: 'PAID', timestamp: '2026-11-20T10:01:00Z', note: 'Paid $100' },
          { status: 'partially_refunded', timestamp: '2026-11-20T10:02:00Z', refundAmount: 10, refundedTotal: 10 },
          { status: 'refunded', timestamp: '2026-11-20T10:03:00Z' },
          { status: 'payment_failed', timestamp: '2026-11-20T10:04:00Z' },
          { status: 'shipped', timestamp: '2026-11-20T12:00:00Z', note: 'Dispatched', extraSecret: 500 },
        ],
      });

      expect(redacted).toEqual({
        source: 'QUICK_SALE',
        storefrontSlug: 'my-shop',
        referralCode: 'REF123',
        visitorId: 'vis-1',
        deliveryNotes: 'Call on arrival',
        deliveryInstructions: 'Side door',
        stockNotDecrementedProductIds: ['prod-1', 'prod-2'],
        shipping: {
          zoneId: 'z-1',
          zoneName: 'Express',
          estimatedDays: '1-2',
          carrier: 'DHL',
        },
        statusTimeline: [
          { status: 'placed', timestamp: '2026-11-20T10:00:00Z', note: 'Placed' },
          { status: 'shipped', timestamp: '2026-11-20T12:00:00Z', note: 'Dispatched' },
        ],
      });
    });
  });

  describe('redactOrderForFulfilment', () => {
    it('strips all money/payment fields on order, items, shipments, and metadata', () => {
      const fullOrder: any = {
        id: 'ord-1',
        businessId: 'biz-1',
        orderNumber: 'ORD-100',
        status: 'SHIPPED',
        type: 'STOREFRONT',
        customerName: 'Ada',
        customerEmail: 'ada@example.com',
        customerPhone: '+18685550100',
        customerCountry: 'TT',
        shippingAddress: { city: 'POS' },
        billingAddress: { city: 'Secret Billing' },
        subtotal: 200,
        shippingFee: 20,
        taxAmount: 25,
        dutyAmount: 5,
        discountAmount: 10,
        total: 240,
        currency: 'TTD',
        paymentStatus: 'PAID',
        paymentMethod: 'STRIPE',
        paymentRef: 'pi_secret',
        promoCodeId: 'promo-1',
        notes: 'Fragile',
        metadata: {
          taxRate: 12.5,
          refundedTotal: 50,
          storefrontSlug: 'shop',
        },
        createdAt: '2026-11-20T00:00:00.000Z',
        updatedAt: '2026-11-20T01:00:00.000Z',
        items: [
          {
            id: 'it-1',
            orderId: 'ord-1',
            productId: 'p-1',
            name: 'Coffee',
            sku: 'COF-1',
            quantity: 2,
            unitPrice: 100,
            total: 200,
            currency: 'TTD',
          },
        ],
        shipments: [
          {
            id: 'sh-1',
            businessId: 'biz-1',
            orderId: 'ord-1',
            trackingNumber: 'TRK-1',
            carrier: 'TTPost',
            status: 'IN_TRANSIT',
            originCountry: 'TT',
            destinationCountry: 'TT',
            destinationAddress: { city: 'POS' },
            weight: 1.5,
            weightUnit: 'kg',
            dimensions: null,
            shippingCost: 20,
            currency: 'TTD',
            estimatedDelivery: null,
            shippedAt: '2026-11-20T01:00:00.000Z',
            deliveredAt: null,
            milestones: null,
            createdAt: '2026-11-20T01:00:00.000Z',
            updatedAt: '2026-11-20T01:00:00.000Z',
          },
        ],
      };

      const redacted = redactOrderForFulfilment(fullOrder);

      for (const forbidden of [
        'subtotal',
        'shippingFee',
        'taxAmount',
        'dutyAmount',
        'discountAmount',
        'total',
        'currency',
        'paymentStatus',
        'paymentMethod',
        'paymentRef',
        'promoCodeId',
        'billingAddress',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(redacted, forbidden)).toBe(false);
      }

      expect(redacted.items).toEqual([
        { id: 'it-1', orderId: 'ord-1', productId: 'p-1', name: 'Coffee', sku: 'COF-1', quantity: 2 },
      ]);
      expect(Object.prototype.hasOwnProperty.call(redacted.shipments![0], 'shippingCost')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(redacted.shipments![0], 'currency')).toBe(false);
      expect(redacted.shipments![0].trackingNumber).toBe('TRK-1');
      expect(redacted.metadata).toEqual({ storefrontSlug: 'shop' });
    });
  });
});
