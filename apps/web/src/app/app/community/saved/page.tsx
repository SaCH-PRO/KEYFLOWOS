"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Bookmark,
  MapPin,
  Briefcase,
  Trash2,
} from "lucide-react";
import {
  fetchSavedBusinesses,
  unsaveBusinessFromShortlist,
  type SavedBusinessItem,
} from "@/lib/client";
import { API_BASE } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function SavedBusinessesPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedBusinessItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    fetchSavedBusinesses(businessId)
      .then((res) => {
        if (res.data) setSaved(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  const handleRemove = useCallback(async (savedBusinessId: string) => {
    if (!businessId) return;
    try {
      await unsaveBusinessFromShortlist(businessId, savedBusinessId);
      setSaved((prev) => prev.filter((s) => s.savedBusinessId !== savedBusinessId));
    } catch {}
  }, [businessId]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => router.push("/app/community")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Community
      </button>

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10">
          <Bookmark className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Saved Businesses</h1>
          <p className="text-xs text-muted-foreground">Your shortlisted businesses for future reference</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted/20 rounded-xl" />
          ))}
        </div>
      ) : saved.length === 0 ? (
        <div className="text-center py-16">
          <Bookmark className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No saved businesses yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Visit business profiles to save them to your shortlist</p>
        </div>
      ) : (
        <div className="space-y-3">
          {saved.map((item) => {
            const biz = item.savedBusiness;
            const logo = biz.logoUrl
              ? biz.logoUrl.startsWith("http") ? biz.logoUrl : `${API_BASE}${biz.logoUrl}`
              : null;
            return (
              <motion.div
                key={item.id}
                variants={fadeUp}
                initial="hidden"
                animate="show"
                className="kf-card rounded-xl p-4 border border-border/30 flex items-center gap-4 cursor-pointer hover:bg-white/[0.03] transition-colors group"
                onClick={() => router.push(`/app/community/profile/${biz.id}`)}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white font-bold overflow-hidden flex-shrink-0">
                  {logo ? (
                    <img src={logo} alt={biz.name} className="w-full h-full object-cover" />
                  ) : (
                    biz.name[0]?.toUpperCase() || "?"
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold truncate">{biz.name}</h3>
                  {biz.headline && (
                    <p className="text-xs text-muted-foreground truncate">{biz.headline}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {biz.industry && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Briefcase className="w-2.5 h-2.5" />
                        {biz.industry}
                      </span>
                    )}
                    {(biz.city || biz.country) && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <MapPin className="w-2.5 h-2.5" />
                        {[biz.city, biz.country].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(biz.id);
                  }}
                  className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all"
                  title="Remove from shortlist"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
