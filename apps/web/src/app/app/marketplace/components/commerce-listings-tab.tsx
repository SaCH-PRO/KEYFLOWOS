"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Tag,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Plus,
  Search,
  TrendingUp,
  ShoppingBag,
  Truck,
  Clock,
  Shuffle,
  Hand,
} from "lucide-react";
import { EmptyState, usePagination, PaginationBar } from "./marketplace-utils";

const FULFILLMENT_STRATEGIES = [
  { key: "local_stock", label: "Local Stock", icon: ShoppingBag, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  { key: "dropship", label: "Dropship", icon: Truck, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { key: "preorder", label: "Pre-Order", icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  { key: "manual", label: "Manual", icon: Hand, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { key: "hybrid", label: "Hybrid", icon: Shuffle, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
];

function ReadinessIndicator({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-1 text-[10px]">
      {ok ? (
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
      ) : (
        <Circle className="w-3 h-3 text-muted-foreground/30" />
      )}
      <span className={ok ? "text-emerald-400" : "text-muted-foreground/40"}>{label}</span>
    </span>
  );
}

function FulfillmentBadge({ strategy }: { strategy: string }) {
  const s = FULFILLMENT_STRATEGIES.find((f) => f.key === strategy);
  if (!s) return null;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${s.bg} ${s.color} border ${s.border}`}>
      <Icon className="w-2.5 h-2.5" />
      {s.label}
    </span>
  );
}

export function CommerceListingsTab({
  listings,
  products,
  onEdit,
  onDelete,
  onUpdateListing,
  onCreateListing,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  listings: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  products: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onEdit: (item: any) => void;
  onDelete: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onUpdateListing: (id: string, data: any) => void;
  onCreateListing: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filterStrategy, setFilterStrategy] = useState("all");

  const productsById = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
    const map: Record<string, any> = {};
    for (const p of products) map[p.id] = p;
    return map;
  }, [products]);

  const filtered = useMemo(() => {
    let result = listings;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((l) => {
        const product = productsById[l.productId];
        return (
          product?.name?.toLowerCase().includes(q) ||
          l.title?.toLowerCase().includes(q)
        );
      });
    }
    if (filterStrategy !== "all") {
      result = result.filter((l) => l.fulfillmentStrategy === filterStrategy);
    }
    return result;
  }, [listings, search, filterStrategy, productsById]);

  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(filtered, 15);

  if (listings.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Listings</h3>
          <button
            onClick={onCreateListing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Listing
          </button>
        </div>
        <EmptyState
          icon={Tag}
          title="No Listings Yet"
          description="Create listings to make your products visible to customers. Set pricing, fulfillment strategy, and visibility."
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
            placeholder="Search listings..."
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterStrategy}
            onChange={(e) => setFilterStrategy(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50 appearance-none"
          >
            <option value="all">All Strategies</option>
            {FULFILLMENT_STRATEGIES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={onCreateListing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Listing
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation */}
        {paginated.map((listing: any) => {
          const product = productsById[listing.productId];
          const isActive = listing.status === "ACTIVE" || listing.active === true;
          const hasFulfillment = !!listing.fulfillmentStrategy;
          const hasMargin = !!listing.price || !!product?.price;
          const hasMedia = !!product?.imageUrl || !!listing.imageUrl;
          const hasSource = !!product?.sourceUrl || !!product?.supplierName;

          const readinessCount = [hasFulfillment, hasMargin, hasMedia, hasSource].filter(Boolean).length;

          return (
            <motion.div
              key={listing.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-white/5 border rounded-2xl p-4 transition-colors ${
                isActive ? "border-white/10" : "border-white/5 opacity-70"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <Tag className="w-4 h-4 text-white/40" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold truncate">
                        {listing.title || product?.name || "Listing"}
                      </p>
                      {listing.marketReach && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
                          {listing.marketReach}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {hasFulfillment && <FulfillmentBadge strategy={listing.fulfillmentStrategy} />}
                      {listing.price && (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                          <TrendingUp className="w-3 h-3" />
                          ${parseFloat(listing.price).toFixed(2)}
                          {listing.compareAtPrice && (
                            <span className="line-through text-muted-foreground/50 ml-1">
                              ${parseFloat(listing.compareAtPrice).toFixed(2)}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <ReadinessIndicator label="Fulfillment" ok={hasFulfillment} />
                      <ReadinessIndicator label="Margin" ok={hasMargin} />
                      <ReadinessIndicator label="Media" ok={hasMedia} />
                      <ReadinessIndicator label="Source" ok={hasSource} />
                      <span className="text-[10px] text-muted-foreground/50">{readinessCount}/4 ready</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onUpdateListing(listing.id, { status: isActive ? "INACTIVE" : "ACTIVE" })}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                      isActive
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                        : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10"
                    }`}
                    title={isActive ? "Deactivate" : "Activate"}
                  >
                    {isActive ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {isActive ? "Live" : "Hidden"}
                  </button>
                  <button
                    onClick={() => onEdit(listing)}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(listing.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}
