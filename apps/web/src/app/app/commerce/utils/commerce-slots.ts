"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Product, Invoice, Quote } from "@/lib/client";

export interface ProductSlots {
  renderCardBadge?: (product: Product) => ReactNode;
  renderHeaderExtra?: () => ReactNode;
  renderEmptyExtra?: () => ReactNode;
  renderInsightBanner?: () => ReactNode;
}

export interface BillingSlots {
  renderKpiExtra?: () => ReactNode;
  renderTimelineBadge?: (item: Invoice | Quote) => ReactNode;
  renderHeaderExtra?: () => ReactNode;
  renderInsightBanner?: () => ReactNode;
}

export interface CommerceSlots {
  products: ProductSlots;
  billing: BillingSlots;
}

const DEFAULT_SLOTS: CommerceSlots = {
  products: {},
  billing: {},
};

const CommerceSlotContext = createContext<CommerceSlots>(DEFAULT_SLOTS);

export const CommerceSlotProvider = CommerceSlotContext.Provider;

export function useCommerceSlots(): CommerceSlots {
  return useContext(CommerceSlotContext);
}
