"use client";

import { motion } from "framer-motion";
import { Package, ShoppingBag, Briefcase, Clock, CheckCircle2, Eye } from "lucide-react";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import { AiRecommendationCard } from "@/components/ui/ai-recommendation-card";
import { CatalogManager } from "./catalog-manager";
import { HoursEditor, type BusinessHoursMap } from "./hours-editor";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import type { Product, Service, CatalogItemOverride } from "@/lib/client";

type Props = {
  commerceProducts: Product[];
  liveProductIds: Set<string>;
  graphProductToServiceMap: Map<string, string>;
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

export function CatalogMode({
  commerceProducts,
  liveProductIds,
  graphProductToServiceMap,
  storeItemCount,
  processingItems,
  confirmRemove,
  onToggleItem,
  onSelectAll,
  onDeselectAll,
  onConfirmRemoveChange,
  onDeleteFromStore,
  services,
  businessHours,
  onHoursChange,
  onSaveHours,
  hoursSaving,
  onReorderProducts,
  itemOverrides,
  onItemOverrideChange,
  categoryEmphasis,
  onCategoryEmphasisChange,
}: Props) {
  const totalItems = commerceProducts.length;
  const inStore = storeItemCount;
  const notAdded = totalItems - commerceProducts.filter((p) => liveProductIds.has(p.id)).length;
  const categories = new Set(commerceProducts.map((p) => p.category).filter(Boolean));
  const serviceCount = commerceProducts.filter((p) => p.category === "SERVICE").length;
  const productCount = commerceProducts.filter((p) => p.category === "PRODUCT").length;
  const packageCount = commerceProducts.filter((p) => p.category === "PACKAGE").length;
  const hiddenCount = Object.values(itemOverrides ?? {}).filter((o) => o.visibilityRule === "hidden").length;
  const featuredCount = Object.values(itemOverrides ?? {}).filter((o) => o.featured).length;

  const hoursActive = Object.values(businessHours).filter((h) => (h as Record<string, unknown>)?.enabled).length;

  const metrics: MetricStripItem[] = [
    {
      label: "Total Items",
      value: totalItems,
      icon: Package,
      iconColor: "hsl(var(--kf-accent1))",
      threshold: { status: totalItems >= 3 ? "good" : totalItems > 0 ? "warn" : "critical" },
    },
    {
      label: "In Store",
      value: inStore,
      icon: CheckCircle2,
      iconColor: "hsl(var(--kf-success))",
      sub: `${notAdded} not added`,
    },
    {
      label: "Categories",
      value: categories.size,
      icon: ShoppingBag,
      iconColor: "#14B8A6",
    },
    {
      label: "Featured",
      value: featuredCount,
      icon: Eye,
      iconColor: "#a78bfa",
    },
  ];

  const aiRecs: { type: "action" | "insight" | "risk" | "opportunity"; priority: "high" | "medium" | "low"; title: string; description: string }[] = [];
  if (totalItems === 0) aiRecs.push({ type: "risk", priority: "high", title: "Empty Catalog", description: "Add products in Commerce first, then add them to your store here." });
  if (notAdded > 3) aiRecs.push({ type: "action", priority: "medium", title: `${notAdded} Items Not in Store`, description: "You have items in Commerce that aren't displayed. Consider adding them with the \"Add All\" button." });
  if (hiddenCount > 0) aiRecs.push({ type: "insight", priority: "low", title: `${hiddenCount} Hidden Items`, description: `${hiddenCount} catalog item${hiddenCount !== 1 ? "s are" : " is"} hidden from the storefront. Review visibility settings if this is unintentional.` });
  if (featuredCount === 0 && inStore > 0) aiRecs.push({ type: "opportunity", priority: "medium", title: "No Featured Items", description: "Mark your best items as \"Featured\" to highlight them prominently at the top of your storefront." });

  const catBreakdown = [
    serviceCount > 0 && { icon: Briefcase, label: "Services", count: serviceCount },
    productCount > 0 && { icon: ShoppingBag, label: "Products", count: productCount },
    packageCount > 0 && { icon: Package, label: "Packages", count: packageCount },
  ].filter(Boolean) as { icon: React.ElementType; label: string; count: number }[];

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <WorkspaceMetricStrip items={metrics} columns={4} compact />
      </motion.div>

      {catBreakdown.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex items-center gap-2"
        >
          {catBreakdown.map((cat) => {
            const Icon = cat.icon;
            return (
              <div
                key={cat.label}
                className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1"
                style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.35)" }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>{cat.count}</span>
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{cat.label}</span>
              </div>
            );
          })}
        </motion.div>
      )}

      {aiRecs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-2"
        >
          {aiRecs.slice(0, 2).map((rec) => (
            <AiRecommendationCard
              key={rec.title}
              type={rec.type}
              priority={rec.priority}
              title={rec.title}
              description={rec.description}
            />
          ))}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <CatalogManager
          products={commerceProducts}
          liveProductIds={liveProductIds}
          graphProductToServiceMap={graphProductToServiceMap}
          storeItemCount={storeItemCount}
          processingItems={processingItems}
          confirmRemove={confirmRemove}
          onToggleItem={onToggleItem}
          onSelectAll={onSelectAll}
          onDeselectAll={onDeselectAll}
          onConfirmRemoveChange={onConfirmRemoveChange}
          onDeleteFromStore={onDeleteFromStore}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          onReorder={onReorderProducts}
          itemOverrides={itemOverrides}
          onItemOverrideChange={onItemOverrideChange}
          categoryEmphasis={categoryEmphasis}
          onCategoryEmphasisChange={onCategoryEmphasisChange}
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <AccordionGroup title="Store Schedule" brandColor="#14B8A6">
          <AccordionSection
            title="Business Hours"
            subtitle={`${hoursActive} day${hoursActive !== 1 ? "s" : ""} active`}
            icon={Clock}
            accentColor="#14B8A6"
          >
            <HoursEditor
              hours={businessHours}
              onChange={onHoursChange}
              onSave={onSaveHours}
              saving={hoursSaving}
            />
          </AccordionSection>
        </AccordionGroup>
      </motion.div>
    </div>
  );
}
