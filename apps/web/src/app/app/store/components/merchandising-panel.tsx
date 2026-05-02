"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Megaphone,
  Tag,
  Award,
  Sparkles,
  Flame,
  Clock,
  Save,
  Loader2,
  Search,
  Shield,
  Truck,
  CheckCircle2,
  Headphones,
  Zap,
  Briefcase,
  LayoutGrid,
  Gift,
  Users,
  BadgeCheck,
  Boxes,
  Layers,
} from "lucide-react";
import type { StorefrontConfig, Product, Service, BadgeType, TrustRailItem } from "@/lib/client";

type Props = {
  config: StorefrontConfig;
  products: Product[];
  services: Service[];
  onConfigChange: (section: string, updates: Record<string, unknown>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

const MAX_FEATURED = 8;

const BADGE_OPTIONS: { value: BadgeType | "none"; label: string; color: string; icon: React.ElementType }[] = [
  { value: "none", label: "None", color: "hsl(var(--kf-muted-foreground))", icon: Tag },
  { value: "popular", label: "Popular", color: "hsl(45 93% 55%)", icon: Flame },
  { value: "new", label: "New", color: "hsl(160 84% 39%)", icon: Sparkles },
  { value: "best_seller", label: "Best Seller", color: "hsl(263 70% 58%)", icon: Award },
  { value: "limited", label: "Limited", color: "hsl(0 72% 51%)", icon: Clock },
  { value: "sale", label: "Sale", color: "hsl(340 82% 52%)", icon: Tag },
  { value: "best_value", label: "Best Value", color: "hsl(199 89% 48%)", icon: Star },
  { value: "fast_delivery", label: "Fast Delivery", color: "hsl(142 70% 45%)", icon: Truck },
  { value: "book_today", label: "Book Today", color: "hsl(28 90% 55%)", icon: CheckCircle2 },
  { value: "verified", label: "Verified", color: "hsl(211 90% 55%)", icon: BadgeCheck },
  { value: "digital_delivery", label: "Digital Delivery", color: "hsl(271 81% 65%)", icon: Zap },
  { value: "staff_pick", label: "Staff Pick", color: "hsl(335 80% 60%)", icon: Users },
];

const BANNER_COLORS = [
  { label: "Amber", value: "hsl(45 93% 55%)" },
  { label: "Emerald", value: "hsl(160 84% 39%)" },
  { label: "Blue", value: "hsl(217 91% 60%)" },
  { label: "Red", value: "hsl(0 72% 51%)" },
  { label: "Purple", value: "hsl(263 70% 58%)" },
];

const TRUST_RAIL_OPTIONS: { key: TrustRailItem; label: string; icon: React.ElementType }[] = [
  { key: "secure_checkout", label: "Secure Checkout", icon: Shield },
  { key: "fast_delivery", label: "Fast Delivery", icon: Truck },
  { key: "verified_business", label: "Verified Business", icon: BadgeCheck },
  { key: "instant_booking", label: "Instant Booking", icon: Zap },
  { key: "custom_support", label: "Custom Support", icon: Headphones },
  { key: "digital_delivery", label: "Digital Delivery", icon: Layers },
];

const RAIL_TYPE_OPTIONS = [
  { value: "featured", label: "Featured Rail" },
  { value: "seasonal", label: "Seasonal Rail" },
  { value: "landing", label: "Landing Section" },
] as const;

function CollapsibleSection({
  icon: Icon,
  title,
  subtitle,
  accent,
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  accent: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: `1px solid ${accent}`,
        boxShadow: "0 4px 24px hsl(var(--kf-accent1) / 0.05)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: open ? `1px solid ${accent}` : "none",
          background: `linear-gradient(135deg, ${accent.replace("0.15", "0.06")}, transparent)`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: accent.replace("0.15", "0.15") }}
          >
            <Icon className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-5 space-y-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between w-full py-2 group"
    >
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      <div
        className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
        style={{ background: enabled ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? "left-[22px]" : "left-0.5"}`} />
      </div>
    </button>
  );
}

export function MerchandisingPanel({ config, products, services, onConfigChange, onSave, saving }: Props) {
  const merchandising = config.merchandising ?? {};
  const promotions = config.promotions ?? {};
  const featuredIds = merchandising.featuredItemIds ?? [];
  const badges = merchandising.badges ?? {};
  const collections = merchandising.collections ?? [];
  const trustRails = merchandising.trustRails ?? [];
  const spotlights = merchandising.spotlights ?? [];

  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [badgeDropdown, setBadgeDropdown] = useState<string | null>(null);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionType, setNewCollectionType] = useState<"featured" | "seasonal" | "landing">("featured");
  const [collectionAddItem, setCollectionAddItem] = useState<string | null>(null);
  const [collectionSearch, setCollectionSearch] = useState("");
  const [newSpotlightItemId, setNewSpotlightItemId] = useState("");
  const [newSpotlightType, setNewSpotlightType] = useState<"service" | "package" | "hybrid">("service");
  const [newSpotlightHeadline, setNewSpotlightHeadline] = useState("");
  const addRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddDropdownOpen(false);
      if (badgeRef.current && !badgeRef.current.contains(e.target as Node)) setBadgeDropdown(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const allItems = [
    ...products.map((p) => ({ id: p.id, name: p.name, type: "product" as const })),
    ...services.map((s) => ({ id: s.id, name: s.name, type: "service" as const })),
  ];

  const availableToAdd = allItems.filter(
    (item) =>
      !featuredIds.includes(item.id) &&
      (!addSearch.trim() || item.name.toLowerCase().includes(addSearch.toLowerCase()))
  );

  function addFeatured(id: string) {
    if (featuredIds.length >= MAX_FEATURED) return;
    onConfigChange("merchandising", { featuredItemIds: [...featuredIds, id] });
    setAddDropdownOpen(false);
    setAddSearch("");
  }

  function removeFeatured(id: string) {
    onConfigChange("merchandising", { featuredItemIds: featuredIds.filter((fid: string) => fid !== id) });
  }

  function moveFeatured(id: string, direction: "up" | "down") {
    const idx = featuredIds.indexOf(id);
    if (idx === -1) return;
    const newIds = [...featuredIds];
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= newIds.length) return;
    [newIds[idx], newIds[swap]] = [newIds[swap], newIds[idx]];
    onConfigChange("merchandising", { featuredItemIds: newIds });
  }

  function setBadge(itemId: string, badge: BadgeType | "none") {
    const newBadges = { ...badges };
    if (badge === "none") {
      delete newBadges[itemId];
    } else {
      newBadges[itemId] = badge;
    }
    onConfigChange("merchandising", { badges: newBadges });
    setBadgeDropdown(null);
  }

  function getItemName(id: string) {
    return allItems.find((i) => i.id === id)?.name ?? id;
  }

  function getBadgeConfig(badge: BadgeType | undefined) {
    if (!badge) return null;
    return BADGE_OPTIONS.find((b) => b.value === badge) ?? null;
  }

  function toggleTrustRail(key: TrustRailItem) {
    const current = trustRails.includes(key)
      ? trustRails.filter((k) => k !== key)
      : [...trustRails, key];
    onConfigChange("merchandising", { trustRails: current });
  }

  function addCollection() {
    if (!newCollectionName.trim()) return;
    const newCol = {
      // eslint-disable-next-line react-hooks/purity -- audited: id generation in user-action handler
      id: `col_${Date.now()}`,
      name: newCollectionName.trim(),
      itemIds: [],
      railType: newCollectionType,
    };
    onConfigChange("merchandising", { collections: [...collections, newCol] });
    setNewCollectionName("");
  }

  function removeCollection(id: string) {
    onConfigChange("merchandising", { collections: collections.filter((c) => c.id !== id) });
  }

  function addItemToCollection(collectionId: string, itemId: string) {
    const updated = collections.map((c) =>
      c.id === collectionId ? { ...c, itemIds: [...(c.itemIds ?? []), itemId] } : c
    );
    onConfigChange("merchandising", { collections: updated });
    setCollectionAddItem(null);
    setCollectionSearch("");
  }

  function removeItemFromCollection(collectionId: string, itemId: string) {
    const updated = collections.map((c) =>
      c.id === collectionId ? { ...c, itemIds: (c.itemIds ?? []).filter((id) => id !== itemId) } : c
    );
    onConfigChange("merchandising", { collections: updated });
  }

  function addSpotlight() {
    if (!newSpotlightItemId) return;
    const item = allItems.find((i) => i.id === newSpotlightItemId);
    if (!item) return;
    const newSpotlight = {
      // eslint-disable-next-line react-hooks/purity -- audited: id generation in user-action handler
      id: `sp_${Date.now()}`,
      itemId: newSpotlightItemId,
      itemType: item.type as "service" | "product" | "package",
      spotlightType: newSpotlightType,
      headline: newSpotlightHeadline || undefined,
    };
    onConfigChange("merchandising", { spotlights: [...spotlights, newSpotlight] });
    setNewSpotlightItemId("");
    setNewSpotlightHeadline("");
  }

  function removeSpotlight(id: string) {
    onConfigChange("merchandising", { spotlights: spotlights.filter((s) => s.id !== id) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
          <h2
            className="text-lg font-bold bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--kf-accent2)), hsl(var(--kf-accent1)))" }}
          >
            Merchandising
          </h2>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save All"}
        </button>
      </div>

      <CollapsibleSection
        icon={Star}
        title={`Featured Items (${featuredIds.length}/${MAX_FEATURED})`}
        subtitle="Pin up to 8 key products and services on your storefront"
        accent="hsl(var(--kf-accent2) / 0.15)"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Toggle
              enabled={merchandising.showBestsellers ?? false}
              onToggle={() => onConfigChange("merchandising", { showBestsellers: !(merchandising.showBestsellers ?? false) })}
              label="Bestsellers"
            />
            <Toggle
              enabled={merchandising.showNewArrivals ?? false}
              onToggle={() => onConfigChange("merchandising", { showNewArrivals: !(merchandising.showNewArrivals ?? false) })}
              label="New Arrivals"
            />
            <Toggle
              enabled={merchandising.showLimitedTimeOffers ?? false}
              onToggle={() => onConfigChange("merchandising", { showLimitedTimeOffers: !(merchandising.showLimitedTimeOffers ?? false) })}
              label="Limited Offers"
            />
          </div>
          <Toggle
            enabled={merchandising.highlightHighMargin ?? false}
            onToggle={() => onConfigChange("merchandising", { highlightHighMargin: !(merchandising.highlightHighMargin ?? false) })}
            label="Highlight high-margin items (from Revenue & Expenses data)"
          />

          <div className="border-t border-[hsl(var(--kf-border)/0.3)] pt-3 space-y-2">
            {featuredIds.length === 0 && (
              <div
                className="text-center py-6 rounded-xl"
                style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px dashed hsl(var(--kf-border) / 0.5)" }}
              >
                <Star className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
                <p className="text-xs text-muted-foreground">No featured items yet. Add items to highlight them.</p>
              </div>
            )}

            <AnimatePresence>
              {featuredIds.map((id: string, idx: number) => (
                <motion.div
                  key={id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{
                    background: "hsl(var(--kf-accent2) / 0.06)",
                    border: "1px solid hsl(var(--kf-accent2) / 0.15)",
                  }}
                >
                  <span
                    className="text-[10px] font-bold w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: "hsl(var(--kf-accent2) / 0.15)", color: "hsl(var(--kf-accent2))" }}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium flex-1 truncate">{getItemName(id)}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveFeatured(id, "up")} disabled={idx === 0} className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors disabled:opacity-30">
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => moveFeatured(id, "down")} disabled={idx === featuredIds.length - 1} className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors disabled:opacity-30">
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => removeFeatured(id)} className="p-1 rounded-md hover:bg-red-500/20 transition-colors">
                      <X className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            <div className="relative" ref={addRef}>
              <button
                type="button"
                onClick={() => setAddDropdownOpen(!addDropdownOpen)}
                disabled={featuredIds.length >= MAX_FEATURED}
                className="kf-btn-secondary text-xs inline-flex items-center gap-1.5 w-full justify-center disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                {featuredIds.length >= MAX_FEATURED ? "Maximum Reached" : "Add Featured"}
              </button>
              <AnimatePresence>
                {addDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 right-0 top-full mt-2 rounded-xl overflow-hidden z-50 max-h-60 overflow-y-auto"
                    style={{
                      background: "hsl(var(--kf-background) / 0.95)",
                      backdropFilter: "blur(20px)",
                      border: "1px solid hsl(var(--kf-border))",
                      boxShadow: "0 8px 32px hsl(0 0% 0% / 0.4)",
                    }}
                  >
                    <div className="p-2 sticky top-0" style={{ background: "hsl(var(--kf-background) / 0.95)" }}>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          value={addSearch}
                          onChange={(e) => setAddSearch(e.target.value)}
                          placeholder="Search items..."
                          className="kf-input w-full pl-8 text-xs"
                          autoFocus
                        />
                      </div>
                    </div>
                    {availableToAdd.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No items available</p>
                    ) : (
                      availableToAdd.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => addFeatured(item.id)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors text-left"
                        >
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full uppercase flex-shrink-0 border"
                            style={{
                              borderColor: item.type === "service" ? "hsl(var(--kf-accent1) / 0.3)" : "hsl(var(--kf-accent2) / 0.3)",
                              color: item.type === "service" ? "hsl(var(--kf-accent1) / 0.7)" : "hsl(var(--kf-accent2) / 0.7)",
                            }}
                          >
                            {item.type}
                          </span>
                          <span className="truncate">{item.name}</span>
                        </button>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={LayoutGrid}
        title={`Featured Collections (${collections.length})`}
        subtitle="Group items into themed rails — featured, seasonal, or landing sections"
        accent="hsl(var(--kf-accent1) / 0.15)"
        defaultOpen={false}
      >
        <div className="space-y-4">
          {collections.length === 0 && (
            <div
              className="text-center py-6 rounded-xl"
              style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px dashed hsl(var(--kf-border) / 0.5)" }}
            >
              <LayoutGrid className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
              <p className="text-xs text-muted-foreground">No collections yet. Create one to group items into themed rails.</p>
            </div>
          )}

          {collections.map((col) => (
            <div
              key={col.id}
              className="rounded-xl overflow-hidden"
              style={{ border: "1px solid hsl(var(--kf-accent1) / 0.15)", background: "hsl(var(--kf-accent1) / 0.03)" }}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm font-semibold">{col.name}</span>
                  <span
                    className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                  >
                    {col.railType ?? "featured"}
                  </span>
                  <span className="ml-1 text-[10px] text-muted-foreground">{(col.itemIds ?? []).length} items</span>
                </div>
                <button onClick={() => removeCollection(col.id)} className="p-1 rounded-md hover:bg-red-500/20 transition-colors">
                  <X className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
              <div className="px-4 pb-3 space-y-2">
                {(col.itemIds ?? []).map((itemId) => (
                  <div key={itemId} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex-1 truncate">{getItemName(itemId)}</span>
                    <button onClick={() => removeItemFromCollection(col.id, itemId)} className="hover:text-red-400 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {collectionAddItem === col.id ? (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <input
                        type="text"
                        value={collectionSearch}
                        onChange={(e) => setCollectionSearch(e.target.value)}
                        placeholder="Search items..."
                        className="kf-input w-full pl-7 text-xs"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {allItems
                        .filter((i) => !(col.itemIds ?? []).includes(i.id) && (!collectionSearch.trim() || i.name.toLowerCase().includes(collectionSearch.toLowerCase())))
                        .map((item) => (
                          <button
                            key={item.id}
                            onClick={() => addItemToCollection(col.id, item.id)}
                            className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors"
                          >
                            {item.name}
                          </button>
                        ))}
                    </div>
                    <button onClick={() => { setCollectionAddItem(null); setCollectionSearch(""); }} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setCollectionAddItem(col.id)}
                    className="text-[10px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add item
                  </button>
                )}
              </div>
            </div>
          ))}

          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: "hsl(var(--kf-accent1) / 0.05)", border: "1px dashed hsl(var(--kf-accent1) / 0.2)" }}
          >
            <p className="text-xs font-medium text-muted-foreground">New Collection</p>
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="Collection name (e.g. Summer Picks)"
              className="kf-input w-full text-sm"
            />
            <div className="flex gap-2">
              {RAIL_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewCollectionType(opt.value)}
                  className={`text-[10px] px-2.5 py-1.5 rounded-lg transition-all flex-1 ${newCollectionType === opt.value ? "kf-btn-primary" : "kf-btn-secondary"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={addCollection}
              disabled={!newCollectionName.trim()}
              className="kf-btn-secondary text-xs inline-flex items-center gap-1.5 w-full justify-center disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" /> Create Collection
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={Award}
        title="Item Badges"
        subtitle="Assign badges to highlight products and services"
        accent="hsl(var(--kf-accent1) / 0.15)"
        defaultOpen={false}
      >
        <div className="space-y-1.5">
          {allItems.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No products or services available.</p>
          ) : (
            allItems.map((item) => {
              const currentBadge = badges[item.id] as BadgeType | undefined;
              const badgeCfg = getBadgeConfig(currentBadge);
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
                  style={{
                    background: currentBadge ? "hsl(var(--kf-accent1) / 0.04)" : "hsl(var(--kf-muted) / 0.2)",
                    border: currentBadge ? "1px solid hsl(var(--kf-accent1) / 0.12)" : "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  <span className="text-sm flex-1 truncate">{item.name}</span>
                  {badgeCfg && (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                      style={{ backgroundColor: `${badgeCfg.color}20`, color: badgeCfg.color }}
                    >
                      {(() => { const BIcon = badgeCfg.icon; return <BIcon className="w-2.5 h-2.5" />; })()}
                      {badgeCfg.label}
                    </span>
                  )}
                  <div className="relative" ref={badgeDropdown === item.id ? badgeRef : undefined}>
                    <button
                      type="button"
                      onClick={() => setBadgeDropdown(badgeDropdown === item.id ? null : item.id)}
                      className="kf-btn-secondary text-[10px] px-2 py-1"
                    >
                      {currentBadge ? "Change" : "Assign"}
                      <ChevronDown className="w-3 h-3 ml-1 inline" />
                    </button>
                    <AnimatePresence>
                      {badgeDropdown === item.id && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 top-full mt-1 w-48 rounded-xl overflow-hidden z-50 max-h-64 overflow-y-auto"
                          style={{
                            background: "hsl(var(--kf-background) / 0.95)",
                            backdropFilter: "blur(20px)",
                            border: "1px solid hsl(var(--kf-border))",
                            boxShadow: "0 8px 32px hsl(0 0% 0% / 0.4)",
                          }}
                        >
                          {BADGE_OPTIONS.map((opt) => {
                            const BIcon = opt.icon;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => setBadge(item.id, opt.value)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors text-left"
                                style={{ color: opt.value !== "none" ? opt.color : undefined }}
                              >
                                <BIcon className="w-3.5 h-3.5" />
                                {opt.label}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={Shield}
        title="Trust Rails"
        subtitle="Display trust signals on your storefront to build buyer confidence"
        accent="hsl(142 70% 45% / 0.15)"
        defaultOpen={false}
      >
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Select which trust signals to show on your storefront. Unchecked items are hidden.</p>
          <div className="grid grid-cols-2 gap-2">
            {TRUST_RAIL_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = trustRails.includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleTrustRail(opt.key)}
                  className="flex items-center gap-2.5 px-3 py-3 rounded-xl text-left transition-all"
                  style={{
                    background: active ? "hsl(142 70% 45% / 0.1)" : "hsl(var(--kf-muted) / 0.2)",
                    border: active ? "1px solid hsl(142 70% 45% / 0.3)" : "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: active ? "hsl(142 70% 45% / 0.2)" : "hsl(var(--kf-muted) / 0.3)" }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: active ? "hsl(142 70% 45%)" : "hsl(var(--kf-muted-foreground))" }} />
                  </div>
                  <span className="text-xs font-medium">{opt.label}</span>
                  {active && <CheckCircle2 className="w-3.5 h-3.5 ml-auto flex-shrink-0" style={{ color: "hsl(142 70% 45%)" }} />}
                </button>
              );
            })}
          </div>
          {trustRails.length === 0 && (
            <p className="text-[10px] text-muted-foreground/60 text-center">No trust rails selected — default platform rails will show.</p>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={Boxes}
        title={`Spotlight Blocks (${spotlights.length})`}
        subtitle="Feature individual services or packages in prominent spotlight blocks"
        accent="hsl(263 70% 58% / 0.15)"
        defaultOpen={false}
      >
        <div className="space-y-3">
          {spotlights.length === 0 && (
            <div
              className="text-center py-6 rounded-xl"
              style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px dashed hsl(var(--kf-border) / 0.5)" }}
            >
              <Boxes className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
              <p className="text-xs text-muted-foreground">No spotlight blocks yet. Add one to feature key items prominently.</p>
            </div>
          )}

          {spotlights.map((sp) => {
            const item = allItems.find((i) => i.id === sp.itemId);
            const SpIcon = sp.spotlightType === "service" ? Briefcase : sp.spotlightType === "package" ? Gift : Layers;
            return (
              <div
                key={sp.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: "hsl(263 70% 58% / 0.05)", border: "1px solid hsl(263 70% 58% / 0.15)" }}
              >
                <SpIcon className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(263 70% 58%)" }} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{item?.name ?? sp.itemId}</span>
                  {sp.headline && <span className="text-[10px] text-muted-foreground">{sp.headline}</span>}
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full capitalize"
                    style={{ background: "hsl(263 70% 58% / 0.1)", color: "hsl(263 70% 58%)" }}
                  >
                    {sp.spotlightType}
                  </span>
                </div>
                <button onClick={() => removeSpotlight(sp.id)} className="p-1 rounded-md hover:bg-red-500/20 transition-colors">
                  <X className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            );
          })}

          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: "hsl(263 70% 58% / 0.05)", border: "1px dashed hsl(263 70% 58% / 0.2)" }}
          >
            <p className="text-xs font-medium text-muted-foreground">Add Spotlight Block</p>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Item</label>
              <select
                value={newSpotlightItemId}
                onChange={(e) => setNewSpotlightItemId(e.target.value)}
                className="kf-input w-full text-sm"
              >
                <option value="">Select an item...</option>
                {allItems.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Spotlight Type</label>
              <div className="flex gap-2">
                {[
                  { v: "service", label: "Service", Icon: Briefcase },
                  { v: "package", label: "Package", Icon: Gift },
                  { v: "hybrid", label: "Hybrid Rail", Icon: Layers },
                ].map(({ v, label, Icon }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setNewSpotlightType(v as "service" | "package" | "hybrid")}
                    className={`flex-1 flex items-center justify-center gap-1.5 text-[10px] py-1.5 rounded-lg transition-all ${newSpotlightType === v ? "kf-btn-primary" : "kf-btn-secondary"}`}
                  >
                    <Icon className="w-3 h-3" /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Headline (optional)</label>
              <input
                type="text"
                value={newSpotlightHeadline}
                onChange={(e) => setNewSpotlightHeadline(e.target.value)}
                placeholder="e.g. Most Popular This Month"
                className="kf-input w-full text-sm"
              />
            </div>
            <button
              onClick={addSpotlight}
              disabled={!newSpotlightItemId}
              className="kf-btn-secondary text-xs inline-flex items-center gap-1.5 w-full justify-center disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" /> Add Spotlight
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={Megaphone}
        title="Promotions Banner"
        subtitle="Show a promotional banner on your storefront with scheduling"
        accent="hsl(var(--kf-accent2) / 0.15)"
        defaultOpen={false}
      >
        <div className="space-y-4">
          <Toggle
            enabled={promotions.bannerEnabled ?? false}
            onToggle={() => onConfigChange("promotions", { bannerEnabled: !(promotions.bannerEnabled ?? false) })}
            label="Enable Banner"
          />

          {(promotions.bannerEnabled ?? false) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Quick Templates</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { text: "🎉 Grand Opening Sale — 20% Off Everything!", color: "hsl(45 93% 55%)" },
                    { text: "🔥 Limited Time Offer — Book Now & Save!", color: "hsl(0 72% 51%)" },
                    { text: "✨ New Services Available — Check Them Out!", color: "hsl(263 70% 58%)" },
                    { text: "💚 Free Consultation — Book Your Spot Today!", color: "hsl(160 84% 39%)" },
                  ].map((tpl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onConfigChange("promotions", { bannerText: tpl.text, bannerColor: tpl.color })}
                      className="text-[10px] text-left px-2.5 py-2 rounded-lg transition-all hover:scale-[1.02]"
                      style={{ background: `${tpl.color}12`, border: `1px solid ${tpl.color}25`, color: tpl.color }}
                    >
                      {tpl.text}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Banner Message</label>
                <input
                  type="text"
                  value={promotions.bannerText ?? ""}
                  onChange={(e) => onConfigChange("promotions", { bannerText: e.target.value })}
                  placeholder="🎉 Special offer this week!"
                  className="kf-input w-full text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">CTA Label (optional)</label>
                <input
                  type="text"
                  value={promotions.bannerCta ?? ""}
                  onChange={(e) => onConfigChange("promotions", { bannerCta: e.target.value })}
                  placeholder="e.g. Shop Now, Book Today"
                  className="kf-input w-full text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Banner Color</label>
                <div className="flex gap-2 flex-wrap">
                  {BANNER_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => onConfigChange("promotions", { bannerColor: c.value })}
                      className="w-8 h-8 rounded-lg transition-all flex items-center justify-center"
                      style={{
                        background: c.value,
                        border: (promotions.bannerColor ?? BANNER_COLORS[0].value) === c.value ? "3px solid white" : "2px solid transparent",
                        boxShadow: (promotions.bannerColor ?? BANNER_COLORS[0].value) === c.value ? `0 0 0 2px ${c.value}` : "none",
                      }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {promotions.bannerText && (
                <div
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-center"
                  style={{
                    background: `${promotions.bannerColor ?? BANNER_COLORS[0].value}20`,
                    color: promotions.bannerColor ?? BANNER_COLORS[0].value,
                    border: `1px solid ${promotions.bannerColor ?? BANNER_COLORS[0].value}40`,
                  }}
                >
                  {promotions.bannerText}
                  {promotions.bannerCta && (
                    <span
                      className="ml-3 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: `${promotions.bannerColor ?? BANNER_COLORS[0].value}30` }}
                    >
                      {promotions.bannerCta} →
                    </span>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Link URL (optional)</label>
                <input
                  type="text"
                  value={promotions.bannerLink ?? ""}
                  onChange={(e) => onConfigChange("promotions", { bannerLink: e.target.value })}
                  placeholder="https://example.com/promo"
                  className="kf-input w-full text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Start Date (optional)</label>
                  <input
                    type="datetime-local"
                    value={promotions.bannerStartDate ?? ""}
                    onChange={(e) => onConfigChange("promotions", { bannerStartDate: e.target.value })}
                    className="kf-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">End Date (optional)</label>
                  <input
                    type="datetime-local"
                    value={promotions.bannerExpiry ?? ""}
                    onChange={(e) => onConfigChange("promotions", { bannerExpiry: e.target.value })}
                    className="kf-input w-full text-sm"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
