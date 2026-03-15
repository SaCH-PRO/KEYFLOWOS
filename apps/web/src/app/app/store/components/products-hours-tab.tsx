"use client";

import { CatalogManager } from "./catalog-manager";
import { MerchandisingPanel } from "./merchandising-panel";
import { HoursEditor, type BusinessHoursMap } from "./hours-editor";
import type { Product, Service, StorefrontConfig } from "@/lib/client";

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
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  businessHours: BusinessHoursMap;
  onHoursChange: (hours: BusinessHoursMap) => void;
  onSaveHours: () => Promise<void>;
  hoursSaving: boolean;
};

export function ProductsHoursTab({
  commerceProducts,
  storeServiceNames,
  storeItemCount,
  processingItems,
  confirmRemove,
  onToggleItem,
  onSelectAll,
  onDeselectAll,
  onConfirmRemoveChange,
  onDeleteFromStore,
  services,
  storefrontConfig,
  onConfigChange,
  onSaveConfig,
  configSaving,
  businessHours,
  onHoursChange,
  onSaveHours,
  hoursSaving,
}: Props) {
  return (
    <div className="space-y-6">
      <CatalogManager
        products={commerceProducts}
        storeServiceNames={storeServiceNames}
        storeItemCount={storeItemCount}
        processingItems={processingItems}
        confirmRemove={confirmRemove}
        onToggleItem={onToggleItem}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onConfirmRemoveChange={onConfirmRemoveChange}
        onDeleteFromStore={onDeleteFromStore}
        services={services.map((s) => ({ id: s.id, name: s.name }))}
      />

      <MerchandisingPanel
        config={storefrontConfig}
        products={commerceProducts}
        services={services}
        onConfigChange={onConfigChange}
        onSave={onSaveConfig}
        saving={configSaving}
      />

      <HoursEditor
        hours={businessHours}
        onChange={onHoursChange}
        onSave={onSaveHours}
        saving={hoursSaving}
      />
    </div>
  );
}
