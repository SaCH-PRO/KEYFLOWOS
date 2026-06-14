import { apiGet, apiPost, apiPatch, apiDelete } from "../api";

// ---------- Delivery Notes ----------
export interface DeliveryNote {
  id: string;
  dnNumber: string;
  invoiceId: string;
  status: string;
  items: Array<{ productId?: string; description: string; quantity: number; unitPrice?: number }>;
  notes: string | null;
  deliveredAt: string | null;
  delivererName: string | null;
  delivererSignature: string | null;
  receiverName: string | null;
  receiverSignature: string | null;
  createdAt: string;
  invoice?: { invoiceNumber: string; contactId: string; total: number; status: string };
}

export async function fetchDeliveryNotes(businessId: string) {
  return apiGet<{ items: DeliveryNote[] }>(`/continental-ops/businesses/${businessId}/delivery-notes`);
}

export async function createDeliveryNote(businessId: string, body: {
  dnNumber: string;
  invoiceId: string;
  items: Array<{ productId?: string; description: string; quantity: number; unitPrice?: number }>;
  notes?: string;
}) {
  return apiPost<DeliveryNote>({ path: `/continental-ops/businesses/${businessId}/delivery-notes`, body });
}

export async function updateDeliveryNote(businessId: string, id: string, body: Partial<{
  items: Array<{ productId?: string; description: string; quantity: number; unitPrice?: number }>;
  notes: string;
  status: string;
  deliveredAt: string;
  delivererName: string;
  delivererSignature: string;
  receiverName: string;
  receiverSignature: string;
}>) {
  return apiPatch<DeliveryNote>(`/continental-ops/businesses/${businessId}/delivery-notes/${id}`, body);
}

export async function fulfillDeliveryNote(businessId: string, id: string, body: {
  delivererName?: string;
  delivererSignature?: string;
  receiverName?: string;
  receiverSignature?: string;
}) {
  return apiPost<DeliveryNote>({ path: `/continental-ops/businesses/${businessId}/delivery-notes/${id}/fulfill`, body });
}

export async function cancelDeliveryNote(businessId: string, id: string) {
  return apiPost<DeliveryNote>({ path: `/continental-ops/businesses/${businessId}/delivery-notes/${id}/cancel`, body: {} });
}

export async function deleteDeliveryNote(businessId: string, id: string) {
  return apiDelete<void>(`/continental-ops/businesses/${businessId}/delivery-notes/${id}`);
}

// ---------- Goods Receipts ----------
export interface GoodsReceipt {
  id: string;
  grNumber: string;
  purchaseOrderId: string | null;
  supplierName: string | null;
  receivedBy: string | null;
  status: string;
  items: Array<{
    productId?: string;
    description: string;
    qtyOrdered: number;
    qtyReceived: number;
    qtyAccepted: number;
    qtyRejected: number;
    reason?: string;
  }>;
  notes: string | null;
  receivedAt: string;
  createdAt: string;
  purchaseOrder?: { poNumber: string; supplierName: string };
}

export async function fetchGoodsReceipts(businessId: string) {
  return apiGet<{ items: GoodsReceipt[] }>(`/continental-ops/businesses/${businessId}/goods-receipts`);
}

export async function createGoodsReceipt(businessId: string, body: {
  grNumber: string;
  purchaseOrderId?: string;
  supplierName?: string;
  receivedBy?: string;
  notes?: string;
  items: Array<{
    productId?: string;
    description: string;
    qtyOrdered: number;
    qtyReceived: number;
    qtyAccepted: number;
    qtyRejected: number;
    reason?: string;
  }>;
}) {
  return apiPost<GoodsReceipt>({ path: `/continental-ops/businesses/${businessId}/goods-receipts`, body });
}

export async function updateGoodsReceipt(businessId: string, id: string, body: Partial<{
  supplierName: string;
  receivedBy: string;
  notes: string;
  items: GoodsReceipt['items'];
  status: string;
}>) {
  return apiPatch<GoodsReceipt>(`/continental-ops/businesses/${businessId}/goods-receipts/${id}`, body);
}

export async function postGoodsReceipt(businessId: string, id: string) {
  return apiPost<GoodsReceipt>({ path: `/continental-ops/businesses/${businessId}/goods-receipts/${id}/post`, body: {} });
}

export async function deleteGoodsReceipt(businessId: string, id: string) {
  return apiDelete<void>(`/continental-ops/businesses/${businessId}/goods-receipts/${id}`);
}

// ---------- Receipts ----------
export interface Receipt {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  receivedFrom: string | null;
  receivedBy: string | null;
  receivedAt: string;
  notes: string | null;
  createdAt: string;
  invoice?: { invoiceNumber: string; contactId: string; total: number };
}

export async function fetchReceipts(businessId: string) {
  return apiGet<{ items: Receipt[] }>(`/continental-ops/businesses/${businessId}/receipts`);
}

export async function createReceipt(businessId: string, body: {
  receiptNumber: string;
  invoiceId: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  receivedFrom?: string;
  receivedBy?: string;
  receivedAt?: string;
  notes?: string;
}) {
  return apiPost<Receipt>({ path: `/continental-ops/businesses/${businessId}/receipts`, body });
}

export async function updateReceipt(businessId: string, id: string, body: Partial<{
  amount: number;
  currency: string;
  paymentMethod: string;
  receivedFrom: string;
  receivedBy: string;
  receivedAt: string;
  notes: string;
}>) {
  return apiPatch<Receipt>(`/continental-ops/businesses/${businessId}/receipts/${id}`, body);
}

export async function deleteReceipt(businessId: string, id: string) {
  return apiDelete<void>(`/continental-ops/businesses/${businessId}/receipts/${id}`);
}

// ---------- Stock Counts ----------
export interface StockCount {
  id: string;
  countNumber: string;
  countDate: string;
  countedBy: string | null;
  status: string;
  items: Array<{
    productId?: string;
    description: string;
    systemQty: number;
    countedQty: number;
    variance: number;
  }>;
  notes: string | null;
  createdAt: string;
}

export async function fetchStockCounts(businessId: string) {
  return apiGet<{ items: StockCount[] }>(`/continental-ops/businesses/${businessId}/stock-counts`);
}

export async function createStockCount(businessId: string, body: {
  countNumber: string;
  countDate?: string;
  countedBy?: string;
  notes?: string;
  items: Array<{ productId?: string; description: string; systemQty: number; countedQty: number }>;
}) {
  return apiPost<StockCount>({ path: `/continental-ops/businesses/${businessId}/stock-counts`, body });
}

export async function updateStockCount(businessId: string, id: string, body: Partial<{
  countDate: string;
  countedBy: string;
  notes: string;
  items: StockCount['items'];
  status: string;
}>) {
  return apiPatch<StockCount>(`/continental-ops/businesses/${businessId}/stock-counts/${id}`, body);
}

export async function adjustStockCount(businessId: string, id: string) {
  return apiPost<StockCount>({ path: `/continental-ops/businesses/${businessId}/stock-counts/${id}/adjust`, body: {} });
}

export async function deleteStockCount(businessId: string, id: string) {
  return apiDelete<void>(`/continental-ops/businesses/${businessId}/stock-counts/${id}`);
}
