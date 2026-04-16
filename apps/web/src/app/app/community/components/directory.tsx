"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  MapPin,
  Briefcase,
  CheckCircle,
  Clock,
  DollarSign,
  X,
  ChevronDown,
  Store,
  Sparkles,
  ShoppingBag,
  Calendar,
  Send,
  MessageSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import {
  searchDirectory,
  type DirectoryBusiness,
} from "@/lib/client";
import { API_BASE } from "@/lib/api";

interface DirectoryProps {
  onViewProfile: (businessId: string) => void;
}

const CAPACITY_OPTIONS = [
  { value: "", label: "Any Availability" },
  { value: "OPEN", label: "Open" },
  { value: "LIMITED", label: "Limited" },
  { value: "FULL", label: "Full" },
];

const STAGE_OPTIONS = [
  { value: "", label: "Any Stage" },
  { value: "IDEA", label: "Idea" },
  { value: "STARTUP", label: "Startup" },
  { value: "GROWTH", label: "Growth" },
  { value: "SCALING", label: "Scaling" },
  { value: "ESTABLISHED", label: "Established" },
  { value: "MATURE", label: "Mature" },
];

const SORT_OPTIONS = [
  { value: "", label: "Best Match" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name A-Z" },
];

function CapacityBadge({ capacity, accepting }: { capacity?: string; accepting: boolean }) {
  if (!accepting) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400">
        <X className="w-2.5 h-2.5" /> Not Accepting
      </span>
    );
  }
  const config: Record<string, { bg: string; color: string; label: string }> = {
    OPEN: { bg: "bg-emerald-500/15", color: "text-emerald-400", label: "Open" },
    LIMITED: { bg: "bg-amber-500/15", color: "text-amber-400", label: "Limited" },
    FULL: { bg: "bg-red-500/15", color: "text-red-400", label: "Full" },
  };
  const c = config[capacity || "OPEN"] || config.OPEN;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.color}`}>
      <CheckCircle className="w-2.5 h-2.5" /> {c.label}
    </span>
  );
}

function DirectoryCard({ biz, onViewProfile }: { biz: DirectoryBusiness; onViewProfile: (id: string) => void }) {
  const router = useRouter();
  const logo = biz.logoUrl
    ? biz.logoUrl.startsWith("http") ? biz.logoUrl : `${API_BASE}${biz.logoUrl}`
    : null;
  const initials = biz.name?.[0]?.toUpperCase() || "?";
  const topOffering = biz.services?.[0] || biz.products?.[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card border border-border/30 rounded-xl p-4 space-y-3 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/30 transition-all group"
      onClick={() => onViewProfile(biz.id)}
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-lg font-bold overflow-hidden flex-shrink-0">
          {logo ? (
            <img src={logo} alt={biz.name} className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold truncate group-hover:text-[hsl(var(--kf-accent1))] transition-colors">{biz.name}</h3>
          {biz.headline && <p className="text-xs text-muted-foreground truncate">{biz.headline}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <CapacityBadge capacity={biz.currentCapacity} accepting={biz.acceptingWork} />
            {biz.industry && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
                <Briefcase className="w-2.5 h-2.5" /> {biz.industry}
              </span>
            )}
          </div>
        </div>
      </div>

      {biz.positioningStatement && (
        <p className="text-xs text-muted-foreground line-clamp-2">{biz.positioningStatement}</p>
      )}

      {biz.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {biz.skills.slice(0, 4).map((skill) => (
            <span key={skill} className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground border border-white/5">
              {skill}
            </span>
          ))}
          {biz.skills.length > 4 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] text-muted-foreground">+{biz.skills.length - 4}</span>
          )}
        </div>
      )}

      {topOffering && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border/20">
          <Store className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
          <span className="truncate">{topOffering.name}</span>
          <span className="ml-auto font-medium text-foreground">
            {topOffering.currency} {topOffering.price.toLocaleString()}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        {(biz.city || biz.country) && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {[biz.city, biz.country].filter(Boolean).join(", ")}
          </span>
        )}
        {biz.leadTime && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {biz.leadTime}
          </span>
        )}
        {biz._count?.networkConnectionsTo ? (
          <span className="ml-auto">{biz._count.networkConnectionsTo} followers</span>
        ) : null}
      </div>

      {biz.slug && (
        <div className="flex items-center gap-1.5 pt-2 border-t border-border/20">
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/book/${biz.slug}`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] text-[10px] font-medium transition-colors"
          >
            <ShoppingBag className="w-3 h-3" /> Store
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/book/${biz.slug}?action=book`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 text-[hsl(var(--kf-accent2))] text-[10px] font-medium transition-colors"
          >
            <Calendar className="w-3 h-3" /> Book
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/book/${biz.slug}?action=quote`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground text-[10px] font-medium transition-colors"
          >
            <Send className="w-3 h-3" /> Quote
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); router.push(`/app/community?message=${biz.id}`); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground text-[10px] font-medium transition-colors ml-auto"
          >
            <MessageSquare className="w-3 h-3" /> Message
          </button>
        </div>
      )}
    </motion.div>
  );
}

