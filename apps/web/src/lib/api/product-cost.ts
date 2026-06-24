import { apiGet as apiGetSimple, apiPost } from "../api";
import { DEFAULT_BUSINESS_ID } from "./_defaults";

export interface ProductCostProfile {
  sourceCost: number;
  shippingEstimate: number;
  dutiesEstimate: number;
  packagingCost: number;
  transactionCost: number;
  landedCostEstimate: number;
  grossMargin: number | null;
  marginBand: string | null;
  currency: string;
}

export async function fetchProductCostProfile(productId: string, businessId?: string) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiGetSimple<{
    costProfile: ProductCostProfile | null;
    price: number;
    landedCost: number | null;
    grossMargin: number | null;
    marginBand: string | null;
    currency: string;
  }>(`/commerce/businesses/${encodeURIComponent(bid)}/products/${encodeURIComponent(productId)}/cost-profile`);
}

export async function updateProductCostProfile(
  productId: string,
  body: {
    sourceCost?: number;
    shippingEstimate?: number;
    dutiesEstimate?: number;
    packagingCost?: number;
    transactionCost?: number;
    currency?: string;
  },
  businessId?: string,
) {
  const bid = businessId ?? DEFAULT_BUSINESS_ID;
  return apiPost<{
    costProfile: ProductCostProfile;
    landedCost: number;
    grossMargin: number | null;
    marginBand: string | null;
  }>({
    path: `/commerce/businesses/${encodeURIComponent(bid)}/products/${encodeURIComponent(productId)}/cost-profile`,
    body,
  });
}

// ── Document Templates ─────────────────────────────────────────────────────

