"use client";

import React, { useMemo } from "react";
import {
  Shield,
  Clock,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Calendar,
  Activity,
} from "lucide-react";
import type { Invoice } from "@/lib/client";
import { formatCurrency } from "@/lib/currency";
import { CustomerBadge } from "./customer-badge";
import type { CustomerBadge as CustomerBadgeType } from "../hooks/use-customer-badge";

interface ContactIntelligenceCardProps {
  contactId: string;
  contactName: string;
  invoices: Invoice[];
  currency: string;
  badge?: CustomerBadgeType | null;
  onViewClientIntel?: (contactId: string) => void;
}

export const ContactIntelligenceCard = React.memo(function ContactIntelligenceCard({
  contactId,
  contactName,
  invoices,
  currency,
  badge,
  onViewClientIntel,
}: ContactIntelligenceCardProps) {
  const intel = useMemo(() => {
    const contactInvoices = invoices.filter((inv) => inv.contactId === contactId);
    const paidInvoices = contactInvoices.filter((inv) => inv.status === "PAID");
    const overdueInvoices = contactInvoices.filter((inv) => inv.status === "OVERDUE");
    const sentInvoices = contactInvoices.filter((inv) => inv.status === "SENT");

    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    const outstandingBalance =
      [...overdueInvoices, ...sentInvoices].reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);

    const paymentRate = contactInvoices.length > 0
      ? Math.round((paidInvoices.length / contactInvoices.length) * 100)
      : 0;

    const recentActivity = contactInvoices
      .sort((a, b) => new Date((b as Record<string, unknown>)["createdAt"] as string ?? 0).getTime() - new Date((a as Record<string, unknown>)["createdAt"] as string ?? 0).getTime())
      .slice(0, 3);

    let followUpCadence = "Monthly";
    if (overdueInvoices.length > 0) followUpCadence = "Weekly";
    else if (outstandingBalance > totalRevenue * 0.3) followUpCadence = "Bi-weekly";
    else if (paymentRate >= 90) followUpCadence = "Quarterly";

    return {
      totalInvoices: contactInvoices.length,
      paidCount: paidInvoices.length,
      overdueCount: overdueInvoices.length,
      totalRevenue,
      outstandingBalance,
      paymentRate,
      followUpCadence,
      recentActivity,
    };
  }, [contactId, invoices]);

  if (intel.totalInvoices === 0) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-white/[0.02] p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Client Intelligence</span>
        </div>
        {badge && <CustomerBadge badge={badge} size="sm" />}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
          <div className="flex items-center gap-1 mb-0.5">
            <Shield className="w-2.5 h-2.5 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">Reliability</span>
          </div>
          <span className={`text-sm font-bold ${intel.paymentRate >= 80 ? "text-emerald-400" : intel.paymentRate >= 50 ? "text-amber-400" : "text-red-400"}`}>
            {intel.paymentRate}%
          </span>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
          <div className="flex items-center gap-1 mb-0.5">
            <DollarSign className="w-2.5 h-2.5 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">Outstanding</span>
          </div>
          <span className={`text-sm font-bold ${intel.outstandingBalance > 0 ? "text-amber-400" : "text-emerald-400"}`}>
            {formatCurrency(intel.outstandingBalance, currency)}
          </span>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
          <div className="flex items-center gap-1 mb-0.5">
            <TrendingUp className="w-2.5 h-2.5 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">Lifetime Value</span>
          </div>
          <span className="text-sm font-bold text-emerald-400">{formatCurrency(intel.totalRevenue, currency)}</span>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
          <div className="flex items-center gap-1 mb-0.5">
            <Calendar className="w-2.5 h-2.5 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">Follow-up</span>
          </div>
          <span className="text-sm font-bold text-[hsl(var(--kf-accent1))]">{intel.followUpCadence}</span>
        </div>
      </div>

      {intel.overdueCount > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/15">
          <AlertTriangle className="w-3 h-3 text-red-400" />
          <span className="text-[10px] text-red-400 font-medium">
            {intel.overdueCount} overdue invoice{intel.overdueCount > 1 ? "s" : ""}
          </span>
        </div>
      )}

      {intel.recentActivity.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider font-medium">Recent Activity</span>
          {intel.recentActivity.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground/60">{inv.invoiceNumber}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/60">{formatCurrency(Number(inv.total), currency)}</span>
                <span className={`font-medium ${
                  inv.status === "PAID" ? "text-emerald-400" :
                  inv.status === "OVERDUE" ? "text-red-400" :
                  "text-blue-400"
                }`}>
                  {inv.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {onViewClientIntel && (
        <button
          onClick={() => onViewClientIntel(contactId)}
          className="w-full text-center text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:underline pt-1"
        >
          View Full Intelligence Report
        </button>
      )}
    </div>
  );
});
