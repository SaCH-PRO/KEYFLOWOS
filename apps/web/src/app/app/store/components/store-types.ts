import { LayoutDashboard, Palette, ShoppingBag, Package, Settings2, Rocket } from "lucide-react";

export type Banner = { text: string; type: "success" | "error" | "info" | "warning" };

export type DriftedItem = {
  serviceId: string;
  serviceName: string;
  priceDiff: boolean;
  durationDiff: boolean;
  commercePrice: number;
  commerceDuration: number | null;
};

export type TabKey = "overview" | "design" | "merchandising" | "catalog" | "operations" | "launch";

export const VIEW_TABS: { key: TabKey; label: string; icon: React.ElementType; tooltip?: string }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, tooltip: "Strategic control center — health scores, KPIs, and quick actions." },
  { key: "design", label: "Design", icon: Palette, tooltip: "Appearance, typography, section layout, and storefront branding." },
  { key: "merchandising", label: "Merch", icon: ShoppingBag, tooltip: "Featured products, social proof, promotions, and SEO." },
  { key: "catalog", label: "Catalog", icon: Package, tooltip: "Manage products and services in your store." },
  { key: "operations", label: "Ops", icon: Settings2, tooltip: "Store status, delivery, business hours, and order fulfillment." },
  { key: "launch", label: "Launch", icon: Rocket, tooltip: "Launch checklist, store URL, QR code, and go-live." },
];

export type Testimonial = { id: string; name: string; text: string; rating: number; date: string };

export const DEFAULT_SECTIONS: import("@/lib/client").StorefrontSection[] = [
  { key: "hero", visible: true, type: "hero", enabled: true },
  { key: "featured", visible: true, type: "featured", enabled: true },
  { key: "categories", visible: true, type: "categories", enabled: true },
  { key: "catalog", visible: true, type: "catalog", enabled: true },
  { key: "testimonials", visible: true, type: "testimonials", enabled: true },
  { key: "faq", visible: false, type: "faq", enabled: false },
  { key: "policies", visible: false, type: "policies", enabled: false },
  { key: "contact", visible: true, type: "contact", enabled: true },
];

export const SECTION_LABELS: Record<import("@/lib/client").StorefrontSectionType, { label: string; description: string }> = {
  hero: { label: "Hero Banner", description: "Store name, tagline, and cover image" },
  featured: { label: "Featured Products", description: "Highlighted items with badges" },
  categories: { label: "Category Navigation", description: "Browse by service type" },
  catalog: { label: "Full Catalog", description: "All products and services" },
  testimonials: { label: "Testimonials", description: "Customer reviews and ratings" },
  faq: { label: "FAQ", description: "Frequently asked questions" },
  policies: { label: "Policies", description: "Refund, privacy, delivery, terms" },
  contact: { label: "Contact", description: "WhatsApp, email, phone" },
  trust: { label: "Trust & Security", description: "Badges, certifications, guarantees" },
};

export const FONT_PAIRINGS: import("@/lib/client").FontPairing[] = [
  { id: "inter-inter", name: "Modern Clean", heading: "Inter", body: "Inter" },
  { id: "playfair-lato", name: "Classic Elegance", heading: "Playfair Display", body: "Lato" },
  { id: "poppins-opensans", name: "Friendly Pro", heading: "Poppins", body: "Open Sans" },
  { id: "montserrat-roboto", name: "Corporate", heading: "Montserrat", body: "Roboto" },
  { id: "dmserif-dmsans", name: "Editorial", heading: "DM Serif Display", body: "DM Sans" },
  { id: "raleway-merriweather", name: "Sophisticated", heading: "Raleway", body: "Merriweather" },
  { id: "spacegrotesk-worksans", name: "Tech Forward", heading: "Space Grotesk", body: "Work Sans" },
  { id: "cormorant-proza", name: "Luxe Serif", heading: "Cormorant Garamond", body: "Proza Libre" },
  { id: "sora-inter", name: "Geometric", heading: "Sora", body: "Inter" },
  { id: "crimsonpro-source", name: "Warm Classic", heading: "Crimson Pro", body: "Source Sans 3" },
];
