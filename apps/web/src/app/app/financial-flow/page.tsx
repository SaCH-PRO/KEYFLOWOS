"use client";

import { useEffect, useState, useCallback } from "react";
import { Banknote, Wallet, Receipt, FileText, Landmark, ShieldCheck, Zap, ArrowRight, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { apiGet } from "@/lib/api";

interface FinancialOverview {
  cashBalance: number;
  outstandingInvoices: number;
  overdueInvoices: number;
  billsDue: number;
  taxReserved: number;
  netProfitThisMonth: number;
  currency: string;
}

interface SafeToSpend {
  safeToSpend: number;
  cashBalance: number;
  taxReserved: number;
  billsDueNext30Days: number;
  operatingBuffer: number;
  currency: string;
}

export default function FinancialFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [safe, setSafe] = useState<SafeToSpend | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [ovRes, safeRes] = await Promise.all([
        apiGet<FinancialOverview>(`/finance/businesses/${businessId}/overview`),
        apiGet<SafeToSpend>(`/finance/businesses/${businessId}/safe-to-spend`),
      ]);
      if (ovRes.data) setOverview(ovRes.data);
      if (safeRes.data) setSafe(safeRes.data);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const currency = overview?.currency ?? "TTD";

  const sections = [
    { label: "Money In", href: "/app/commerce", icon: Receipt, desc: "Invoices, quotes, payments" },
    { label: "Money Out", href: "/app/expenses", icon: Wallet, desc: "Expenses, bills, vendors" },
    { label: "Accounts", href: "/app/finance/accounts", icon: Landmark, desc: "Bank, cash, reconciliation" },
    { label: "Reports", href: "/app/finance", icon: FileText, desc: "P&L, balance sheet, tax" },
    { label: "Safe to Spend", href: "#", icon: ShieldCheck, desc: "Know what cash is truly available" },
    { label: "Money Moves", href: "#", icon: Zap, desc: "Actions to improve cashflow" },
  ];

  return (
    <FlowShell
      title="Financial Flow"
      subtitle="Control money. Know what you have, what you owe, and what is safe to spend."
      icon={Banknote}
      activeFlowId="financial"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />)
        ) : (
          <>
            <MetricCard label="Cash Balance" value={`${currency} ${(overview?.cashBalance ?? 0).toLocaleString()}`} icon={Wallet} />
            <MetricCard label="Safe to Spend" value={`${currency} ${(safe?.safeToSpend ?? 0).toLocaleString()}`} icon={ShieldCheck} iconColor="#10b981" />
            <MetricCard label="Overdue" value={`${currency} ${(overview?.overdueInvoices ?? 0).toLocaleString()}`} icon={Receipt} iconColor="#ef4444" />
            <MetricCard label="Net Profit (MTD)" value={`${currency} ${(overview?.netProfitThisMonth ?? 0).toLocaleString()}`} icon={TrendingUp} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((s) => (
          <button
            key={s.label}
            onClick={() => router.push(s.href)}
            className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 kf-radius-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <s.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{s.label}</h3>
                  <p className="kf-text-micro text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </FlowShell>
  );
}
