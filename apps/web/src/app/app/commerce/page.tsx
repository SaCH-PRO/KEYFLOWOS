"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  CreditCard,
  FileText,
  DollarSign,
  RefreshCw,
  Plus,
  Clock,
  AlertTriangle,
  ArrowRight,
  Package,
  Zap,
  TrendingUp,
  Receipt,
  Settings as SettingsIcon,
  BarChart3,
  Send,
  Repeat,
  LayoutDashboard,
  Boxes,
} from "lucide-react";

import { useNavigationContext } from "@/lib/navigation-context";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { FinanceBanner } from "../finance/components/finance-banner";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { EmptyState } from "@/components/ui/empty-state";
import { MobileActionSheet, type MobileActionSheetItem } from "@/components/ui/mobile-action-sheet";
import { RecordDetailDrawer, type RecordDetailEntity } from "@/components/ui/record-detail-drawer";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { RichTooltip } from "@/components/ui/rich-tooltip";
import { PlanLimitBanner } from "@/components/ui/upgrade-prompt";
import { GraphInsightsPanel } from "@/components/ai/graph-insights-panel";
import { AutomationCoverageIndicator } from "@/components/ai/automation-coverage-indicator";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";

import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEvent } from "@/hooks/use-module-events";
import { useGraphIntelligence } from "@/hooks/use-graph-intelligence";
import { usePlan } from "@/hooks/use-plan";

import { formatCurrencyCompact } from "@/lib/currency";

import { useCommerceShell } from "./hooks/use-commerce-shell";
import { useBillingWorkspace } from "./hooks/use-billing-workspace";
import { useCommerceOverview } from "./hooks/use-commerce-overview";
import { useCommerceCopilot } from "./hooks/use-commerce-copilot";
import { ProgressivePrompts } from "../profile/components/progressive-prompts";
import InvoicesPanel from "./invoices/invoices-panel";
import QuotesPanel from "./quotes/quotes-panel";
import RecurringPanel from "./recurring/recurring-panel";
import PaymentsTab from "./payments/payments-tab";
import { CommerceOverviewTab } from "./components/commerce-overview-tab";
import { RevenueActionsTab } from "./components/revenue-actions-tab";
import { ServiceLinkWidget } from "./components/service-link-widget";
import { CommerceInventoryWrapper } from "./components/commerce-inventory-wrapper";

type RevenueTabKey = "overview" | "quotes" | "invoices" | "payments" | "recurring" | "actions" | "inventory";

const REVENUE_TABS: { key: RevenueTabKey; label: string; icon: React.ElementType; tooltip?: string }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, tooltip: "Cashflow snapshot and key metrics" },
  { key: "quotes", label: "Quotes", icon: FileText, tooltip: "Drafts, sent, accepted quotes" },
  { key: "invoices", label: "Invoices", icon: Receipt, tooltip: "Drafts, sent, overdue, paid" },
  { key: "payments", label: "Payments", icon: DollarSign, tooltip: "Collected and pending payments" },
  { key: "recurring", label: "Recurring", icon: Repeat, tooltip: "Subscriptions and scheduled invoices" },
  { key: "inventory", label: "Inventory", icon: Boxes, tooltip: "Warehouses, stock, and purchase orders" },
  { key: "actions", label: "Actions", icon: Zap, tooltip: "Cashflow actions that need attention" },
];

const VALID_TABS = new Set<RevenueTabKey>(REVENUE_TABS.map((t) => t.key));

interface TabFrameProps {
  loading: boolean;
  error?: string | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ElementType;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  children: React.ReactNode;
}

function TabFrame({
  loading,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyActionLabel,
  onEmptyAction,
  children,
}: TabFrameProps) {
  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-3">
              <div className="h-3 w-12 mb-2 rounded bg-muted/40 animate-pulse" />
              <div className="h-5 w-20 rounded bg-muted/40 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 w-full rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="rounded-xl border px-4 py-4 text-sm flex items-start gap-2"
        style={{
          borderColor: "hsl(var(--kf-error) / 0.3)",
          background: "hsl(var(--kf-error) / 0.06)",
          color: "hsl(var(--kf-error))",
        }}
        role="alert"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Couldn&apos;t load this view</p>
          <p className="text-xs mt-1 opacity-80">{error}</p>
        </div>
      </div>
    );
  }
  if (isEmpty && emptyTitle && emptyIcon) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
        variant="compact"
      />
    );
  }
  return <>{children}</>;
}

