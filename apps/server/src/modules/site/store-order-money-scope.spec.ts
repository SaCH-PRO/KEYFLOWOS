import { describe, it, expect, vi } from 'vitest';
import {
  redactOrderForFulfilment,
  redactOrderMetadataForFulfilment,
} from './store-order.service';
import { PresenceOverviewService } from './presence/presence-overview.service';

describe('FU-STORE-ORDERS-MONEY-SCOPE redaction helpers', () => {
  describe('redactOrderMetadataForFulfilment', () => {
    it('returns null for null, undefined, primitives, arrays, and non-plain objects (R1-SEC-02)', () => {
      expect(redactOrderMetadataForFulfilment(null)).toBeNull();
      expect(redactOrderMetadataForFulfilment(undefined)).toBeNull();
      expect(redactOrderMetadataForFulfilment('raw')).toBeNull();
      expect(redactOrderMetadataForFulfilment(42)).toBeNull();
      expect(redactOrderMetadataForFulfilment(['a', 'b'])).toBeNull();
      expect(redactOrderMetadataForFulfilment(new Date())).toBeNull();
      expect(redactOrderMetadataForFulfilment(new Map([['source', 'STOREFRONT']]))).toBeNull();

      class CustomMeta {
        storefrontSlug = 'custom';
      }
      expect(redactOrderMetadataForFulfilment(new CustomMeta())).toBeNull();
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

    it('[R1-SEC-01] enforces fail-closed FULFILMENT_TIMELINE_STATUSES allowlist on statusTimeline', () => {
      const redacted = redactOrderMetadataForFulfilment({
        statusTimeline: [
          // Disallowed payment/unknown/malformed statuses
          { status: 'awaiting_payment', timestamp: '2026-11-20T09:00:00Z', note: 'Waiting for payment' },
          { status: 'chargeback', timestamp: '2026-11-20T09:05:00Z', note: 'Bank dispute' },
          { status: 'refund_pending', timestamp: '2026-11-20T09:10:00Z' },
          { status: 'disputed', timestamp: '2026-11-20T09:15:00Z' },
          { status: 'voided', timestamp: '2026-11-20T09:20:00Z' },
          { status: '', timestamp: '2026-11-20T09:25:00Z' },
          { status: '   ', timestamp: '2026-11-20T09:26:00Z' },
          { timestamp: '2026-11-20T09:30:00Z', note: 'Missing status' },
          { status: 200, timestamp: '2026-11-20T09:35:00Z' },
          { status: null, timestamp: '2026-11-20T09:36:00Z' },
          { status: { nested: 'shipped' }, timestamp: '2026-11-20T09:37:00Z' },
          // Allowed fulfilment statuses (including case/whitespace variations)
          { status: 'placed', timestamp: '2026-11-20T10:00:00Z' },
          { status: 'PENDING', timestamp: '2026-11-20T10:01:00Z' },
          { status: ' confirmed ', timestamp: '2026-11-20T10:02:00Z' },
          { status: 'processing', timestamp: '2026-11-20T10:03:00Z' },
          { status: 'awaiting_fulfillment', timestamp: '2026-11-20T10:04:00Z' },
          { status: 'routes_created', timestamp: '2026-11-20T10:05:00Z' },
          { status: 'routed', timestamp: '2026-11-20T10:06:00Z' },
          { status: 'supplier_ordered', timestamp: '2026-11-20T10:07:00Z' },
          { status: 'picking_packing', timestamp: '2026-11-20T10:08:00Z' },
          { status: 'shipped', timestamp: '2026-11-20T10:09:00Z' },
          { status: 'delivered', timestamp: '2026-11-20T10:10:00Z' },
          { status: 'completed', timestamp: '2026-11-20T10:11:00Z' },
          { status: 'cancelled', timestamp: '2026-11-20T10:12:00Z' },
          { status: 'on_hold', timestamp: '2026-11-20T10:13:00Z' },
          { status: 'tracking_updated', timestamp: '2026-11-20T10:14:00Z', note: 'TRK-99' },
        ],
      });

      expect(redacted?.statusTimeline).toEqual([
        { status: 'placed', timestamp: '2026-11-20T10:00:00Z' },
        { status: 'PENDING', timestamp: '2026-11-20T10:01:00Z' },
        { status: ' confirmed ', timestamp: '2026-11-20T10:02:00Z' },
        { status: 'processing', timestamp: '2026-11-20T10:03:00Z' },
        { status: 'awaiting_fulfillment', timestamp: '2026-11-20T10:04:00Z' },
        { status: 'routes_created', timestamp: '2026-11-20T10:05:00Z' },
        { status: 'routed', timestamp: '2026-11-20T10:06:00Z' },
        { status: 'supplier_ordered', timestamp: '2026-11-20T10:07:00Z' },
        { status: 'picking_packing', timestamp: '2026-11-20T10:08:00Z' },
        { status: 'shipped', timestamp: '2026-11-20T10:09:00Z' },
        { status: 'delivered', timestamp: '2026-11-20T10:10:00Z' },
        { status: 'completed', timestamp: '2026-11-20T10:11:00Z' },
        { status: 'cancelled', timestamp: '2026-11-20T10:12:00Z' },
        { status: 'on_hold', timestamp: '2026-11-20T10:13:00Z' },
        { status: 'tracking_updated', timestamp: '2026-11-20T10:14:00Z', note: 'TRK-99' },
      ]);
    });

    it('[R1-SEC-02] restricts shipping values to scalars and rejects nested objects, non-finite numbers, non-plain objects, and inherited prototype keys', () => {
      const nullProtoMeta = Object.create(null);
      nullProtoMeta.storefrontSlug = 'null-proto-shop';
      nullProtoMeta.shipping = {
        zoneId: 'z-1',
        zoneName: { label: 'Express', secretCost: 45 },
        carrier: ['DHL', { price: 30 }],
        estimatedDays: Number.POSITIVE_INFINITY,
      };
      expect(redactOrderMetadataForFulfilment(nullProtoMeta)).toEqual({
        storefrontSlug: 'null-proto-shop',
        shipping: { zoneId: 'z-1' },
      });

      // Finite numeric and null estimatedDays are kept; NaN / objects are dropped.
      expect(
        redactOrderMetadataForFulfilment({
          shipping: { zoneId: null, zoneName: 'Local', carrier: 'TTPost', estimatedDays: 3 },
        }),
      ).toEqual({
        shipping: { zoneId: null, zoneName: 'Local', carrier: 'TTPost', estimatedDays: 3 },
      });
      expect(
        redactOrderMetadataForFulfilment({
          shipping: { estimatedDays: Number.NaN },
        }),
      ).toEqual({
        shipping: {},
      });
      expect(
        redactOrderMetadataForFulfilment({
          shipping: new Date(),
        }),
      ).toEqual({});

      // Inherited prototype properties on shipping or timeline entries must not be copied.
      const inheritedShip = Object.create({ zoneName: 'Inherited', carrier: 'Leaked' });
      inheritedShip.zoneId = 'own-zone';
      // Non-plain prototype (Object.create(proto) where proto !== Object.prototype and !== null) is rejected outright.
      expect(redactOrderMetadataForFulfilment({ shipping: inheritedShip })).toEqual({});

      const inheritedEntry = Object.create({ status: 'shipped', note: 'Inherited' });
      const dateEntry = new Date();
      expect(
        redactOrderMetadataForFulfilment({
          statusTimeline: [inheritedEntry, dateEntry, { status: 'shipped', note: 'Own' }],
        }),
      ).toEqual({
        statusTimeline: [{ status: 'shipped', note: 'Own' }],
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

  describe('PresenceOverviewService.listStorefrontOrders (SiteModule sibling scope)', () => {
    function buildOverview(membership: { role: string; permissionScopes: unknown } | null) {
      const prismaMock = {
        client: {
          membership: {
            findUnique: vi.fn().mockResolvedValue(membership),
          },
        },
      };
      const storeOrdersMock = {
        listOrdersForReader: vi.fn().mockImplementation(async (_bizId: string, readsRevenue: boolean) => ({
          data: [
            {
              id: 'ord-1',
              orderNumber: 'ORD-101',
              status: 'CONFIRMED',
              customerName: 'Alicia',
              customerEmail: 'alicia@example.com',
              createdAt: '2026-11-20T10:00:00.000Z',
              items: [{ name: 'Cacao', quantity: 2 }],
              ...(readsRevenue ? { paymentStatus: 'PAID', total: 245.5, currency: 'TTD' } : {}),
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          totalPages: 1,
        })),
      };
      const service = new PresenceOverviewService(
        prismaMock as any,
        {} as any,
        {} as any,
        storeOrdersMock as any,
        {} as any,
      );
      return { service, storeOrdersMock };
    }

    it('omits paymentStatus, total, and currency for a revenue:none actor and missing actor (fail closed)', async () => {
      for (const [membership, actor] of [
        [{ role: 'STAFF', permissionScopes: { storefront: 'read' } }, { id: 'u-norev', role: 'USER' }],
        [{ role: 'OWNER', permissionScopes: { storefront: 'admin', revenue: 'none' } }, { id: 'u-owner-norev', role: 'USER' }],
        [null, null],
        [null, undefined],
      ] as const) {
        const { service, storeOrdersMock } = buildOverview(membership);
        const res = await service.listStorefrontOrders('biz-1', { limit: 10 }, actor as any);
        expect(storeOrdersMock.listOrdersForReader).toHaveBeenCalledWith('biz-1', false, { pageSize: 10 });
        expect(res.items).toHaveLength(1);
        const [item] = res.items;
        expect(Object.prototype.hasOwnProperty.call(item, 'paymentStatus')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(item, 'total')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(item, 'currency')).toBe(false);
        expect(item).toEqual({
          id: 'ord-1',
          orderNumber: 'ORD-101',
          status: 'CONFIRMED',
          customerName: 'Alicia',
          customerEmail: 'alicia@example.com',
          createdAt: '2026-11-20T10:00:00.000Z',
          items: [{ name: 'Cacao', quantity: 2 }],
        });
      }
    });

    it('preserves paymentStatus, total, and currency for a revenue:read actor', async () => {
      const { service, storeOrdersMock } = buildOverview({ role: 'OWNER', permissionScopes: null });
      const res = await service.listStorefrontOrders('biz-1', { limit: 10 }, { id: 'u-owner', role: 'USER' });
      expect(storeOrdersMock.listOrdersForReader).toHaveBeenCalledWith('biz-1', true, { pageSize: 10 });
      expect(res.items).toEqual([
        {
          id: 'ord-1',
          orderNumber: 'ORD-101',
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          customerName: 'Alicia',
          customerEmail: 'alicia@example.com',
          total: 245.5,
          currency: 'TTD',
          createdAt: '2026-11-20T10:00:00.000Z',
          items: [{ name: 'Cacao', quantity: 2 }],
        },
      ]);
    });
  });
});
