"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  Upload,
  ImageIcon,
  Trash2,
  Link2,
  Wallet,
  Lightbulb,
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
import { apiGet } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { Send } from "lucide-react";
import { ConnectionBanner } from "@/components/ui/connection-banner";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { saveProductImage, deleteProductImage, fileToDataUrl, getAllProductImages } from "@/lib/image-store";
import { notifyProductsChanged } from "@/lib/product-sync";
import { Tab, ProductForm, InvoiceLineItem, CATEGORIES, generateItemId } from "./components/commerce-types";
import { ListPageSkeleton } from "@/components/ui/skeleton";
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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"upload" | "url">("upload");
  const [cachedImages, setCachedImages] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDisconnectGmail, setConfirmDisconnectGmail] = useState(false);
  const [paymentGateways, setPaymentGateways] = useState<{ wipay: boolean; paypal: boolean }>({ wipay: false, paypal: false });

  const [showGuide, setShowGuide] = useState(false);
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
        const [productsRes, invoicesRes, contactsRes, quotesRes, gmailRes, bizRes] = await Promise.all([
          fetchProducts(businessId),
          fetchInvoices(businessId),
          fetchContacts(businessId),
          listQuotes(businessId),
          getGmailStatus(businessId),
          apiGet<{ metaData: Record<string, any> }>(`/identity/businesses/${businessId}`),
        ]);
        setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        setInvoices(invoicesRes.data ?? []);
        setContacts(contactsRes.data ?? []);
        setQuotes(quotesRes.data ?? []);
        if (gmailRes.data) setGmailStatus(gmailRes.data);
        if (bizRes.data?.metaData) {
          const meta = bizRes.data.metaData;
          setPaymentGateways({
            wipay: Boolean(meta.wipayApiKey || meta.wipayAccountNumber),
            paypal: Boolean(meta.paypalClientId && meta.paypalClientSecret),
          });
        }
        if (productsRes.error) setError(productsRes.error);
        try {
          const imgs = await getAllProductImages();
          setCachedImages(imgs);
        } catch {}

      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && businessId) {
        const reload = async () => {
          const productsRes = await fetchProducts(businessId);
          setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        };
        void reload();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
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
    setImagePreview(null);
    setImageMode("upload");
    setFormError(null);
    setShowProductForm(true);
  }

  async function openEditProduct(product: Product) {
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
    const cached = cachedImages[product.id] ?? null;
    if (cached) {
      setImagePreview(cached);
      setImageMode("upload");
    } else if (product.imageUrl) {
      setImagePreview(product.imageUrl);
      setImageMode("url");
    } else {
      setImagePreview(null);
      setImageMode("upload");
    }
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
    setImagePreview(null);
    setImageMode("upload");
    setFormError(null);
  }

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setImagePreview(dataUrl);
      setProductForm((f) => ({ ...f, imageUrl: "__local__" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load image");
    }
  }, []);

  function removeImage() {
    setImagePreview(null);
    setProductForm((f) => ({ ...f, imageUrl: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
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

    const isLocalImage = imagePreview?.startsWith("data:");
    const serverImageUrl = isLocalImage ? null : (productForm.imageUrl || null);

    if (editingProductId) {
      const { data, error } = await updateProduct({
        businessId,
        productId: editingProductId,
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description ?? null,
        category: productForm.category,
        duration: durationValue,
        imageUrl: serverImageUrl,
        sku: productForm.sku || null,
        isActive: productForm.isActive,
      });
      if (error) { setFormError(error); toast.error("Failed to update product"); return; }
      if (data) {
        if (isLocalImage && imagePreview) {
          await saveProductImage(editingProductId, imagePreview);
          setCachedImages((prev) => ({ ...prev, [editingProductId]: imagePreview }));
        } else if (!imagePreview) {
          await deleteProductImage(editingProductId);
          setCachedImages((prev) => { const n = { ...prev }; delete n[editingProductId]; return n; });
        }
        setProducts((prev) => prev.map((p) => (p.id === editingProductId ? { ...p, ...data } : p)));
        closeProductForm();
        toast.success("Product updated");
        notifyProductsChanged();
      }
    } else {
      const { data, error } = await createProduct({
        businessId,
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description,
        category: productForm.category,
        duration: durationValue,
        imageUrl: serverImageUrl,
        sku: productForm.sku || null,
        isActive: productForm.isActive,
      });
      if (error) { setFormError(error); toast.error("Failed to create product"); return; }
      if (data) {
        if (isLocalImage && imagePreview) {
          await saveProductImage(data.id, imagePreview);
          setCachedImages((prev) => ({ ...prev, [data.id]: imagePreview }));
        }
        setProducts((prev) => [data, ...prev]);
        closeProductForm();
        toast.success("Product created");
        notifyProductsChanged();
      }
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!businessId) return;
    const { error } = await deleteProduct(productId, businessId);
    if (error) { setError(error); toast.error("Failed to delete product"); return; }
    await deleteProductImage(productId).catch(() => {});
    setCachedImages((prev) => { const n = { ...prev }; delete n[productId]; return n; });
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeleteConfirm(null);
    toast.success("Product deleted");
    notifyProductsChanged();
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

  if (workspaceLoading) return <ListPageSkeleton />;

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
        titleExtra={
          <div className="relative">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                showGuide
                  ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                  : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
              }`}
              aria-label="Getting started guide"
              title="Getting started guide"
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute left-0 top-full mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl w-[90vw] max-w-[700px] max-h-[85vh] overflow-y-auto p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-amber-400/10">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Getting Started</h4>
                        <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                      </div>
                      <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { step: "1", title: "Add Products", desc: "Create your product and service catalog with prices, categories, and descriptions." },
                        { step: "2", title: "Create Invoices", desc: "Generate professional invoices, set payment terms, and track payment status." },
                        { step: "3", title: "Send Quotes", desc: "Build quotes for clients, then convert accepted quotes into invoices with one click." },
                        { step: "4", title: "Set Up Recurring", desc: "Automate repeat billing with weekly, monthly, or custom schedules." },
                        { step: "5", title: "Track Payments", desc: "Monitor paid, pending, and overdue invoices. Share payment links via WhatsApp." },
                        { step: "6", title: "Connect Gmail", desc: "Link your Gmail to send quotes and invoices directly via email." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                            {item.step}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
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
                  onClick={() => {
                    if (!businessId) return;
                    setConfirmDisconnectGmail(true);
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


      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ConnectionBanner
          icon={Mail}
          color="#EA4335"
          title="Gmail"
          description="Connect Gmail to send invoices and quotes via email"
          connected={gmailStatus?.connected ?? false}
          connectedDetail={gmailStatus?.email ? `Sending as ${gmailStatus.email}` : undefined}
          onConnect={async () => {
            if (!businessId) return;
            setLoadingGmail(true);
            const res = await getGmailAuthUrl(businessId);
            if (res.data?.url) {
              window.location.href = res.data.url;
            }
            setLoadingGmail(false);
          }}
          onDisconnect={() => {
            if (!businessId) return;
            setConfirmDisconnectGmail(true);
          }}
          loading={loadingGmail}
          compact
        />
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-card/60">
          <div className="flex -space-x-1.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: paymentGateways.wipay ? "#10b98118" : "hsl(var(--kf-muted))" }}
            >
              <CreditCard className="w-4 h-4" style={{ color: paymentGateways.wipay ? "#10b981" : "hsl(var(--kf-muted-foreground))" }} />
            </div>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 -ml-1"
              style={{ background: paymentGateways.paypal ? "#0070ba18" : "hsl(var(--kf-muted))" }}
            >
              <Wallet className="w-4 h-4" style={{ color: paymentGateways.paypal ? "#0070ba" : "hsl(var(--kf-muted-foreground))" }} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">Payment Gateways</span>
              <span className="text-[11px] text-muted-foreground">
                {paymentGateways.wipay && paymentGateways.paypal
                  ? "WiPay + PayPal"
                  : paymentGateways.wipay
                  ? "WiPay"
                  : paymentGateways.paypal
                  ? "PayPal"
                  : "None configured"}
              </span>
            </div>
          </div>
          <a
            href="/app/settings/business?tab=payments"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            {paymentGateways.wipay || paymentGateways.paypal ? "Manage" : "Set up"}
          </a>
        </div>
      </div>

      <CommerceDashboard invoices={invoices} quotes={quotes} products={products} />

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Commerce sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            role="tab"
            aria-selected={tab === t.key}
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
              cachedImages={cachedImages}
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
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            onClick={(e) => e.target === e.currentTarget && closeProductForm()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden my-auto"
            >
              <div className="p-5 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
                <h2 id="product-modal-title" className="text-lg font-semibold flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center">
                    <Package className="w-4 h-4 text-primary" />
                  </div>
                  {editingProductId ? "Edit Product" : "New Product"}
                </h2>
                <button onClick={closeProductForm} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
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
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Product Image</label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setImageMode("upload")}
                        className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                          imageMode === "upload"
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "text-muted-foreground hover:bg-muted border border-transparent"
                        }`}
                      >
                        <Upload className="w-3 h-3 inline mr-1" />
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageMode("url")}
                        className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                          imageMode === "url"
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "text-muted-foreground hover:bg-muted border border-transparent"
                        }`}
                      >
                        <Link2 className="w-3 h-3 inline mr-1" />
                        URL
                      </button>
                    </div>
                  </div>
                  {imagePreview ? (
                    <div className="relative rounded-xl border border-border/60 overflow-hidden bg-muted/20 group/img">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="w-full h-36 object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).src = ""; setImagePreview(null); }}
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
                          title="Replace image"
                        >
                          <Upload className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={removeImage}
                          className="p-2 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-white transition-colors"
                          title="Remove image"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : imageMode === "upload" ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-primary/60", "bg-primary/5"); }}
                      onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove("border-primary/60", "bg-primary/5"); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("border-primary/60", "bg-primary/5");
                        const file = e.dataTransfer.files[0];
                        if (file) handleFileSelect(file);
                      }}
                      className="w-full h-28 rounded-xl border-2 border-dashed border-border/60 bg-muted/10 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all"
                    >
                      <div className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium text-muted-foreground">Click or drag to upload</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">PNG, JPG, WEBP up to 5 MB</p>
                      </div>
                    </div>
                  ) : (
                    <input
                      type="url"
                      value={productForm.imageUrl === "__local__" ? "" : productForm.imageUrl}
                      onChange={(e) => {
                        setProductForm((f) => ({ ...f, imageUrl: e.target.value }));
                        setImagePreview(e.target.value || null);
                      }}
                      placeholder="https://example.com/image.jpg"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                    />
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
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
      <ConfirmDialog
        open={confirmDisconnectGmail}
        title="Disconnect Gmail?"
        message="You won't be able to send quotes via email until you reconnect."
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={async () => {
          if (businessId) {
            await disconnectGmail(businessId);
            setGmailStatus({ connected: false, email: null });
            toast.success("Gmail disconnected");
          }
          setConfirmDisconnectGmail(false);
        }}
        onCancel={() => setConfirmDisconnectGmail(false)}
      />
    </div>
  );
}
