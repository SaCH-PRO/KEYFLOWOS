"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@keyflow/ui";
import {
  CreditCard,
  Package,
  FileText,
  Plus,
  X,
  Mail,
  RefreshCw,
} from "lucide-react";
import {
  createProduct,
  fetchProducts,
  fetchInvoices,
  fetchContacts,
  listQuotes,
  updateProduct,
  deleteProduct,
  getGmailStatus,
  getGmailAuthUrl,
  disconnectGmail,
  Product,
  Invoice,
  Contact,
  Quote,
} from "@/lib/client";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { Send } from "lucide-react";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { Tab, ProductForm, InvoiceLineItem, CATEGORIES, generateItemId } from "./components/commerce-types";
import CommerceDashboard from "./components/commerce-dashboard";
import { ProductsPanel } from "./products/products-panel";
import QuotesPanel from "./quotes/quotes-panel";
import InvoicesPanel from "./invoices/invoices-panel";
import RecurringPanel from "./recurring/recurring-panel";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().positive("Price must be positive"),
  description: z.string().optional(),
});

export default function CommercePage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showQuoteBuilder, setShowQuoteBuilder] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteForm, setQuoteForm] = useState({
    contactId: "",
    expiryDate: "",
    items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }] as InvoiceLineItem[],
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    notes: "",
  });
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>({
    name: "",
    description: "",
    price: "",
    category: "SERVICE",
    duration: "",
    imageUrl: "",
    sku: "",
    isActive: true,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [recurringTriggerNew, setRecurringTriggerNew] = useState(0);
  const [showInvoiceBuilder, setShowInvoiceBuilder] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({
    contactId: "",
    dueDate: "",
    items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }] as InvoiceLineItem[],
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    notes: "",
  });

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        setWorkspaceLoading(false);
        return;
      }
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
        setWorkspaceLoading(false);
        return;
      }
      setWorkspaceError("Could not find your workspace. Please sign in again.");
      setWorkspaceLoading(false);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [productsRes, invoicesRes, contactsRes, quotesRes, gmailRes] = await Promise.all([
          fetchProducts(businessId),
          fetchInvoices(businessId),
          fetchContacts(businessId),
          listQuotes(businessId),
          getGmailStatus(businessId),
        ]);
        setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        setInvoices(invoicesRes.data ?? []);
        setContacts(contactsRes.data ?? []);
        setQuotes(quotesRes.data ?? []);
        if (gmailRes.data) setGmailStatus(gmailRes.data);
        if (productsRes.error) setError(productsRes.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [businessId]);

  function openAddProduct() {
    setEditingProductId(null);
    setProductForm({
      name: "",
      description: "",
      price: "",
      category: "SERVICE",
      duration: "",
      imageUrl: "",
      sku: "",
      isActive: true,
    });
    setFormError(null);
    setShowProductForm(true);
  }

  function openEditProduct(product: Product) {
    setEditingProductId(product.id);
    setProductForm({
      name: product.name,
      description: product.description ?? "",
      price: String(product.price),
      category: (product.category as "SERVICE" | "PRODUCT" | "PACKAGE") ?? "SERVICE",
      duration: product.duration ? String(product.duration) : "",
      imageUrl: product.imageUrl || "",
      sku: product.sku || "",
      isActive: product.isActive ?? true,
    });
    setFormError(null);
    setShowProductForm(true);
  }

  function closeProductForm() {
    setShowProductForm(false);
    setEditingProductId(null);
    setProductForm({
      name: "",
      description: "",
      price: "",
      category: "SERVICE",
      duration: "",
      imageUrl: "",
      sku: "",
      isActive: true,
    });
    setFormError(null);
  }

  async function handleSaveProduct() {
    setFormError(null);
    const parsed = productSchema.safeParse({
      name: productForm.name,
      price: Number(productForm.price),
      description: productForm.description || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    if (!businessId) return;
    const durationValue = productForm.duration ? parseInt(productForm.duration) : null;

    if (editingProductId) {
      const { data, error } = await updateProduct({
        businessId,
        productId: editingProductId,
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description ?? null,
        category: productForm.category,
        duration: durationValue,
        imageUrl: productForm.imageUrl || null,
        sku: productForm.sku || null,
        isActive: productForm.isActive,
      });
      if (error) { setFormError(error); return; }
      if (data) {
        setProducts((prev) => prev.map((p) => (p.id === editingProductId ? { ...p, ...data } : p)));
        closeProductForm();
      }
    } else {
      const { data, error } = await createProduct({
        businessId,
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description,
        category: productForm.category,
        duration: durationValue,
        imageUrl: productForm.imageUrl || null,
        sku: productForm.sku || null,
        isActive: productForm.isActive,
      });
      if (error) { setFormError(error); return; }
      if (data) {
        setProducts((prev) => [data, ...prev]);
        closeProductForm();
      }
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!businessId) return;
    const { error } = await deleteProduct(productId, businessId);
    if (error) { setError(error); return; }
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeleteConfirm(null);
  }

  function resetQuoteForm() {
    setQuoteForm({
      contactId: "",
      expiryDate: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: "",
    });
    setEditingQuoteId(null);
  }

  function resetInvoiceForm() {
    setEditingInvoiceId(null);
    setInvoiceForm({
      contactId: "",
      dueDate: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: "",
    });
  }

  if (workspaceLoading) {
    return (
      <div className="space-y-6">
        <div className="h-16 bg-muted/30 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-muted/30 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-10 bg-muted/30 rounded-xl animate-pulse w-80" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-muted/30 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <CreditCard className="w-12 h-12 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground">{workspaceError}</p>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "products", label: "Products & Services", icon: <Package className="w-4 h-4" /> },
    { key: "quotes", label: "Quotations", icon: <FileText className="w-4 h-4" /> },
    { key: "invoices", label: "Invoices", icon: <CreditCard className="w-4 h-4" /> },
    { key: "recurring", label: "Recurring", icon: <RefreshCw className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CreditCard}
        title="Commerce"
        subtitle="Manage invoices, payments and quotes"
        rightSlot={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowContactPicker(true)}
              className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Send className="w-4 h-4" />
              Broadcast
            </button>
            {gmailStatus?.connected ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-500/30">
                <Mail className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-200">{gmailStatus.email}</span>
                <button
                  onClick={async () => {
                    if (!businessId) return;
                    if (confirm("Disconnect Gmail? You won't be able to send quotes via email until you reconnect.")) {
                      await disconnectGmail(businessId);
                      setGmailStatus({ connected: false, email: null });
                    }
                  }}
                  className="ml-1 text-green-400/60 hover:text-red-400 transition-colors"
                  title="Disconnect Gmail"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={async () => {
                  if (!businessId) return;
                  setLoadingGmail(true);
                  const res = await getGmailAuthUrl(businessId);
                  if (res.data?.url) {
                    window.location.href = res.data.url;
                  }
                  setLoadingGmail(false);
                }}
                disabled={loadingGmail}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card/50 border border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
              >
                <Mail className="w-4 h-4" />
                {loadingGmail ? "Connecting..." : "Connect Gmail"}
              </button>
            )}
            <div className="flex gap-2">
              {tab === "products" && (
                <Button onClick={openAddProduct} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add Product
                </Button>
              )}
              {tab === "quotes" && (
                <Button onClick={() => { setEditingQuoteId(null); resetQuoteForm(); setShowQuoteBuilder(true); }} className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Quote
                </Button>
              )}
              {tab === "invoices" && (
                <Button onClick={() => setShowInvoiceBuilder(!showInvoiceBuilder)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Invoice
                </Button>
              )}
              {tab === "recurring" && (
                <Button onClick={() => setRecurringTriggerNew((n) => n + 1)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Schedule
                </Button>
              )}
            </div>
          </div>
        }
      />

      <FeatureGuide
        featureKey="commerce"
        title="Getting Started with Commerce"
        description="Manage your products, invoices, quotes, and recurring billing all in one place."
        steps={[
          { title: "Add Products", description: "Create your product and service catalog with prices, categories, and descriptions." },
          { title: "Create Invoices", description: "Generate professional invoices, set payment terms, and track payment status." },
          { title: "Send Quotes", description: "Build quotes for clients, then convert accepted quotes into invoices with one click." },
          { title: "Set Up Recurring", description: "Automate repeat billing with weekly, monthly, or custom schedules." },
          { title: "Track Payments", description: "Monitor paid, pending, and overdue invoices. Share payment links via WhatsApp." },
          { title: "Connect Gmail", description: "Link your Gmail to send quotes and invoices directly via email." },
        ]}
      />

      <CommerceDashboard invoices={invoices} quotes={quotes} products={products} />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap ${
              tab === t.key
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {tab === t.key && (
              <motion.div
                layoutId="commerce-tab-pill"
                className="absolute inset-0 bg-gradient-to-r from-primary/15 to-secondary/15 border border-primary/30 rounded-xl shadow-lg shadow-primary/10"
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {t.icon}
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
          <span className="text-amber-400">!</span> {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {tab === "products" && (
          <motion.div
            key="products"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <ProductsPanel
              products={products}
              loading={loading}
              productSearch={productSearch}
              setProductSearch={setProductSearch}
              onEdit={openEditProduct}
              onDelete={handleDeleteProduct}
              onAdd={openAddProduct}
              deleteConfirm={deleteConfirm}
              setDeleteConfirm={setDeleteConfirm}
            />
          </motion.div>
        )}

        {tab === "quotes" && (
          <motion.div
            key="quotes"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <QuotesPanel
              quotes={quotes}
              contacts={contacts}
              products={products}
              businessId={businessId}
              loading={loading}
              gmailStatus={gmailStatus}
              showQuoteBuilder={showQuoteBuilder}
              setShowQuoteBuilder={setShowQuoteBuilder}
              editingQuoteId={editingQuoteId}
              setEditingQuoteId={setEditingQuoteId}
              quoteForm={quoteForm}
              setQuoteForm={setQuoteForm}
              resetQuoteForm={resetQuoteForm}
              setProducts={setProducts}
              setQuotes={setQuotes}
              setInvoices={setInvoices}
              setTab={setTab}
            />
          </motion.div>
        )}

        {tab === "invoices" && (
          <motion.div
            key="invoices"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <InvoicesPanel
              invoices={invoices}
              contacts={contacts}
              products={products}
              businessId={businessId}
              loading={loading}
              showInvoiceBuilder={showInvoiceBuilder}
              setShowInvoiceBuilder={setShowInvoiceBuilder}
              editingInvoiceId={editingInvoiceId}
              setEditingInvoiceId={setEditingInvoiceId}
              invoiceForm={invoiceForm}
              setInvoiceForm={setInvoiceForm}
              resetInvoiceForm={resetInvoiceForm}
              setProducts={setProducts}
              setInvoices={setInvoices}
              gmailStatus={gmailStatus}
            />
          </motion.div>
        )}
        {tab === "recurring" && (
          <motion.div
            key="recurring"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <RecurringPanel
              businessId={businessId}
              contacts={contacts}
              products={products}
              triggerNew={recurringTriggerNew}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProductForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && closeProductForm()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center">
                    <Package className="w-4 h-4 text-primary" />
                  </div>
                  {editingProductId ? "Edit Product" : "New Product"}
                </h2>
                <button onClick={closeProductForm} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                {formError && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    {formError}
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Name *</label>
                  <input
                    type="text"
                    value={productForm.name}
                    onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Haircut, Web Design Package"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description</label>
                  <textarea
                    value={productForm.description}
                    onChange={(e) => setProductForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Describe your product or service..."
                    rows={2}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Image URL</label>
                    <input
                      type="url"
                      value={productForm.imageUrl}
                      onChange={(e) => setProductForm((f) => ({ ...f, imageUrl: e.target.value }))}
                      placeholder="https://example.com/image.jpg"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">SKU</label>
                    <input
                      type="text"
                      value={productForm.sku}
                      onChange={(e) => setProductForm((f) => ({ ...f, sku: e.target.value }))}
                      placeholder="e.g. SVC-001, PKG-DELUXE"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                    />
                  </div>
                </div>
                {productForm.imageUrl && (
                  <div className="rounded-xl border border-border/60 overflow-hidden bg-muted/20">
                    <img
                      src={productForm.imageUrl}
                      alt="Preview"
                      className="w-full h-32 object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Price (TTD) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={productForm.price}
                      onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Category</label>
                    <select
                      value={productForm.category}
                      onChange={(e) => setProductForm((f) => ({ ...f, category: e.target.value as "SERVICE" | "PRODUCT" | "PACKAGE" }))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {productForm.category === "SERVICE" && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Duration (minutes)</label>
                    <input
                      type="number"
                      min="0"
                      value={productForm.duration}
                      onChange={(e) => setProductForm((f) => ({ ...f, duration: e.target.value }))}
                      placeholder="e.g. 30, 60, 90"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                    />
                  </div>
                )}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/40">
                  <button
                    type="button"
                    onClick={() => setProductForm((f) => ({ ...f, isActive: !f.isActive }))}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      productForm.isActive ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                      productForm.isActive ? "translate-x-5" : ""
                    }`} />
                  </button>
                  <div>
                    <span className="text-sm font-medium">{productForm.isActive ? "Active" : "Inactive"}</span>
                    <p className="text-xs text-muted-foreground">
                      {productForm.isActive ? "Visible in store and bookings" : "Hidden from customers"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-5 border-t border-border flex justify-end gap-2">
                <Button variant="outline" onClick={closeProductForm}>Cancel</Button>
                <Button onClick={handleSaveProduct}>
                  {editingProductId ? "Update Product" : "Create Product"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