export default function CommercePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getOriginContext } = useNavigationContext();
  const { getReturnLabel, navigateBack } = useReturnNavigation({ skipScrollListener: true });

  const shell = useCommerceShell();
  const billing = useBillingWorkspace();
  const overview = useCommerceOverview(shell.invoices, shell.businessCurrency);
  const { checkLimit } = usePlan();
  const intelligence = useGraphIntelligence({ businessId: shell.businessId, module: "revenue" });

  const copilot = useCommerceCopilot({
    businessId: shell.businessId,
    tab: overview.tab,
    invoiceCount: shell.invoices.length,
    quoteCount: shell.quotes.length,
    handleTabChange: overview.handleTabChange,
    prefillForContact: billing.prefillForContact,
  });

  const { businessId, businessCurrency, invoices, quotes } = shell;
  const { commerceAi } = copilot;

  const [activeTab, setActiveTab] = useState<RevenueTabKey>("overview");
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [recordDrawer, setRecordDrawer] = useState<{ entity: RecordDetailEntity; id: string } | null>(null);

  const closeRecordDrawer = useCallback(() => {
    setRecordDrawer(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("recordType");
      url.searchParams.delete("recordId");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const openRecordDrawer = useCallback((entity: RecordDetailEntity, id: string) => {
    setRecordDrawer({ entity, id });
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("recordType", entity);
      url.searchParams.set("recordId", id);
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleTabChange = useCallback(
    (key: string) => {
      const next = (VALID_TABS.has(key as RevenueTabKey) ? key : "overview") as RevenueTabKey;
      setActiveTab(next);
      overview.handleTabChange(next);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url.toString());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- narrow to overview.handleTabChange to avoid re-creating the callback on every overview state change
    [overview.handleTabChange],
  );

  useEffect(() => {
    const paramTab = searchParams.get("tab");
    if (!paramTab) return;
    if (VALID_TABS.has(paramTab as RevenueTabKey)) {
      setActiveTab(paramTab as RevenueTabKey);
    } else if (["products", "billing", "insights"].includes(paramTab)) {
      setActiveTab("overview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount-time read of the URL `tab` param
  }, []);

  useEffect(() => {
    const recordType = searchParams.get("recordType");
    const recordId = searchParams.get("recordId");
    if (recordType && recordId && ["quote", "invoice", "payment", "recurring"].includes(recordType)) {
      setRecordDrawer({ entity: recordType as RecordDetailEntity, id: recordId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount-time deep-link read
  }, []);

  useEffect(() => {
    if (billing.pendingPrefill?.targetSegment) {
      const target: RevenueTabKey =
        billing.pendingPrefill.targetSegment === "quotes" ? "quotes" : "invoices";
      if (activeTab !== target) handleTabChange(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to new prefill arrivals
  }, [billing.pendingPrefill]);

  useEffect(() => {
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: activeTab,
        itemCount: invoices.length + quotes.length,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the specific update method is referenced
  }, [businessId, activeTab, invoices.length, quotes.length, commerceAi.updateCommerceContext]);

  useModuleEvent<{ contactId?: string; items?: import("./components/commerce-types").InvoiceLineItem[] }>(
    "commerce:create_quote_for_contact",
    useCallback(
      (event) => {
        const { contactId, items } = event.data ?? {};
        if (contactId) {
          billing.prefillForContact(contactId, "quotes", items);
          handleTabChange("quotes");
          toast.success("Opening quote builder for contact...");
        }
      },
      [billing, handleTabChange],
    ),
  );

  useModuleEvent<{ contactId?: string; items?: import("./components/commerce-types").InvoiceLineItem[] }>(
    "commerce:create_invoice_for_contact",
    useCallback(
      (event) => {
        const { contactId, items } = event.data ?? {};
        if (contactId) {
          billing.prefillForContact(contactId, "invoices", items);
          handleTabChange("invoices");
          toast.success("Opening invoice builder for contact...");
        }
      },
      [billing, handleTabChange],
    ),
  );

  const handleCommerceAiAction = useCallback(
    (actionKey: string) => {
      if (actionKey.startsWith("switch_tab:")) {
        const t = actionKey.replace("switch_tab:", "") as RevenueTabKey;
        if (VALID_TABS.has(t)) handleTabChange(t);
      } else if (actionKey.startsWith("filter_status:") || actionKey.startsWith("send_reminders:")) {
        handleTabChange("invoices");
      }
    },
    [handleTabChange],
  );

  const financialSummary = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    let outstanding = 0;
    let overdue = 0;
    let collectedThisMonth = 0;
    let draftCount = 0;
    let pendingQuotes = 0;
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
        if (inv.dueDate && new Date(inv.dueDate) < now) overdue += amount;
      } else if (inv.status === "DRAFT") {
        outstanding += amount;
        draftCount += 1;
      }
    }
    for (const q of quotes) {
      if (q.status === "SENT" || q.status === "DRAFT") pendingQuotes += 1;
    }
    return { outstanding, overdue, collectedThisMonth, draftCount, pendingQuotes };
  }, [invoices, quotes]);

  const actionQueue = useMemo(() => {
    const items: {
      id: string;
      icon: React.ElementType;
      label: string;
      detail?: string;
      urgency: "high" | "medium" | "low";
      cta: string;
      onCta: () => void;
    }[] = [];
    const now = new Date();
    const overdueInvoices = invoices.filter(
      (inv) => inv.status === "OVERDUE" || (inv.status === "SENT" && inv.dueDate && new Date(inv.dueDate) < now),
    );
    if (overdueInvoices.length > 0) {
      items.push({
        id: "overdue",
        icon: AlertTriangle,
        label: `${overdueInvoices.length} overdue invoice${overdueInvoices.length !== 1 ? "s" : ""}`,
        detail: formatCurrencyCompact(
          overdueInvoices.reduce((s, inv) => s + Number(inv.total ?? 0), 0),
          businessCurrency,
        ),
        urgency: "high",
        cta: overdueInvoices.length === 1 ? "Details" : "View overdue",
        onCta:
          overdueInvoices.length === 1
            ? () => openRecordDrawer("invoice", overdueInvoices[0]!.id)
            : () => handleTabChange("invoices"),
      });
    }
    const drafts = invoices.filter((inv) => inv.status === "DRAFT");
    if (drafts.length > 0) {
      items.push({
        id: "drafts",
        icon: FileText,
        label: `${drafts.length} draft invoice${drafts.length !== 1 ? "s" : ""} unsent`,
        detail: formatCurrencyCompact(
          drafts.reduce((s, inv) => s + Number(inv.total ?? 0), 0),
          businessCurrency,
        ),
        urgency: "medium",
        cta: drafts.length === 1 ? "Details" : "Send",
        onCta:
          drafts.length === 1
            ? () => openRecordDrawer("invoice", drafts[0]!.id)
            : () => handleTabChange("invoices"),
      });
    }
    const pendingQuotes = quotes.filter((q) => q.status === "SENT");
    if (pendingQuotes.length > 0) {
      items.push({
        id: "pending-quotes",
        icon: CreditCard,
        label: `${pendingQuotes.length} quote${pendingQuotes.length !== 1 ? "s" : ""} awaiting response`,
        detail: formatCurrencyCompact(
          pendingQuotes.reduce((s, q) => s + Number(q.total ?? 0), 0),
          businessCurrency,
        ),
        urgency: "medium",
        cta: pendingQuotes.length === 1 ? "Details" : "Follow up",
        onCta:
          pendingQuotes.length === 1
            ? () => openRecordDrawer("quote", pendingQuotes[0]!.id)
            : () => handleTabChange("quotes"),
      });
    }
    const sent = invoices.filter((inv) => inv.status === "SENT");
    if (sent.length > 0) {
      items.push({
        id: "pending",
        icon: Clock,
        label: `${formatCurrencyCompact(
          sent.reduce((s, inv) => s + Number(inv.total ?? 0), 0),
          businessCurrency,
        )} awaiting payment`,
        detail: `${sent.length} invoice${sent.length !== 1 ? "s" : ""}`,
        urgency: "low",
        cta: "Open payments",
        onCta: () => handleTabChange("payments"),
      });
    }
    return items;
  }, [invoices, quotes, businessCurrency, handleTabChange, openRecordDrawer]);

  const mobileSheetItems = useMemo<MobileActionSheetItem[]>(
    () => [
      {
        key: "new-invoice",
        label: "New invoice",
        description: "Bill a customer for delivered work",
        icon: Receipt,
        tone: "primary",
        onSelect: () => {
          handleTabChange("invoices");
          billing.setTriggerNewInvoice((n: number) => n + 1);
        },
      },
      {
        key: "new-quote",
        label: "New quote",
        description: "Draft a proposal for a prospect",
        icon: FileText,
        onSelect: () => {
          handleTabChange("quotes");
          billing.setTriggerNewQuote((n: number) => n + 1);
        },
      },
      {
        key: "record-payment",
        label: "Record a payment",
        description: "Log a payment received outside the platform",
        icon: DollarSign,
        onSelect: () => {
          handleTabChange("payments");
        },
      },
      {
        key: "convert-quote",
        label: "Convert quote to invoice",
        description: "Pick an accepted quote to bill",
        icon: Send,
        onSelect: () => {
          handleTabChange("quotes");
        },
      },
      {
        key: "new-recurring",
        label: "New recurring schedule",
        description: "Set up a subscription or repeat invoice",
        icon: RefreshCw,
        onSelect: () => {
          handleTabChange("recurring");
          billing.setTriggerNewSchedule((n: number) => n + 1);
        },
      },
    ],
    [billing, handleTabChange],
  );

  const handlePrimaryAction = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
      setMobileSheetOpen(true);
      return;
    }
    let target: RevenueTabKey;
    if (activeTab === "quotes") target = "quotes";
    else if (activeTab === "recurring") target = "recurring";
    else target = "invoices";
    if (activeTab !== target) handleTabChange(target);
    if (target === "quotes") billing.setTriggerNewQuote((n: number) => n + 1);
    else if (target === "recurring") billing.setTriggerNewSchedule((n: number) => n + 1);
    else billing.setTriggerNewInvoice((n: number) => n + 1);
  }, [activeTab, handleTabChange, billing]);

  const commerceShortcuts = useMemo<ShortcutGroup[]>(
    () => [
      {
        groupName: "Revenue Navigation",
        shortcuts: [
          { key: "n", description: "New", action: handlePrimaryAction },
          { key: "1", description: "Overview", action: () => handleTabChange("overview") },
          { key: "2", description: "Quotes", action: () => handleTabChange("quotes") },
          { key: "3", description: "Invoices", action: () => handleTabChange("invoices") },
          { key: "4", description: "Payments", action: () => handleTabChange("payments") },
          { key: "5", description: "Recurring", action: () => handleTabChange("recurring") },
          { key: "6", description: "Actions", action: () => handleTabChange("actions") },
        ],
      },
    ],
    [handlePrimaryAction, handleTabChange],
  );

  useKeyboardShortcuts(commerceShortcuts, !shell.workspaceLoading);

  const renderTimelineBadge = useCallback(() => null, []);

  if (shell.workspaceLoading) return <ListPageSkeleton />;
  if (shell.workspaceError) return <WorkspaceError />;

  const originContext = getOriginContext();
  const showCrossModuleBanner =
    originContext && originContext.workspace && originContext.workspace !== "Revenue" && billing.pendingPrefill?.contactId;

  const tabsForShell = REVENUE_TABS.map((t) => ({
    key: t.key,
    label: t.label,
    icon: t.icon,
    tooltip: t.tooltip,
    count:
      t.key === "quotes"
        ? quotes.length || undefined
        : t.key === "invoices"
        ? invoices.length || undefined
        : t.key === "actions"
        ? actionQueue.length || undefined
        : undefined,
  }));

  return (
    <WorkspaceShell
      icon={TrendingUp}
      title="Revenue Intelligence"
      subtitle="Quotes, invoices, payments, and cashflow actions."
      tabs={tabsForShell}
      activeTab={activeTab}
      onTabChange={(k) => handleTabChange(k)}
      tabLayoutId="revenue-tabs"
      ai={{ hook: commerceAi.aiHook, moduleName: "Revenue", onAction: handleCommerceAiAction }}
      actionLabel="+ New"
      actionIcon={Plus}
      onAction={handlePrimaryAction}
      actionDataAttr="commerce-new"
      headerRight={
        <div className="flex items-center gap-2">
          <ServiceLinkWidget compact />
          <NotesTrigger pageKey="commerce" variant="header" />
          <RichTooltip
            title="Revenue Pulse"
            description="Total payments collected this month across all invoices."
            side="bottom"
          >
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 kf-radius-md cursor-help kf-text-body"
              style={{ border: "1px solid hsl(var(--kf-border) / 0.5)", background: "hsl(var(--kf-muted) / 0.12)" }}
            >
              <DollarSign className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <span
                className="font-semibold kf-text-caption"
                style={{ color: "hsl(var(--kf-success))" }}
              >
                {overview.revenuePulse}
              </span>
              <span className="kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                collected
              </span>
            </div>
          </RichTooltip>
        </div>
      }
      banners={
        <>
          <FinanceBanner from="commerce" />
          <ResumePrompt
            module="commerce"
            onResume={(task) => {
              const isQuote = task.taskIntent?.includes("quote") || task.route?.includes("tab=quotes");
              if (isQuote) {
                handleTabChange("quotes");
                billing.setTriggerNewQuote((n: number) => n + 1);
              } else {
                handleTabChange("invoices");
                billing.setTriggerNewInvoice((n: number) => n + 1);
              }
            }}
          />
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
            return (
              <PlanLimitBanner
                resourceKey="invoices"
                label="invoices"
                currentUsage={il.current}
                limit={il.limit}
                isUnlimited={il.isUnlimited}
                nearLimit={il.nearLimit}
                atLimit={il.atLimit}
                upgradeTo={il.upgradeTo}
              />
            );
          })()}
          {shell.error && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
              <span className="text-amber-400">!</span> {shell.error}
            </div>
          )}
        </>
      }
      metricStrip={
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" data-walkthrough="commerce-kpi">
          {[
            {
              label: "Outstanding",
              value: formatCurrencyCompact(financialSummary.outstanding, businessCurrency),
              color: "text-amber-400",
              bg: "bg-amber-500/10",
              icon: Clock,
            },
            {
              label: "Overdue",
              value: formatCurrencyCompact(financialSummary.overdue, businessCurrency),
              color: financialSummary.overdue > 0 ? "text-red-400" : "text-muted-foreground/50",
              bg: financialSummary.overdue > 0 ? "bg-red-500/10" : "bg-muted/10",
              icon: AlertTriangle,
            },
            {
              label: "Collected",
              value: formatCurrencyCompact(financialSummary.collectedThisMonth, businessCurrency),
              color: "text-emerald-400",
              bg: "bg-emerald-500/10",
              icon: DollarSign,
            },
            {
              label: "Drafts",
              value: String(financialSummary.draftCount),
              color: financialSummary.draftCount > 0 ? "text-amber-300" : "text-muted-foreground/50",
              bg: "bg-muted/10",
              icon: FileText,
            },
            {
              label: "Quotes Pending",
              value: String(financialSummary.pendingQuotes),
              color: financialSummary.pendingQuotes > 0 ? "text-blue-400" : "text-muted-foreground/50",
              bg: "bg-blue-500/10",
              icon: CreditCard,
            },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-border/40 bg-card p-2.5 flex items-center gap-2">
              <div className={`p-1.5 rounded-lg ${metric.bg} shrink-0`}>
                <metric.icon className={`w-3 h-3 ${metric.color}`} />
              </div>
              <div className="min-w-0">
                <span className="text-[9px] text-muted-foreground/50 font-medium uppercase tracking-wider block leading-tight">
                  {metric.label}
                </span>
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

      {activeTab === "overview" && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <div className="space-y-4">
            <CommerceOverviewTab
              businessId={businessId}
              invoices={invoices}
              quotes={quotes}
              currency={businessCurrency}
              loading={shell.loading}
              onNavigate={(t) => handleTabChange(t)}
              onNewItem={handlePrimaryAction}
            />
            <PointerCards />
          </div>
        </TabFrame>
      )}

      {activeTab === "quotes" && (
        <TabFrame
          loading={shell.loading}
          error={shell.error}
          isEmpty={false}
        >
          <QuotesPanel
            quotes={quotes}
            contacts={shell.contacts}
            products={shell.products}
            businessId={businessId}
            loading={shell.loading}
            gmailStatus={shell.integrations.gmailStatus}
            setProducts={shell.setProducts}
            setQuotes={shell.setQuotes}
            setInvoices={shell.setInvoices}
            triggerNew={billing.triggerNewQuote}
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
        </TabFrame>
      )}

      {activeTab === "invoices" && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <InvoicesPanel
            invoices={invoices}
            contacts={shell.contacts}
            products={shell.products}
            businessId={businessId}
            loading={shell.loading}
            triggerNew={billing.triggerNewInvoice}
            setProducts={shell.setProducts}
            setInvoices={shell.setInvoices}
            gmailStatus={shell.integrations.gmailStatus}
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
        </TabFrame>
      )}

      {activeTab === "payments" && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <PaymentsTab
            invoices={invoices}
            currency={businessCurrency}
            businessId={businessId}
            contacts={shell.contacts}
            setInvoices={shell.setInvoices}
            onNavigateToInvoices={() => handleTabChange("invoices")}
          />
        </TabFrame>
      )}

      {activeTab === "recurring" && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <RecurringPanel
            businessId={businessId}
            contacts={shell.contacts}
            products={shell.products}
            triggerNew={billing.triggerNewSchedule}
            currency={businessCurrency}
          />
        </TabFrame>
      )}

      {activeTab === "inventory" && businessId && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <CommerceInventoryWrapper businessId={businessId} />
        </TabFrame>
      )}

      {activeTab === "actions" && (
        <TabFrame
          loading={shell.loading}
          error={shell.error}
        >
          <RevenueActionsTab
            businessId={businessId}
            currency={businessCurrency}
            onOpenInvoice={(id) => openRecordDrawer("invoice", id)}
            onOpenQuote={(id) => openRecordDrawer("quote", id)}
            onOpenContact={(id) => router.push(`/app/crm/contacts/${id}`)}
            onNavigate={(t) => handleTabChange(t)}
          />
        </TabFrame>
      )}

      <MobileActionSheet
        open={mobileSheetOpen}
        onClose={() => setMobileSheetOpen(false)}
        title="Quick actions"
        items={mobileSheetItems}
      />

      <RevenueRecordDrawer
        record={recordDrawer}
        invoices={invoices}
        quotes={quotes}
        currency={businessCurrency}
        onClose={closeRecordDrawer}
        onOpenFullEditor={(entity) => {
          if (entity === "quote") handleTabChange("quotes");
          else if (entity === "invoice") handleTabChange("invoices");
          else if (entity === "payment") handleTabChange("payments");
          else if (entity === "recurring") handleTabChange("recurring");
          closeRecordDrawer();
        }}
      />

      <ProgressivePrompts moduleFilter={["sales", "revenue", "finance"]} />
    </WorkspaceShell>
  );
}

