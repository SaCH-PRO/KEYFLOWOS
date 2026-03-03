"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CreditCard, Package, FileText, RefreshCw, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { useCommerce } from "./hooks/use-commerce";
import { CommerceGuide } from "./components/commerce-guide";
import { ConnectionStatus } from "./components/connection-status";
import CommerceDashboard from "./components/commerce-dashboard";
import { ProductsPanel } from "./products/products-panel";
import { ProductFormModal } from "./products/product-form-modal";
import QuotesPanel from "./quotes/quotes-panel";
import InvoicesPanel from "./invoices/invoices-panel";
import RecurringPanel from "./recurring/recurring-panel";
import { CommerceAiSearchBar, type CommerceCommand } from "./components/commerce-ai-search-bar";
import { useCommerceAiHub } from "./hooks/use-commerce-ai-hub";
import { renderCommerceToolResult } from "./components/commerce-tool-results";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit } from "@/hooks/use-module-events";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { commerceAiExecute } from "@/lib/client";

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: BarChart3 },
  { key: "products", label: "Products", icon: Package },
  { key: "quotes", label: "Quotations", icon: FileText },
  { key: "invoices", label: "Invoices", icon: CreditCard },
  { key: "recurring", label: "Recurring", icon: RefreshCw },
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
    gmailStatus, loadingGmail, paymentGateways,
    handleConnectGmail, handleDisconnectGmail,
    confirmDisconnectGmail, setConfirmDisconnectGmail,
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

  useEffect(() => {
    if (businessId) {
      commerceAi.updateCommerceContext({
        businessId,
        activeView: tab,
        itemCount: tab === "products" ? products.length : tab === "invoices" ? invoices.length : quotes.length,
      });
    }
  }, [businessId, tab, products.length, invoices.length, quotes.length, commerceAi.updateCommerceContext]);

  const handleCommerceCommand = useCallback((cmd: CommerceCommand) => {
    switch (cmd.type) {
      case "create_invoice":
        state.setTab("invoices");
        state.setShowInvoiceBuilder(true);
        toast.success("Opening invoice builder...");
        break;
      case "create_quote":
        state.setTab("quotes");
        state.setShowQuoteBuilder(true);
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
          state.setTab("invoices");
          toast.info("Select an invoice to mark as paid");
        }
        break;
      case "send_reminder":
        if (cmd.invoiceId) {
          toast.success("Sending payment reminder...");
        } else {
          state.setTab("invoices");
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
          state.setTab("invoices");
          toast.info("Select an invoice to void");
        }
        break;
      case "view_invoice":
        state.setTab("invoices");
        toast.success("Switching to invoices...");
        break;
      case "switch_tab":
        handleTabChange(cmd.tab);
        toast.success(`Switched to ${cmd.tab}`);
        break;
      case "filter_status":
        state.setTab("invoices");
        toast.success(`Filtering by ${cmd.status}`);
        break;
      case "show_overdue":
        state.setTab("invoices");
        toast.success("Showing overdue invoices");
        break;
      case "generate_ai_analysis":
        commerceAi.togglePanel();
        toast.success("Opening AI analysis...");
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
      const status = actionKey.split(":")[1];
      state.setTab("invoices");
      toast.success(`Filtering by ${status}`);
    } else if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.split(":")[1];
      handleTabChange(t);
    } else if (actionKey.startsWith("send_reminders:")) {
      state.setTab("invoices");
      toast.success("Opening invoices for reminders...");
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
        { key: "/", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('[data-commerce-ai-search]'); el?.focus(); } },
        { key: "1", description: "Dashboard tab", action: () => handleTabChange("dashboard") },
        { key: "2", description: "Products tab", action: () => handleTabChange("products") },
        { key: "3", description: "Quotes tab", action: () => handleTabChange("quotes") },
        { key: "4", description: "Invoices tab", action: () => handleTabChange("invoices") },
        { key: "5", description: "Recurring tab", action: () => handleTabChange("recurring") },
        { key: "a", shift: true, description: "Toggle AI Hub", action: () => commerceAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => { if (commerceAi.hubMode === "tool-result") commerceAi.clearToolResult(); else if (commerceAi.panelOpen) commerceAi.setOpen(false); } },
      ],
    },
  ], [handleNewItem, handleTabChange, commerceAi.togglePanel, commerceAi.panelOpen, commerceAi.setOpen, commerceAi.hubMode, commerceAi.clearToolResult]);

  useKeyboardShortcuts(commerceShortcuts, !workspaceLoading);

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
        subtitle="Manage products, invoices, quotes and billing"
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
          {tab === "dashboard" && (
            <motion.div key="dashboard" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <div className="space-y-4">
                <CommerceDashboard businessId={businessId} invoices={invoices} quotes={quotes} products={products} currency={businessCurrency} />
                <ConnectionStatus
                  gmailStatus={gmailStatus}
                  paymentGateways={paymentGateways}
                  loadingGmail={loadingGmail}
                  onConnectGmail={handleConnectGmail}
                  onDisconnectGmail={() => setConfirmDisconnectGmail(true)}
                />
              </div>
            </motion.div>
          )}
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
                onAdd={state.openAddProduct}
                deleteConfirm={state.deleteConfirm}
                setDeleteConfirm={state.setDeleteConfirm}
                cachedImages={state.cachedImages}
                businessId={state.businessId}
                onBulkAction={state.refreshProducts}
                currency={businessCurrency}
              />
            </motion.div>
          )}
          {tab === "quotes" && (
            <motion.div key="quotes" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <QuotesPanel
                quotes={quotes}
                contacts={contacts}
                products={products}
                businessId={businessId}
                loading={loading}
                gmailStatus={gmailStatus}
                showQuoteBuilder={state.showQuoteBuilder}
                setShowQuoteBuilder={state.setShowQuoteBuilder}
                editingQuoteId={state.editingQuoteId}
                setEditingQuoteId={state.setEditingQuoteId}
                quoteForm={state.quoteForm}
                setQuoteForm={state.setQuoteForm}
                resetQuoteForm={state.resetQuoteForm}
                setProducts={state.setProducts}
                setQuotes={state.setQuotes}
                setInvoices={state.setInvoices}
                setTab={state.setTab}
                currency={businessCurrency}
              />
            </motion.div>
          )}
          {tab === "invoices" && (
            <motion.div key="invoices" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <InvoicesPanel
                invoices={invoices}
                contacts={contacts}
                products={products}
                businessId={businessId}
                loading={loading}
                showInvoiceBuilder={state.showInvoiceBuilder}
                setShowInvoiceBuilder={state.setShowInvoiceBuilder}
                editingInvoiceId={state.editingInvoiceId}
                setEditingInvoiceId={state.setEditingInvoiceId}
                invoiceForm={state.invoiceForm}
                setInvoiceForm={state.setInvoiceForm}
                resetInvoiceForm={state.resetInvoiceForm}
                setProducts={state.setProducts}
                setInvoices={state.setInvoices}
                gmailStatus={gmailStatus}
                currency={businessCurrency}
              />
            </motion.div>
          )}
          {tab === "recurring" && (
            <motion.div key="recurring" custom={slideDirection} initial={{ opacity: 0, x: slideDirection * 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: slideDirection * -60 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <RecurringPanel
                businessId={businessId}
                contacts={contacts}
                products={products}
                triggerNew={state.recurringTriggerNew}
                currency={businessCurrency}
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

      <ConfirmDialog
        open={confirmDisconnectGmail}
        title="Disconnect Gmail?"
        message="You won't be able to send quotes via email until you reconnect."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={handleDisconnectGmail}
        onCancel={() => setConfirmDisconnectGmail(false)}
      />
    </div>
  );
}
