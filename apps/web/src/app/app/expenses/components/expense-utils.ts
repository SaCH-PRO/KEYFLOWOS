"use client";

import {
  CreditCard, Wallet, Building2, FileText, DollarSign,
} from "lucide-react";

export const CATEGORY_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e",
  "#eab308", "#ec4899", "#6366f1", "#14b8a6", "#f43f5e",
];

export const PERIODS = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "ytd", label: "Year to Date" },
  { value: "12m", label: "12 Months" },
];

export const PAYMENT_ICONS: Record<string, typeof CreditCard> = {
  cash: Wallet, card: CreditCard, bank_transfer: Building2, linx: CreditCard,
  mobile_money: Wallet, cheque: FileText, other: DollarSign, unspecified: DollarSign,
};

export function formatCurrency(amount: number): string {
  return `TTD $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
