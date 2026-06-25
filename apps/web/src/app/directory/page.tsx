"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  MapPin,
  Store,
  ArrowRight,
  Sparkles,
  Layers,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Globe,
} from "lucide-react";
import { API_BASE } from "@/lib/api";

interface DirectoryBusiness {
  slug: string;
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  headline: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  publishedAt: string | null;
}

interface DirectoryFilters {
  industries: { value: string; count: number }[];
  cities: { value: string; count: number }[];
}

interface DirectoryResponse {
  items: DirectoryBusiness[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  filters: DirectoryFilters;
}

const fadeUp = { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.08 } } };

export default function DirectoryPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeCity, setActiveCity] = useState("All");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDirectory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "24");
      if (search.trim()) params.set("q", search.trim());
      if (activeCategory !== "All") params.set("industry", activeCategory);
      if (activeCity !== "All") params.set("city", activeCity);

      const res = await fetch(`${API_BASE}/site/presence/directory?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load directory (${res.status})`);
      const json: DirectoryResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, [search, activeCategory, activeCity, page]);

  useEffect(() => {
    fetchDirectory();
  }, [fetchDirectory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, activeCategory, activeCity]);

  const categories = useMemo(() => {
    if (!data?.filters.industries) return ["All"];
    return ["All", ...data.filters.industries.map((i) => i.value)];
  }, [data?.filters.industries]);

  const cities = useMemo(() => {
    if (!data?.filters.cities) return ["All"];
    return ["All", ...data.filters.cities.map((c) => c.value)];
  }, [data?.filters.cities]);

  return (
    <div className="relative min-h-screen bg-[hsl(20_14%_4%)] text-[hsl(30_20%_98%)] overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-60 right-0 w-[700px] h-[700px] rounded-full bg-[radial-gradient(circle,hsl(24_95%_53%/0.1),transparent_65%)]" />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,hsl(173_58%_39%/0.07),transparent_65%)]" />
      </div>

      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[hsl(20_14%_4%/0.8)] backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
              <Layers className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">KeyFlowOS</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/directory"
              className="hidden sm:inline-block text-sm text-[hsl(24_95%_53%)] font-medium"
            >
              Directory
            </Link>
            <Link
              href="/pricing"
              className="hidden sm:inline-block text-sm text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/auth/login"
              className="text-sm text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/auth/signup"
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all"
            >
              Start Free
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-20">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="text-center max-w-3xl mx-auto mb-12"
        >
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[hsl(24_95%_53%/0.08)] border border-[hsl(24_95%_53%/0.15)] text-sm font-medium text-[hsl(24_95%_63%)] mb-6"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Caribbean Business Directory
          </motion.div>

          <motion.h1
            variants={fadeUp}
            transition={{ duration: 0.6 }}
            className="text-4xl sm:text-5xl font-bold leading-[1.08] mb-5 tracking-tight"
          >
            Discover local businesses{" "}
            <span className="bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_50%)] bg-clip-text text-transparent">
              on KeyFlow
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="text-base sm:text-lg text-[hsl(30_10%_55%)] max-w-xl mx-auto leading-relaxed"
          >
            Find and book appointments with the best service businesses across
            the Caribbean.
          </motion.p>
        </motion.div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-2xl mx-auto mb-6"
        >
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-[hsl(30_10%_40%)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by business name, category or location"
              className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] pl-11 pr-4 py-3.5 text-sm placeholder:text-[hsl(30_10%_40%)] focus:border-[hsl(24_95%_53%)] focus:outline-none focus:ring-1 focus:ring-[hsl(24_95%_53%/0.2)] transition-all"
            />
          </div>
        </motion.div>

        {/* Industry filters */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-wrap justify-center gap-2 mb-3"
        >
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeCategory === cat
                  ? "bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] text-white shadow-lg shadow-orange-500/20"
                  : "bg-white/[0.04] border border-white/[0.08] text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] hover:bg-white/[0.07]"
              }`}
            >
              {cat}
            </button>
          ))}
        </motion.div>

        {/* City filters */}
        {cities.length > 1 && (
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.5, delay: 0.35 }}
            className="flex flex-wrap justify-center gap-2 mb-10"
          >
            {cities.map((city) => (
              <button
                key={city}
                onClick={() => setActiveCity(city)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  activeCity === city
                    ? "bg-[hsl(173_58%_39%/0.2)] border border-[hsl(173_58%_39%/0.4)] text-[hsl(173_58%_60%)]"
                    : "bg-white/[0.03] border border-white/[0.06] text-[hsl(30_10%_45%)] hover:text-[hsl(30_20%_85%)] hover:bg-white/[0.06]"
                }`}
              >
                {city}
              </button>
            ))}
          </motion.div>
        )}

        {/* Results count */}
        {data && !loading && (
          <p className="text-center text-sm text-[hsl(30_10%_40%)] mb-6">
            Showing {data.items.length} of {data.total} businesses
            {data.pageCount > 1 && ` · Page ${data.page} of ${data.pageCount}`}
          </p>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 text-[hsl(24_95%_53%)] animate-spin mb-4" />
            <p className="text-sm text-[hsl(30_10%_45%)]">Loading businesses...</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="text-center py-20">
            <Store className="w-12 h-12 text-[hsl(30_10%_30%)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[hsl(30_20%_85%)] mb-2">
              Could not load directory
            </h3>
            <p className="text-sm text-[hsl(30_10%_45%)] mb-4">{error}</p>
            <button
              onClick={fetchDirectory}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && data?.items.length === 0 && (
          <div className="text-center py-20">
            <Store className="w-12 h-12 text-[hsl(30_10%_30%)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[hsl(30_20%_85%)] mb-2">
              No businesses found
            </h3>
            <p className="text-sm text-[hsl(30_10%_45%)]">
              Try adjusting your search or filters.
            </p>
          </div>
        )}

        {/* Grid */}
        {!loading && !error && data && data.items.length > 0 && (
          <motion.ul
            variants={stagger}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            <AnimatePresence mode="popLayout">
              {data.items.map((business) => (
                <motion.li
                  key={business.slug}
                  variants={fadeUp}
                  transition={{ duration: 0.4 }}
                  layout
                >
                  <BusinessCard business={business} />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}

        {/* Pagination */}
        {data && data.pageCount > 1 && !loading && (
          <div className="flex items-center justify-center gap-3 mt-12">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-[hsl(30_10%_55%)]">
              Page {page} of {data.pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(data.pageCount, p + 1))}
              disabled={page >= data.pageCount}
              className="p-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
              <Layers className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-[hsl(30_10%_45%)]">
              KeyFlowOS
            </span>
          </div>
          <p className="text-xs text-[hsl(30_10%_30%)]">
            Your business, on autopilot.
          </p>
          <div className="flex items-center gap-4 text-xs text-[hsl(30_10%_35%)]">
            <Link
              href="/directory"
              className="text-[hsl(24_95%_53%)] hover:text-[hsl(24_95%_63%)] transition-colors"
            >
              Directory
            </Link>
            <Link
              href="/pricing"
              className="hover:text-[hsl(30_10%_60%)] transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/auth/login"
              className="hover:text-[hsl(30_10%_60%)] transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/auth/signup"
              className="hover:text-[hsl(30_10%_60%)] transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function BusinessCard({ business }: { business: DirectoryBusiness }) {
  const location = [business.city, business.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="group flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[hsl(24_95%_53%/0.25)] transition-all p-5">
      <div className="flex items-start gap-4 mb-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(24_95%_53%/0.15)] to-[hsl(173_58%_39%/0.1)] ring-1 ring-white/[0.08] flex items-center justify-center text-sm font-bold text-[hsl(30_20%_85%)]">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external logo URL from S3/R2; unoptimized img acceptable here
            <img
              src={business.logoUrl}
              alt={`${business.name} logo`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <span>{business.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-[hsl(30_20%_98%)] group-hover:text-[hsl(24_95%_63%)] transition-colors">
            {business.name}
          </h3>
          <p className="mt-0.5 text-sm text-[hsl(30_10%_45%)] line-clamp-2">
            {business.tagline || business.headline || ""}
          </p>
        </div>
      </div>

      <div className="mt-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {business.industry && (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[hsl(30_10%_55%)]">
              {business.industry}
            </span>
          )}
          {location && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[hsl(30_10%_55%)]">
              <MapPin className="w-3 h-3" />
              {location}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/site/${business.slug}`}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all shadow-lg shadow-orange-500/10"
          >
            Visit
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          {business.website && (
            <a
              href={business.website}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] hover:bg-white/[0.06] transition-all"
              title="External website"
            >
              <Globe className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
