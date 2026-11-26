import { apiGet } from "@/lib/api";
import { isClosedOnDate } from "./store-hours";
import type { BusinessHours, CartItem, PromoCode } from "./types";

/**
 * SWP-BOOKING-SLOTS (BUG-122): the times a customer can book a service on a day, as HH:MM on the business's own
 * clock (Business.timezone; the visitor's when the business has none), read from the server's public slots route.
 * That route puts every candidate through the guard the booking write paths use (existing bookings, buffer, lead
 * time, business and staff hours, the appointment ending by closing), so the picker offers only what Place Order
 * accepts. null when the route cannot be read, answers something else, or the zone is unknown: no local guess knows
 * the bookings, so nothing is offered then.
 */
export async function fetchAvailableSlots(params: SlotQuery): Promise<string[] | null> {
  const slots = await fetchAvailableSlotTimes(params);
  return slots ? slots.map((s) => s.time) : null;
}

/** The query fetchAvailableSlots and fetchAvailableSlotTimes ask the public slots route. */
export type SlotQuery = {
  businessId: string;
  serviceId: string;
  date: string;
  staffId?: string;
  timeZone?: string | null;
  signal?: AbortSignal;
};

/** A time the picker offers: HH:MM on the business's clock and the exact instant the server offered for it. */
export type SlotTime = { time: string; startIso: string };

/**
 * fetchAvailableSlots, with each time's instant: the booking posts that instant as is, so a visitor on another
 * clock books exactly the slot offered. Where one wall time is offered twice (the hour repeated when clocks go
 * back), the first instant is kept.
 */
export async function fetchAvailableSlotTimes(params: SlotQuery): Promise<SlotTime[] | null> {
  const { businessId, serviceId, date, staffId, timeZone, signal } = params;
  if (!businessId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return null;
  const query = new URLSearchParams({ serviceId, date });
  if (staffId) query.set("staffId", staffId);
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", { timeZone: timeZone || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    return null;
  }
  try {
    const res = await apiGet<{ date?: string; slots?: unknown }>(
      `/bookings/public/businesses/${encodeURIComponent(businessId)}/slots?${query.toString()}`,
      signal ? { signal } : undefined,
    );
    const slots = res?.data?.slots;
    if (res?.error || !Array.isArray(slots)) return null;
    const shown: SlotTime[] = [];
    for (const s of slots) {
      const at = typeof s === "string" ? new Date(s) : null;
      if (!at || Number.isNaN(at.getTime())) return null;
      const parts = format.formatToParts(at);
      const hh = String(Number(parts.find((p) => p.type === "hour")?.value) % 24).padStart(2, "0");
      const mm = parts.find((p) => p.type === "minute")?.value ?? "";
      const text = `${hh}:${mm}`;
      if (!/^\d{2}:\d{2}$/.test(text)) return null;
      if (!shown.some((t) => t.time === text)) shown.push({ time: text, startIso: at.toISOString() });
    }
    return shown.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  } catch {
    return null;
  }
}

export function isDayClosed(date: string, businessHours?: BusinessHours | null): boolean {
  return isClosedOnDate(businessHours, date);
}

export function loadCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`kf_cart_${slug}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: unknown) => {

      const obj = item as Record<string, unknown>;
      return obj && typeof obj.id === "string" && typeof obj.name === "string";
    });
  } catch {
    return [];
  }
}

export function saveCart(slug: string, cart: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`kf_cart_${slug}`, JSON.stringify(cart));
  } catch {}
}

export function loadPromoCode(slug: string): PromoCode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`kf_promo_${slug}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function savePromoCode(slug: string, promo: PromoCode | null) {
  if (typeof window === "undefined") return;
  try {
    if (promo) {
      localStorage.setItem(`kf_promo_${slug}`, JSON.stringify(promo));
    } else {
      localStorage.removeItem(`kf_promo_${slug}`);
    }
  } catch {}
}

export function loadCheckoutDetails(): { firstName: string; lastName: string; email: string; phone: string } {
  if (typeof window === "undefined") return { firstName: "", lastName: "", email: "", phone: "" };
  try {
    const s = localStorage.getItem("kf_checkout_details");
    return s ? JSON.parse(s) : { firstName: "", lastName: "", email: "", phone: "" };
  } catch {
    return { firstName: "", lastName: "", email: "", phone: "" };
  }
}

export function saveCheckoutDetails(details: { firstName: string; lastName: string; email: string; phone: string }) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("kf_checkout_details", JSON.stringify(details));
  } catch {}
}

export function calculateDiscount(subtotal: number, promo: PromoCode | null): number {
  if (!promo) return 0;
  if (promo.minimumOrder && subtotal < promo.minimumOrder) return 0;
  if (promo.discountType === "percentage") {
    return Math.round(subtotal * (promo.discountValue / 100) * 100) / 100;
  }
  return Math.min(promo.discountValue, subtotal);
}

export function typeBadge(itemType: "service" | "product" | "package", primaryColor: string, secondaryColor: string, accentColor?: string) {
  const cfg = {
    service: { label: "Service", icon: "\u{1F6E0}", color: primaryColor },
    product: { label: "Product", icon: "\u{1F4E6}", color: secondaryColor },
    package: { label: "Package", icon: "\u{1F381}", color: accentColor || "#a78bfa" },
  }[itemType];
  return { label: `${cfg.icon} ${cfg.label}`, color: cfg.color };
}
