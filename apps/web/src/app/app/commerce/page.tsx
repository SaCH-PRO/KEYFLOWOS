"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  FileText,
  DollarSign,
  RefreshCw,
  Plus,
  Search,
  Sparkles,
  Terminal,
  Lightbulb,
  Zap,
  BookOpen,
  Clock,
  AlertTriangle,
  Settings,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { AiCommandHub } from "@/components/ai/ai-command-hub";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { useCommerceShell } from "./hooks/use-commerce-shell";
import { useBillingWorkspace } from "./hooks/use-billing-workspace";
import { useCommerceOverview } from "./hooks/use-commerce-overview";
import { useCommerceCopilot } from "./hooks/use-commerce-copilot";
import { useCommerceComposer } from "./hooks/use-commerce-composer";
import { useCommerceAiHub, type CopilotMode } from "./hooks/use-commerce-ai-hub";
import { SearchableHelpDrawer } from "./components/contextual-onboarding";
import { renderCommerceToolResult } from "./components/commerce-tool-results";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit, useModuleEvent } from "@/hooks/use-module-events";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useRouter } from "next/navigation";
import { commerceAiExecute } from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";
import type { BillingSlots } from "./utils/commerce-slots";
import InvoicesPanel from "./invoices/invoices-panel";
import QuotesPanel from "./quotes/quotes-panel";
import RecurringPanel from "./recurring/recurring-panel";
import PaymentsTab from "./payments/payments-tab";

const TABS = [
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "quotes", label: "Quotes", icon: CreditCard },
  { key: "payments", label: "Payments", icon: DollarSign },
  { key: "recurring", label: "Recurring", icon: RefreshCw },
];

