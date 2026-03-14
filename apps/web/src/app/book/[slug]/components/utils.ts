import type { BusinessHours, CartItem } from "./types";

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function getAvailableSlots(date: string, businessHours?: BusinessHours | null): string[] {
  if (!date) return [];
  const d = new Date(date + "T00:00:00");
  const dayKey = dayKeys[d.getDay()];
  const dayH = businessHours?.[dayKey];
  if (dayH?.closed) return [];
  const open = dayH?.open || "09:00";
  const close = dayH?.close || "17:00";
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  const slots: string[] = [];
  let t = oh * 60 + om;
  const end = ch * 60 + cm;
  while (t < end) {
    const h = Math.floor(t / 60).toString().padStart(2, "0");
    const m = (t % 60).toString().padStart(2, "0");
    slots.push(`${h}:${m}`);
    t += 30;
  }
  return slots;
}

export function isDayClosed(date: string, businessHours?: BusinessHours | null): boolean {
  if (!date || !businessHours) return false;
  const d = new Date(date + "T00:00:00");
  return businessHours[dayKeys[d.getDay()]]?.closed === true;
}

export function loadCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`kf_cart_${slug}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: any) => item && typeof item.id === "string" && typeof item.name === "string");
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

export function typeBadge(itemType: "service" | "product" | "package", primaryColor: string, secondaryColor: string, accentColor?: string) {
  const cfg = {
    service: { label: "Service", icon: "\u{1F6E0}", color: primaryColor },
    product: { label: "Product", icon: "\u{1F4E6}", color: secondaryColor },
    package: { label: "Package", icon: "\u{1F381}", color: accentColor || "#a78bfa" },
  }[itemType];
  return { label: `${cfg.icon} ${cfg.label}`, color: cfg.color };
}
