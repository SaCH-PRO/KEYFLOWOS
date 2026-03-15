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

export const VIEW_TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "storefront", label: "Storefront", icon: Store },
  { key: "products", label: "Products & Hours", icon: ShoppingBag },
  { key: "performance", label: "Performance", icon: BarChart3 },
];

export type Testimonial = { id: string; name: string; text: string; rating: number; date: string };
