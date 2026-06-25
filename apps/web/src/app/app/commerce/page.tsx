"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FileText,
  DollarSign,
  RefreshCw,
  TrendingUp,
  Receipt,
  Send,
  Repeat,
  LayoutDashboard,
} from "lucide-react";

import { useNavigationContext } from "@/lib/navigation-context";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { KeyflowUnifiedShell } from "@/components/guide/keyflow-unified-shell";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { MobileActionSheet, type MobileActionSheetItem } from "@/components/ui/mobile-action-sheet";
import { type RecordDetailEntity } from "@/components/ui/record-detail-drawer";

import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEvent } from "@/hooks/use-module-events";
/* AI centralized in Cockpit */
import { usePlan } from "@/hooks/use-plan";

import { formatCurrencyCompact } from "@/lib/currency";

import { useCommerceShell } from "./hooks/use-commerce-shell";
import { useBillingWorkspace } from "./hooks/use-billing-workspace";
import { useCommerceOverview } from "./hooks/use-commerce-overview";
import { useFinancialSummary } from "./hooks/use-financial-summary";
import { useActionQueue } from "./hooks/use-action-queue";
import { FinancePipeline } from "../finance/components/finance-pipeline";
import { RevenueComposer } from "../finance/components/revenue-composer";
import RecurringPanel from "./recurring/recurring-panel";
import { CommerceOverviewTab } from "./components/commerce-overview-tab";
import { TabFrame } from "./components/tab-frame";
import { RevenueRecordDrawer } from "./components/revenue-record-drawer";
import { CommerceBanners } from "./components/commerce-banners";
import { CommerceHeaderRight } from "./components/commerce-header-right";
import { RevenueActionMenu } from "./components/revenue-action-menu";
import { StandalonePaymentRecorder } from "./components/standalone-payment-recorder";

type RevenueTabKey = "snapshot" | "pipeline" | "recurring";

const REVENUE_TABS: { key: RevenueTabKey; label: string; icon: React.ElementType; tooltip?: string }[] = [
  { key: "snapshot", label: "Snapshot", icon: LayoutDashboard, tooltip: "Cashflow snapshot and key metrics" },
  { key: "pipeline", label: "Pipeline", icon: TrendingUp, tooltip: "Quotes, invoices, collections, and revenue flow" },
  { key: "recurring", label: "Recurring", icon: Repeat, tooltip: "Subscriptions and scheduled invoices" },
];

const VALID_TABS = new Set<RevenueTabKey>(REVENUE_TABS.map((t) => t.key));