export default function CommercePage() {
  const shell = useCommerceShell();
  const billing = useBillingWorkspace();
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

  const emitEvent = useModuleEmit();
  const router = useRouter();
  const [slideDirection, setSlideDirection] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const COMMERCE_TAB_KEYS = TABS.map((t) => t.key);

  const { tab } = overview;
  const { commerceAi } = copilot;
  const { businessId, businessCurrency } = shell;
  const { invoices, quotes } = shell;

  const handleTabChange = useCallback((t: string) => {
    if (t === tab) return;
    const oldIndex = COMMERCE_TAB_KEYS.indexOf(tab);
    const newIndex = COMMERCE_TAB_KEYS.indexOf(t);
    setSlideDirection(newIndex > oldIndex ? 1 : -1);
    overview.handleTabChange(t);
  }, [tab, overview.handleTabChange]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: COMMERCE_TAB_KEYS,
    activeTab: tab,
    onTabChange: handleTabChange,
  });

  useModuleEvent("commerce:create_quote_for_contact", useCallback((event: any) => {
    const { contactId, items } = event.data ?? {};
    if (contactId) {
      billing.prefillForContact(contactId, "quotes", items);
      handleTabChange("quotes");
      toast.success("Opening quote builder for contact...");
    }
  }, [billing.prefillForContact, handleTabChange]));

  useModuleEvent("commerce:create_invoice_for_contact", useCallback((event: any) => {
    const { contactId, items } = event.data ?? {};
    if (contactId) {
      billing.prefillForContact(contactId, "invoices", items);
      handleTabChange("invoices");
      toast.success("Opening invoice builder for contact...");
    }
  }, [billing.prefillForContact, handleTabChange]));

  useEffect(() => {
    if (billing.pendingPrefill?.targetSegment) {
      const target = billing.pendingPrefill.targetSegment === "quotes" ? "quotes" : "invoices";
      if (tab !== target) handleTabChange(target);
    }
  }, [billing.pendingPrefill]);

  useEffect(() => {
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: tab,
        itemCount: invoices.length + quotes.length,
      });
    }
  }, [businessId, tab, invoices.length, quotes.length, commerceAi.updateCommerceContext]);

  const handleAiAssistantAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("filter_status:")) {
      handleTabChange("invoices");
      toast.success(`Filtering by ${actionKey.split(":")[1]}`);
    } else if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.split(":")[1];
      if (t === "quotes") handleTabChange("quotes");
      else if (t === "invoices") handleTabChange("invoices");
      else if (t === "schedules" || t === "recurring") handleTabChange("recurring");
      else if (t === "payments" || t === "collections") handleTabChange("payments");
      else if (t === "insights" || t === "catalog") handleTabChange("payments");
      else handleTabChange(t);
    } else if (actionKey.startsWith("send_reminders:")) {
      handleTabChange("invoices");
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

  const financialSummary = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    let outstanding = 0;
    let overdue = 0;
    let collectedThisMonth = 0;

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
      }
    }

    return { outstanding, overdue, collectedThisMonth };
  }, [invoices]);

  const commerceShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Commerce Navigation",
      shortcuts: [
        { key: "n", description: "New item", action: () => composer.handleNewItem() },
        { key: "f", description: "Focus search", action: () => { if (!commerceAi.panelOpen) commerceAi.setOpen(true); } },
        { key: "/", description: "Focus search", action: () => { if (!commerceAi.panelOpen) commerceAi.setOpen(true); } },
        { key: "1", description: "Invoices tab", action: () => handleTabChange("invoices") },
        { key: "2", description: "Quotes tab", action: () => handleTabChange("quotes") },
        { key: "3", description: "Payments tab", action: () => handleTabChange("payments") },
        { key: "4", description: "Recurring tab", action: () => handleTabChange("recurring") },
        { key: "r", description: "Refresh data", action: () => { shell.refreshProducts(); } },
        { key: "a", shift: true, description: "Toggle AI Copilot", action: () => commerceAi.togglePanel() },
        { key: "?", description: "Help", action: () => setHelpOpen(true) },
        { key: "Escape", description: "Close panels", action: () => { if (commerceAi.hubMode === "tool-result") commerceAi.clearToolResult(); else if (commerceAi.panelOpen) commerceAi.setOpen(false); } },
      ],
    },
  ], [composer.handleNewItem, handleTabChange, shell.refreshProducts, commerceAi.togglePanel, commerceAi.panelOpen, commerceAi.setOpen, commerceAi.hubMode, commerceAi.clearToolResult]);

  useKeyboardShortcuts(commerceShortcuts, !shell.workspaceLoading);

  const renderTimelineBadge = useCallback((item: { contactId?: string | null }) => {
    if (!item.contactId) return null;
    return null;
  }, []);

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
    renderTimelineBadge,
  }), [commerceAi.panelOpen, commerceAi.setOpen, renderTimelineBadge]);

  if (shell.workspaceLoading) return <ListPageSkeleton />;

  if (shell.workspaceError) {
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
              <span className="font-semibold text-xs text-emerald-400">{overview.revenuePulse}</span>
              <span className="text-[10px] text-muted-foreground/50">collected</span>
            </div>
            <div className="flex items-center gap-0.5">
              <Link
                href="/app/settings/business"
                className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="Billing Settings"
                title="Billing Settings"
              >
                <Settings className="w-4 h-4 text-muted-foreground/60" />
              </Link>
              <button
                onClick={() => setHelpOpen(true)}
                className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="Help"
                title="Help (?)"
              >
                <BookOpen className="w-4 h-4 text-muted-foreground/60" />
              </button>
              <button
                onClick={() => commerceAi.togglePanel()}
                className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                aria-label="AI Copilot"
                title="AI Copilot (Shift+A)"
              >
                <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]/60" />
              </button>
            </div>
          </div>
        }
        actionLabel="+ New"
        actionIcon={Plus}
        onAction={composer.handleNewItem}
      />

      <AnimatePresence>
        {commerceAi.panelOpen && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 px-1">
              {(["command", "recommend", "assist"] as CopilotMode[]).map((mode) => {
                const isActive = commerceAi.copilotMode === mode;
                const ModeIcon = mode === "command" ? Terminal : mode === "recommend" ? Lightbulb : Zap;
                const cfg = commerceAi.copilotModeConfig[mode];
                return (
                  <button
                    key={mode}
                    onClick={() => commerceAi.setCopilotMode(mode)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                        : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/[0.04] border border-transparent"
                    }`}
                    title={cfg.description}
                  >
                    <ModeIcon className="w-3 h-3" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <AiCommandHub
              ai={commerceAi}
              moduleName="Commerce"
              onAction={handleAiAssistantAction}
              toolResultRenderer={renderCommerceToolResult}
            />
          </div>
        )}
      </AnimatePresence>

      <TabNav
        tabs={TABS}
        activeTab={tab}
        onTabChange={handleWrappedTabChange}
      />

      {shell.error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
          <span className="text-amber-400">!</span> {shell.error}
        </div>
      )}

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={slideDirection}>
          {tab === "invoices" && (
            <motion.div key="invoices" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 shrink-0">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Outstanding</span>
                      <span className="text-sm font-bold text-amber-400">{formatCurrencyCompact(financialSummary.outstanding, businessCurrency)}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-red-500/10 shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Overdue</span>
                      <span className="text-sm font-bold text-red-400">{formatCurrencyCompact(financialSummary.overdue, businessCurrency)}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 shrink-0">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">This Month</span>
                      <span className="text-sm font-bold text-emerald-400">{formatCurrencyCompact(financialSummary.collectedThisMonth, businessCurrency)}</span>
                    </div>
                  </div>
                </div>
                <InvoicesPanel
                  invoices={shell.invoices}
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
              </div>
            </motion.div>
          )}
          {tab === "quotes" && (
            <motion.div key="quotes" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <QuotesPanel
                quotes={shell.quotes}
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
                prefillContactId={tab === "quotes" ? billing.pendingPrefill?.contactId : undefined}
                prefillItems={tab === "quotes" ? billing.pendingPrefill?.items : undefined}
                prefillToken={billing.pendingPrefill?._token}
                onPrefillApplied={billing.clearPrefill}
                renderTimelineBadge={renderTimelineBadge}
                onViewContact={copilot.handleViewContact}
                onViewClientIntel={copilot.handleViewClientIntel}
              />
            </motion.div>
          )}
          {tab === "payments" && (
            <motion.div key="payments" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <PaymentsTab
                invoices={shell.invoices}
                currency={businessCurrency}
                businessId={businessId}
                contacts={shell.contacts}
                setInvoices={shell.setInvoices}
                onNavigateToInvoices={() => handleTabChange("invoices")}
              />
            </motion.div>
          )}
          {tab === "recurring" && (
            <motion.div key="recurring" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <RecurringPanel
                businessId={businessId}
                contacts={shell.contacts}
                products={shell.products}
                triggerNew={billing.triggerNewSchedule}
                currency={businessCurrency}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
        {[
          { label: "Billing & Tax", desc: "Tax rates, default terms, and invoice preferences", href: "/app/settings/business?tab=billing" },
          { label: "Payment Gateways", desc: "WiPay, PayPal, and payment methods", href: "/app/settings/business?tab=payments" },
          { label: "Branding & Templates", desc: "Customize invoice branding and layout", href: "/app/settings/business?tab=branding" },
        ].map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="flex items-center gap-2.5 p-3 rounded-xl border border-border/40 bg-muted/5 hover:bg-muted/10 transition-colors group"
          >
            <div className="p-1.5 rounded-lg bg-muted/20">
              <Settings className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">{link.label}</p>
              <p className="text-[10px] text-muted-foreground/60 truncate">{link.desc}</p>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
          </Link>
        ))}
      </div>

      <SearchableHelpDrawer
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        onNavigate={(navTab: string) => handleTabChange(navTab)}
      />
    </div>
  );
}
