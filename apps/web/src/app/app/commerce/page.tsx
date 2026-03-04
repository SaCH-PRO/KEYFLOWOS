"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CreditCard, Package, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";

import { ListPageSkeleton } from "@/components/ui/skeleton";
import { useCommerce } from "./hooks/use-commerce";
import { CommerceGuide } from "./components/commerce-guide";
import { ProductsPanel } from "./products/products-panel";
import { ProductFormModal } from "./products/product-form-modal";
import { BillingPanel } from "./billing/billing-panel";
import { CommerceInsightsTab } from "./insights/commerce-insights-tab";
import { CommerceAiSearchBar, type CommerceCommand } from "./components/commerce-ai-search-bar";
import { useCommerceAiHub } from "./hooks/use-commerce-ai-hub";
import { renderCommerceToolResult } from "./components/commerce-tool-results";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit, useModuleEvent } from "@/hooks/use-module-events";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { commerceAiExecute } from "@/lib/client";
import type { ProductSlots } from "./utils/commerce-slots";
import type { BillingSlots } from "./utils/commerce-slots";

const TABS = [
  { key: "products", label: "Products", icon: Package },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "insights", label: "Insights", icon: BarChart3 },
];

export default function CommercePage() {
  const state = useCommerce();
  const commerceAi = useCommerceAiHub();
  const emitEvent = useModuleEmit();
  const [slideDirection, setSlideDirection] = useState(0);
  const COMMERCE_TAB_KEYS = TABS.map((t) => t.key);
  const {
    businessId, businessCurrency, workspaceLoading, workspaceError, tab, handleTabChange: rawTabChange,
    products, invoices, quotes, contacts, loading, error,
    showGuide, handleToggleGuide, handleNewItem,
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
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: tab,
        itemCount: tab === "products" ? products.length : invoices.length + quotes.length,
      });
    }
  }, [businessId, tab, products.length, invoices.length, quotes.length, commerceAi.updateCommerceContext]);

  const handleCommerceCommand = useCallback((cmd: CommerceCommand) => {
    switch (cmd.type) {
      case "create_invoice":
        state.setTab("billing");
        state.setTriggerNewInvoice((n) => n + 1);
        toast.success("Opening invoice builder...");
        break;
      case "create_quote":
        state.setTab("billing");
        state.setTriggerNewQuote((n) => n + 1);
        toast.success("Opening quote builder...");
        break;
      case "mark_paid":
        if (cmd.invoiceId) {
          toast.success("Marking invoice as paid...");
          commerceAiExecute("mark_paid", { invoiceId: cmd.invoiceId }).then(res => {
            if (res.data?.success) toast.success(res.data.message ?? "Invoice marked as paid");
            else toast.error(res.data?.error ?? "Failed to mark as paid");
          });
        } else {
          state.setTab("billing");
          toast.info("Select an invoice to mark as paid");
        }
        break;
      case "send_reminder":
        if (cmd.invoiceId) {
          toast.success("Sending payment reminder...");
        } else {
          state.setTab("billing");
          toast.info("Select an invoice to send a reminder");
        }
        break;
      case "void_invoice":
        if (cmd.invoiceId) {
          toast.success("Voiding invoice...");
          commerceAiExecute("void_invoice", { invoiceId: cmd.invoiceId }).then(res => {
            if (res.data?.success) toast.success(res.data.message ?? "Invoice voided");
            else toast.error(res.data?.error ?? "Failed to void invoice");
          });
        } else {
          state.setTab("billing");
          toast.info("Select an invoice to void");
        }
        break;
      case "view_invoice":
        state.setTab("billing");
        toast.success("Switching to billing...");
        break;
      case "switch_tab":
        handleTabChange(cmd.tab === "quotes" || cmd.tab === "invoices" || cmd.tab === "recurring" ? "billing" : cmd.tab);
        toast.success(`Switched to ${cmd.tab === "quotes" || cmd.tab === "invoices" || cmd.tab === "recurring" ? "billing" : cmd.tab}`);
        break;
      case "filter_status":
        state.setTab("billing");
        toast.success(`Filtering by ${cmd.status}`);
        break;
      case "show_overdue":
        state.setTab("billing");
        toast.success("Showing overdue invoices");
        break;
      case "create_quote_for_contact":
        if (cmd.contactId) {
          prefillForContact(cmd.contactId, "quotes");
          toast.success(`Opening quote builder for ${cmd.contactName ?? "contact"}...`);
        }
        break;
      case "create_invoice_for_contact":
        if (cmd.contactId) {
          prefillForContact(cmd.contactId, "invoices");
          toast.success(`Opening invoice builder for ${cmd.contactName ?? "contact"}...`);
        }
        break;
      case "generate_ai_analysis":
        state.setTab("insights");
        toast.success("Opening insights...");
        break;
      case "ai_execute": {
        const executing = toast.loading("Executing AI command...");
        commerceAiExecute(cmd.action, cmd.params ?? {}).then(result => {
          toast.dismiss(executing);
          if (result.data?.success) {
            toast.success(result.data.message ?? "Action completed");
          } else {
            toast.error(result.data?.error ?? result.error ?? "Command failed");
          }
        }).catch(() => {
          toast.dismiss(executing);
          toast.error("Command execution failed");
        });
        break;
      }
    }
    emitEvent("module:view_changed", "commerce", { command: cmd.type });
  }, [state, handleTabChange, commerceAi, emitEvent]);

  const handleAiAssistantAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("filter_status:")) {
      state.setTab("billing");
      toast.success(`Filtering by ${actionKey.split(":")[1]}`);
    } else if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.split(":")[1];
      handleTabChange(t === "quotes" || t === "invoices" || t === "recurring" ? "billing" : t);
    } else if (actionKey.startsWith("send_reminders:")) {
      state.setTab("billing");
      toast.success("Opening billing for reminders...");
    }
  }, [state, handleTabChange]);

  const handleWrappedTabChange = useCallback((t: string) => {
    handleTabChange(t);
    emitEvent("module:tab_changed", "commerce", { tab: t });
  }, [handleTabChange, emitEvent]);


  const commerceShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Commerce Navigation",
      shortcuts: [
        { key: "n", description: "New item", action: () => handleNewItem() },
        { key: "f", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('[data-commerce-ai-search]'); el?.focus(); } },
        { key: "/", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('[data-commerce-ai-search]'); el?.focus(); } },
        { key: "1", description: "Products tab", action: () => handleTabChange("products") },
        { key: "2", description: "Billing tab", action: () => handleTabChange("billing") },
        { key: "3", description: "Insights tab", action: () => handleTabChange("insights") },
        { key: "r", description: "Refresh data", action: () => { state.refreshProducts(); } },
        { key: "a", shift: true, description: "Toggle AI Hub", action: () => commerceAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => { if (commerceAi.hubMode === "tool-result") commerceAi.clearToolResult(); else if (commerceAi.panelOpen) commerceAi.setOpen(false); } },
      ],
    },
  ], [handleNewItem, handleTabChange, state.refreshProducts, commerceAi.togglePanel, commerceAi.panelOpen, commerceAi.setOpen, commerceAi.hubMode, commerceAi.clearToolResult]);

  useKeyboardShortcuts(commerceShortcuts, !workspaceLoading);

  const productSlots = useMemo<ProductSlots>(() => {
    const topSuggestion = commerceAi.suggestions.find(
      (s) => s.priority === "high" && (s.type === "warning" || s.type === "insight"),
    );
    if (!topSuggestion) return {};
    return {
      renderInsightBanner: () => (
        <div className="flex items-center gap-3 rounded-xl border border-border/30 bg-white/[0.03] px-4 py-2.5 text-sm">
          <span className="text-base">{topSuggestion.type === "warning" ? "⚠" : "💡"}</span>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-foreground/90">{topSuggestion.title}</span>
            <span className="text-muted-foreground/60 ml-1.5">{topSuggestion.description}</span>
          </div>
          {topSuggestion.actionLabel && topSuggestion.actionKey && (
            <button
              onClick={() => handleAiAssistantAction(topSuggestion.actionKey!)}
              className="shrink-0 rounded-lg px-3 py-1 text-xs font-medium border border-border/40 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
            >
              {topSuggestion.actionLabel}
            </button>
          )}
        </div>
      ),
    };
  }, [commerceAi.suggestions, handleAiAssistantAction]);

  const billingSlots = useMemo<BillingSlots>(() => {
    const billingSuggestion = commerceAi.suggestions.find(
      (s) => s.priority === "high" && s.type === "warning",
    );
    if (!billingSuggestion) return {};
    return {
      renderInsightBanner: () => (
        <div className="flex items-center gap-3 rounded-xl border border-border/30 bg-white/[0.03] px-4 py-2.5 text-sm">
          <span className="text-base">⚠</span>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-foreground/90">{billingSuggestion.title}</span>
            <span className="text-muted-foreground/60 ml-1.5">{billingSuggestion.description}</span>
          </div>
          {billingSuggestion.actionLabel && billingSuggestion.actionKey && (
            <button
              onClick={() => handleAiAssistantAction(billingSuggestion.actionKey!)}
              className="shrink-0 rounded-lg px-3 py-1 text-xs font-medium border border-border/40 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
            >
              {billingSuggestion.actionLabel}
            </button>
          )}
        </div>
      ),
    };
  }, [commerceAi.suggestions, handleAiAssistantAction]);

  if (workspaceLoading) return <ListPageSkeleton />;

  if (workspaceError) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <CreditCard className="w-12 h-12 text-muted-foreground/50 mx-auto" />
          <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{workspaceError}</p>
          <p className="text-muted-foreground">Try logging in again to create your workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-label="Commerce">
      <PageHeader
        icon={CreditCard}
        title="Commerce"
        subtitle="Products, billing and insights"
        titleExtra={
          <CommerceGuide
            isOpen={showGuide}
            onToggle={handleToggleGuide}
            onTabChange={handleTabChange}
          />
        }
      />

      <CommerceAiSearchBar onExecuteCommand={handleCommerceCommand} />

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
      <AiHubTrigger ai={commerceAi} moduleName="Commerce" />

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
          {tab === "products" && (
            <motion.div key="products" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <ProductsPanel
                products={products}
                loading={loading}
                productSearch={state.productSearch}
                setProductSearch={state.setProductSearch}
                onEdit={state.openEditProduct}
                onDelete={state.handleDeleteProduct}
                onDuplicate={state.handleDuplicateProduct}
                onToggleActive={state.handleToggleProductActive}
                onInlineSave={state.handleInlineSave}
                onAdd={state.openAddProduct}
                setProducts={state.setProducts}
                deleteConfirm={state.deleteConfirm}
                setDeleteConfirm={state.setDeleteConfirm}
                cachedImages={state.cachedImages}
                businessId={state.businessId}
                onBulkAction={state.refreshProducts}
                currency={businessCurrency}
                onCreateQuote={(p) => {
                  const items = [{ description: p.name, quantity: 1, unitPrice: p.price, total: p.price, productId: p.id }];
                  prefillForContact("", "quotes", items);
                  handleTabChange("billing");
                }}
                onCreateInvoice={(p) => {
                  const items = [{ description: p.name, quantity: 1, unitPrice: p.price, total: p.price, productId: p.id }];
                  prefillForContact("", "invoices", items);
                  handleTabChange("billing");
                }}
                invoices={invoices}
                quotes={quotes}
                slots={productSlots}
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
                onSegmentChange={state.setActiveBillingSegment}
                prefillContactId={pendingPrefill?.contactId}
                prefillItems={pendingPrefill?.items}
                prefillToken={pendingPrefill?._token}
                defaultSegment={pendingPrefill?.targetSegment ?? "invoices"}
                onPrefillApplied={clearPrefill}
                slots={billingSlots}
              />
            </motion.div>
          )}
          {tab === "insights" && (
            <motion.div key="insights" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
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

      <ProductFormModal
        open={state.showProductForm}
        editingProductId={state.editingProductId}
        productForm={state.productForm}
        setProductForm={state.setProductForm}
        formError={state.formError}
        saving={state.saving}
        imagePreview={state.imagePreview}
        imageMode={state.imageMode}
        setImageMode={state.setImageMode}
        setImagePreview={state.setImagePreview}
        fileInputRef={state.fileInputRef}
        onClose={state.closeProductForm}
        onSave={state.handleSaveProduct}
        onSaveAndAddAnother={state.handleSaveAndAddAnother}
        onFileSelect={state.handleFileSelect}
        onRemoveImage={state.removeImage}
        currency={businessCurrency}
      />

    </div>
  );
}
