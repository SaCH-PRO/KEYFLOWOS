"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  BarChart3,
  LayoutDashboard,
  Plus,
  Search,
  Sparkles,
  HelpCircle,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { AiCommandHub } from "@/components/ai/ai-command-hub";

import { ListPageSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { useCommerce } from "./hooks/use-commerce";
import { CommerceGuideDrawer } from "./components/commerce-guide";
import { BillingPanel } from "./billing/billing-panel";
import { CommerceInsightsTab } from "./insights/commerce-insights-tab";
import { CommerceOverviewTab } from "./components/commerce-overview-tab";
import { useCommerceAiHub } from "./hooks/use-commerce-ai-hub";
import { renderCommerceToolResult } from "./components/commerce-tool-results";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit, useModuleEvent } from "@/hooks/use-module-events";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useRouter } from "next/navigation";
import { commerceAiExecute } from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";
import type { BillingSlots } from "./utils/commerce-slots";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "catalog", label: "Catalog & Intelligence", icon: BarChart3 },
];

export default function CommercePage() {
  const state = useCommerce();
  const commerceAi = useCommerceAiHub();
  const emitEvent = useModuleEmit();
  const router = useRouter();
  const [slideDirection, setSlideDirection] = useState(0);
  const COMMERCE_TAB_KEYS = TABS.map((t) => t.key);
  const {
    businessId, businessCurrency, workspaceLoading, workspaceError, tab, handleTabChange: rawTabChange,
    products, invoices, quotes, contacts, loading, error,
    showGuide, handleToggleGuide, handleCloseGuide, handleNewItem,
    activeBillingSegment: billingSegment, setActiveBillingSegment: setBillingSegment,
    gmailStatus,
    pendingPrefill, clearPrefill, prefillForContact,
  } = state;

  const handleTabChange = useCallback((t: string) => {
    if (t === tab) return;
    const oldIndex = COMMERCE_TAB_KEYS.indexOf(tab);
    const newIndex = COMMERCE_TAB_KEYS.indexOf(t);
    setSlideDirection(newIndex > oldIndex ? 1 : -1);
    rawTabChange(t);
  }, [tab, rawTabChange]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: COMMERCE_TAB_KEYS,
    activeTab: tab,
    onTabChange: handleTabChange,
  });

  useModuleEvent("commerce:create_quote_for_contact", useCallback((event: any) => {
    const { contactId, items } = event.data ?? {};
    if (contactId) {
      prefillForContact(contactId, "quotes", items);
      toast.success("Opening quote builder for contact...");
    }
  }, [prefillForContact]));

  useModuleEvent("commerce:create_invoice_for_contact", useCallback((event: any) => {
    const { contactId, items } = event.data ?? {};
    if (contactId) {
      prefillForContact(contactId, "invoices", items);
      toast.success("Opening invoice builder for contact...");
    }
  }, [prefillForContact]));

  useEffect(() => {
    if (pendingPrefill?.targetSegment && tab === "billing") {
      setBillingSegment(pendingPrefill.targetSegment === "quotes" ? "quotes" : "invoices");
    }
  }, [pendingPrefill, tab]);

  useEffect(() => {
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: tab === "billing" ? billingSegment : tab,
        itemCount: invoices.length + quotes.length,
      });
    }
  }, [businessId, tab, billingSegment, invoices.length, quotes.length, commerceAi.updateCommerceContext]);

  const handleViewContact = useCallback((contactId: string) => {
    if (contactId) {
      emitEvent("contact:selected", "commerce", { contactId });
      router.push(`/app/crm/contacts/${contactId}`);
    }
  }, [emitEvent, router]);

  const handleViewClientIntel = useCallback((contactId: string) => {
    if (contactId) {
      emitEvent("commerce:view_client_intel", "commerce", { contactId });
      if (!commerceAi.panelOpen) commerceAi.setOpen(true);
      commerceAi.executeTool("client-intelligence");
    }
  }, [emitEvent, commerceAi]);

  const handleAiRecoveryPlan = useCallback(() => {
    if (!commerceAi.panelOpen) commerceAi.setOpen(true);
    commerceAi.executeTool("overdue-recovery");
  }, [commerceAi]);

  const handleAiForecast = useCallback(() => {
    if (!commerceAi.panelOpen) commerceAi.setOpen(true);
    commerceAi.executeTool("cashflow-forecast");
  }, [commerceAi]);

  const handleAiDraftReminder = useCallback((invoiceId: string) => {
    commerceAi.updateCommerceContext({ businessId: businessId!, activeView: "invoices", selectedItemId: invoiceId });
    if (!commerceAi.panelOpen) commerceAi.setOpen(true);
    commerceAi.executeTool("invoice-reminder");
  }, [businessId, commerceAi]);


  const handleAiAssistantAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("filter_status:")) {
      handleTabChange("billing");
      setBillingSegment("invoices");
      toast.success(`Filtering by ${actionKey.split(":")[1]}`);
    } else if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.split(":")[1];
      if (t === "quotes" || t === "invoices" || t === "schedules" || t === "recurring") {
        handleTabChange("billing");
        setBillingSegment(t === "recurring" ? "schedules" : t as "quotes" | "invoices" | "schedules");
      } else {
        handleTabChange(t === "insights" ? "catalog" : t);
      }
    } else if (actionKey.startsWith("send_reminders:")) {
      handleTabChange("billing");
      setBillingSegment("invoices");
      toast.success("Opening invoices for reminders...");
    } else if (actionKey.startsWith("tool:")) {
      const toolId = actionKey.split(":")[1];
      if (!commerceAi.panelOpen) commerceAi.setOpen(true);
      commerceAi.executeTool(toolId);
    }
  }, [handleTabChange, commerceAi]);

  const handleWrappedTabChange = useCallback((t: string) => {
    handleTabChange(t);
    emitEvent("module:tab_changed", "commerce", { tab: t });
  }, [handleTabChange, emitEvent]);

  const handleOverviewNavigate = useCallback((navTab: string, segment?: string) => {
    handleTabChange(navTab);
    if (navTab === "billing" && segment) {
      setBillingSegment(segment as "quotes" | "invoices" | "schedules");
    }
  }, [handleTabChange]);

  const revenuePulse = useMemo(() => {
    const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    return formatCurrencyCompact(totalRevenue, businessCurrency);
  }, [invoices, businessCurrency]);

  const commerceShortcuts = useMemo<ShortcutGroup[]>(() => {
    const shortcuts: ShortcutGroup[] = [
      {
        groupName: "Commerce Navigation",
        shortcuts: [
          { key: "n", description: "New item", action: () => handleNewItem() },
          { key: "f", description: "Focus search", action: () => { if (!commerceAi.panelOpen) commerceAi.setOpen(true); } },
          { key: "/", description: "Focus search", action: () => { if (!commerceAi.panelOpen) commerceAi.setOpen(true); } },
          { key: "1", description: "Overview tab", action: () => handleTabChange("overview") },
          { key: "2", description: "Billing tab", action: () => handleTabChange("billing") },
          { key: "3", description: "Catalog tab", action: () => handleTabChange("catalog") },
          { key: "r", description: "Refresh data", action: () => { state.refreshProducts(); } },
          { key: "a", shift: true, description: "Toggle AI Copilot", action: () => commerceAi.togglePanel() },
          { key: "?", description: "Help", action: () => handleToggleGuide() },
          { key: "Escape", description: "Close panels", action: () => { if (commerceAi.hubMode === "tool-result") commerceAi.clearToolResult(); else if (commerceAi.panelOpen) commerceAi.setOpen(false); } },
        ],
      },
    ];
    if (tab === "billing") {
      shortcuts.push({
        groupName: "Billing Segments",
        shortcuts: [
          { key: "i", description: "Invoices segment", action: () => setBillingSegment("invoices") },
          { key: "q", description: "Quotes segment", action: () => setBillingSegment("quotes") },
          { key: "s", description: "Recurring segment", action: () => setBillingSegment("schedules") },
        ],
      });
    }
    return shortcuts;
  }, [handleNewItem, handleTabChange, state.refreshProducts, commerceAi.togglePanel, commerceAi.panelOpen, commerceAi.setOpen, commerceAi.hubMode, commerceAi.clearToolResult, handleToggleGuide, tab, setBillingSegment]);

  useKeyboardShortcuts(commerceShortcuts, !workspaceLoading);

  const billingSlots = useMemo<BillingSlots>(() => ({
    renderHeaderExtra: () => (
      <button
        onClick={() => { if (!commerceAi.panelOpen) commerceAi.setOpen(true); }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/5 hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors text-xs font-medium text-[hsl(var(--kf-accent1))]"
      >
        <Sparkles className="w-3 h-3" />
        Ask AI
      </button>
    ),
  }), [commerceAi.panelOpen, commerceAi.setOpen]);

  if (workspaceLoading) return <ListPageSkeleton />;

  if (workspaceError) {
    return <WorkspaceError />;
  }

  return (
    <div className="space-y-6" aria-label="Commerce">
      <PageHeader
        icon={CreditCard}
        title="Commerce"
        subtitle="Revenue workspace"
        rightSlot={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 bg-white/[0.03] text-sm">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-semibold text-xs text-emerald-400">{revenuePulse}</span>
              <span className="text-[10px] text-muted-foreground/50">collected</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => commerceAi.togglePanel()}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="Search & commands"
                title="Search & commands (/ or F)"
              >
                <Search className="w-3.5 h-3.5 text-muted-foreground/60" />
              </button>
              <button
                onClick={() => commerceAi.togglePanel()}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="AI Copilot"
                title="AI Copilot (Shift+A)"
              >
                <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]/60" />
              </button>
              <button
                onClick={handleToggleGuide}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="Help"
                title="Help (?)"
              >
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/60" />
              </button>
            </div>
          </div>
        }
        actionLabel="+ New"
        actionIcon={Plus}
        onAction={handleNewItem}
      />

      <AnimatePresence>
        {commerceAi.panelOpen && (
          <AiCommandHub
            ai={commerceAi}
            moduleName="Commerce"
            onAction={handleAiAssistantAction}
            toolResultRenderer={renderCommerceToolResult}
          />
        )}
      </AnimatePresence>

      <CommerceGuideDrawer
        isOpen={showGuide}
        onClose={handleCloseGuide}
        onTabChange={handleTabChange}
      />

      <TabNav
        tabs={TABS}
        activeTab={tab}
        onTabChange={handleWrappedTabChange}
      />

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
          <span className="text-amber-400">!</span> {error}
        </div>
      )}

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={slideDirection}>
          {tab === "overview" && (
            <motion.div key="overview" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <CommerceOverviewTab
                businessId={businessId}
                invoices={invoices}
                quotes={quotes}
                currency={businessCurrency}
                loading={loading}
                onNavigate={handleOverviewNavigate}
                onNewItem={handleNewItem}
              />
            </motion.div>
          )}
          {tab === "billing" && (
            <motion.div key="billing" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <BillingPanel
                businessId={businessId}
                contacts={contacts}
                products={products}
                quotes={quotes}
                invoices={invoices}
                loading={loading}
                gmailStatus={gmailStatus}
                currency={businessCurrency}
                setProducts={state.setProducts}
                setQuotes={state.setQuotes}
                setInvoices={state.setInvoices}
                triggerNewQuote={state.triggerNewQuote}
                triggerNewInvoice={state.triggerNewInvoice}
                triggerNewSchedule={state.triggerNewSchedule}
                activeSegment={billingSegment}
                defaultSegment={billingSegment}
                onSegmentChange={(seg) => setBillingSegment(seg)}
                prefillContactId={pendingPrefill?.contactId}
                prefillItems={pendingPrefill?.items}
                prefillToken={pendingPrefill?._token}
                onPrefillApplied={clearPrefill}
                slots={billingSlots}
                onViewContact={handleViewContact}
                onViewClientIntel={handleViewClientIntel}
                onAiRecoveryPlan={handleAiRecoveryPlan}
                onAiForecast={handleAiForecast}
                onAiDraftReminder={handleAiDraftReminder}
              />
            </motion.div>
          )}
          {tab === "catalog" && (
            <motion.div key="catalog" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <CommerceInsightsTab
                businessId={businessId}
                invoices={invoices}
                quotes={quotes}
                currency={businessCurrency}
                loading={loading}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
