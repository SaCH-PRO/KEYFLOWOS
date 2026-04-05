import { Store, ShoppingBag, BarChart3 } from "lucide-react";

export type Banner = { text: string; type: "success" | "error" | "info" | "warning" };

export type DriftedItem = {
  serviceId: string;
  serviceName: string;
  priceDiff: boolean;
  durationDiff: boolean;
  commercePrice: number;
  commerceDuration: number | null;
};

export type TabKey = "storefront" | "products" | "performance";

export const VIEW_TABS: { key: TabKey; label: string; icon: React.ElementType; tooltip?: string }[] = [
  { key: "storefront", label: "Storefront", icon: Store, tooltip: "Configure your public online store page — branding, layout, and share link." },
  { key: "products", label: "Products & Hours", icon: ShoppingBag, tooltip: "Manage which products and services appear on your storefront and set hours." },
  { key: "performance", label: "Performance", icon: BarChart3, tooltip: "Store traffic, conversion rates, and top-selling products." },
];

export type Testimonial = { id: string; name: string; text: string; rating: number; date: string };

export const DEFAULT_SECTIONS: import("@/lib/client").StorefrontSection[] = [
  { type: "hero", enabled: true },
  { type: "featured", enabled: true },
  { type: "categories", enabled: true },
  { type: "catalog", enabled: true },
  { type: "testimonials", enabled: true },
  { type: "faq", enabled: false },
  { type: "policies", enabled: false },
  { type: "contact", enabled: true },
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
