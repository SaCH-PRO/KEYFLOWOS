"use client";

import { useMemo } from "react";
import { ChevronRight, Home, Grid3X3 } from "lucide-react";
import type { CatalogItem, CategoryInfo } from "./types";

type Props = {
  catalogItems: CatalogItem[];
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  primaryColor: string;
  slug: string;
};

export function CategoryNav({ catalogItems, activeCategory, onCategoryChange, primaryColor, slug }: Props) {
  const categories = useMemo<CategoryInfo[]>(() => {
    const map = new Map<string, number>();
    for (const item of catalogItems) {
      const key = item.itemType;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const cats: CategoryInfo[] = [];
    const labels: Record<string, string> = { service: "Services", product: "Products", package: "Packages" };
    for (const [key, count] of map) {
      cats.push({ key, label: labels[key] || key, count });
    }
    return cats;
  }, [catalogItems]);

  if (categories.length <= 1) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center overflow-x-auto gap-2 pb-1" style={{ scrollbarWidth: "none" }}>
        <button
          onClick={() => onCategoryChange(null)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all min-h-[44px] flex-shrink-0"
          style={{
            backgroundColor: !activeCategory ? `${primaryColor}20` : "rgba(0,0,0,0.03)",
            color: !activeCategory ? primaryColor : "rgba(0,0,0,0.4)",
            border: !activeCategory ? `1px solid ${primaryColor}30` : "1px solid rgba(0,0,0,0.04)",
          }}
        >
          <Grid3X3 className="w-3.5 h-3.5" />
          All ({catalogItems.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => onCategoryChange(cat.key)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all min-h-[44px] flex-shrink-0"
            style={{
              backgroundColor: activeCategory === cat.key ? `${primaryColor}20` : "rgba(0,0,0,0.03)",
              color: activeCategory === cat.key ? primaryColor : "rgba(0,0,0,0.4)",
              border: activeCategory === cat.key ? `1px solid ${primaryColor}30` : "1px solid rgba(0,0,0,0.04)",
            }}
          >
            {cat.label} ({cat.count})
          </button>
        ))}
      </div>
    </div>
  );
}

type BreadcrumbProps = {
  slug: string;
  businessName: string;
  category?: string | null;
  productName?: string | null;
  primaryColor: string;
  onNavigate?: (path: string) => void;
};

export function Breadcrumbs({ slug, businessName, category, productName, primaryColor, onNavigate }: BreadcrumbProps) {
  const crumbs: { label: string; path?: string }[] = [
    { label: businessName || slug, path: `/book/${slug}` },
  ];
  if (category) {
    const labels: Record<string, string> = { service: "Services", product: "Products", package: "Packages" };
    crumbs.push({ label: labels[category] || category, path: `/book/${slug}?category=${category}` });
  }
  if (productName) {
    crumbs.push({ label: productName });
  }

  if (crumbs.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1.5 text-xs text-gray-400 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
      <Home className="w-3 h-3 flex-shrink-0" style={{ color: primaryColor }} />
      {crumbs.map((crumb, idx) => (
        <span key={idx} className="flex items-center gap-1.5 flex-shrink-0">
          {idx > 0 && <ChevronRight className="w-3 h-3 text-gray-300" />}
          {crumb.path && idx < crumbs.length - 1 ? (
            <button
              onClick={() => onNavigate?.(crumb.path!)}
              className="hover:text-gray-500 transition-colors min-h-[44px] flex items-center"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="text-gray-500 font-medium">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
