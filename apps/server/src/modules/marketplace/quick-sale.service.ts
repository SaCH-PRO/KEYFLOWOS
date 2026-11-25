import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  StoreOrderService,
  type QuickSaleCommittedResult,
  type QuickSaleInvoiceSummary,
  type QuickSalePaymentSummary,
} from '../site/store-order.service';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import type { CreateQuickSaleDto } from './dto/quick-sale.dto';

const QUICK_SALE_METHODS = new Set(['cash', 'bank_transfer']);

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

export interface QuickSaleResponse {
  order: QuickSaleCommittedResult['order'];
  invoice: QuickSaleInvoiceSummary;
  payment: QuickSalePaymentSummary;
  receiptToken: string;
  receiptPath: string;
  replayed: boolean;
}

@Injectable()
export class QuickSaleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  private storeOrders(): StoreOrderService {
    return this.moduleRef.get(StoreOrderService, { strict: false });
  }

  /**
   * V1-66 (QUICK-SALE-SERVER, P83, Journey L, owner rulings D-155/D-160/D-164):
   * Records an owner-created counter sale in one atomic transaction through
   * StoreOrderService.completeCheckout:
   *   - MarketplaceOrder (type QUICK_SALE, COMPLETED, PAID, cash or bank_transfer)
   *   - PAID Invoice bound to named contact or per-business 'Walk-in customer'
   *     contact created at most once under pg_advisory_xact_lock
   *   - SUCCESSFUL Payment + RevenuePostingService ledger entries
   *   - InventoryStock decrement + StockMovement audit rows under routing claim
   *     and global stock lock order (oversell refused cleanly with 0 rows committed)
   *   - COGS posting via ExpensePostingService.onProductSold
   *   - PaymentLink token served by existing GET /commerce/public/invoice-link/:token/receipt
   *   - Optional Idempotency-Key slot committed in the same transaction
   */
  async createQuickSale(
    businessId: string,
    body: CreateQuickSaleDto,
    actorId: string | null,
    idempotencyHeader?: string,
  ): Promise<QuickSaleResponse> {
    // D-46 & revenue:write authority check FIRST, before any read or write.
    await this.storeOrders().assertMemberMayRecordPayments(businessId, actorId);

    // Owner ruling D-164 (taxorder): no discounts on quick sales in v1.
    const hasDiscountAmount =
      body?.discountAmount !== undefined &&
      body?.discountAmount !== null &&
      body?.discountAmount !== '' &&
      Number(body.discountAmount) !== 0;
    const hasDiscount =
      body?.discount !== undefined &&
      body?.discount !== null &&
      body?.discount !== '' &&
      Number(body.discount) !== 0;
    const hasPromo = typeof body?.promoCode === 'string' ? body.promoCode.trim().length > 0 : Boolean(body?.promoCode);
    if (hasDiscountAmount || hasDiscount || hasPromo) {
      throw new BadRequestException('Discounts are not supported on quick sales in v1');
    }

    // Payment method: cash or bank_transfer only.
    const rawMethod = typeof body?.paymentMethod === 'string' ? body.paymentMethod.trim().toLowerCase() : '';
    if (!QUICK_SALE_METHODS.has(rawMethod)) {
      throw new BadRequestException('Quick sales accept cash or bank_transfer payment methods only');
    }

    // Validate & aggregate items (duplicate productId lines are summed cleanly).
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw new BadRequestException('Add at least one item to complete a quick sale');
    }
    const aggregatedMap = new Map<string, number>();
    for (const rawItem of body.items) {
      const productId = typeof rawItem?.productId === 'string' ? rawItem.productId.trim() : '';
      const quantity = Number(rawItem?.quantity);
      if (!productId) {
        throw new BadRequestException('Each quick sale item must specify a productId');
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException('Each quick sale item needs a whole quantity of 1 or more');
      }
      aggregatedMap.set(productId, (aggregatedMap.get(productId) ?? 0) + quantity);
    }
    const normalizedItems = [...aggregatedMap.entries()].map(([productId, quantity]) => ({ productId, quantity }));

    const contactId = typeof body?.contactId === 'string' && body.contactId.trim() ? body.contactId.trim() : null;
    const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    // Resolve optional Idempotency-Key (header and/or body).
    const headerKey = typeof idempotencyHeader === 'string' && idempotencyHeader.trim() ? idempotencyHeader.trim() : null;
    const bodyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : null;
    if (headerKey && bodyKey && headerKey !== bodyKey) {
      throw new BadRequestException('Idempotency-Key header and body.idempotencyKey must match');
    }
    const rawIdemKey = headerKey ?? bodyKey;
    const idemSlot = rawIdemKey ? `quick_sale:${sha256(rawIdemKey)}` : null;
    const requestHash = idemSlot
      ? sha256(
          canonicalJson({
            items: [...normalizedItems].sort((a, b) => a.productId.localeCompare(b.productId)),
            paymentMethod: rawMethod,
            contactId,
            notes,
          }),
        )
      : null;

    if (idemSlot && requestHash) {
      const prior = await this.readReplay(businessId, idemSlot, requestHash);
      if (prior) return prior;
    }

    // Validate named contactId with tenant + CRM visibility enforcement.
    let namedContact: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      email: string | null;
      phone: string | null;
    } | null = null;
    if (contactId) {
      const access = await resolveCrmAccess(this.prisma, businessId, actorId ?? '');
      const vis = visibilityClause(access, actorId ?? '') as Prisma.ContactWhereInput | null;
      namedContact = await this.prisma.client.contact.findFirst({
        where: {
          id: contactId,
          businessId,
          deletedAt: null,
          ...(vis ?? {}),
        },
        select: { id: true, firstName: true, lastName: true, displayName: true, email: true, phone: true },
      });
      if (!namedContact) {
        throw new NotFoundException('Contact not found');
      }
    }

    // Load business & products inside this tenant.
    const [business, products] = await Promise.all([
      this.prisma.client.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: { id: true, currency: true, defaultTaxRate: true },
      }),
      this.prisma.client.product.findMany({
        where: {
          id: { in: normalizedItems.map((i) => i.productId) },
          businessId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true, name: true, sku: true, price: true, currency: true },
      }),
    ]);
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const productById = new Map(products.map((p) => [p.id, p]));
    let currency: string | null = null;
    let subtotal = 0;
    const orderItems: Array<{
      productId: string;
      name: string;
      sku: string | null;
      quantity: number;
      unitPrice: number;
      total: number;
      currency: string;
    }> = [];

    for (const item of normalizedItems) {
      const product = productById.get(item.productId);
      if (!product) {
        throw new BadRequestException('One or more selected products were not found or are inactive');
      }
      const itemCurrency = product.currency || business.currency || 'TTD';
      if (currency === null) {
        currency = itemCurrency;
      } else if (currency !== itemCurrency) {
        throw new BadRequestException('All items in a quick sale must share the same currency');
      }
      const unitPrice = Number(product.price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new BadRequestException(`Product "${product.name}" has an invalid price`);
      }
      const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
      subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
      orderItems.push({
        productId: product.id,
        name: product.name,
        sku: product.sku ?? null,
        quantity: item.quantity,
        unitPrice,
        total: lineTotal,
        currency: itemCurrency,
      });
    }

    const saleCurrency = currency ?? business.currency ?? 'TTD';
    const taxRate = business.defaultTaxRate ?? 0;
    const taxAmount = Math.round(((subtotal * taxRate) / 100) * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;
    if (!(total > 0)) {
      throw new BadRequestException('Quick sale total must be greater than zero');
    }

    const orderNumber = `QS-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const paymentRef = `quick_sale_${orderNumber}_${randomBytes(12).toString('hex')}`;
    const receiptToken = randomBytes(24).toString('base64url');
    const customerName = namedContact
      ? [namedContact.firstName, namedContact.lastName].filter(Boolean).join(' ').trim() ||
        namedContact.displayName?.trim() ||
        'Customer'
      : 'Walk-in customer';

    const committedHolder: { value: QuickSaleCommittedResult | null } = { value: null };
    try {
      await this.storeOrders().completeCheckout({
        orderId: '',
        paymentRef,
        provider: rawMethod,
        method: rawMethod,
        actorId,
        paidStatus: 'COMPLETED',
        quickSale: {
          businessId,
          orderNumber,
          customerName,
          customerEmail: namedContact?.email ?? null,
          customerPhone: namedContact?.phone ?? null,
          contactId: namedContact?.id ?? null,
          subtotal,
          taxRate,
          taxAmount,
          total,
          currency: saleCurrency,
          notes,
          items: orderItems,
          receiptToken,
          idempotency: idemSlot && requestHash ? { slot: idemSlot, requestHash } : null,
          onCommitted: (summary) => {
            committedHolder.value = summary;
          },
        },
      });
    } catch (err) {
      if (idemSlot && requestHash && isUniqueViolation(err)) {
        const winner = await this.readReplay(businessId, idemSlot, requestHash);
        if (winner) return winner;
      }
      throw err;
    }

    const committed = committedHolder.value;
    if (!committed) {
      throw new ConflictException('Quick sale could not be finalized; try again');
    }

    return {
      order: committed.order,
      invoice: committed.invoice,
      payment: committed.payment,
      receiptToken: committed.receiptToken,
      receiptPath: `/commerce/public/invoice-link/${committed.receiptToken}/receipt`,
      replayed: false,
    };
  }

  private async readReplay(
    businessId: string,
    slot: string,
    requestHash: string,
  ): Promise<QuickSaleResponse | null> {
    const row = await this.prisma.client.idempotencyKey.findUnique({
      where: { businessId_idempotencyKey: { businessId, idempotencyKey: slot } },
    });
    if (!row) return null;
    if (row.requestHash !== requestHash) {
      throw new ConflictException(
        'This Idempotency-Key was already used for a different quick sale; use a new key',
      );
    }
    const saved = row.response as unknown as Omit<QuickSaleResponse, 'replayed'> | null;
    if (!saved?.order?.id || !saved?.invoice?.id || !saved?.payment?.id || !saved?.receiptToken) {
      throw new ConflictException('This Idempotency-Key is already in use; use a new key');
    }
    return {
      ...saved,
      replayed: true,
    };
  }
}
