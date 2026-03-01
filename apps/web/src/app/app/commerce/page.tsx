"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CreditCard, Package, FileText, RefreshCw, Plus } from "lucide-react";
import { Button } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";

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

const TABS = [
  { key: "products", label: "Products", icon: Package },
  { key: "quotes", label: "Quotations", icon: FileText },
  { key: "invoices", label: "Invoices", icon: CreditCard },
  { key: "recurring", label: "Recurring", icon: RefreshCw },
];

const TAB_LABELS: Record<string, string> = {
  products: "Add Product",
  quotes: "New Quote",
  invoices: "New Invoice",
  recurring: "New Schedule",
};

export default function CommercePage() {
  const state = useCommerce();
  const {
    businessId, workspaceLoading, workspaceError, tab, handleTabChange,
    products, invoices, quotes, contacts, loading, error,
    showGuide, handleToggleGuide, handleNewItem,
    gmailStatus, loadingGmail, paymentGateways,
    handleConnectGmail, handleDisconnectGmail,
    confirmDisconnectGmail, setConfirmDisconnectGmail,
  } = state;

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
        rightSlot={
          <Button onClick={handleNewItem} className="gap-2">
            <Plus className="w-4 h-4" />
            {TAB_LABELS[tab] ?? "New"}
          </Button>
        }
      />

      <ConnectionStatus
        gmailStatus={gmailStatus}
        paymentGateways={paymentGateways}
        loadingGmail={loadingGmail}
        onConnectGmail={handleConnectGmail}
        onDisconnectGmail={() => setConfirmDisconnectGmail(true)}
      />

      <CommerceDashboard invoices={invoices} quotes={quotes} products={products} />

      <TabNav
        tabs={TABS}
        activeTab={tab}
        onTabChange={handleTabChange}
        layoutId="commerce-tab-pill"
      />

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
          <span className="text-amber-400">!</span> {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {tab === "products" && (
          <motion.div key="products" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
            <ProductsPanel
              products={products}
              loading={loading}
              productSearch={state.productSearch}
              setProductSearch={state.setProductSearch}
              onEdit={state.openEditProduct}
              onDelete={state.handleDeleteProduct}
              onAdd={state.openAddProduct}
              deleteConfirm={state.deleteConfirm}
              setDeleteConfirm={state.setDeleteConfirm}
              cachedImages={state.cachedImages}
            />
          </motion.div>
        )}
        {tab === "quotes" && (
          <motion.div key="quotes" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
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
            />
          </motion.div>
        )}
        {tab === "invoices" && (
          <motion.div key="invoices" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
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
            />
          </motion.div>
        )}
        {tab === "recurring" && (
          <motion.div key="recurring" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
            <RecurringPanel
              businessId={businessId}
              contacts={contacts}
              products={products}
              triggerNew={state.recurringTriggerNew}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
        onFileSelect={state.handleFileSelect}
        onRemoveImage={state.removeImage}
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