interface RevenueRecordDrawerProps {
  record: { entity: RecordDetailEntity; id: string } | null;
  invoices: import("@/lib/client").Invoice[];
  quotes: import("@/lib/client").Quote[];
  currency: string;
  onClose: () => void;
  onOpenFullEditor: (entity: RecordDetailEntity) => void;
}

function RevenueRecordDrawer({
  record,
  invoices,
  quotes,
  currency,
  onClose,
  onOpenFullEditor,
}: RevenueRecordDrawerProps) {
  if (!record) {
    return (
      <RecordDetailDrawer
        open={false}
        onClose={onClose}
        entity="invoice"
        title=""
      />
    );
  }
  const { entity, id } = record;
  if (entity === "invoice") {
    const inv = invoices.find((i) => i.id === id);
    if (!inv) {
      return (
        <RecordDetailDrawer
          open
          onClose={onClose}
          entity="invoice"
          title="Invoice not found"
          error="This invoice is no longer available in the current workspace."
        />
      );
    }
    const contactName = inv.contact
      ? [inv.contact.firstName, inv.contact.lastName].filter(Boolean).join(" ") || inv.contact.email || "Customer"
      : "Customer";
    const status = inv.status?.toUpperCase() ?? "DRAFT";
    const tone =
      status === "PAID"
        ? "success"
        : status === "OVERDUE"
        ? "error"
        : status === "SENT"
        ? "info"
        : "default";
    return (
      <RecordDetailDrawer
        open
        onClose={onClose}
        entity="invoice"
        title={inv.invoiceNumber || `Invoice ${inv.id.slice(0, 8)}`}
        subtitle={contactName}
        status={{ label: status, tone }}
        meta={[
          { label: "Total", value: `${inv.currency || currency} ${Number(inv.total ?? 0).toFixed(2)}` },
          { label: "Status", value: status },
          { label: "Issued", value: inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : "—" },
          { label: "Due", value: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—" },
        ]}
        actions={
          <button
            onClick={() => onOpenFullEditor("invoice")}
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground))" }}
          >
            Open in Invoices
          </button>
        }
      />
    );
  }
  if (entity === "quote") {
    const q = quotes.find((x) => x.id === id);
    if (!q) {
      return (
        <RecordDetailDrawer
          open
          onClose={onClose}
          entity="quote"
          title="Quote not found"
          error="This quote is no longer available in the current workspace."
        />
      );
    }
    const contactName = q.contact
      ? [q.contact.firstName, q.contact.lastName].filter(Boolean).join(" ") || q.contact.email || "Customer"
      : "Customer";
    const tone =
      q.status === "ACCEPTED" ? "success" : q.status === "REJECTED" ? "error" : q.status === "SENT" ? "info" : "default";
    return (
      <RecordDetailDrawer
        open
        onClose={onClose}
        entity="quote"
        title={q.quoteNumber || `Quote ${q.id.slice(0, 8)}`}
        subtitle={contactName}
        status={{ label: q.status, tone }}
        meta={[
          { label: "Total", value: `${q.currency || currency} ${Number(q.total ?? 0).toFixed(2)}` },
          { label: "Status", value: q.status },
          { label: "Issued", value: q.issueDate ? new Date(q.issueDate).toLocaleDateString() : "—" },
          { label: "Expires", value: q.expiryDate ? new Date(q.expiryDate).toLocaleDateString() : "—" },
        ]}
        actions={
          <button
            onClick={() => onOpenFullEditor("quote")}
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground))" }}
          >
            Open in Quotes
          </button>
        }
      />
    );
  }
  return (
    <RecordDetailDrawer
      open
      onClose={onClose}
      entity={entity}
      title={entity === "payment" ? "Payment" : "Recurring schedule"}
      subtitle={`Record ${id.slice(0, 8)}`}
      emptyMessage="Detail view will load with the matching record."
      actions={
        <button
          onClick={() => onOpenFullEditor(entity)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground))" }}
        >
          {entity === "payment" ? "Open in Payments" : "Open in Recurring"}
        </button>
      }
    />
  );
}

function PointerCards() {
  const cards = [
    {
      icon: Package,
      label: "Products & services",
      desc: "Manage your shared catalog used by quotes, invoices, and your store.",
      cta: "Open catalog",
      href: "/app/store?tab=catalog",
    },
    {
      icon: SettingsIcon,
      label: "Billing settings",
      desc: "Tax, payment gateways, branding, and invoice preferences.",
      cta: "Open settings",
      href: "/app/settings/billing",
    },
    {
      icon: BarChart3,
      label: "Revenue trends",
      desc: "Deeper analytics, forecasts, and cohort breakdowns.",
      cta: "View revenue trends",
      href: "/app/reports?view=revenue",
    },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map((card) => (
        <Link
          key={card.label}
          href={card.href}
          className="flex items-start gap-3 p-3 rounded-xl border border-border/40 bg-card hover:bg-card/80 transition-colors group"
        >
          <div
            className="p-2 rounded-lg shrink-0"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
          >
            <card.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">{card.label}</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-snug">{card.desc}</p>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium mt-1.5 text-[hsl(var(--kf-accent1))] group-hover:underline">
              {card.cta} <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
