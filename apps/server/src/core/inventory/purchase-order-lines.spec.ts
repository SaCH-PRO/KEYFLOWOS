import { describe, it, expect } from 'vitest';
import { purchaseOrderLineRefusal, readPurchaseOrderLine, STOCK_QUANTITY_MAX } from './purchase-order-lines';

/** What a reading answers: the line read, or the refusal text for line 1. */
const answer = (raw: unknown, reading: 'create' | 'receipt') => {
  const read = readPurchaseOrderLine(raw, reading);
  return read.problem ? purchaseOrderLineRefusal(1, read.problem) : read.line;
};

describe('W11-PO-LINES purchase order line reader (D-136)', () => {
  const product = { productId: 'prod_1', warehouseId: 'wh_1', quantity: 3, unitPrice: 4, unitCost: 2 };

  it('W11-PO-LINES create: a line must be a plain object, its ids absent or non-empty strings, its numbers finite', () => {
    for (const raw of [null, 5, 'line', [product], new Date()]) {
      expect(answer(raw, 'create')).toBe('Purchase order line 1 must be an object');
    }
    for (const productId of [42, ['prod_1'], { not: '' }, true]) {
      expect(answer({ ...product, productId }, 'create')).toBe('Purchase order line 1 productId must be a non-empty string');
    }
    expect(answer({ ...product, warehouseId: ['wh_1'] }, 'create')).toBe('Purchase order line 1 warehouseId must be a non-empty string');
    for (const quantity of ['5', {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(answer({ ...product, quantity }, 'create')).toBe('Purchase order line 1 quantity must be a number');
    }
    expect(answer({ ...product, unitCost: 'x' }, 'create')).toBe('Purchase order line 1 unitCost must be a number of 0 or more');
    expect(answer({ ...product, unitPrice: -1 }, 'create')).toBe('Purchase order line 1 unitPrice must be a number of 0 or more');
  });

  it('W11-PO-LINES create (D-136): a product line adds a positive whole number to stock (receivedQuantity, else quantity)', () => {
    for (const quantity of [0, -1, 1.5, undefined, null]) {
      expect(answer({ ...product, quantity }, 'create')).toBe('Purchase order line 1 quantity must be a whole number above 0 on a product line');
    }
    expect(answer({ ...product, receivedQuantity: 2.5 }, 'create')).toBe(
      'Purchase order line 1 receivedQuantity must be a whole number above 0 on a product line',
    );
    expect(answer({ ...product, quantity: 1.5, receivedQuantity: 2 }, 'create')).toEqual({ ...product, quantity: 1.5, receivedQuantity: 2, stockQuantity: 2 });
    expect(answer(product, 'create')).toEqual({ ...product, stockQuantity: 3 });
  });

  it('W11-PO-LINES create: a line naming no product (free text, a service) keeps any finite quantity, or none; empty ids are absent', () => {
    expect(answer({ name: 'Freight', quantity: 1.5, unitPrice: 7 }, 'create')).toEqual({ quantity: 1.5, unitPrice: 7 });
    expect(answer({ name: 'Setup', unitPrice: 9 }, 'create')).toEqual({ unitPrice: 9 });
    expect(answer({ productId: '', warehouseId: null, quantity: 0 }, 'create')).toEqual({ quantity: 0 });
    expect(answer(Object.assign(Object.create(null), { name: 'x' }), 'create')).toEqual({});
  });

  it('W11-PO-LINES receipt (D-136): digit text is that number, a fraction, a word or a negative is malformed, absent or 0 adds nothing', () => {
    expect(answer({ ...product, quantity: '5' }, 'receipt')).toEqual({ productId: 'prod_1', warehouseId: 'wh_1', quantity: 5, stockQuantity: 5, unitCost: 2 });
    expect(answer({ ...product, quantity: 5, receivedQuantity: '2' }, 'receipt')).toMatchObject({ receivedQuantity: 2, stockQuantity: 2 });
    expect(answer({ ...product, quantity: 'abc', receivedQuantity: 2 }, 'receipt')).toMatchObject({ stockQuantity: 2 });
    for (const quantity of ['abc', '1.5', 1.5, '-3', {}]) {
      expect(readPurchaseOrderLine({ ...product, quantity }, 'receipt').problem?.field).toBe('quantity');
    }
    expect(readPurchaseOrderLine({ ...product, quantity: -1 }, 'receipt').problem?.field).toBe('quantity');
    expect(answer({ ...product, quantity: undefined }, 'receipt')).toEqual({ productId: 'prod_1', warehouseId: 'wh_1', unitCost: 2 });
    expect(answer({ ...product, quantity: 0 }, 'receipt')).toMatchObject({ stockQuantity: 0 });
    expect(readPurchaseOrderLine({ ...product, productId: ['prod_1'] }, 'receipt').problem?.field).toBe('productId');
    expect(readPurchaseOrderLine({ ...product, warehouseId: ['wh_1'] }, 'receipt').problem?.field).toBe('warehouseId');
  });

  it('W11-PO-LINES review SEC-POL-1, POL-CR-1 (D-136): a stock quantity is at most 2147483647 (an int4 stock column) at create and at receipt', () => {
    expect(STOCK_QUANTITY_MAX).toBe(2_147_483_647);
    for (const quantity of [2147483648, 3e9, 1e300]) {
      expect(answer({ ...product, quantity }, 'create')).toBe('Purchase order line 1 quantity must be at most 2147483647 on a product line');
      expect(readPurchaseOrderLine({ ...product, quantity }, 'receipt').problem?.field).toBe('quantity');
    }
    expect(answer({ ...product, receivedQuantity: 2147483648 }, 'create')).toBe(
      'Purchase order line 1 receivedQuantity must be at most 2147483647 on a product line',
    );
    for (const quantity of ['3000000000', '9999999999', '9'.repeat(400)]) {
      expect(readPurchaseOrderLine({ ...product, quantity }, 'receipt').problem?.field).toBe('quantity');
    }
    expect(readPurchaseOrderLine({ ...product, receivedQuantity: '2147483648' }, 'receipt').problem?.field).toBe('receivedQuantity');
    expect(answer({ ...product, quantity: 2147483647 }, 'create')).toMatchObject({ stockQuantity: 2147483647 });
    expect(answer({ ...product, quantity: '2147483647' }, 'receipt')).toMatchObject({ stockQuantity: 2147483647 });
    // A line naming no product adds no stock: its quantity is not bounded (its subtotal is checked at create).
    expect(answer({ name: 'Freight', quantity: 3e9, unitPrice: 0 }, 'create')).toEqual({ quantity: 3e9, unitPrice: 0 });
  });

  it("W11-PO-LINES receipt: the cost is Number(unitCost) when finite and above 0, else none; prices and a free-text line's quantity are not read", () => {
    expect(answer({ ...product, unitCost: '3' }, 'receipt')).toMatchObject({ unitCost: 3 });
    for (const unitCost of ['x', 0, -2, null, undefined, {}]) {
      expect(answer({ ...product, unitCost }, 'receipt')).not.toHaveProperty('unitCost');
    }
    expect(answer({ ...product, unitPrice: 'x' }, 'receipt')).not.toHaveProperty('unitPrice');
    expect(answer({ name: 'Freight', quantity: 'abc' }, 'receipt')).toEqual({});
    expect(answer({ name: 'Freight', warehouseId: ['wh_1'], unitCost: 3 }, 'receipt')).toEqual({});
    expect(readPurchaseOrderLine(null, 'receipt').problem?.field).toBe('line');
  });
});
