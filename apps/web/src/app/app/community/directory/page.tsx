"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Search,
  MapPin,
  Briefcase,
  Sparkles,
  Globe,
} from "lucide-react";
import {
  fetchCommunityDirectory,
  type DirectoryBusiness,
} from "@/lib/client";
import { API_BASE } from "@/lib/api";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function DirectoryPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<DirectoryBusiness[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [page, setPage] = useState(1);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCommunityDirectory({
        search: search.trim() || undefined,
        industry: industry.trim() || undefined,
        page,
        limit: 20,
      });
      if (res.data) {
        setBusinesses(res.data.data);
        setTotal(res.data.total);
      }
    } catch {}
    setLoading(false);
  }, [search, industry, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
    void loadDirectory();
  }, [loadDirectory]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    void loadDirectory();
  }, [loadDirectory]);

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
          <Globe className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Business Directory</h1>
          <p className="text-xs text-muted-foreground">Discover and connect with businesses in the network</p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, industry, or headline..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
          />
        </div>
        <input
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          placeholder="Industry"
          className="w-32 px-3 py-2 rounded-xl bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-sm font-medium hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
        >
          Search
        </button>
      </form>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-muted/20 rounded-xl" />
          ))}
        </div>
      ) : businesses.length === 0 ? (
        <div className="text-center py-16">
          <Globe className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No businesses found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search criteria</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{total} businesses found</p>
          <div className="space-y-3">
            {businesses.map((biz) => {
              const logo = biz.logoUrl
                ? biz.logoUrl.startsWith("http") ? biz.logoUrl : `${API_BASE}${biz.logoUrl}`
                : null;
              return (
                <motion.div
                  key={biz.id}
                  variants={fadeUp}
                  initial="hidden"
                  animate="show"
                  onClick={() => router.push(`/app/community/profile/${biz.id}`)}
                  className="kf-card rounded-xl p-4 border border-border/30 flex items-center gap-4 cursor-pointer hover:bg-white/[0.03] transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white font-bold overflow-hidden flex-shrink-0">
                    {logo ? (
                      <Image src={logo} alt={biz.name} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                    ) : (
                      biz.name[0]?.toUpperCase() || "?"
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold truncate">{biz.name}</h3>
                    {biz.headline && (
                      <p className="text-xs text-muted-foreground truncate">{biz.headline}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {biz.industry && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--kf-accent1))]">
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
                      {biz.businessStage && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                          <Sparkles className="w-2.5 h-2.5" />
                          {biz.businessStage}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div className="text-xs font-medium">{biz.profileCompleteness}%</div>
                    <div className="w-12 h-1 bg-muted/30 rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]"
                        style={{ width: `${biz.profileCompleteness}%` }}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {total > 20 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg bg-muted/30 text-xs font-medium disabled:opacity-50 hover:bg-muted/50 transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">Page {page}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page * 20 >= total}
                className="px-3 py-1.5 rounded-lg bg-muted/30 text-xs font-medium disabled:opacity-50 hover:bg-muted/50 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
