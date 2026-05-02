"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigationContext } from "@/lib/navigation-context";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import {
  CreditCard,
  FileText,
  DollarSign,
  RefreshCw,
  Plus,
  BookOpen,
  Clock,
  AlertTriangle,
  Settings,
  ArrowRight,
  Package,
  Briefcase,
  Zap,
  TrendingUp,
  CheckCircle2,
  Layers,
  Receipt,
  Shield,
  Palette,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import type { InvoiceLineItem } from "./components/commerce-types";
import { useCommerceShell } from "./hooks/use-commerce-shell";
import { useBillingWorkspace } from "./hooks/use-billing-workspace";
import { useCommerceOverview } from "./hooks/use-commerce-overview";
import { useCommerceCopilot } from "./hooks/use-commerce-copilot";
import { useCommerceComposer } from "./hooks/use-commerce-composer";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { SearchableHelpDrawer } from "./components/contextual-onboarding";
import { ProgressivePrompts } from "../profile/components/progressive-prompts";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { RichTooltip } from "@/components/ui/rich-tooltip";
import { COMMERCE_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit, useModuleEvent } from "@/hooks/use-module-events";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrencyCompact } from "@/lib/currency";
import { usePlan } from "@/hooks/use-plan";
import { PlanLimitBanner } from "@/components/ui/upgrade-prompt";
import { GraphInsightsPanel } from "@/components/ai/graph-insights-panel";
import { AutomationCoverageIndicator } from "@/components/ai/automation-coverage-indicator";
import { useGraphIntelligence } from "@/hooks/use-graph-intelligence";
import InvoicesPanel from "./invoices/invoices-panel";
import QuotesPanel from "./quotes/quotes-panel";
import RecurringPanel from "./recurring/recurring-panel";
import PaymentsTab from "./payments/payments-tab";
import { ProductsPanel } from "./products/products-panel";
import { useProducts } from "./hooks/use-products";
import { RevenueSetupDrawer } from "./components/revenue-setup-drawer";

type RevenueMode = "operations" | "catalog" | "setup";

const MODE_TABS: { key: RevenueMode; label: string; icon: React.ElementType }[] = [
  { key: "operations", label: "Operations", icon: Zap },
  { key: "catalog", label: "Catalog", icon: Package },
  { key: "setup", label: "Setup", icon: Settings },
];

const OPS_SECTIONS: { key: string; label: string; icon: React.ElementType }[] = [
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "quotes", label: "Quotes", icon: CreditCard },
  { key: "payments", label: "Payments", icon: DollarSign },
  { key: "recurring", label: "Recurring", icon: RefreshCw },
];

