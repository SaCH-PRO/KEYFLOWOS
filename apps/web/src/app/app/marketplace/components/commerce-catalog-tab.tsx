"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Package,
  Search,
  Filter,
  Plus,
  Pencil,
  ChevronDown,
  ChevronUp,
  Link2,
  Tag,
  Layers,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { EmptyState, usePagination, PaginationBar } from "./marketplace-utils";
import type { ProductDto, ProductVariantDto, ListingDto } from "@/lib/types/marketplace";

function ReadinessDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px]" title={label}>
      {ok ? (
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
      ) : (
        <Circle className="w-3 h-3 text-muted-foreground/40" />
      )}
      <span className={ok ? "text-emerald-400" : "text-muted-foreground/50"}>{label}</span>
    </span>
  );
}

function VariantPill({ variant }: { variant: ProductVariantDto }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
      {variant.name || variant.sku || "Variant"}
      {variant.price && <span className="text-muted-foreground">· ${variant.price}</span>}
    </span>
  );
}

export function CommerceCatalogTab({
  products,
  listings,
  onCreateProduct,
  onEditProduct,
}: {
  products: ProductDto[];
  listings: ListingDto[];
  onCreateProduct: () => void;
  onEditProduct: (product: ProductDto) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterModel, setFilterModel] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const listingsByProduct = useMemo(() => {
    const map: Record<string, ListingDto[]> = {};
    for (const l of listings) {
      if (l.productId) {
        if (!map[l.productId]) map[l.productId] = [];
        map[l.productId].push(l);
      }
    }
    return map;
  }, [listings]);

  const filtered = useMemo(() => {
    let result = products;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q)
      );
    }
    if (filterModel !== "all") {
      result = result.filter((p) => p.fulfillmentModel === filterModel || p.type === filterModel);
    }
    return result;
  }, [products, search, filterModel]);

  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(filtered, 15);

  if (products.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Product Catalog</h3>
          <button
            onClick={onCreateProduct}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Product
          </button>
        </div>
        <EmptyState
          icon={Package}
          title="No Products Yet"
          description="Add products to your catalog to manage variants, sources, and pricing."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20"
            placeholder="Search products..."
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <select
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50 appearance-none"
          >
            <option value="all">All Models</option>
            <option value="local_stock">Local Stock</option>
            <option value="dropship">Dropship</option>
            <option value="preorder">Pre-Order</option>
            <option value="manual">Manual</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <button
            onClick={onCreateProduct}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Product
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {paginated.map((product) => {
          const productListings = listingsByProduct[product.id] || [];
          const variants: ProductVariantDto[] = product.variants ?? [];
          const hasVariants = variants.length > 0;
          const hasSource = !!product.sourceUrl || !!product.supplierName;
          const hasCost = !!product.costPrice || !!product.price;
          const hasListings = productListings.length > 0;
          const isExpanded = expanded === product.id;

          const readinessScore = [hasVariants || !!product.price, hasSource, hasCost, hasListings].filter(Boolean).length;
          const readinessColor =
            readinessScore >= 3 ? "text-emerald-400" : readinessScore >= 2 ? "text-amber-400" : "text-muted-foreground";

          return (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <Package className="w-4.5 h-4.5 text-white/40" style={{ width: "1.1rem", height: "1.1rem" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">{product.name || "Untitled Product"}</p>
                        {product.sku && (
                          <span className="text-[10px] text-muted-foreground/60 bg-white/5 px-1.5 py-0.5 rounded">
                            {product.sku}
                          </span>
                        )}
                        {product.fulfillmentModel ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {String(product.fulfillmentModel)}
                          </span>
                        ) : null}
                      </div>
                      {product.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{product.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <ReadinessDot ok={hasCost} label="Cost set" />
                        <ReadinessDot ok={hasSource} label="Source linked" />
                        <ReadinessDot ok={hasListings} label="Listed" />
                        <ReadinessDot ok={hasVariants} label="Variants" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasCost && (
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-muted-foreground">Price</p>
                        <p className="text-sm font-semibold">${parseFloat(String(product.price ?? product.costPrice ?? 0)).toFixed(2)}</p>
                      </div>
                    )}
                    <span className={`text-[10px] font-semibold ${readinessColor}`}>{readinessScore}/4</span>
                    <button
                      onClick={() => onEditProduct(product)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : product.id)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-white/5 px-4 pb-4 pt-3 space-y-3">
                  {hasVariants && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                        <Layers className="w-3 h-3" /> Variants
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {variants.map((v, i) => (
                          <VariantPill key={i} variant={v} />
                        ))}
                      </div>
                    </div>
                  )}
                  {hasSource && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
                        <Link2 className="w-3 h-3" /> Source
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {product.supplierName ? <span>{String(product.supplierName)} — </span> : null}
                        {product.sourceUrl ? (
                          <a href={String(product.sourceUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                            {String(product.sourceUrl)}
                          </a>
                        ) : null}
                      </p>
                    </div>
                  )}
                  {hasCost && (
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Cost Price", value: product.costPrice },
                        { label: "Sell Price", value: product.price },
                        { label: "Margin", value: product.price && product.costPrice ? `${(((parseFloat(String(product.price)) - parseFloat(String(product.costPrice))) / parseFloat(String(product.price))) * 100).toFixed(1)}%` : "—" },
                      ].map((item) => (
                        <div key={item.label} className="bg-white/3 rounded-xl p-2.5 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                          <p className="text-[10px] text-muted-foreground">{item.label}</p>
                          <p className="text-sm font-semibold mt-0.5">
                            {item.value != null && item.value !== "" ? (item.label === "Margin" ? String(item.value) : `$${parseFloat(String(item.value)).toFixed(2)}`) : "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {hasListings && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                        <Tag className="w-3 h-3" /> Active Listings ({productListings.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {productListings.map((l) => (
                          <span key={l.id} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {(l as { marketReach?: string }).marketReach || "LOCAL"}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}
