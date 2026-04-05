export type DayHours = { open: string; close: string; closed: boolean };
export type BusinessHours = Record<string, DayHours>;

export type Business = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  logoUrl?: string | null;
  tagline?: string | null;
  description?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  businessHours?: BusinessHours | null;
  storeEnabled?: boolean;
  facebook?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  whatsapp?: string | null;
};

export type Service = {
  id: string;
  name: string;
  duration: number;
  durationMins?: number;
  price: number;
  currency?: string;
  description?: string | null;
};

export type Staff = {
  id: string;
  name: string;
};

export type CommerceProduct = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  category: string;
  duration?: number | null;
  imageUrl?: string | null;
  isActive: boolean;
};

export type CatalogItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  duration?: number | null;
  imageUrl?: string | null;
  itemType: "service" | "product" | "package";
  requiresBooking: boolean;
  sourceServiceId?: string;
};

export type CartItem = CatalogItem & { quantity: number };

export type ServiceBookingData = {
  serviceId: string;
  serviceName: string;
  staffId: string;
  date: string;
  time: string;
};

export type FilterTab = "all" | "service" | "product" | "package";
export type SortOption = "default" | "price_asc" | "price_desc" | "duration";

export type CategoryInfo = {
  key: string;
  label: string;
  count: number;
};