export function Directory({ onViewProfile }: DirectoryProps) {
  const [businesses, setBusinesses] = useState<DirectoryBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    industry: "",
    city: "",
    businessStage: "",
    currentCapacity: "",
    acceptingWork: "",
    serviceType: "",
    priceMin: "",
    priceMax: "",
    sort: "",
  });

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filters.industry) params.industry = filters.industry;
    if (filters.city) params.city = filters.city;
    if (filters.businessStage) params.businessStage = filters.businessStage;
    if (filters.currentCapacity) params.currentCapacity = filters.currentCapacity;
    if (filters.acceptingWork) params.acceptingWork = filters.acceptingWork;
    if (filters.serviceType) params.serviceType = filters.serviceType;
    if (filters.priceMin) params.priceMin = filters.priceMin;
    if (filters.priceMax) params.priceMax = filters.priceMax;
    if (filters.sort) params.sort = filters.sort;
    params.page = String(page);
    params.limit = "20";

    try {
      const res = await searchDirectory(params);
      if (res.data) {
        setBusinesses(res.data.data);
        setTotal(res.data.total);
      }
    } catch {}
    setLoading(false);
  }, [search, filters, page]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search businesses, skills, services..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 transition-colors"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
            showFilters || activeFilterCount > 0
              ? "border-[hsl(var(--kf-accent1))]/50 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
              : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-[hsl(var(--kf-accent1))] text-white text-[10px] flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
        <select
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
          className="px-3 py-2.5 rounded-xl text-xs bg-white/5 border border-white/10 text-muted-foreground focus:outline-none"
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
        >
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Industry</label>
            <input
              placeholder="e.g. Technology"
              value={filters.industry}
              onChange={(e) => setFilters((f) => ({ ...f, industry: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Location</label>
            <input
              placeholder="e.g. Port of Spain"
              value={filters.city}
              onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Business Stage</label>
            <select
              value={filters.businessStage}
              onChange={(e) => setFilters((f) => ({ ...f, businessStage: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            >
              {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Availability</label>
            <select
              value={filters.currentCapacity}
              onChange={(e) => setFilters((f) => ({ ...f, currentCapacity: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            >
              {CAPACITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Service Type</label>
            <input
              placeholder="e.g. Branding, Web Dev"
              value={filters.serviceType}
              onChange={(e) => setFilters((f) => ({ ...f, serviceType: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Min Price</label>
            <input
              type="number"
              placeholder="0"
              value={filters.priceMin}
              onChange={(e) => setFilters((f) => ({ ...f, priceMin: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Max Price</label>
            <input
              type="number"
              placeholder="No limit"
              value={filters.priceMax}
              onChange={(e) => setFilters((f) => ({ ...f, priceMax: e.target.value }))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div className="col-span-2 md:col-span-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={filters.acceptingWork === "true"}
                onChange={(e) => setFilters((f) => ({ ...f, acceptingWork: e.target.checked ? "true" : "" }))}
                className="rounded"
              />
              Only show businesses accepting work
            </label>
            <button
              onClick={() => setFilters({ industry: "", city: "", businessStage: "", currentCapacity: "", acceptingWork: "", serviceType: "", priceMin: "", priceMax: "", sort: "" })}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="kf-card rounded-xl p-4 space-y-3 animate-pulse border border-border/30">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-xl bg-muted/30" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-muted/30 rounded" />
                  <div className="h-3 w-48 bg-muted/20 rounded" />
                </div>
              </div>
              <div className="h-8 bg-muted/15 rounded" />
            </div>
          ))}
        </div>
      ) : businesses.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No businesses found"
          description="Try adjusting your search or filters to find businesses in the network."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{total} business{total !== 1 ? "es" : ""} found</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {businesses.map((biz) => (
              <DirectoryCard key={biz.id} biz={biz} onViewProfile={onViewProfile} />
            ))}
          </div>
          {total > 20 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(total / 20)}</span>
              <button
                disabled={page >= Math.ceil(total / 20)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 disabled:opacity-50"
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