export default function CommercePage() {
  const { getOriginContext } = useNavigationContext();
  const { getReturnLabel, navigateBack } = useReturnNavigation({ skipScrollListener: true });
  const shell = useCommerceShell();
  const billing = useBillingWorkspace();
  const { checkLimit } = usePlan();
  const intelligence = useGraphIntelligence({ businessId: shell.businessId, module: "revenue" });
  const overview = useCommerceOverview(shell.invoices, shell.businessCurrency);
  const composer = useCommerceComposer({
    tab: overview.tab,
    setTab: overview.setTab,
    setTriggerNewQuote: billing.setTriggerNewQuote,
    setTriggerNewInvoice: billing.setTriggerNewInvoice,
    setTriggerNewSchedule: billing.setTriggerNewSchedule,
  });
  const copilot = useCommerceCopilot({
    businessId: shell.businessId,
    tab: overview.tab,
    invoiceCount: shell.invoices.length,
    quoteCount: shell.quotes.length,
    handleTabChange: overview.handleTabChange,
    prefillForContact: billing.prefillForContact,
  });

  const productActions = useProducts(shell.businessId, shell.setProducts, shell.cachedImages, shell.setCachedImages);

  const _emitEvent = useModuleEmit();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [helpOpen, setHelpOpen] = useState(false);
  const [mode, setMode] = useState<RevenueMode>("operations");
  const [opsSection, setOpsSection] = useState<string>("invoices");
  const [setupDrawer, setSetupDrawer] = useState<"billing" | "payments" | "branding" | null>(null);


  const { tab } = overview;
  const { commerceAi } = copilot;
  const { businessId, businessCurrency } = shell;
  const { invoices, quotes } = shell;

  const handleCommerceAiAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.replace("switch_tab:", "");
      if (["operations", "catalog", "setup"].includes(t)) {
        setMode(t as RevenueMode);
      } else if (["invoices", "quotes", "payments", "recurring"].includes(t)) {
        setMode("operations");
        setOpsSection(t);
        overview.handleTabChange(t);
      }
    } else if (actionKey === "filter_status:overdue") {
      setMode("operations");
      setOpsSection("invoices");
      overview.handleTabChange("invoices");
    } else if (actionKey.startsWith("filter_status:")) {
      setMode("operations");
      setOpsSection("invoices");
      overview.handleTabChange("invoices");
    } else if (actionKey.startsWith("send_reminders:")) {
      setMode("operations");
      setOpsSection("invoices");
      overview.handleTabChange("invoices");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to overview.handleTabChange; including the full `overview` bag would re-create this AI action handler on every overview state change.
  }, [overview.handleTabChange]);

  useEffect(() => {
    const paramTab = searchParams.get("tab");
    if (paramTab === "products") {
      setMode("catalog");
    } else if (paramTab && ["invoices", "quotes", "payments", "recurring"].includes(paramTab)) {
      setMode("operations");
      setOpsSection(paramTab);
      overview.handleTabChange(paramTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount-time read of the URL `tab` param to seed mode/section. Re-firing on `searchParams`/`overview` changes would fight the user's in-app navigation by snapping back to the URL.
  }, []);

  const handleTabChange = useCallback((t: string) => {
    if (["invoices", "quotes", "payments", "recurring"].includes(t)) {
      setMode("operations");
    }
    overview.handleTabChange(t);
    setOpsSection(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to overview.handleTabChange; including the full `overview` bag would re-create this tab-change callback on every overview state change and break memoized children.
  }, [overview.handleTabChange]);

  useModuleEvent<{ contactId?: string; items?: InvoiceLineItem[] }>("commerce:create_quote_for_contact", useCallback((event) => {
    const { contactId, items } = event.data ?? {};
    if (contactId) {
      billing.prefillForContact(contactId, "quotes", items);
      setMode("operations");
      handleTabChange("quotes");
      toast.success("Opening quote builder for contact...");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to billing.prefillForContact; including the full `billing` bag would re-bind this event listener on every billing state change.
  }, [billing.prefillForContact, handleTabChange]));

  useModuleEvent<{ contactId?: string; items?: InvoiceLineItem[] }>("commerce:create_invoice_for_contact", useCallback((event) => {
    const { contactId, items } = event.data ?? {};
    if (contactId) {
      billing.prefillForContact(contactId, "invoices", items);
      setMode("operations");
      handleTabChange("invoices");
      toast.success("Opening invoice builder for contact...");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to billing.prefillForContact; including the full `billing` bag would re-bind this event listener on every billing state change.
  }, [billing.prefillForContact, handleTabChange]));

  useEffect(() => {
    if (billing.pendingPrefill?.targetSegment) {
      const target = billing.pendingPrefill.targetSegment === "quotes" ? "quotes" : "invoices";
      setMode("operations");
      if (tab !== target) handleTabChange(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when a new prefill arrives; including `tab`/`handleTabChange` would refire when the user navigates away from the prefilled segment.
  }, [billing.pendingPrefill]);

  useEffect(() => {
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: tab,
        itemCount: invoices.length + quotes.length,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'commerceAi' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [businessId, tab, invoices.length, quotes.length, commerceAi.updateCommerceContext]);


  const financialSummary = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    let outstanding = 0;
    let overdue = 0;
    let collectedThisMonth = 0;
    let draftCount = 0;
    let draftValue = 0;
    let pendingQuotes = 0;
    let pendingQuoteValue = 0;

    for (const inv of invoices) {
      const amount = Number(inv.total ?? 0);
      if (inv.status === "PAID") {
        const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
        if (paidDate && paidDate.getMonth() === thisMonth && paidDate.getFullYear() === thisYear) {
          collectedThisMonth += amount;
        }
      } else if (inv.status === "OVERDUE") {
        outstanding += amount;
        overdue += amount;
      } else if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") {
        outstanding += amount;
        if (inv.dueDate && new Date(inv.dueDate) < now) {
          overdue += amount;
        }
      } else if (inv.status === "DRAFT") {
        outstanding += amount;
        draftCount++;
        draftValue += amount;
      }
    }

    for (const q of quotes) {
      if (q.status === "SENT" || q.status === "DRAFT") {
        pendingQuotes++;
        pendingQuoteValue += Number(q.total ?? 0);
      }
    }

    return { outstanding, overdue, collectedThisMonth, draftCount, draftValue, pendingQuotes, pendingQuoteValue };
  }, [invoices, quotes]);

  const actionQueue = useMemo(() => {
    const actions: { id: string; icon: React.ElementType; label: string; amount?: string; urgency: "high" | "medium" | "low"; cta: string; ctaAction: () => void }[] = [];
    const now = new Date();

    const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE" || (inv.status === "SENT" && inv.dueDate && new Date(inv.dueDate) < now));
    if (overdueInvoices.length > 0) {
      const total = overdueInvoices.reduce((s, inv) => s + Number(inv.total ?? 0), 0);
      actions.push({
        id: "overdue",
        icon: AlertTriangle,
        label: `${overdueInvoices.length} overdue invoice${overdueInvoices.length !== 1 ? "s" : ""}`,
        amount: formatCurrencyCompact(total, businessCurrency),
        urgency: "high",
        cta: "View overdue",
        ctaAction: () => { setMode("operations"); handleTabChange("invoices"); },
      });
    }

    const draftInvoices = invoices.filter((inv) => inv.status === "DRAFT");
    if (draftInvoices.length > 0) {
      actions.push({
        id: "drafts",
        icon: FileText,
        label: `${draftInvoices.length} draft invoice${draftInvoices.length !== 1 ? "s" : ""} unsent`,
        amount: formatCurrencyCompact(draftInvoices.reduce((s, inv) => s + Number(inv.total ?? 0), 0), businessCurrency),
        urgency: "medium",
        cta: "Send invoices",
        ctaAction: () => { setMode("operations"); handleTabChange("invoices"); },
      });
    }

    const pendingQuotesList = quotes.filter((q) => q.status === "SENT");
    if (pendingQuotesList.length > 0) {
      actions.push({
        id: "pending-quotes",
        icon: CreditCard,
        label: `${pendingQuotesList.length} quote${pendingQuotesList.length !== 1 ? "s" : ""} awaiting response`,
        amount: formatCurrencyCompact(pendingQuotesList.reduce((s, q) => s + Number(q.total ?? 0), 0), businessCurrency),
        urgency: "medium",
        cta: "Follow up",
        ctaAction: () => { setMode("operations"); handleTabChange("quotes"); },
      });
    }

    const sentInvoices = invoices.filter((inv) => inv.status === "SENT");
    if (sentInvoices.length > 0) {
      const total = sentInvoices.reduce((s, inv) => s + Number(inv.total ?? 0), 0);
      actions.push({
        id: "pending",
        icon: Clock,
        label: `${formatCurrencyCompact(total, businessCurrency)} pending from ${sentInvoices.length} invoice${sentInvoices.length !== 1 ? "s" : ""}`,
        urgency: "low",
        cta: "View pending",
        ctaAction: () => { setMode("operations"); handleTabChange("payments"); },
      });
    }

    return actions;
  }, [invoices, quotes, businessCurrency, handleTabChange]);

  const commerceShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Revenue Navigation",
      shortcuts: [
        { key: "n", description: "New item", action: () => composer.handleNewItem() },
        { key: "1", description: "Operations", action: () => setMode("operations") },
        { key: "2", description: "Catalog", action: () => setMode("catalog") },
        { key: "3", description: "Setup", action: () => setMode("setup") },
        { key: "r", description: "Refresh data", action: () => { shell.refreshProducts(); } },
        { key: "?", description: "Help", action: () => setHelpOpen(true) },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to the specific methods used; including the full `composer`/`shell` bags would re-create shortcuts on every commerce state change and re-bind keyboard handlers.
  ], [composer.handleNewItem, shell.refreshProducts]);

  useKeyboardShortcuts(commerceShortcuts, !shell.workspaceLoading);

  const renderTimelineBadge = useCallback((item: { contactId?: string | null }) => {
    if (!item.contactId) return null;
    return null;
  }, []);


  const setupReadiness = useMemo(() => {
    const items = [
      { label: "Payment gateway", ok: false, href: "/app/settings/business?tab=payments" },
      { label: "Tax configuration", ok: false, href: "/app/settings/business?tab=billing" },
      { label: "Invoice branding", ok: false, href: "/app/settings/business?tab=branding" },
      { label: "Products configured", ok: shell.products.length > 0, href: undefined },
    ];
    return items;
  }, [shell.products.length]);

  const setupReadyCount = setupReadiness.filter((i) => i.ok).length;

  const toggleOpsSection = useCallback((key: string) => {
    setOpsSection(key);
    overview.handleTabChange(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to overview.handleTabChange; including the full `overview` bag would re-create this callback on every overview state change.
  }, [overview.handleTabChange]);

  const handleResumeCommerceTask = useCallback((task: import("@/lib/resume-task-registry").InterruptedTask) => {
    const isQuote = task.taskIntent?.includes("quote") || task.route?.includes("tab=quotes");
    if (isQuote) {
      setMode("operations");
      handleTabChange("quotes");
      billing.setTriggerNewQuote((n: number) => n + 1);
    } else {
      setMode("operations");
      handleTabChange("invoices");
      billing.setTriggerNewInvoice((n: number) => n + 1);
    }
  }, [handleTabChange, billing]);

  if (shell.workspaceLoading) return <ListPageSkeleton />;

  if (shell.workspaceError) {
    return <WorkspaceError />;
  }

  const originContext = getOriginContext();
  const showCrossModuleBanner = originContext && originContext.workspace && originContext.workspace !== "Revenue" && billing.pendingPrefill?.contactId;

  return (
    <WorkspaceShell
      icon={TrendingUp}
      title="Revenue"
      subtitle="Invoices, quotes, payments, collections, and billing operations"
      tabs={MODE_TABS}
      activeTab={mode}
      onTabChange={(key) => setMode(key as RevenueMode)}
      tabLayoutId="commerce-mode-tabs"
      ai={{ hook: commerceAi.aiHook, moduleName: "Revenue", onAction: handleCommerceAiAction }}
      actionLabel="+ New"
      actionIcon={Plus}
      onAction={composer.handleNewItem}
      actionDataAttr="commerce-new"
      headerRight={
        <div className="flex items-center gap-2">
          <PageGuideTrigger moduleKey="commerce" />
          <RichTooltip title="Revenue Pulse" description="Total payments collected this month across all invoices." side="bottom">
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 kf-radius-md cursor-help kf-text-body"
              style={{ border: "1px solid hsl(var(--kf-border) / 0.5)", background: "hsl(var(--kf-muted) / 0.12)" }}
            >
              <DollarSign className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <span className="font-semibold kf-text-caption" style={{ color: "hsl(var(--kf-success))" }}>{overview.revenuePulse}</span>
              <span className="kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>collected</span>
            </div>
          </RichTooltip>
          <div className="flex items-center gap-0.5">
            <RichTooltip title="Help" description="Revenue workspace guide" shortcut="?">
              <button
                onClick={() => setHelpOpen(true)}
                className="min-w-[44px] min-h-[44px] kf-radius-md flex items-center justify-center transition-colors"
                style={{ color: "hsl(var(--kf-muted-foreground))" }}
                aria-label="Help"
                title="Help (?)"
                data-walkthrough="commerce-help"
              >
                <BookOpen className="w-4 h-4 text-muted-foreground/60" />
              </button>
            </RichTooltip>
          </div>
        </div>
      }
      banners={
        <>
          <ResumePrompt module="commerce" onResume={handleResumeCommerceTask} />
          {showCrossModuleBanner && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
              <button
                onClick={() => navigateBack()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
                title={getReturnLabel()}
              >
                <ArrowRight className="w-3.5 h-3.5 rotate-180 group-hover:-translate-x-0.5 transition-transform" />
                <span className="max-w-[180px] truncate hidden sm:inline">{getReturnLabel()}</span>
              </button>
              <div className="w-px h-4 bg-border/60 shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">
                {billing.pendingPrefill?.targetSegment === "quotes" ? "Creating quote" : "Creating invoice"} for client from {originContext!.workspace}
              </span>
            </div>
          )}
          {(() => {
            const il = checkLimit("invoices");
            return <PlanLimitBanner resourceKey="invoices" label="invoices" currentUsage={il.current} limit={il.limit} isUnlimited={il.isUnlimited} nearLimit={il.nearLimit} atLimit={il.atLimit} upgradeTo={il.upgradeTo} />;
          })()}
          {shell.error && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
              <span className="text-amber-400">!</span> {shell.error}
            </div>
          )}
        </>
      }
      metricStrip={
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-walkthrough="commerce-kpi">
        {[
          { label: "Outstanding", value: formatCurrencyCompact(financialSummary.outstanding, businessCurrency), color: "text-amber-400", bg: "bg-amber-500/10", icon: Clock },
          { label: "Overdue", value: formatCurrencyCompact(financialSummary.overdue, businessCurrency), color: financialSummary.overdue > 0 ? "text-red-400" : "text-muted-foreground/50", bg: financialSummary.overdue > 0 ? "bg-red-500/10" : "bg-muted/10", icon: AlertTriangle },
          { label: "Collected", value: formatCurrencyCompact(financialSummary.collectedThisMonth, businessCurrency), color: "text-emerald-400", bg: "bg-emerald-500/10", icon: DollarSign, sub: "this month" },
          { label: "Drafts", value: String(financialSummary.draftCount), color: financialSummary.draftCount > 0 ? "text-amber-300" : "text-muted-foreground/50", bg: "bg-muted/10", icon: FileText },
          { label: "Quotes Pending", value: String(financialSummary.pendingQuotes), color: financialSummary.pendingQuotes > 0 ? "text-blue-400" : "text-muted-foreground/50", bg: "bg-blue-500/10", icon: CreditCard },
          { label: "Recurring", value: "0", color: "text-muted-foreground/50", bg: "bg-muted/10", icon: RefreshCw },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl border border-border/40 bg-card p-2.5 flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${metric.bg} shrink-0`}>
              <metric.icon className={`w-3 h-3 ${metric.color}`} />
            </div>
            <div className="min-w-0">
              <span className="text-[9px] text-muted-foreground/50 font-medium uppercase tracking-wider block leading-tight">{metric.label}</span>
              <span className={`text-xs font-bold ${metric.color}`}>{metric.value}</span>
            </div>
          </div>
        ))}
      </div>
      }
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        {intelligence.moduleCoverage && (
          <AutomationCoverageIndicator
            coveragePct={intelligence.moduleCoverage.coveragePct}
            automatedCount={intelligence.moduleCoverage.automatedCount}
            totalProcesses={intelligence.moduleCoverage.totalProcesses}
          />
        )}
      </div>

      <GraphInsightsPanel
        recommendations={intelligence.recommendations}
        loading={intelligence.loading}
        onDismiss={intelligence.dismiss}
        onNavigate={(route) => router.push(route)}
        className="mb-4"
      />

      {mode === "operations" && (
        <div className="space-y-4">
          {actionQueue.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h3 className="text-xs font-semibold">Action Queue</h3>
                <span className="text-[9px] text-muted-foreground">{actionQueue.length} item{actionQueue.length !== 1 ? "s" : ""} need attention</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {actionQueue.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl border transition-colors"
                    style={{
                      borderColor: action.urgency === "high" ? "hsl(var(--kf-error) / 0.25)" : action.urgency === "medium" ? "hsl(var(--kf-warning) / 0.2)" : "hsl(var(--border) / 0.4)",
                      background: action.urgency === "high" ? "hsl(var(--kf-error) / 0.04)" : "hsl(var(--card))",
                    }}
                  >
                    <div
                      className="p-1.5 rounded-lg shrink-0"
                      style={{
                        background: action.urgency === "high" ? "hsl(var(--kf-error) / 0.1)" : action.urgency === "medium" ? "hsl(var(--kf-warning) / 0.1)" : "hsl(var(--muted) / 0.15)",
                      }}
                    >
                      <action.icon className="w-3 h-3" style={{ color: action.urgency === "high" ? "hsl(var(--kf-error))" : action.urgency === "medium" ? "hsl(var(--kf-warning))" : "hsl(var(--muted-foreground))" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{action.label}</p>
                      {action.amount && <p className="text-[10px] text-muted-foreground">{action.amount}</p>}
                    </div>
                    <button
                      onClick={action.ctaAction}
                      className="text-[10px] font-medium px-2 py-1 rounded-lg shrink-0 min-h-[28px] transition-colors"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.1)",
                        color: "hsl(var(--kf-accent1))",
                        borderWidth: 1,
                        borderColor: "hsl(var(--kf-accent1) / 0.15)",
                      }}
                    >
                      {action.cta}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 flex-wrap">
            {OPS_SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => toggleOpsSection(s.key)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all min-h-[32px]"
                style={{
                  background: opsSection === s.key ? "hsl(var(--kf-accent1) / 0.08)" : "transparent",
                  color: opsSection === s.key ? "hsl(var(--kf-accent1))" : "hsl(var(--muted-foreground))",
                  borderWidth: 1,
                  borderColor: opsSection === s.key ? "hsl(var(--kf-accent1) / 0.15)" : "hsl(var(--border) / 0.3)",
                }}
              >
                <s.icon className="w-3 h-3" />
                {s.label}
                {s.key === "invoices" && invoices.length > 0 && (
                  <span className="text-[9px] px-1 rounded-full" style={{ background: "hsl(var(--muted) / 0.3)" }}>{invoices.length}</span>
                )}
                {s.key === "quotes" && quotes.length > 0 && (
                  <span className="text-[9px] px-1 rounded-full" style={{ background: "hsl(var(--muted) / 0.3)" }}>{quotes.length}</span>
                )}
              </button>
            ))}
          </div>

          {opsSection === "invoices" && (
            <div className="flex items-center gap-3 flex-wrap text-[10px] px-1 mb-1">
              {(() => {
                const now = new Date();
                const draft = invoices.filter((i) => i.status === "DRAFT").length;
                const sent = invoices.filter((i) => i.status === "SENT").length;
                const overdue = invoices.filter((i) => i.status === "OVERDUE" || (i.status === "SENT" && i.dueDate && new Date(i.dueDate) < now)).length;
                const paid = invoices.filter((i) => i.status === "PAID").length;
                const stats = [
                  { label: "Draft", count: draft, color: "text-muted-foreground" },
                  { label: "Sent", count: sent, color: "text-blue-400" },
                  { label: "Overdue", count: overdue, color: overdue > 0 ? "text-red-400" : "text-muted-foreground/50" },
                  { label: "Paid", count: paid, color: "text-emerald-400" },
                ];
                return stats.map((s) => (
                  <span key={s.label} className={`${s.color} font-medium`}>
                    {s.count} {s.label}
                  </span>
                ));
              })()}
            </div>
          )}
          {opsSection === "invoices" && (
            <InvoicesPanel
              invoices={shell.invoices} contacts={shell.contacts} products={shell.products}
              businessId={businessId} loading={shell.loading}
              triggerNew={billing.triggerNewInvoice} setProducts={shell.setProducts}
              setInvoices={shell.setInvoices} gmailStatus={shell.integrations.gmailStatus}
              currency={businessCurrency}
              prefillContactId={billing.pendingPrefill?.contactId}
              prefillItems={billing.pendingPrefill?.items}
              prefillToken={billing.pendingPrefill?._token}
              onPrefillApplied={billing.clearPrefill}
              renderTimelineBadge={renderTimelineBadge}
              onViewContact={copilot.handleViewContact}
              onViewClientIntel={copilot.handleViewClientIntel}
              onAiDraftReminder={copilot.handleAiDraftReminder}
            />
          )}

          {opsSection === "quotes" && quotes.length > 0 && (
            <div className="rounded-xl border border-border/30 bg-card p-2.5">
              {(() => {
                const draft = quotes.filter((q) => q.status === "DRAFT").length;
                const sent = quotes.filter((q) => q.status === "SENT").length;
                const accepted = quotes.filter((q) => q.status === "ACCEPTED").length;
                const rejected = quotes.filter((q) => q.status === "REJECTED").length;
                const total = quotes.length;
                const convRate = total > 0 ? Math.round((accepted / total) * 100) : 0;
                const pendingVal = quotes.filter((q) => q.status === "SENT").reduce((s, q) => s + Number(q.total ?? 0), 0);
                const acceptedVal = quotes.filter((q) => q.status === "ACCEPTED").reduce((s, q) => s + Number(q.total ?? 0), 0);
                const stages = [
                  { label: "Draft", count: draft, color: "hsl(var(--muted-foreground))" },
                  { label: "Sent", count: sent, color: "hsl(210, 80%, 60%)" },
                  { label: "Accepted", count: accepted, color: "hsl(var(--kf-success))" },
                  { label: "Rejected", count: rejected, color: "hsl(var(--kf-error))" },
                ];
                const totalBar = Math.max(total, 1);
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Quote Pipeline</span>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="font-bold" style={{ color: convRate >= 50 ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))" }}>
                          {convRate}% conversion
                        </span>
                      </div>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted/20">
                      {stages.map((s) => s.count > 0 && (
                        <div
                          key={s.label}
                          style={{ width: `${(s.count / totalBar) * 100}%`, background: s.color }}
                          className="transition-all duration-300"
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-[10px]">
                      {stages.map((s) => (
                        <span key={s.label} className="font-medium" style={{ color: s.color }}>
                          {s.count} {s.label}
                        </span>
                      ))}
                      {pendingVal > 0 && (
                        <>
                          <span className="text-muted-foreground/30">|</span>
                          <span className="text-amber-400 font-medium">{formatCurrencyCompact(pendingVal, businessCurrency)} pending</span>
                        </>
                      )}
                      {acceptedVal > 0 && (
                        <>
                          <span className="text-muted-foreground/30">|</span>
                          <span className="text-emerald-400 font-medium">{formatCurrencyCompact(acceptedVal, businessCurrency)} won</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {opsSection === "quotes" && (
            <QuotesPanel
              quotes={shell.quotes} contacts={shell.contacts} products={shell.products}
              businessId={businessId} loading={shell.loading}
              gmailStatus={shell.integrations.gmailStatus}
              setProducts={shell.setProducts} setQuotes={shell.setQuotes}
              setInvoices={shell.setInvoices} triggerNew={billing.triggerNewQuote}
              onSwitchToInvoices={() => handleTabChange("invoices")}
              currency={businessCurrency}
              prefillContactId={billing.pendingPrefill?.contactId}
              prefillItems={billing.pendingPrefill?.items}
              prefillToken={billing.pendingPrefill?._token}
              onPrefillApplied={billing.clearPrefill}
              renderTimelineBadge={renderTimelineBadge}
              onViewContact={copilot.handleViewContact}
              onViewClientIntel={copilot.handleViewClientIntel}
            />
          )}

          {opsSection === "payments" && (
            <div className="flex items-center gap-3 flex-wrap text-[10px] px-1 mb-1">
              {(() => {
                const paid = invoices.filter((i) => i.status === "PAID");
                const totalCollected = paid.reduce((s, i) => s + Number(i.total ?? 0), 0);
                const partial = invoices.filter((i) => i.status === "PARTIALLY_PAID").length;
                const awaitingPayment = invoices.filter((i) => i.status === "SENT" || i.status === "OVERDUE").length;
                return (
                  <>
                    <span className="text-emerald-400 font-medium">{formatCurrencyCompact(totalCollected, businessCurrency)} collected</span>
                    <span className="text-muted-foreground/30">|</span>
                    <span className="text-blue-400 font-medium">{paid.length} paid</span>
                    <span className="text-amber-400 font-medium">{partial} partial</span>
                    <span className={`${awaitingPayment > 0 ? "text-red-400" : "text-muted-foreground/50"} font-medium`}>{awaitingPayment} awaiting</span>
                  </>
                );
              })()}
            </div>
          )}
          {opsSection === "payments" && (
            <PaymentsTab
              invoices={shell.invoices} currency={businessCurrency}
              businessId={businessId} contacts={shell.contacts}
              setInvoices={shell.setInvoices}
              onNavigateToInvoices={() => handleTabChange("invoices")}
            />
          )}

          {opsSection === "recurring" && (
            <RecurringPanel
              businessId={businessId} contacts={shell.contacts}
              products={shell.products} triggerNew={billing.triggerNewSchedule}
              currency={businessCurrency}
            />
          )}
        </div>
      )}

      {mode === "catalog" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              <h3 className="text-sm font-semibold">Products & Services</h3>
              <span className="text-[10px] text-muted-foreground">({shell.products.length} item{shell.products.length !== 1 ? "s" : ""})</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[10px] px-1">
            {(() => {
              const services = shell.products.filter((p) => p.category === "SERVICE").length;
              const products = shell.products.filter((p) => p.category === "PRODUCT").length;
              const packages = shell.products.filter((p) => p.category === "PACKAGE").length;
              const active = shell.products.filter((p) => p.isActive).length;
              const inactive = shell.products.length - active;
              return (
                <>
                  <span className="text-blue-400 font-medium">{services} Services</span>
                  <span className="text-amber-400 font-medium">{products} Products</span>
                  <span className="font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>{packages} Packages</span>
                  <span className="text-muted-foreground/30">|</span>
                  <span className="text-emerald-400 font-medium">{active} Active</span>
                  {inactive > 0 && <span className="text-muted-foreground/50 font-medium">{inactive} Inactive</span>}
                </>
              );
            })()}
          </div>
          <ProductsPanel
            products={shell.products}
            loading={shell.loading}
            productSearch={productActions.productSearch}
            setProductSearch={productActions.setProductSearch}
            onEdit={productActions.openEditProduct}
            onDelete={productActions.handleDeleteProduct}
            onDuplicate={productActions.handleDuplicateProduct}
            onToggleActive={productActions.handleToggleProductActive}
            onInlineSave={productActions.handleInlineSave}
            onAdd={productActions.openAddProduct}
            setProducts={shell.setProducts}
            deleteConfirm={productActions.deleteConfirm}
            setDeleteConfirm={productActions.setDeleteConfirm}
            cachedImages={shell.cachedImages}
            businessId={businessId}
            currency={businessCurrency}
            invoices={shell.invoices}
            quotes={shell.quotes}
          />
        </div>
      )}

      {mode === "setup" && (
        <div className="space-y-4">
          <div className="kf-card rounded-xl p-3">
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <h3 className="text-sm font-semibold">Revenue Setup</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {setupReadyCount === setupReadiness.length ? "All configured! Your billing infrastructure is ready." : `${setupReadyCount}/${setupReadiness.length} configured — complete the items below.`}
                </p>
              </div>
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold"
                style={{
                  background: setupReadyCount === setupReadiness.length ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-warning) / 0.1)",
                  color: setupReadyCount === setupReadiness.length ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
                }}
              >
                {setupReadyCount === setupReadiness.length ? <CheckCircle2 className="w-3 h-3" /> : null}
                {setupReadyCount}/{setupReadiness.length}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {setupReadiness.map((item) => (
                <div
                  key={item.label}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium"
                  style={{
                    background: item.ok ? "hsl(var(--kf-success) / 0.06)" : "hsl(var(--kf-error) / 0.06)",
                    color: item.ok ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))",
                    borderWidth: 1,
                    borderColor: item.ok ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-error) / 0.15)",
                  }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: item.ok ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}
                  />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Billing & Tax", desc: "Tax rates, default terms, and invoice preferences", section: "billing" as const, icon: Receipt, colorVar: "--kf-accent1" },
              { label: "Payment Gateways", desc: "WiPay, PayPal, and payment methods", section: "payments" as const, icon: Shield, colorVar: "--kf-accent2" },
              { label: "Branding & Templates", desc: "Customize invoice branding and layout", section: "branding" as const, icon: Palette, colorVar: "--kf-accent1" },
            ].map((link) => (
              <button
                key={link.label}
                onClick={() => setSetupDrawer(link.section)}
                className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card transition-all group text-left"
                style={{ ["--link-color" as string]: `hsl(var(${link.colorVar}))` }}
              >
                <div className="p-2 rounded-xl shrink-0" style={{ background: `hsl(var(${link.colorVar}) / 0.1)` }}>
                  <link.icon className="w-4 h-4" style={{ color: `hsl(var(${link.colorVar}))` }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">{link.label}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{link.desc}</p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 transition-colors shrink-0" />
              </button>
            ))}
          </div>

          <div className="kf-card rounded-xl p-3">
            <h4 className="text-xs font-semibold mb-2">Connected Modules</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {[
                { label: "Clients", desc: "Client invoicing and payment history", href: "/app/crm/pipeline", icon: Briefcase },
                { label: "Calendar", desc: "Service bookings generate invoicing data", href: "/app/bookings", icon: Clock },
                { label: "Store", desc: "Public storefront products and checkout", href: "/app/store", icon: Layers },
                { label: "Reports", desc: "Revenue analytics and projections", href: "/app/reports", icon: TrendingUp },
              ].map((cx) => (
                <Link
                  key={cx.label}
                  href={cx.href}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border/30 hover:border-border/50 transition-colors group"
                >
                  <cx.icon className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium">{cx.label}</p>
                    <p className="text-[9px] text-muted-foreground/50">{cx.desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <SearchableHelpDrawer
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        onNavigate={(navTab: string) => handleTabChange(navTab)}
      />

      <RevenueSetupDrawer
        open={setupDrawer !== null}
        onClose={() => setSetupDrawer(null)}
        section={setupDrawer ?? "billing"}
      />

      <ProgressivePrompts moduleFilter={["sales", "revenue", "finance"]} />

      <PageGuide
        moduleKey="commerce"
        walkthroughSteps={COMMERCE_WALKTHROUGH}
      />
    </WorkspaceShell>
  );
}
