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
