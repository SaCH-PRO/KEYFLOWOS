export function fmtMoney(value: number | null | undefined, currency: string = "TTD") {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-TT", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

export function statusClass(status: string) {
  if (status === "WON") return "bg-emerald-500/15 text-emerald-500";
  if (status === "LOST") return "bg-red-500/15 text-red-500";
  return "bg-sky-500/15 text-sky-500";
}

export function healthColor(score: number) {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  if (score >= 25) return "bg-orange-500";
  return "bg-red-500";
}

export function healthHexColor(score: number): string {
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#f59e0b";
  if (score >= 25) return "#f97316";
  return "#ef4444";
}

export const DEALS_VIEW_KEY = "kf:crm:deals:view";
export type DealsView = "list" | "board" | "reports" | "account";

export function readStoredView(): DealsView {
  if (typeof window === "undefined") return "list";
  const raw = window.localStorage.getItem(DEALS_VIEW_KEY);
  if (raw === "board" || raw === "reports" || raw === "list" || raw === "account") return raw;
  return "list";
}

export function persistView(v: DealsView) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DEALS_VIEW_KEY, v); } catch { /* ignore */ }
}
