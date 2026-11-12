/**
 * W11-PO-LINES (owner ruling D-136; findings F-33, F-40): how a purchase
 * order's line is read, at create and at receipt.
 *
 * A purchase order's items are JSON. MarketplaceService.createPurchaseOrder
 * (POST .../purchase-orders, body: any, and the KEY tool
 * inventory_create_purchase_order) stored them as sent, and the receipt
 * (FulfillmentRoutingService.advancePurchaseOrderStatus RECEIVED) checked each
 * line's ids with String() and then passed the raw values to its lock and to
 * Prisma: an id that is a one-element array passed the check (String(['x']) is
 * 'x') and answered 500, digit text added to an integer column answered 500, a
 * fraction was stored truncated. Both paths now read every line here.
 *
 * At create a line must be a plain object; productId and warehouseId are each
 * absent (undefined, null or '') or a non-empty string; quantity and
 * receivedQuantity are absent (undefined or null) or finite numbers; a line
 * naming a product adds stock when received, so its stock quantity
 * (receivedQuantity ?? quantity) must be a positive whole number (D-136: a
 * fraction is refused); unitPrice and unitCost are absent or finite numbers of
 * 0 or more. Lines naming no product (free text, a service, freight) are
 * accepted with any finite quantity, or none.
 *
 * At receipt only what a receipt adds to stock is read. A line naming no
 * product (productId absent) adds none and is not read further, as before. A
 * line naming a product has its ids read as at create, and its stock quantity
 * absent (it adds nothing, as before) or a whole number of 0 or more, where a
 * legacy line's digit text ('5') is that number (D-136); its cost is
 * Number(unitCost) when that is finite and above 0, else none (a legacy text
 * cost is read, not refused). Its price is not read.
 *
 * A problem names the field (or the line) and what it must be, never the value
 * sent (an id of the caller's or of another business's).
 */

/** A purchase order line as read: each field present only when the line carries it, ids as strings, numbers as numbers. */
export interface PurchaseOrderLine {
  productId?: string;
  warehouseId?: string;
  quantity?: number;
  receivedQuantity?: number;
  /** A line naming a product: what it adds to stock when received (receivedQuantity ?? quantity), when it carries one. */
  stockQuantity?: number;
  unitPrice?: number;
  unitCost?: number;
}

/** Where a line is read: a purchase order being created, or a stored purchase order being received. */
export type PurchaseOrderLineReading = 'create' | 'receipt';

/**
 * What is wrong with a line: the field, or 'line' for the line itself, and what a refusal says of it after
 * 'Purchase order line N' (naming no value).
 */
export interface PurchaseOrderLineProblem {
  field: 'line' | 'productId' | 'warehouseId' | 'quantity' | 'receivedQuantity' | 'unitPrice' | 'unitCost';
  says: string;
}

export type PurchaseOrderLineRead = { line: PurchaseOrderLine; problem?: undefined } | { line?: undefined; problem: PurchaseOrderLineProblem };

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** An id: absent (undefined, null or ''), a non-empty string, or neither (null is returned). */
const readId = (value: unknown): { id?: string } | null => {
  if (value === undefined || value === null || value === '') return {};
  return typeof value === 'string' ? { id: value } : null;
};

/** A number: absent (undefined or null), a finite number (at receipt, digit text as that number), or neither (null). */
const readNumber = (value: unknown, digitText: boolean): { n?: number } | null => {
  if (value === undefined || value === null) return {};
  if (typeof value === 'number') return Number.isFinite(value) ? { n: value } : null;
  if (digitText && typeof value === 'string' && /^\d+$/.test(value)) return { n: Number(value) };
  return null;
};

const problem = (field: PurchaseOrderLineProblem['field'], says: string): PurchaseOrderLineRead => ({ problem: { field, says } });

/** Reads one stored or sent purchase order line (see the module comment for the rules of each reading). */
export function readPurchaseOrderLine(raw: unknown, reading: PurchaseOrderLineReading): PurchaseOrderLineRead {
  if (!isPlainObject(raw)) return problem('line', 'must be an object');
  const atReceipt = reading === 'receipt';
  const line: PurchaseOrderLine = {};

  for (const field of ['productId', 'warehouseId'] as const) {
    const read = readId(raw[field]);
    if (!read) return problem(field, `${field} must be a non-empty string`);
    if (read.id !== undefined) line[field] = read.id;
    // At receipt a line naming no product adds no stock: nothing else of it is read (as before).
    if (atReceipt && field === 'productId' && line.productId === undefined) return { line };
  }

  for (const field of ['quantity', 'receivedQuantity'] as const) {
    // At receipt a line's stock quantity is its receivedQuantity when it carries one; its quantity is then not read.
    if (atReceipt && field === 'quantity' && raw.receivedQuantity !== undefined && raw.receivedQuantity !== null) continue;
    const read = readNumber(raw[field], atReceipt);
    if (!read) return problem(field, `${field} must be a number`);
    if (read.n !== undefined) line[field] = read.n;
  }

  if (line.productId !== undefined) {
    const field = line.receivedQuantity !== undefined ? 'receivedQuantity' : 'quantity';
    const stock = line[field];
    if (atReceipt) {
      // Absent or 0: the line adds nothing (as before). A fraction or a negative is malformed (D-136).
      if (stock !== undefined && !(Number.isInteger(stock) && stock >= 0)) return problem(field, `${field} must be a whole number of 0 or more`);
    } else if (!(stock !== undefined && Number.isInteger(stock) && stock > 0)) {
      return problem(field, `${field} must be a whole number above 0 on a product line`);
    }
    if (stock !== undefined) line.stockQuantity = stock;
  }

  if (atReceipt) {
    // The receipt's cost: Number(unitCost) when finite and above 0, else none (a legacy text cost is read, not refused).
    const cost = Number(raw.unitCost);
    if (raw.unitCost !== undefined && raw.unitCost !== null && Number.isFinite(cost) && cost > 0) line.unitCost = cost;
    return { line };
  }

  for (const field of ['unitPrice', 'unitCost'] as const) {
    const read = readNumber(raw[field], false);
    if (!read || (read.n !== undefined && read.n < 0)) return problem(field, `${field} must be a number of 0 or more`);
    if (read.n !== undefined) line[field] = read.n;
  }
  return { line };
}

/** The 400 text for a line refused at create: 'Purchase order line N <what is wrong>' (N from 1). */
export const purchaseOrderLineRefusal = (lineNo: number, refused: PurchaseOrderLineProblem): string =>
  `Purchase order line ${lineNo} ${refused.says}`;
