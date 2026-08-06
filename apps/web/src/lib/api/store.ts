/**
 * Storefront performance — orders, promos and margins.
 *
 * The four panels behind the Store "Performance" tab rendered hardcoded
 * constants (DEMO_ORDERS, DEMO_SUMMARY, DEMO_CUSTOMERS, DEMO_PROMOS) and never
 * called anything. Every endpoint below already existed on the server; nothing
 * had ever connected to them. This module is that connection.
 *
 * Server routes: site.controller.ts:248-343 (orders + promo codes),
 * commerce-insights.controller.ts:45 (margin analysis).
 */
import { apiGet, apiPost, apiPatch } from "@/lib/api";

// ── Orders ──────────────────────────────────────────────────────────────────

export interface StoreOrderItem {
  id: string;
  productId: string;
  name: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: string;
}

export interface StoreOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  subtotal: number;
  shippingFee: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  currency: string;
  paymentStatus: string;
  paymentMethod?: string | null;
  items: StoreOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface StoreOrderPage {
  data: StoreOrder[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StoreOrderSummary {
  totalOrders: number;
  pendingOrders: number;
  confirmedOrders: number;
  shippedOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
}

export interface StoreOrderFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

function orderQuery(filters?: StoreOrderFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.search) params.set("search", filters.search);
  if (filters.page !== undefined) params.set("page", String(filters.page));
  if (filters.pageSize !== undefined) params.set("pageSize", String(filters.pageSize));
  return params.toString() ? `?${params.toString()}` : "";
}

export async function fetchStoreOrders(
  businessId: string,
  filters?: StoreOrderFilters,
): Promise<{ data: StoreOrderPage | null; error: string | null }> {
  return apiGet<StoreOrderPage>(
    `/site/businesses/${encodeURIComponent(businessId)}/orders${orderQuery(filters)}`,
  );
}

export async function fetchStoreOrderSummary(
  businessId: string,
): Promise<{ data: StoreOrderSummary | null; error: string | null }> {
  return apiGet<StoreOrderSummary>(
    `/site/businesses/${encodeURIComponent(businessId)}/orders/summary`,
  );
}

export async function updateStoreOrderStatus(
  businessId: string,
  orderId: string,
  status: string,
): Promise<{ data: StoreOrder | null; error: string | null }> {
  return apiPatch<StoreOrder>(
    `/site/businesses/${encodeURIComponent(businessId)}/orders/${encodeURIComponent(orderId)}/status`,
    { status },
  );
}

export async function refundStoreOrder(
  businessId: string,
  orderId: string,
): Promise<{ data: StoreOrder | null; error: string | null }> {
  return apiPost<StoreOrder>({
    path: `/site/businesses/${encodeURIComponent(businessId)}/orders/${encodeURIComponent(orderId)}/refund`,
    body: {},
  });
}

// ── Promo codes ─────────────────────────────────────────────────────────────

export type PromoCodeType = "PERCENT" | "FIXED" | "FREE_SHIPPING";

export interface PromoCode {
  id: string;
  code: string;
  type: PromoCodeType;
  value: number;
  minOrderValue?: number | null;
  maxUses?: number | null;
  currentUses: number;
  validFrom?: string | null;
  validTo?: string | null;
  active: boolean;
  createdAt: string;
}

export interface PromoCodeInput {
  code: string;
  type: PromoCodeType;
  value: number;
  minOrderValue?: number;
  maxUses?: number;
  validFrom?: string;
  validTo?: string;
  active?: boolean;
}

export async function fetchPromoCodes(
  businessId: string,
): Promise<{ data: PromoCode[] | null; error: string | null }> {
  return apiGet<PromoCode[]>(`/site/businesses/${encodeURIComponent(businessId)}/promo-codes`);
}

export async function createPromoCode(
  businessId: string,
  input: PromoCodeInput,
): Promise<{ data: PromoCode | null; error: string | null }> {
  return apiPost<PromoCode>({
    path: `/site/businesses/${encodeURIComponent(businessId)}/promo-codes`,
    body: input,
  });
}

export async function updatePromoCode(
  businessId: string,
  promoId: string,
  input: Partial<PromoCodeInput>,
): Promise<{ data: PromoCode | null; error: string | null }> {
  return apiPatch<PromoCode>(
    `/site/businesses/${encodeURIComponent(businessId)}/promo-codes/${encodeURIComponent(promoId)}`,
    input,
  );
}

/** The server exposes delete as POST .../delete, not DELETE (site.controller.ts:337). */
export async function deletePromoCode(
  businessId: string,
  promoId: string,
): Promise<{ data: unknown | null; error: string | null }> {
  return apiPost<unknown>({
    path: `/site/businesses/${encodeURIComponent(businessId)}/promo-codes/${encodeURIComponent(promoId)}/delete`,
    body: {},
  });
}

// ── Margins ─────────────────────────────────────────────────────────────────

export interface ProductMargin {
  productId: string;
  productName: string;
  sellingPrice: number;
  landedCost: number;
  grossProfit: number;
  grossMarginPct: number;
  marginBand: "healthy" | "moderate" | "low" | "negative";
  currency: string;
}

export interface MarginSummary {
  businessId: string;
  totalProducts: number;
  productsWithCostData: number;
  marginDistribution: Record<string, number>;
  avgGrossMarginPct: number;
  products: ProductMargin[];
}

export async function fetchMarginAnalysis(
  businessId: string,
): Promise<{ data: MarginSummary | null; error: string | null }> {
  return apiGet<MarginSummary>(
    `/commerce/businesses/${encodeURIComponent(businessId)}/insights/margins`,
  );
}