export default function CommercePage() {
  const _router = useRouter();
  const searchParams = useSearchParams();
  const { getOriginContext } = useNavigationContext();
  const { getReturnLabel, navigateBack } = useReturnNavigation({ skipScrollListener: true });

  const shell = useCommerceShell();
  const billing = useBillingWorkspace();
  const overview = useCommerceOverview(shell.invoices, shell.businessCurrency);
  const { checkLimit } = usePlan();

  const { businessId, businessCurrency, invoices, quotes } = shell;

  const [activeTab, setActiveTab] = useState<RevenueTabKey>("snapshot");
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [recordDrawer, setRecordDrawer] = useState<{ entity: RecordDetailEntity; id: string } | null>(null);
  const [paymentRecorderOpen, setPaymentRecorderOpen] = useState(false);

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
      const next = (VALID_TABS.has(key as RevenueTabKey) ? key : "snapshot") as RevenueTabKey;
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
      setActiveTab("snapshot");
    } else if (["quotes", "invoices", "payments"].includes(paramTab)) {
      // Redirect old tabs to pipeline
      setActiveTab("pipeline");
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "pipeline");
      window.history.replaceState({}, "", url.toString());
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
      if (activeTab !== "pipeline") handleTabChange("pipeline");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to new prefill arrivals
  }, [billing.pendingPrefill]);

  useModuleEvent<{ contactId?: string; items?: import("./components/commerce-types").InvoiceLineItem[] }>(
    "commerce:create_quote_for_contact",
    useCallback(
      (event) => {
        const { contactId, items } = event.data ?? {};
        if (contactId) {
          billing.prefillForContact(contactId, "quotes", items);
          handleTabChange("pipeline");
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
          handleTabChange("pipeline");
          toast.success("Opening invoice builder for contact...");
        }
      },
      [billing, handleTabChange],
    ),
  );

  const financialSummary = useFinancialSummary(invoices, quotes);
  const _actionQueue = useActionQueue(invoices, quotes, businessCurrency, handleTabChange, openRecordDrawer);

  const mobileSheetItems = useMemo<MobileActionSheetItem[]>(
    () => [
      {
        key: "new-invoice",
        label: "New invoice",
        description: "Bill a customer for delivered work",
        icon: Receipt,
        tone: "primary",
        onSelect: () => {
          handleTabChange("pipeline");
          billing.setTriggerNewInvoice((n: number) => n + 1);
        },
      },
      {
        key: "new-quote",
        label: "New quote",
        description: "Draft a proposal for a prospect",
        icon: FileText,
        onSelect: () => {
          handleTabChange("pipeline");
          billing.setTriggerNewQuote((n: number) => n + 1);
        },
      },
      {
        key: "record-payment",
        label: "Record a payment",
        description: "Upload evidence and match to an invoice",
        icon: DollarSign,
        onSelect: () => {
          setPaymentRecorderOpen(true);
        },
      },
      {
        key: "convert-quote",
        label: "Convert quote to invoice",
        description: "Pick an accepted quote to bill",
        icon: Send,
        onSelect: () => {
          handleTabChange("pipeline");
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
    if (activeTab === "recurring") target = "recurring";
    else target = "pipeline";
    if (activeTab !== target) handleTabChange(target);
    if (target === "recurring") billing.setTriggerNewSchedule((n: number) => n + 1);
    else billing.setTriggerNewInvoice((n: number) => n + 1);
  }, [activeTab, handleTabChange, billing]);

  const commerceShortcuts = useMemo<ShortcutGroup[]>(
    () => [
      {
        groupName: "Revenue Navigation",
        shortcuts: [
          { key: "1", description: "Snapshot", action: () => handleTabChange("snapshot") },
          { key: "2", description: "Pipeline", action: () => handleTabChange("pipeline") },
          { key: "3", description: "Recurring", action: () => handleTabChange("recurring") },
        ],
      },
    ],
    [handleTabChange],
  );

  useKeyboardShortcuts(commerceShortcuts, !shell.workspaceLoading);

  const _renderTimelineBadge = useCallback(() => null, []);

  if (shell.workspaceLoading) return <ListPageSkeleton />;
  if (shell.workspaceError) return <WorkspaceError />;

  const originContext = getOriginContext();
  const showCrossModuleBanner =
    originContext && originContext.workspace && originContext.workspace !== "Revenue" && billing.pendingPrefill?.contactId;
  const limitCheck = checkLimit("invoices");

  const tabsForShell = REVENUE_TABS.map((t) => ({
    key: t.key,
    label: t.label,
    icon: t.icon,
    tooltip: t.tooltip,
    count: undefined,
  }));

  return (
    <KeyflowUnifiedShell
      module="revenue"
      pageTitle="Revenue"
      availableActions={["Create invoice", "Send quote", "Record payment", "Set up recurring billing"]}
    >
    <WorkspaceShell
      icon={TrendingUp}
      title="Revenue"
      subtitle="Quotes, invoices, collections, and cashflow actions."
      tabs={tabsForShell}
      activeTab={activeTab}
      onTabChange={(k) => handleTabChange(k)}
      tabLayoutId="revenue-tabs"
      /* AI centralized in Cockpit */
      headerRight={
        <div className="flex items-center gap-2">
          <CommerceHeaderRight revenuePulse={overview.revenuePulse} />
          <RevenueActionMenu
            onNewInvoice={() => { handleTabChange("pipeline"); billing.setTriggerNewInvoice((n: number) => n + 1); }}
            onNewQuote={() => { handleTabChange("pipeline"); billing.setTriggerNewQuote((n: number) => n + 1); }}
            onNewRecurring={() => { handleTabChange("recurring"); billing.setTriggerNewSchedule((n: number) => n + 1); }}
            onRecordPayment={() => setPaymentRecorderOpen(true)}
          />
        </div>
      }
      banners={
        <CommerceBanners
          showCrossModuleBanner={!!showCrossModuleBanner}
          returnLabel={getReturnLabel()}
          onNavigateBack={navigateBack}
          crossModuleAction={billing.pendingPrefill?.targetSegment === "quotes" ? "Creating quote" : "Creating invoice"}
          crossModuleOrigin={originContext?.workspace ?? ""}
          limitCheck={limitCheck}
          shellError={shell.error}
        />
      }
      metricStrip={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-walkthrough="commerce-kpi">
          {[
            { label: "Outstanding", value: formatCurrencyCompact(financialSummary.outstanding, businessCurrency), color: financialSummary.outstanding > 0 ? "text-amber-400" : "text-muted-foreground" },
            { label: "Overdue", value: formatCurrencyCompact(financialSummary.overdue, businessCurrency), color: financialSummary.overdue > 0 ? "text-red-400" : "text-muted-foreground" },
            { label: "Collected", value: formatCurrencyCompact(financialSummary.collectedThisMonth, businessCurrency), color: "text-emerald-400" },
            { label: "Drafts", value: String(financialSummary.draftCount), color: financialSummary.draftCount > 0 ? "text-foreground" : "text-muted-foreground" },
            { label: "Quotes", value: String(financialSummary.pendingQuotes), color: financialSummary.pendingQuotes > 0 ? "text-foreground" : "text-muted-foreground" },
          ].map((stat, _i) => (
            <span key={stat.label} className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-xs">{stat.label}:</span>
              <span className={cn("text-xs font-semibold", stat.color)}>{stat.value}</span>
            </span>
          ))}
        </div>
      }
    >
      {/* AI insights centralized in Cockpit */}

      {activeTab === "snapshot" && (
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
      
          </div>
        </TabFrame>
      )}

      {activeTab === "pipeline" && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <FinancePipeline
            businessId={businessId}
            quotes={quotes}
            invoices={invoices}
            loading={shell.loading}
            currency={businessCurrency}
            contacts={shell.contacts}
            setInvoices={shell.setInvoices}
            onViewRecord={(record) => {
              if (record.type === "quote") openRecordDrawer("quote", record.id);
              else if (record.type === "invoice") openRecordDrawer("invoice", record.id);
            }}

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

      {/* Actions merged into Overview. Inventory moved to Studio > Products. */}

      <RevenueComposer
        businessId={businessId}
        contacts={shell.contacts}
        products={shell.products}
        currency={businessCurrency}
        setQuotes={shell.setQuotes}
        setInvoices={shell.setInvoices}
        setProducts={shell.setProducts}
        triggerNewQuote={billing.triggerNewQuote}
        triggerNewInvoice={billing.triggerNewInvoice}
      />

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
          if (entity === "quote" || entity === "invoice" || entity === "payment") handleTabChange("pipeline");
          else if (entity === "recurring") handleTabChange("recurring");
          closeRecordDrawer();
        }}
      />

      <StandalonePaymentRecorder
        businessId={businessId ?? ""}
        open={paymentRecorderOpen}
        onClose={() => setPaymentRecorderOpen(false)}
      />

      {/* Progressive prompts centralized in Cockpit */}
    </WorkspaceShell>
    </KeyflowUnifiedShell>
  );
}

/* PointerCards removed — cross-module links belong in Cockpit or Studio */
