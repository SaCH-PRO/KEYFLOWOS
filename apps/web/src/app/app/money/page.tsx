"use client";

/**
 * NAV-A2 (sweep BUG-114; journey H): Money's own page, an index of its entries.
 *
 * It used to re-export finance/page.tsx, which only redirects (and rendered the error page in the sweep's build).
 * /app/finance is itself a next.config redirect (to /app/financial-flow), so Books opens the books' first page, the
 * general ledger. Every entry names its final URL, never a redirect source (as the nav does).
 */
import { Banknote, LayoutDashboard, ArrowDownLeft, Receipt, BarChart3, BookOpen } from "lucide-react";
import { HubIndex, type HubIndexEntry } from "@/components/layout/hub-index";

const ENTRIES: HubIndexEntry[] = [
  { name: "Overview", href: "/app/financial-flow", description: "Cash, what you are owed and what you owe", icon: LayoutDashboard, module: "revenue" },
  { name: "Money in", href: "/app/payments", description: "Payments received, payment links and refunds", icon: ArrowDownLeft, module: "revenue" },
  { name: "Expenses & bills", href: "/app/money/expenses", description: "What you spend and the bills you owe", icon: Receipt, module: "expenses" },
  // The report reads need revenue; D-179 also keeps Reports from a member with no analytics entry (as the nav).
  { name: "Reports", href: "/app/reports", description: "Profit and loss, cash flow and who owes you", icon: BarChart3, module: ["revenue", "analytics"] },
  { name: "Books", href: "/app/finance/ledger", description: "Ledger, journals, tax and closing the month", icon: BookOpen, module: "revenue" },
];

export default function MoneyIndexPage() {
  return <HubIndex title="Money" subtitle="Where your money comes from and where it goes" icon={Banknote} entries={ENTRIES} />;
}
