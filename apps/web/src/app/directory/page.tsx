"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Search,
  MapPin,
  Store,
  ArrowRight,
  Sparkles,
  Layers,
} from "lucide-react";

const CATEGORIES = ["All", "Beauty", "Health", "Food", "Services", "Retail"];

const MOCK_BUSINESSES = [
  {
    slug: "island-glow-spa",
    name: "Island Glow Spa",
    logoUrl: null,
    tagline: "Radiant skin, island soul",
    category: "Beauty",
    city: "Port of Spain",
    country: "Trinidad & Tobago",
  },
  {
    slug: "coconut-cove-barbers",
    name: "Coconut Cove Barbers",
    logoUrl: null,
    tagline: "Sharp cuts by the shore",
    category: "Services",
    city: "Scarborough",
    country: "Trinidad & Tobago",
  },
  {
    slug: "spice-isle-kitchen",
    name: "Spice Isle Kitchen",
    logoUrl: null,
    tagline: "Authentic Grenadian flavours",
    category: "Food",
    city: "St. George's",
    country: "Grenada",
  },
  {
    slug: "reef-wellness",
    name: "Reef & Wellness",
    logoUrl: null,
    tagline: "Healing from the sea",
    category: "Health",
    city: "Bridgetown",
    country: "Barbados",
  },
  {
    slug: "sunset-boutique",
    name: "Sunset Boutique",
    logoUrl: null,
    tagline: "Island fashion finds",
    category: "Retail",
    city: "Kingston",
    country: "Jamaica",
  },
  {
    slug: "tropical-twist-salon",
    name: "Tropical Twist Salon",
    logoUrl: null,
    tagline: "Braids, beauty & beyond",
    category: "Beauty",
    city: "Castries",
    country: "St. Lucia",
  },
];

const fadeUp = { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.08 } } };

export default function DirectoryPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = useMemo(() => {
    let items = [...MOCK_BUSINESSES];
    if (activeCategory !== "All") {
      items = items.filter((b) => b.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.tagline.toLowerCase().includes(q) ||
          b.city.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q)
      );
    }
    return items;
  }, [search, activeCategory]);

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
          className="max-w-2xl mx-auto mb-10"
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

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-wrap justify-center gap-2 mb-12"
        >
          {CATEGORIES.map((cat) => (
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

        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <Store className="w-12 h-12 text-[hsl(30_10%_30%)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[hsl(30_20%_85%)] mb-2">
              No businesses found
            </h3>
            <p className="text-sm text-[hsl(30_10%_45%)]">
              Try adjusting your search or category filter.
            </p>
          </div>
        ) : (
          <motion.ul
            variants={stagger}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {filtered.map((business) => (
              <motion.li key={business.slug} variants={fadeUp} transition={{ duration: 0.4 }}>
                <BusinessCard business={business} />
              </motion.li>
            ))}
          </motion.ul>
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

function BusinessCard({
  business,
}: {
  business: (typeof MOCK_BUSINESSES)[number];
}) {
  const location = [business.city, business.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="group flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[hsl(24_95%_53%/0.25)] transition-all p-5">
      <div className="flex items-start gap-4 mb-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(24_95%_53%/0.15)] to-[hsl(173_58%_39%/0.1)] ring-1 ring-white/[0.08] flex items-center justify-center text-sm font-bold text-[hsl(30_20%_85%)]">
          {business.logoUrl ? (
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
          <p className="mt-0.5 text-sm text-[hsl(30_10%_45%)]">
            {business.tagline}
          </p>
        </div>
      </div>

      <div className="mt-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[hsl(30_10%_55%)]">
            {business.category}
          </span>
          {location && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[hsl(30_10%_55%)]">
              <MapPin className="w-3 h-3" />
              {location}
            </span>
          )}
        </div>

        <Link
          href={`/book/${business.slug}`}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all shadow-lg shadow-orange-500/10"
        >
          Book Now
          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}
