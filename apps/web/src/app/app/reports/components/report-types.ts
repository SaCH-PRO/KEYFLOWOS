import { Briefcase, Wallet, TrendingUp, PieChart, Users, Calendar, Megaphone, BarChart3 } from "lucide-react";

export type ReportType = "executive" | "pnl" | "revenue" | "revenue-detail" | "cash-flow" | "expenses" | "clients" | "bookings" | "marketing";

export const REPORT_TABS: Array<{ id: ReportType; label: string; icon: React.ElementType; tooltip?: string }> = [
  { id: "executive", label: "Executive Summary", icon: Briefcase, tooltip: "High-level business health snapshot with key KPIs and trends." },
  { id: "pnl", label: "Profit & Loss", icon: Wallet, tooltip: "Income minus expenses — see your net profit over any period." },
  { id: "revenue", label: "Revenue & Collections", icon: TrendingUp, tooltip: "Invoiced vs. collected revenue, aging receivables, and payment velocity." },
  { id: "revenue-detail", label: "Revenue Reports", icon: BarChart3, tooltip: "Detailed revenue analytics: by source, contact, product, conversion, aging, and more." },
  { id: "cash-flow", label: "Cash Flow Forecast", icon: Wallet, tooltip: "Projected cash inflows and outflows based on invoices and recurring expenses." },
  { id: "expenses", label: "Expenses & Profitability", icon: PieChart, tooltip: "Expense breakdown by category with profit margin analysis." },
  { id: "clients", label: "Client Portfolio", icon: Users, tooltip: "Client lifetime value, retention rates, and revenue concentration." },
  { id: "bookings", label: "Bookings Performance", icon: Calendar, tooltip: "Booking volume, utilization rates, and service popularity." },
  { id: "marketing", label: "Marketing ROI", icon: Megaphone, tooltip: "Campaign spend vs. revenue attributed — calculate your marketing return." },
];

export const DATE_PRESETS = [
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
  { label: "This Quarter", value: "this-quarter" },
  { label: "Last Quarter", value: "last-quarter" },
  { label: "This Year", value: "this-year" },
  { label: "Last 90 Days", value: "last-90" },
  { label: "Custom", value: "custom" },
];

export function getDateRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case "this-month":
      return { start: new Date(y, m, 1).toISOString(), end: now.toISOString() };
    case "last-month":
      return { start: new Date(y, m - 1, 1).toISOString(), end: new Date(y, m, 0).toISOString() };
    case "this-quarter": {
      const qStart = Math.floor(m / 3) * 3;
      return { start: new Date(y, qStart, 1).toISOString(), end: now.toISOString() };
    }
    case "last-quarter": {
      const qStart = Math.floor(m / 3) * 3 - 3;
      return { start: new Date(y, qStart, 1).toISOString(), end: new Date(y, qStart + 3, 0).toISOString() };
    }
    case "this-year":
      return { start: new Date(y, 0, 1).toISOString(), end: now.toISOString() };
    case "last-90":
      return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(), end: now.toISOString() };
    default:
      return { start: new Date(y, m, 1).toISOString(), end: now.toISOString() };
  }
}

export function formatCurrency(amount: number, currency = "TTD") {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-TT", { year: "numeric", month: "long", day: "numeric" });
}
