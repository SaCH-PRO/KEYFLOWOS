import { apiGet as apiGetSimple, apiPost } from "../api";
import { getStoredBusinessId } from "../workspace";
import { noBusinessSelected } from "./_defaults";

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
  // R0-15d: the business named, else the selected one, never the demo tenant.
  // FOLLOW3-D11: only a business left out resolves the selection; an explicit
  // "" is refused, as lib/client.ts refuses it (`||` used to swap it silently).
  const bid = businessId ?? getStoredBusinessId();
  if (!bid) return noBusinessSelected();
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
  // R0-15d: the business named, else the selected one, never the demo tenant.
  // FOLLOW3-D11: an explicit "" is refused, not swapped for the selection.
  const bid = businessId ?? getStoredBusinessId();
  if (!bid) return noBusinessSelected();
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

