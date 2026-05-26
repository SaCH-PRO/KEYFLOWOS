"use client";

import { TrendingDown, Zap, AlertTriangle, Banknote, TrendingUp, CreditCard, FileText, Calculator, BarChart3 } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { useMoneyHub } from "./hooks/use-money-hub";
import { MoneyCashHero } from "./components/money-cash-hero";
import { MoneyFlowBar } from "./components/money-flow-bar";
import { MoneyActionCards } from "./components/money-action-cards";
import { MoneyActivityFeed } from "./components/money-activity-feed";
import { PipelinePreview } from "./components/pipeline-preview";
import { FinanceIntelPanel } from "../finance/_intel-panel";
import { ModuleSnapshotCards } from "./components/module-snapshot-cards";
import { formatCurrency } from "@/lib/currency";

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-7 h-7 rounded-lg bg-muted/30 flex items-center justify-center">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <h2 className="text-sm font-semibold text-foreground/90">{title}</h2>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 sm:p-6 h-32">
      <div className="h-3 w-24 rounded bg-muted animate-pulse mb-3" />
      <div className="h-10 w-48 rounded bg-muted animate-pulse mb-2" />
      <div className="h-3 w-32 rounded bg-muted animate-pulse" />
    </div>
  );
}

function FlowSkeleton() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 h-24">
      <div className="h-3 w-20 rounded bg-muted animate-pulse mb-3" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 w-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/60 bg-card p-4 h-28 space-y-2">
          <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
          <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          <div className="h-3 w-32 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card">
      <div className="px-4 py-3 border-b border-border/40">
        <div className="h-3 w-24 rounded bg-muted animate-pulse" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
            <div className="h-2 w-24 rounded bg-muted animate-pulse" />
          </div>
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export default function MoneyPage() {
  const { data, loading, error, reload, businessId } = useMoneyHub();
  const currency = data.overview?.currency ?? "TTD";

  if (error) {
    return (
      <WorkspaceShell icon={Banknote} title="Money" subtitle="Cash, revenue, expenses — one view.">
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button
            onClick={reload}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
          >
            Retry
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={Banknote} title="Money" subtitle="Cash, revenue, expenses — one view.">
      <div className="space-y-5">
        {/* Module Snapshots — Revenue / Expenses / Books */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/60 bg-card p-4 h-36">
                <div className="h-3 w-20 rounded bg-muted animate-pulse mb-3" />
                <div className="h-8 w-32 rounded bg-muted animate-pulse mb-2" />
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <ModuleSnapshotCards
            overview={data.overview}
            expenseSummary={data.expenseSummary}
            revenueOverview={data.revenueOverview}
            currency={currency}
          />
        )}

        {/* Cash Hero */}
        {loading ? <HeroSkeleton /> : <MoneyCashHero overview={data.overview} currency={currency} />}

        {/* KPI Row — finance overview metrics not in the hero */}
        {!loading && data.overview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="Net profit (MTD)" value={formatCurrency(data.overview.netProfitThisMonth, currency)} icon={BarChart3} accent={data.overview.netProfitThisMonth >= 0 ? "emerald" : "rose"} />
            <Kpi label="Owed to you" value={formatCurrency(data.overview.outstandingInvoices, currency)} sub={`${data.overview.outstandingInvoiceCount} invoice${data.overview.outstandingInvoiceCount === 1 ? "" : "s"}`} icon={CreditCard} accent="amber" />
            <Kpi label="Bills due" value={formatCurrency(data.overview.billsDue, currency)} sub={`${data.overview.billsDueCount} recurring`} icon={FileText} accent="rose" />
            <Kpi label="Tax reserved" value={formatCurrency(data.overview.taxReserved, currency)} icon={Calculator} accent="indigo" />
          </div>
        )}

        {/* Money Flow */}
        {loading ? (
          <FlowSkeleton />
        ) : (
          <MoneyFlowBar
            quotes={data.quotes}
            invoices={data.invoices}
            expenses={data.expenses}
            expenseSummary={data.expenseSummary}
            overview={data.overview}
            revenueOverview={data.revenueOverview}
            currency={currency}
          />
        )}

        {/* Action Cards */}
        {loading ? (
          <CardsSkeleton />
        ) : (
          <>
            <SectionTitle icon={Zap} title="Actions" />
            <MoneyActionCards
              overview={data.overview}
              invoices={data.invoices}
              quotes={data.quotes}
              businessId={businessId}
              currency={currency}
            />
          </>
        )}

        {/* Needs Attention — finance intelligence panel */}
        {!loading && businessId && (
          <>
            <SectionTitle icon={AlertTriangle} title="Needs Attention" />
            <FinanceIntelPanel businessId={businessId} currency={currency} compact />
          </>
        )}

        {/* Pipeline Preview */}
        {loading ? (
          <FeedSkeleton />
        ) : (
          <>
            <SectionTitle icon={TrendingUp} title="Pipeline" />
            <PipelinePreview
              invoices={data.invoices}
              quotes={data.quotes}
              currency={currency}
            />
          </>
        )}

        {/* Activity Feed */}
        {loading ? (
          <FeedSkeleton />
        ) : (
          <>
            <SectionTitle icon={TrendingDown} title="Activity" />
            <MoneyActivityFeed
              invoices={data.invoices}
              quotes={data.quotes}
              expenses={data.expenses}
              currency={currency}
            />
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

function Kpi({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon: React.ElementType; accent: "emerald" | "rose" | "amber" | "indigo" }) {
  const accentBg: Record<string, string> = {
    emerald: "hsl(142 76% 45% / 0.1)",
    rose: "hsl(0 75% 60% / 0.1)",
    amber: "hsl(38 92% 50% / 0.1)",
    indigo: "hsl(238 75% 65% / 0.1)",
  };
  const accentFg: Record<string, string> = {
    emerald: "hsl(142 76% 36%)",
    rose: "hsl(0 75% 50%)",
    amber: "hsl(38 92% 40%)",
    indigo: "hsl(238 75% 55%)",
  };
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
        <span className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: accentBg[accent] }}>
          <Icon className="w-3 h-3" style={{ color: accentFg[accent] }} />
        </span>
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
