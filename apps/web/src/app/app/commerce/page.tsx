"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  Store,
  Calendar,
  CreditCard,
  Inbox,
  Package,
} from "lucide-react";

import { useNavigationContext } from "@/lib/navigation-context";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { NAV_ROUTE_LABELS } from "@/lib/semantic-routes";
import { KeyflowUnifiedShell } from "@/components/guide/keyflow-unified-shell";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { MobileActionSheet, type MobileActionSheetItem } from "@/components/ui/mobile-action-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type RecordDetailEntity } from "@/components/ui/record-detail-drawer";
import { FlowQuickLauncher } from "@/components/layout/flow-quick-launcher";
import type { ModuleLauncherSection } from "@/components/ui/module-launcher-sheet";

import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEvent } from "@/hooks/use-module-events";
/* AI centralized in Cockpit */
import { usePlan } from "@/hooks/use-plan";

import { useCommerceShell, type UseCommerceShellReturn } from "./hooks/use-commerce-shell";
import { useBillingWorkspace } from "./hooks/use-billing-workspace";
import { useCommerceOverview } from "./hooks/use-commerce-overview";
import { useActionQueue } from "./hooks/use-action-queue";
import { RevenueComposer } from "../finance/components/revenue-composer";
import RecurringPanel from "./recurring/recurring-panel";
import QuotesPanel from "./quotes/quotes-panel";
import PaymentsTab from "./payments/payments-tab";
import { CommerceOverviewTab } from "./components/commerce-overview-tab";
import { CommerceKpiStrip } from "./components/commerce-kpi-strip";
import { TabFrame } from "./components/tab-frame";
import { RevenueRecordDrawer } from "./components/revenue-record-drawer";
import { CommerceBanners } from "./components/commerce-banners";
import { CommerceHeaderRight } from "./components/commerce-header-right";
import { RevenueActionMenu } from "./components/revenue-action-menu";
import { StandalonePaymentRecorder } from "./components/standalone-payment-recorder";

// MOUNT-QUOTES (D-150 hubs): the pipeline left Sales. Quotes is quotes-panel.tsx
// and Collections is the pipeline's collections view on its own tab; the
// invoices live at /app/commerce/invoices.
type RevenueTabKey = "snapshot" | "quotes" | "collections" | "recurring";

const REVENUE_TABS: { key: RevenueTabKey; label: string; icon: React.ElementType; tooltip?: string }[] = [
  { key: "snapshot", label: "Snapshot", icon: LayoutDashboard, tooltip: "Cashflow snapshot and key metrics" },
  { key: "quotes", label: "Quotes", icon: FileText, tooltip: "Draft, send, accept and convert quotes" },
  { key: "collections", label: "Collections", icon: DollarSign, tooltip: "Payments received, pending and overdue" },
  { key: "recurring", label: "Recurring", icon: Repeat, tooltip: "Subscriptions and scheduled invoices" },
];

const VALID_TABS = new Set<RevenueTabKey>(REVENUE_TABS.map((t) => t.key));

/** The invoices list, where every invoice door now lands. */
const INVOICES_ROUTE = "/app/commerce/invoices";

/**
 * Where a URL's ?tab (and ?view) lands now that the pipeline is gone, so a
 * stored or server-emitted link still opens a real screen:
 *   ?tab=pipeline (no view), ?tab=pipeline&view=quotes, ?tab=quotes -> the Quotes tab
 *   ?tab=pipeline&view=invoices, ?tab=invoices                      -> /app/commerce/invoices
 *   ?tab=pipeline&view=collections, ?tab=payments                   -> the Collections tab
 *   ?tab=products / billing / insights (older still)                -> the Snapshot
 * Null for a tab this page does not know (left alone, as before).
 */
function landingFor(tab: string, view: string | null): RevenueTabKey | "invoices" | null {
  if (VALID_TABS.has(tab as RevenueTabKey)) return tab as RevenueTabKey;
  if (tab === "pipeline") {
    if (view === "invoices") return "invoices";
    if (view === "collections") return "collections";
    return "quotes";
  }
  if (tab === "invoices") return "invoices";
  if (tab === "payments") return "collections";
  if (["products", "billing", "insights"].includes(tab)) return "snapshot";
  return null;
}

