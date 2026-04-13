"use client";

import { ProductsHoursTab } from "./products-hours-tab";
import type { Product, Service, CatalogItemOverride } from "@/lib/client";
import type { BusinessHoursMap } from "./hours-editor";

type Props = {
  commerceProducts: Product[];
  storeServiceNames: Set<string>;
  storeItemCount: number;
  processingItems: Set<string>;
  confirmRemove: string | null;
  onToggleItem: (product: Product) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirmRemoveChange: (id: string | null) => void;
  onDeleteFromStore: (serviceId: string, productName?: string) => void;
  services: Service[];
  businessHours: BusinessHoursMap;
  onHoursChange: (hours: BusinessHoursMap) => void;
  onSaveHours: () => Promise<void>;
  hoursSaving: boolean;
  onReorderProducts?: (orderedIds: string[]) => void;
  itemOverrides?: Record<string, CatalogItemOverride>;
  onItemOverrideChange?: (productId: string, override: Partial<CatalogItemOverride>) => void;
  categoryEmphasis?: Record<string, "high" | "medium" | "low" | "default">;
  onCategoryEmphasisChange?: (category: string, emphasis: "high" | "medium" | "low" | "default") => void;
};

export function CatalogMode(props: Props) {
  return <ProductsHoursTab {...props} />;
}
