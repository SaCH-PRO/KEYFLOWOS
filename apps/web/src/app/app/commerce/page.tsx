"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CreditCard,
  FileText,
  DollarSign,
  RefreshCw,
  Plus,
  Clock,
  AlertTriangle,
  TrendingUp,
  Receipt,
  Send,
  Repeat,
  LayoutDashboard,
} from "lucide-react";

import { useNavigationContext } from "@/lib/navigation-context";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
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
import InvoicesPanel from "./invoices/invoices-panel";
import QuotesPanel from "./quotes/quotes-panel";
import RecurringPanel from "./recurring/recurring-panel";
import PaymentsTab from "./payments/payments-tab";
import { CommerceOverviewTab } from "./components/commerce-overview-tab";
import { TabFrame } from "./components/tab-frame";
import { RevenueRecordDrawer } from "./components/revenue-record-drawer";
import { CommerceBanners } from "./components/commerce-banners";
import { CommerceHeaderRight } from "./components/commerce-header-right";

type RevenueTabKey = "overview" | "quotes" | "invoices" | "payments" | "recurring";

const REVENUE_TABS: { key: RevenueTabKey; label: string; icon: React.ElementType; tooltip?: string }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, tooltip: "Cashflow snapshot and key metrics" },
  { key: "quotes", label: "Quotes", icon: FileText, tooltip: "Drafts, sent, accepted quotes" },
  { key: "invoices", label: "Invoices", icon: Receipt, tooltip: "Drafts, sent, overdue, paid" },
  { key: "payments", label: "Payments", icon: DollarSign, tooltip: "Collected and pending payments" },
  { key: "recurring", label: "Recurring", icon: Repeat, tooltip: "Subscriptions and scheduled invoices" },
];

const VALID_TABS = new Set<RevenueTabKey>(REVENUE_TABS.map((t) => t.key));

export default function CommercePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getOriginContext } = useNavigationContext();
  const { getReturnLabel, navigateBack } = useReturnNavigation({ skipScrollListener: true });

  const shell = useCommerceShell();
  const billing = useBillingWorkspace();
  const overview = useCommerceOverview(shell.invoices, shell.businessCurrency);
  const { checkLimit } = usePlan();

  const { businessId, businessCurrency, invoices, quotes } = shell;

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

  const financialSummary = useFinancialSummary(invoices, quotes);
  const actionQueue = useActionQueue(invoices, quotes, businessCurrency, handleTabChange, openRecordDrawer);

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
  const limitCheck = checkLimit("invoices");

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
      /* AI centralized in Cockpit */
      actionLabel="+ New"
      actionIcon={Plus}
      onAction={handlePrimaryAction}
      actionDataAttr="commerce-new"
      headerRight={<CommerceHeaderRight revenuePulse={overview.revenuePulse} />}
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
        <div className="flex items-center gap-4 text-sm" data-walkthrough="commerce-kpi">
          <span className="text-muted-foreground">
            Outstanding: <span className={cn("font-semibold", financialSummary.outstanding > 0 ? "text-amber-400" : "text-muted-foreground")}>{formatCurrencyCompact(financialSummary.outstanding, businessCurrency)}</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            Overdue: <span className={cn("font-semibold", financialSummary.overdue > 0 ? "text-red-400" : "text-muted-foreground")}>{formatCurrencyCompact(financialSummary.overdue, businessCurrency)}</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            Collected: <span className="font-semibold text-emerald-400">{formatCurrencyCompact(financialSummary.collectedThisMonth, businessCurrency)}</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            Drafts: <span className={cn("font-semibold", financialSummary.draftCount > 0 ? "text-foreground" : "text-muted-foreground")}>{financialSummary.draftCount}</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            Quotes: <span className={cn("font-semibold", financialSummary.pendingQuotes > 0 ? "text-foreground" : "text-muted-foreground")}>{financialSummary.pendingQuotes}</span>
          </span>
        </div>
      }
    >
      {/* AI insights centralized in Cockpit */}

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

      {/* Actions merged into Overview. Inventory moved to Studio > Products. */}

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

      {/* Progressive prompts centralized in Cockpit */}
    </WorkspaceShell>
  );
}

/* PointerCards removed — cross-module links belong in Cockpit or Studio */
