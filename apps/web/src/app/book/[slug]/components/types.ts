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
  refundPolicy?: string | null;
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

export type PromoCode = {
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minimumOrder?: number;
  description?: string;
};

export type DeliveryAddress = {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type PaymentMethod = "wipay" | "paypal" | "cash";

export type CheckoutCustomerInfo = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type OrderSummary = {
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  total: number;
};

export type ShippingZone = {
  id: string;
  name: string;
  countries: string[];
  regions: string[];
  baseFee: number;
  freeAbove: number | null;
  currency: string;
  estimatedDays: number | null;
  carrier: string | null;
};

export type StoreOrderResponse = {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    subtotal: number;
    shippingFee: number;
    taxAmount: number;
    discountAmount: number;
    total: number;
    currency: string;
    items: { name: string; quantity: number; unitPrice: number; total: number }[];
  };
  payment: {
    paymentId?: string;
    redirectUrl?: string;
    status: string;
  } | null;
};

export type FilterTab = "all" | "service" | "product" | "package";
export type SortOption = "default" | "price_asc" | "price_desc" | "duration" | "highest_rated";

export type CategoryInfo = {
  key: string;
  label: string;
  count: number;
};

export type ReviewAggregate = {
  averageRating: number;
  reviewCount: number;
};
