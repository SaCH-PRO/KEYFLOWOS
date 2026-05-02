"use client";

import { motion } from "framer-motion";
import { Package, MapPin, Hash, Pencil, Trash2 } from "lucide-react";
import { ReachBadge, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";

import type { ListingDto } from "@/lib/types/marketplace";

export function CatalogTab({ listings, onEdit, onDelete }: { listings: ListingDto[]; onEdit: (item: ListingDto) => void; onDelete: (id: string) => void }) {
  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(listings);
  if (listings.length === 0) {
    return <EmptyState icon={Package} title="No Listings Yet" description="Create your first marketplace listing to start selling products globally." />;
  }
  return (
    <div className="space-y-3">
      {paginated.map((listing) => (
        <motion.div
          key={listing.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-white/40" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{listing.product?.name || listing.productName || "Product"}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <ReachBadge reach={listing.marketReach || "LOCAL"} />
                  {listing.countries && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {listing.countries}
                    </span>
                  )}
                  {listing.hsCode && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      HS: {listing.hsCode}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StatusBadge status={listing.status || "ACTIVE"} />
              {listing.shippingEnabled && (
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  Shipping ✓
                </span>
              )}
              <button onClick={() => onEdit(listing)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(listing.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      ))}
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}