function CommerceQuickLauncher() {
  const sections: ModuleLauncherSection[] = [
    {
      id: "commerce",
      label: "Commerce",
      items: [
        { id: "storefront", label: "Storefront", icon: Store, href: "/app/store", tone: "violet" },
        { id: "events", label: "Events", icon: Calendar, href: "/app/events", tone: "teal" },
        { id: "gateway", label: "Gateway", icon: CreditCard, href: "/app/commerce/gateway", tone: "mint" },
        { id: "inbox", label: "Inbox", icon: Inbox, href: "/app/data-inbox", tone: "default" },
      ],
    },
    {
      id: "money",
      label: "Money",
      items: [
        { id: "financial-flow", label: "Financial Flow", icon: TrendingUp, href: "/app/financial-flow", tone: "gold" },
        { id: "expenses", label: "Expenses", icon: DollarSign, href: "/app/expenses", tone: "rose" },
        { id: "reports", label: "Reports", icon: FileText, href: "/app/finance/reports", tone: "sky" },
      ],
    },
  ];

  return (
    <FlowQuickLauncher
      title="Commerce Modules"
      subtitle="Storefront, events, payments, and money"
      sections={sections}
    />
  );
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
      // The overview, the action queue and the record drawer still name the
      // old segments (invoices, payments, pipeline): each lands where its
      // screen is now.
      const landing = landingFor(key, null) ?? "snapshot";
      if (landing === "invoices") {
        router.push(INVOICES_ROUTE);
        return;
      }
      const next = landing;
      setActiveTab(next);
      overview.handleTabChange(next);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      url.searchParams.delete("view");
      window.history.replaceState({}, "", url.toString());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- narrow to overview.handleTabChange to avoid re-creating the callback on every overview state change
    [overview.handleTabChange, router],
  );

  // The tab follows ?tab for as long as the page is mounted, not only on its
  // first render. Next keeps this page mounted across a search-param-only
  // navigation, so a nav door back to /app/commerce (Money > Quotes is
  // ?tab=pipeline&view=quotes, Money > Sales has no tab) clicked while already
  // here changed the URL and left the old tab on screen (R0-08b F2). The tab
  // only leaves the URL by such a navigation, so no tab means the Snapshot.
  // handleTabChange writes its tab back through replaceState, which Next feeds
  // into useSearchParams, so following the URL there is a no-op.
  const paramTab = searchParams.get("tab");
  const paramView = searchParams.get("view");
  useEffect(() => {
    if (!paramTab) {
      setActiveTab("snapshot");
      return;
    }
    const landing = landingFor(paramTab, paramView);
    if (!landing) return;
    if (landing === "invoices") {
      // MOUNT-QUOTES: the invoices left this page for their own list.
      router.replace(INVOICES_ROUTE);
      return;
    }
    setActiveTab(landing);
    if (landing !== paramTab || paramView) {
      // The legacy door is rewritten to the tab it landed on (the command
      // palette, the new-entity menu, the contact actions and Money's doors
      // still push ?tab=pipeline / quotes / invoices / payments).
      const url = new URL(window.location.href);
      url.searchParams.set("tab", landing);
      url.searchParams.delete("view");
      window.history.replaceState({}, "", url.toString());
    }
  }, [paramTab, paramView, router]);

  // WEDGE-WA-INBOUND-CAPTURE (D-263): New quote for a customer from another screen ("+ New > From WhatsApp") is the
  // Quotes door with ?contactId=<id>: the Quotes tab opens the New quote form with that customer chosen. It follows
  // the URL while the page is mounted; the id then leaves the URL, so a reload or Back does not open a second form. A
  // contactId on any other tab is left alone. Every door to a new quote for a customer is this URL: the WhatsApp sheet
  // (a full page load), a contact's Send quote (use-contact-actions.ts) and the next-action Send quote
  // (use-contacts-pipeline.ts), both router.push; the "commerce:create_quote_for_contact" event this page also
  // listened for had no sender left and is gone. A client navigation mounts this page once since
  // FU-REQUIRE-AUTH-REMOUNT (RequireAuth no longer remounts the shell on a pathname change), so it reads the id
  // (FU-CONTACT-SEND-QUOTE-DOOR).
  const paramContactId = searchParams.get("contactId");
  useEffect(() => {
    if (!paramContactId || !paramTab || landingFor(paramTab, paramView) !== "quotes") return;
    billing.prefillForContact(paramContactId, "quotes");
    const url = new URL(window.location.href);
    url.searchParams.delete("contactId");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- billing's prefillForContact is stable (useCallback, no deps)
  }, [paramContactId, paramTab, paramView]);

  useEffect(() => {
    const recordType = searchParams.get("recordType");
    const recordId = searchParams.get("recordId");
    if (recordType && recordId && ["quote", "invoice", "payment", "recurring"].includes(recordType)) {
      setRecordDrawer({ entity: recordType as RecordDetailEntity, id: recordId });
      return;
    }
    // Money's activity feed links a quote as ?tab=pipeline&quote=<id> (MOUNT-QUOTES).
    const quoteId = searchParams.get("quote");
    if (quoteId) setRecordDrawer({ entity: "quote", id: quoteId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount-time deep-link read
  }, []);

  // R0-CMF5-GMAIL-CONNECT-BINDING: Google consent (from Revenue, Marketing or
  // the Google Suite sign-in) lands here with gmail=pending&pending=<id>. Nothing
  // is linked yet: the owner is shown the mailbox the consent was completed with
  // and connects it with one more click, or declines. gmail=error says why the
  // sign-in did not get that far. The parameters are a one-time hand-off, so
  // they leave the URL once read and a reload does not replay them.
  const gmail = shell.integrations as UseCommerceShellReturn["integrations"] | undefined;
  const loadPendingGmail = gmail?.loadPendingGmail;
  const gmailParam = searchParams.get("gmail");
  const gmailPendingParam = searchParams.get("pending");
  const gmailReasonParam = searchParams.get("reason");
  useEffect(() => {
    if (!businessId || !gmailParam) return;
    if (gmailParam === "pending" && gmailPendingParam && loadPendingGmail) {
      void loadPendingGmail(gmailPendingParam);
    } else if (gmailParam === "error") {
      toast.error(
        gmailReasonParam === "invalid_state"
          ? "That Gmail sign-in expired or was already used. Connect Gmail again."
          : "Gmail could not be connected. Try again.",
      );
    }
    const url = new URL(window.location.href);
    for (const key of ["gmail", "pending", "reason", "google", "services", "email"]) url.searchParams.delete(key);
    window.history.replaceState({}, "", url.toString());
  }, [businessId, gmailParam, gmailPendingParam, gmailReasonParam, loadPendingGmail]);

  useEffect(() => {
    // A quote prefill (a customer's ?contactId on the Quotes door) opens the
    // Quotes tab, where the panel reads it; an invoice prefill goes to the
    // invoice list's builder.
    if (billing.pendingPrefill?.targetSegment === "quotes") {
      if (activeTab !== "quotes") handleTabChange("quotes");
    } else if (billing.pendingPrefill?.targetSegment === "invoices") {
      router.push(`${INVOICES_ROUTE}/new`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to new prefill arrivals
  }, [billing.pendingPrefill]);

  useModuleEvent<{ contactId?: string; items?: import("./components/commerce-types").InvoiceLineItem[] }>(
    "commerce:create_invoice_for_contact",
    useCallback(
      (event) => {
        const { contactId, items } = event.data ?? {};
        if (contactId) {
          billing.prefillForContact(contactId, "invoices", items);
          toast.success("Opening invoice builder for contact...");
        }
      },
      [billing],
    ),
  );

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
    if (activeTab === "recurring") billing.setTriggerNewSchedule((n: number) => n + 1);
    else if (activeTab === "quotes") billing.setTriggerNewQuote((n: number) => n + 1);
    else billing.setTriggerNewInvoice((n: number) => n + 1);
  }, [activeTab, billing]);

  const commerceShortcuts = useMemo<ShortcutGroup[]>(
    () => [
      {
        groupName: "Revenue Navigation",
        shortcuts: [
          { key: "1", description: "Snapshot", action: () => handleTabChange("snapshot") },
          { key: "2", description: "Quotes", action: () => handleTabChange("quotes") },
          { key: "3", description: "Collections", action: () => handleTabChange("collections") },
          { key: "4", description: "Recurring", action: () => handleTabChange("recurring") },
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
      pageTitle={NAV_ROUTE_LABELS["/app/commerce"]}
      availableActions={["Create invoice", "Send quote", "Record payment", "Set up recurring billing"]}
    >
    {/* Header label under decision D-09 — the nav and the breadcrumb read the
        same constant, so the screen is called what the rail called it. */}
    <WorkspaceShell
      icon={TrendingUp}
      title={NAV_ROUTE_LABELS["/app/commerce"]}
      subtitle="Quotes, invoices, collections, and cashflow actions."
      tabs={tabsForShell}
      activeTab={activeTab}
      onTabChange={(k) => handleTabChange(k)}
      tabLayoutId="revenue-tabs"
      tabVariant="pill"
      /* AI centralized in Cockpit */
      headerRight={
        <div className="flex items-center gap-2">
          {/* CATALOG-1: Sales > Products, what you sell (journey B1, B5, B6 read this door). */}
          <Link
            href="/app/commerce/products"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/60 hover:bg-muted/40 transition-colors"
          >
            <Package className="w-3.5 h-3.5" aria-hidden="true" />
            Products
          </Link>
          <CommerceQuickLauncher />
          <CommerceHeaderRight revenuePulse={overview.revenuePulse} />
          <RevenueActionMenu
            onNewInvoice={() => { billing.setTriggerNewInvoice((n: number) => n + 1); }}
            onNewQuote={() => { handleTabChange("quotes"); billing.setTriggerNewQuote((n: number) => n + 1); }}
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
        <CommerceKpiStrip
          businessId={businessId}
          invoices={invoices}
          quotes={quotes}
          products={shell.products}
          currency={businessCurrency}
        />
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

      {activeTab === "quotes" && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <QuotesPanel
            quotes={quotes}
            contacts={shell.contacts}
            products={shell.products}
            businessId={businessId}
            loading={shell.loading}
            gmailStatus={gmail?.gmailStatus ?? null}
            setProducts={shell.setProducts}
            setQuotes={shell.setQuotes}
            setInvoices={shell.setInvoices}
            currency={businessCurrency}
            onSwitchToInvoices={() => router.push(INVOICES_ROUTE)}
            prefillContactId={billing.pendingPrefill?.targetSegment === "quotes" ? billing.pendingPrefill.contactId : undefined}
            prefillItems={billing.pendingPrefill?.targetSegment === "quotes" ? billing.pendingPrefill.items : undefined}
            prefillToken={billing.pendingPrefill?.targetSegment === "quotes" ? billing.pendingPrefill._token : undefined}
            onPrefillApplied={billing.clearPrefill}
            onViewContact={(contactId) => router.push(`/app/crm/contacts/${encodeURIComponent(contactId)}`)}
          />
        </TabFrame>
      )}

      {activeTab === "collections" && (
        <TabFrame loading={shell.loading} error={shell.error}>
          <PaymentsTab
            invoices={invoices}
            currency={businessCurrency}
            businessId={businessId}
            setInvoices={shell.setInvoices}
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
          if (entity === "quote") handleTabChange("quotes");
          else if (entity === "invoice" || entity === "payment") handleTabChange("invoices");
          else if (entity === "recurring") handleTabChange("recurring");
          closeRecordDrawer();
        }}
      />

      <StandalonePaymentRecorder
        businessId={businessId ?? ""}
        open={paymentRecorderOpen}
        onClose={() => setPaymentRecorderOpen(false)}
      />

      {gmail?.pendingGmail && (
        <ConfirmDialog
          open
          title={`Connect ${gmail.pendingGmail.email}?`}
          message={`Invoices, reminders, receipts and quotes will be sent from ${gmail.pendingGmail.email}. Connect it only if this is the mailbox you just signed in with.`}
          confirmLabel={gmail.confirmingGmail ? "Connecting..." : "Connect mailbox"}
          busy={gmail.confirmingGmail}
          cancelLabel="Not this mailbox"
          onConfirm={() => void gmail.handleConfirmPendingGmail()}
          onCancel={gmail.handleCancelPendingGmail}
        />
      )}

      {/* Progressive prompts centralized in Cockpit */}
    </WorkspaceShell>
    </KeyflowUnifiedShell>
  );
}

/* PointerCards removed — cross-module links belong in Cockpit or Studio */
