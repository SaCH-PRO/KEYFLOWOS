import { BarChart3, Palette, ShoppingBag, Clock, Settings2 } from "lucide-react";

export type Banner = { text: string; type: "success" | "error" | "info" | "warning" };

export type DriftedItem = {
  serviceId: string;
  serviceName: string;
  priceDiff: boolean;
  durationDiff: boolean;
  commercePrice: number;
  commerceDuration: number | null;
};

export type TabKey = "overview" | "customize" | "products" | "hours" | "settings";

export const VIEW_TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "customize", label: "Customize", icon: Palette },
  { key: "products", label: "Products", icon: ShoppingBag },
  { key: "hours", label: "Hours", icon: Clock },
  { key: "settings", label: "Settings", icon: Settings2 },
];

export type Testimonial = { id: string; name: string; text: string; rating: number; date: string };
