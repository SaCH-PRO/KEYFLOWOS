"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input } from "@keyflow/ui";
import {
  CreditCard,
  Package,
  FileText,
  Plus,
  Send,
  CheckCircle,
  Pencil,
  Trash2,
  X,
  DollarSign,
  Search,
  Clock,
  Tag,
  ToggleLeft,
  ToggleRight,
  Copy,
  Eye,
  Filter,
  Calendar,
  User,
  Minus,
  Mail,
} from "lucide-react";
import {
  createProduct,
  fetchProducts,
  fetchInvoices,
  fetchContacts,
  markInvoicePaid,
  createInvoice,
  updateInvoiceStatus,
  updateProduct,
  deleteProduct,
  deleteInvoice,
  updateInvoice,
  listQuotes,
  createQuote,
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
  convertQuoteToInvoice,
  getGmailStatus,
  getGmailAuthUrl,
  disconnectGmail,
  sendQuoteEmail,
  Product,
  Invoice,
  Contact,
  Quote,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().positive("Price must be positive"),
  description: z.string().optional(),
});

type Tab = "products" | "quotes" | "invoices";

type ProductForm = {
  name: string;
  description: string;
  price: string;
  category: "SERVICE" | "PRODUCT" | "PACKAGE";
  duration: string; // in minutes
  isActive: boolean;
};

const CATEGORIES = [
  { value: "SERVICE", label: "Service" },
  { value: "PRODUCT", label: "Product" },
  { value: "PACKAGE", label: "Package" },
] as const;

type InvoiceLineItem = {
  id: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  isNewItem?: boolean;
  newItemName?: string;
  newItemCategory?: "SERVICE" | "PRODUCT" | "PACKAGE";
  addToCatalog?: boolean;
};

const INVOICE_STATUS_FILTERS = [
  { value: "ALL", label: "All Invoices" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PAID", label: "Paid" },
  { value: "OVERDUE", label: "Overdue" },
] as const;

const QUOTE_STATUS_FILTERS = [
  { value: "ALL", label: "All Quotes" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
] as const;

function generateItemId() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

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

  // Quote state
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
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<string>("ALL");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [convertForm, setConvertForm] = useState({
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    notes: "",
    dueDate: "",
  });

  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>({ 
    name: "", 
    description: "", 
    price: "",
    category: "SERVICE",
    duration: "",
    isActive: true,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [invoiceError, setInvoiceError] = useState<string | null>(null);
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
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>("ALL");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  useEffect(() => {
    const initWorkspace = async () => {
      // Always refresh businessId from server to ensure it's valid for current user
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        setWorkspaceLoading(false);
        return;
      }
      // Fallback to stored if refresh fails (offline/network error)
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
        if (invoicesRes.error) setInvoiceError(invoicesRes.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [businessId]);

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
    );
  }, [products, productSearch]);

  function openAddProduct() {
    setEditingProductId(null);
    setProductForm({ 
      name: "", 
      description: "", 
      price: "",
      category: "SERVICE",
      duration: "",
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
        isActive: productForm.isActive,
      });
      if (error) {
        setFormError(error);
        return;
      }
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
        isActive: productForm.isActive,
      });
      if (error) {
        setFormError(error);
        return;
      }
      if (data) {
        setProducts((prev) => [data, ...prev]);
        closeProductForm();
      }
    }
  }

  async function handleDeleteProduct(productId: string) {
    if (!businessId) return;
    const { error } = await deleteProduct(productId, businessId);
    if (error) {
      setError(error);
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeleteConfirm(null);
  }

  const filteredInvoices = useMemo(() => {
    if (invoiceStatusFilter === "ALL") return invoices;
    return invoices.filter((inv) => inv.status === invoiceStatusFilter);
  }, [invoices, invoiceStatusFilter]);

  function addInvoiceItem() {
    setInvoiceForm((f) => ({
      ...f,
      items: [...f.items, { id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    }));
  }

  function removeInvoiceItem(itemId: string) {
    setInvoiceForm((f) => ({
      ...f,
      items: f.items.filter((item) => item.id !== itemId),
    }));
  }

  function updateInvoiceItem(itemId: string, field: keyof InvoiceLineItem, value: string | boolean) {
    setInvoiceForm((f) => ({
      ...f,
      items: f.items.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item
      ),
    }));
  }

  function selectProductForItem(itemId: string, productId: string) {
    if (productId === "__NEW__") {
      setInvoiceForm((f) => ({
        ...f,
        items: f.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: "__NEW__",
                isNewItem: true,
                newItemName: "",
                newItemCategory: "SERVICE",
                description: "",
                unitPrice: "",
                addToCatalog: false,
              }
            : item
        ),
      }));
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (product) {
      setInvoiceForm((f) => ({
        ...f,
        items: f.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId,
                description: product.name,
                unitPrice: String(product.price),
                isNewItem: false,
                addToCatalog: false,
              }
            : item
        ),
      }));
    } else {
      setInvoiceForm((f) => ({
        ...f,
        items: f.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: "",
                isNewItem: false,
                addToCatalog: false,
              }
            : item
        ),
      }));
    }
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

  function addQuoteItem() {
    setQuoteForm((f) => ({
      ...f,
      items: [...f.items, { id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    }));
  }

  function removeQuoteItem(itemId: string) {
    setQuoteForm((f) => ({
      ...f,
      items: f.items.filter((item) => item.id !== itemId),
    }));
  }

  function updateQuoteItem(itemId: string, field: keyof InvoiceLineItem, value: string | boolean) {
    setQuoteForm((f) => ({
      ...f,
      items: f.items.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item
      ),
    }));
  }

  function selectProductForQuoteItem(itemId: string, productId: string) {
    if (productId === "__NEW__") {
      setQuoteForm((f) => ({
        ...f,
        items: f.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: "__NEW__",
                isNewItem: true,
                newItemName: "",
                newItemCategory: "SERVICE",
                description: "",
                unitPrice: "",
                addToCatalog: false,
              }
            : item
        ),
      }));
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (product) {
      setQuoteForm((f) => ({
        ...f,
        items: f.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId,
                description: product.name,
                unitPrice: String(product.price),
                isNewItem: false,
                addToCatalog: false,
              }
            : item
        ),
      }));
    } else {
      setQuoteForm((f) => ({
        ...f,
        items: f.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                productId: "",
                isNewItem: false,
                addToCatalog: false,
              }
            : item
        ),
      }));
    }
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

  async function copyPaymentLink(invoiceId: string) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${baseUrl}/pay/${invoiceId}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(invoiceId);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch {
      setInvoiceError("Failed to copy link");
    }
  }

  async function handleCreateOrUpdateInvoice() {
    setFormError(null);
    if (!businessId) return;
    const validItems = invoiceForm.items.filter(
      (item) => {
        const hasName = item.isNewItem ? (item.newItemName?.trim() || item.description.trim()) : item.description.trim();
        return hasName && item.unitPrice;
      }
    );
    if (validItems.length === 0) {
      setFormError("At least one item with name/description and price is required");
      return;
    }
    
    // First, create any new items that should be added to catalog
    const itemsToAddToCatalog = validItems.filter(
      (item) => item.isNewItem && item.addToCatalog
    );
    
    for (const item of itemsToAddToCatalog) {
      const itemName = item.newItemName || item.description;
      const { data: newProduct, error: productError } = await createProduct({
        businessId,
        name: itemName,
        price: parseFloat(item.unitPrice),
        category: item.newItemCategory || "SERVICE",
        description: item.description || "",
        isActive: true,
      });
      if (productError) {
        setFormError(`Failed to add "${itemName}" to catalog: ${productError}`);
        return;
      }
      if (newProduct) {
        setProducts((prev) => [newProduct, ...prev]);
      }
    }

    const invoicePayload = {
      businessId,
      contactId: invoiceForm.contactId || undefined,
      items: validItems.map((item) => ({
        description: item.isNewItem ? (item.newItemName || item.description) : item.description,
        quantity: parseInt(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice),
      })),
      dueDate: invoiceForm.dueDate || undefined,
      taxRate: invoiceForm.taxRate ? parseFloat(invoiceForm.taxRate) : undefined,
      discountType: invoiceForm.discountValue ? invoiceForm.discountType : undefined,
      discountValue: invoiceForm.discountValue ? parseFloat(invoiceForm.discountValue) : undefined,
      notes: invoiceForm.notes || undefined,
    };
    
    if (editingInvoiceId) {
      // Update existing invoice
      const { data, error } = await updateInvoice({
        ...invoicePayload,
        invoiceId: editingInvoiceId,
      });
      if (error) setFormError(error);
      if (data) {
        setInvoices((prev) => prev.map((inv) => inv.id === editingInvoiceId ? data : inv));
        resetInvoiceForm();
        setShowInvoiceBuilder(false);
      }
    } else {
      // Create new invoice
      const { data, error } = await createInvoice(invoicePayload);
      if (error) setFormError(error);
      if (data) {
        setInvoices((prev) => [data, ...prev]);
        resetInvoiceForm();
        setShowInvoiceBuilder(false);
      }
    }
  }

  async function handleSendInvoice(invoiceId: string) {
    const { data, error } = await updateInvoiceStatus(invoiceId, "SENT");
    if (!error && data) {
      setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: "SENT" } : i)));
    } else {
      setInvoiceError(error ?? "Failed to send invoice");
    }
  }

  async function handleMarkPaid(invoiceId: string, inv: Invoice) {
    const { data, error } = await markInvoicePaid(invoiceId);
    if (!error && data) {
      setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: data.status ?? "PAID" } : i)));
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("kf:invoicePaid", {
            detail: { invoiceNumber: data.invoiceNumber ?? inv.invoiceNumber, total: data.total, currency: data.currency, invoiceId },
          })
        );
      }
    } else {
      setInvoiceError(error ?? "Failed to mark paid");
    }
  }

  async function handleDeleteInvoice(invoiceId: string) {
    if (!businessId) return;
    if (!confirm("Are you sure you want to delete this invoice?")) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "https://keyflowos.replit.app"}/commerce/businesses/${businessId}/invoices/${invoiceId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("kf_token") || ""}`,
        },
      });
      if (res.ok) {
        setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
        if (selectedInvoice?.id === invoiceId) {
          setSelectedInvoice(null);
        }
      } else {
        const err = await res.json();
        setInvoiceError(err.message || "Failed to delete invoice");
      }
    } catch (e) {
      setInvoiceError("Failed to delete invoice");
    }
  }

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      DRAFT: "bg-slate-500/20 text-slate-300 border-slate-500/40",
      SENT: "bg-blue-500/20 text-blue-300 border-blue-500/40",
      PAID: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
      OVERDUE: "bg-red-500/20 text-red-300 border-red-500/40",
      VOID: "bg-slate-600/20 text-slate-400 border-slate-600/40",
    };
    return styles[status] ?? styles.DRAFT;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/30 to-secondary/30 border border-primary/40 flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Commerce
            </h1>
            <p className="text-sm text-muted-foreground">Manage your products, services, and invoices</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {(["products", "quotes", "invoices"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 ${
              tab === t
                ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-primary border border-primary/30 shadow-lg shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
            }`}
          >
            {t === "products" && <Package className="w-4 h-4" />}
            {t === "quotes" && <FileText className="w-4 h-4" />}
            {t === "invoices" && <CreditCard className="w-4 h-4" />}
            {t === "products" ? "Products & Services" : t === "quotes" ? "Quotations" : "Invoices"}
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
            className="space-y-4"
          >
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search products..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
              />
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-2xl border border-border/60 bg-card p-6 animate-pulse">
                    <div className="h-5 bg-muted rounded w-2/3 mb-3" />
                    <div className="h-4 bg-muted rounded w-full mb-2" />
                    <div className="h-6 bg-muted rounded w-1/3" />
                  </div>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
                <Package className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {productSearch ? "No products found" : "No products yet"}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {productSearch
                    ? "Try a different search term"
                    : "Add your first product or service to start selling"}
                </p>
                {!productSearch && (
                  <Button onClick={openAddProduct} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Add Your First Product
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProducts.map((product) => (
                  <motion.div
                    key={product.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`group relative rounded-2xl border bg-card hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 ${
                      product.isActive === false 
                        ? "border-border/40 opacity-60" 
                        : "border-border/60 hover:border-primary/40"
                    }`}
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-base truncate">{product.name}</h3>
                            {product.isActive === false && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                                Inactive
                              </span>
                            )}
                          </div>
                          {product.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {product.description}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEditProduct(product)}
                            className="p-2 rounded-lg hover:bg-muted transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground hover:text-primary" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(product.id)}
                            className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-400" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ${
                          product.category === "SERVICE" 
                            ? "bg-secondary/20 text-secondary" 
                            : product.category === "PACKAGE"
                            ? "bg-purple-500/20 text-purple-400"
                            : "bg-blue-500/20 text-blue-400"
                        }`}>
                          <Tag className="w-3 h-3" />
                          {product.category ?? "Service"}
                        </span>
                        {product.category === "SERVICE" && product.duration && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {product.duration} min
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/40">
                        <DollarSign className="w-4 h-4 text-primary" />
                        <span className="text-lg font-bold text-primary">
                          {product.currency} {Number(product.price).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {deleteConfirm === product.id && (
                      <div className="absolute inset-0 bg-card/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 p-4">
                        <p className="text-sm text-center">Delete this product?</p>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="text-sm px-3 py-1.5">
                            Cancel
                          </Button>
                          <Button
                            onClick={() => handleDeleteProduct(product.id)}
                            className="text-sm px-3 py-1.5 bg-red-500 hover:bg-red-600"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {tab === "quotes" && (
          <motion.div
            key="quotes"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {showQuoteBuilder && (
              <div className="rounded-2xl border border-primary/30 bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" /> {editingQuoteId ? "Edit Quote" : "Create Quote"}
                  </h3>
                  <button onClick={() => { setShowQuoteBuilder(false); resetQuoteForm(); }} className="p-1 rounded hover:bg-muted">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Contact *</label>
                    <select
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={quoteForm.contactId}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, contactId: e.target.value }))}
                    >
                      <option value="">Select contact...</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName} {c.email ? `(${c.email})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="Expiry Date"
                    type="date"
                    value={quoteForm.expiryDate}
                    onChange={(e) => setQuoteForm((f) => ({ ...f, expiryDate: e.target.value }))}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Line Items</label>
                    <Button variant="outline" onClick={addQuoteItem} className="text-xs gap-1 px-2 py-1">
                      <Plus className="w-3 h-3" /> Add Item
                    </Button>
                  </div>
                  
                  {quoteForm.items.map((item) => (
                    <div key={item.id} className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-2">
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-12 md:col-span-3">
                          <label className="text-xs text-muted-foreground mb-1 block">Product/Service</label>
                          <select
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            value={item.productId}
                            onChange={(e) => selectProductForQuoteItem(item.id, e.target.value)}
                          >
                            <option value="">Select item...</option>
                            <option value="__NEW__">
                              {item.isNewItem && item.newItemName ? `+ ${item.newItemName}` : "+ New item"}
                            </option>
                            {products.filter(p => p.isActive !== false).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} - {p.currency} {Number(p.price).toLocaleString()}
                              </option>
                            ))}
                          </select>
                        </div>
                        {item.isNewItem && (
                          <>
                            <div className="col-span-12 md:col-span-3">
                              <label className="text-xs text-muted-foreground mb-1 block">Item Name</label>
                              <input
                                className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                placeholder="Enter name for new item"
                                value={item.newItemName || ""}
                                onChange={(e) => updateQuoteItem(item.id, "newItemName", e.target.value)}
                              />
                            </div>
                            <div className="col-span-6 md:col-span-2">
                              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                              <select
                                className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={item.newItemCategory || "SERVICE"}
                                onChange={(e) => updateQuoteItem(item.id, "newItemCategory", e.target.value)}
                              >
                                {CATEGORIES.map((cat) => (
                                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}
                        <div className={`col-span-12 ${item.isNewItem ? "md:col-span-4" : "md:col-span-4"}`}>
                          <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                          <input
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder={item.isNewItem ? "New item name/description" : "Item description"}
                            value={item.description}
                            onChange={(e) => updateQuoteItem(item.id, "description", e.target.value)}
                          />
                        </div>
                        <div className="col-span-4 md:col-span-2">
                          <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                          <input
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder="1"
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateQuoteItem(item.id, "quantity", e.target.value)}
                          />
                        </div>
                        <div className="col-span-6 md:col-span-2">
                          <label className="text-xs text-muted-foreground mb-1 block">Price (TTD)</label>
                          <input
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder="0.00"
                            type="number"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => updateQuoteItem(item.id, "unitPrice", e.target.value)}
                          />
                        </div>
                        <div className="col-span-2 md:col-span-1 flex justify-center">
                          {quoteForm.items.length > 1 && (
                            <button
                              onClick={() => removeQuoteItem(item.id)}
                              className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                              title="Remove item"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {item.isNewItem && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={item.addToCatalog ?? false}
                            onChange={(e) => updateQuoteItem(item.id, "addToCatalog", e.target.checked)}
                            className="rounded border-border"
                          />
                          Add this item to my product catalog for future use
                        </label>
                      )}
                    </div>
                  ))}
                </div>

                {/* Tax, Discount & Notes */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-border/40">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={quoteForm.taxRate}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, taxRate: e.target.value }))}
                      placeholder="12.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Discount Type</label>
                    <select
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={quoteForm.discountType}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, discountType: e.target.value as "PERCENT" | "FIXED" }))}
                    >
                      <option value="PERCENT">Percentage (%)</option>
                      <option value="FIXED">Fixed Amount (TTD)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      Discount {quoteForm.discountType === "PERCENT" ? "(%)" : "(TTD)"}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={quoteForm.discountValue}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, discountValue: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</label>
                  <textarea
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[60px]"
                    value={quoteForm.notes}
                    onChange={(e) => setQuoteForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Payment terms, conditions, or additional notes..."
                  />
                </div>

                {/* Quote Totals */}
                {(() => {
                  const subtotal = quoteForm.items.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0), 0);
                  const taxAmount = subtotal * (parseFloat(quoteForm.taxRate) || 0) / 100;
                  const discountAmount = quoteForm.discountType === "PERCENT"
                    ? subtotal * (parseFloat(quoteForm.discountValue) || 0) / 100
                    : parseFloat(quoteForm.discountValue) || 0;
                  const total = subtotal + taxAmount - discountAmount;
                  return (
                    <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span className="font-medium">${subtotal.toFixed(2)} TTD</span>
                      </div>
                      {parseFloat(quoteForm.taxRate) > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tax ({quoteForm.taxRate}%):</span>
                          <span className="font-medium">+${taxAmount.toFixed(2)} TTD</span>
                        </div>
                      )}
                      {parseFloat(quoteForm.discountValue) > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Discount {quoteForm.discountType === "PERCENT" ? `(${quoteForm.discountValue}%)` : ""}:
                          </span>
                          <span className="font-medium text-emerald-500">-${discountAmount.toFixed(2)} TTD</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base pt-1 border-t border-border/40">
                        <span className="font-semibold">Total:</span>
                        <span className="font-bold text-primary">${total.toFixed(2)} TTD</span>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setShowQuoteBuilder(false); resetQuoteForm(); }}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!businessId || !quoteForm.contactId) return;
                      
                      for (const item of quoteForm.items) {
                        if (item.isNewItem && item.addToCatalog && item.newItemName) {
                          const newProduct = await createProduct({
                            businessId,
                            name: item.newItemName,
                            description: item.description,
                            category: item.newItemCategory || "SERVICE",
                            price: parseFloat(item.unitPrice) || 0,
                          });
                          if (newProduct.data) {
                            setProducts((prev) => [...prev, newProduct.data!]);
                          }
                        }
                      }
                      
                      const items = quoteForm.items.filter((item) => item.description && parseFloat(item.unitPrice) > 0).map((item) => ({
                        description: item.isNewItem && item.newItemName ? item.newItemName : item.description,
                        quantity: parseInt(item.quantity) || 1,
                        unitPrice: parseFloat(item.unitPrice),
                        productId: item.productId && item.productId !== "__NEW__" ? item.productId : undefined,
                      }));
                      if (items.length === 0) return;
                      
                      if (editingQuoteId) {
                        const res = await updateQuote({
                          businessId,
                          quoteId: editingQuoteId,
                          contactId: quoteForm.contactId,
                          items,
                          expiryDate: quoteForm.expiryDate || undefined,
                          taxRate: parseFloat(quoteForm.taxRate) || 0,
                          discountType: quoteForm.discountType,
                          discountValue: parseFloat(quoteForm.discountValue) || 0,
                          notes: quoteForm.notes || undefined,
                        });
                        if (res.data) {
                          setQuotes((q) => q.map((quote) => quote.id === editingQuoteId ? res.data! : quote));
                        }
                      } else {
                        const res = await createQuote({
                          businessId,
                          contactId: quoteForm.contactId,
                          items,
                          expiryDate: quoteForm.expiryDate || undefined,
                          taxRate: parseFloat(quoteForm.taxRate) || 0,
                          discountType: quoteForm.discountType,
                          discountValue: parseFloat(quoteForm.discountValue) || 0,
                          notes: quoteForm.notes || undefined,
                        });
                        if (res.data) {
                          setQuotes((q) => [res.data!, ...q]);
                        }
                      }
                      setShowQuoteBuilder(false);
                      resetQuoteForm();
                    }}
                    className="gap-2"
                  >
                    {editingQuoteId ? "Update Quote" : "Create Quote"}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search quotes..."
                  value={quoteSearch}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                />
              </div>
              <div className="flex items-center gap-1">
                <Filter className="w-4 h-4 text-muted-foreground" />
                {QUOTE_STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setQuoteStatusFilter(f.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      quoteStatusFilter === f.value
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "text-muted-foreground hover:bg-muted border border-transparent"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {quotes.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>No quotes yet. Create your first quote above.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Quote #</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes
                      .filter((q) => quoteStatusFilter === "ALL" || q.status === quoteStatusFilter)
                      .filter((q) => !quoteSearch || q.quoteNumber.toLowerCase().includes(quoteSearch.toLowerCase()) || q.contact?.firstName?.toLowerCase().includes(quoteSearch.toLowerCase()) || q.contact?.lastName?.toLowerCase().includes(quoteSearch.toLowerCase()))
                      .map((quote) => (
                        <tr key={quote.id} className="border-t border-border/40 hover:bg-muted/20">
                          <td className="px-4 py-3 font-mono text-xs">{quote.quoteNumber}</td>
                          <td className="px-4 py-3">{quote.contact?.firstName} {quote.contact?.lastName}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              quote.status === "DRAFT" ? "bg-gray-500/20 text-gray-400" :
                              quote.status === "SENT" ? "bg-blue-500/20 text-blue-400" :
                              quote.status === "ACCEPTED" ? "bg-green-500/20 text-green-400" :
                              "bg-red-500/20 text-red-400"
                            }`}>
                              {quote.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">${quote.total.toFixed(2)} {quote.currency}</td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(quote.issueDate).toLocaleDateString()}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {/* View - always available */}
                              <button
                                onClick={() => setSelectedQuote(quote)}
                                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              {/* Edit - always available */}
                              <button
                                onClick={() => {
                                  setEditingQuoteId(quote.id);
                                  setQuoteForm({
                                    contactId: quote.contactId,
                                    expiryDate: quote.expiryDate ? quote.expiryDate.split("T")[0] : "",
                                    items: (quote.items ?? []).map((item) => ({
                                      id: item.id,
                                      productId: item.productId ?? "",
                                      description: item.description,
                                      quantity: String(item.quantity),
                                      unitPrice: String(item.unitPrice),
                                    })),
                                    taxRate: String(quote.taxRate ?? 0),
                                    discountType: (quote.discountType as "PERCENT" | "FIXED") || "PERCENT",
                                    discountValue: quote.discountValue ? String(quote.discountValue) : "",
                                    notes: quote.notes || "",
                                  });
                                  setShowQuoteBuilder(true);
                                }}
                                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                                title="Edit Quote"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {/* Send to Email - available for DRAFT and SENT */}
                              {(quote.status === "DRAFT" || quote.status === "SENT") && (
                                <button
                                  onClick={() => {
                                    setSelectedQuote(quote);
                                    setShowEmailModal(true);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-400"
                                  title="Send to Email"
                                >
                                  <Mail className="w-4 h-4" />
                                </button>
                              )}
                              {/* Mark as Sent - DRAFT only */}
                              {quote.status === "DRAFT" && (
                                <button
                                  onClick={async () => {
                                    const res = await updateQuoteStatus(quote.id, "SENT");
                                    if (res.data) {
                                      setQuotes((q) => q.map((qItem) => qItem.id === quote.id ? res.data! : qItem));
                                    }
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-primary/20 text-primary"
                                  title="Mark as Sent"
                                >
                                  <Send className="w-4 h-4" />
                                </button>
                              )}
                              {/* Accept/Reject - SENT only */}
                              {quote.status === "SENT" && (
                                <>
                                  <button
                                    onClick={async () => {
                                      const res = await updateQuoteStatus(quote.id, "ACCEPTED");
                                      if (res.data) {
                                        setQuotes((q) => q.map((qItem) => qItem.id === quote.id ? res.data! : qItem));
                                      }
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-green-500/20 text-green-400"
                                    title="Mark Accepted"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const res = await updateQuoteStatus(quote.id, "REJECTED");
                                      if (res.data) {
                                        setQuotes((q) => q.map((qItem) => qItem.id === quote.id ? res.data! : qItem));
                                      }
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"
                                    title="Mark Rejected"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                              {/* Convert to Invoice - ACCEPTED only, if no invoice yet */}
                              {quote.status === "ACCEPTED" && !quote.invoiceId && (
                                <button
                                  onClick={() => {
                                    setSelectedQuote(quote);
                                    setShowConvertModal(true);
                                  }}
                                  className="px-2 py-1 rounded-lg bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30"
                                  title="Convert to Invoice"
                                >
                                  Convert
                                </button>
                              )}
                              {/* Delete - always available */}
                              <button
                                onClick={async () => {
                                  if (!businessId) return;
                                  if (confirm("Are you sure you want to delete this quote?")) {
                                    await deleteQuote(businessId, quote.id);
                                    setQuotes((q) => q.filter((qItem) => qItem.id !== quote.id));
                                  }
                                }}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"
                                title="Delete Quote"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {showConvertModal && selectedQuote && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-2xl border border-border p-6 max-w-md w-full space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Convert Quote to Invoice</h3>
                <button onClick={() => { setShowConvertModal(false); setSelectedQuote(null); }} className="p-1 rounded hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Converting <span className="font-mono">{selectedQuote.quoteNumber}</span> for ${selectedQuote.total.toFixed(2)} {selectedQuote.currency}
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={convertForm.taxRate}
                    onChange={(e) => setConvertForm((f) => ({ ...f, taxRate: e.target.value }))}
                  />
                </div>
                <Input
                  label="Due Date"
                  type="date"
                  value={convertForm.dueDate}
                  onChange={(e) => setConvertForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount Type</label>
                  <select
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={convertForm.discountType}
                    onChange={(e) => setConvertForm((f) => ({ ...f, discountType: e.target.value as "PERCENT" | "FIXED" }))}
                  >
                    <option value="PERCENT">Percentage (%)</option>
                    <option value="FIXED">Fixed (TTD)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount Value</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={convertForm.discountValue}
                    onChange={(e) => setConvertForm((f) => ({ ...f, discountValue: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
                <textarea
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm resize-none"
                  rows={2}
                  value={convertForm.notes}
                  onChange={(e) => setConvertForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Payment terms or notes..."
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setShowConvertModal(false); setSelectedQuote(null); }}>Cancel</Button>
                <Button
                  onClick={async () => {
                    if (!businessId || !selectedQuote) return;
                    const res = await convertQuoteToInvoice({
                      businessId,
                      quoteId: selectedQuote.id,
                      taxRate: parseFloat(convertForm.taxRate) || 0,
                      discountType: convertForm.discountValue ? convertForm.discountType : undefined,
                      discountValue: parseFloat(convertForm.discountValue) || undefined,
                      notes: convertForm.notes || undefined,
                      dueDate: convertForm.dueDate || undefined,
                    });
                    if (res.data) {
                      setInvoices((inv) => [res.data!, ...inv]);
                      setQuotes((q) => q.map((qItem) => qItem.id === selectedQuote.id ? { ...qItem, invoiceId: res.data!.id } : qItem));
                      setShowConvertModal(false);
                      setSelectedQuote(null);
                      setConvertForm({ taxRate: "12.5", discountType: "PERCENT", discountValue: "", notes: "", dueDate: "" });
                      setTab("invoices");
                    }
                  }}
                >
                  Create Invoice
                </Button>
              </div>
            </div>
          </div>
        )}

        {selectedQuote && !showConvertModal && !showEmailModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-2xl border border-border p-6 max-w-lg w-full space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Quote Details</h3>
                <button onClick={() => setSelectedQuote(null)} className="p-1 rounded hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Quote Number:</span>
                  <span className="ml-2 font-mono">{selectedQuote.quoteNumber}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    selectedQuote.status === "DRAFT" ? "bg-gray-500/20 text-gray-400" :
                    selectedQuote.status === "SENT" ? "bg-blue-500/20 text-blue-400" :
                    selectedQuote.status === "ACCEPTED" ? "bg-green-500/20 text-green-400" :
                    "bg-red-500/20 text-red-400"
                  }`}>{selectedQuote.status}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Contact:</span>
                  <span className="ml-2">{selectedQuote.contact?.firstName} {selectedQuote.contact?.lastName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Date:</span>
                  <span className="ml-2">{new Date(selectedQuote.issueDate).toLocaleDateString()}</span>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Items</h4>
                <div className="rounded-lg border border-border/40 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Item</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Price</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedQuote.items ?? []).map((item) => (
                        <tr key={item.id} className="border-t border-border/40">
                          <td className="px-3 py-2">{item.description}</td>
                          <td className="px-3 py-2 text-center">{item.quantity}</td>
                          <td className="px-3 py-2 text-right">${item.unitPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium">${item.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border/40">
                <span className="text-muted-foreground">Total</span>
                <span className="text-xl font-bold">${selectedQuote.total.toFixed(2)} {selectedQuote.currency}</span>
              </div>
            </div>
          </div>
        )}

        {/* Send Quote Email Modal */}
        {showEmailModal && selectedQuote && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-2xl border border-border p-6 max-w-md w-full space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Mail className="w-5 h-5 text-primary" /> Send Quote to Client
                </h3>
                <button 
                  onClick={() => { setShowEmailModal(false); setEmailForm({ email: "", message: "" }); }} 
                  className="p-1 rounded hover:bg-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!gmailStatus?.connected ? (
                <div className="space-y-4">
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                    <p className="text-sm text-amber-200">
                      Connect your Gmail account to send quotes directly from your email address.
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      setLoadingGmail(true);
                      try {
                        const res = await getGmailAuthUrl(businessId ?? undefined);
                        if (res.data?.url) {
                          window.location.href = res.data.url;
                        }
                      } catch {
                        alert("Failed to get Gmail authorization URL");
                      } finally {
                        setLoadingGmail(false);
                      }
                    }}
                    disabled={loadingGmail}
                    className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loadingGmail ? "Connecting..." : (
                      <>
                        <Mail className="w-4 h-4" />
                        Connect Gmail Account
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => { setShowEmailModal(false); setEmailForm({ email: "", message: "" }); }}
                    className="w-full rounded-xl border border-border py-2.5 text-sm hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-200">Sending from: {gmailStatus.email}</span>
                    </div>
                    <button
                      onClick={async () => {
                        if (confirm("Disconnect Gmail?")) {
                          await disconnectGmail(businessId ?? undefined);
                          setGmailStatus({ connected: false, email: null });
                        }
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Disconnect
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Recipient Email</label>
                      <input
                        type="email"
                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder={selectedQuote.contact?.email || "client@example.com"}
                        value={emailForm.email || selectedQuote.contact?.email || ""}
                        onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Message (optional)</label>
                      <textarea
                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px]"
                        placeholder="Please find attached your quotation..."
                        value={emailForm.message}
                        onChange={(e) => setEmailForm((f) => ({ ...f, message: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 text-sm space-y-1">
                    <div><span className="text-muted-foreground">Quote:</span> {selectedQuote.quoteNumber}</div>
                    <div><span className="text-muted-foreground">Amount:</span> ${selectedQuote.total.toFixed(2)} {selectedQuote.currency}</div>
                    <div><span className="text-muted-foreground">Expires:</span> {selectedQuote.expiryDate ? new Date(selectedQuote.expiryDate).toLocaleDateString() : "N/A"}</div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => { setShowEmailModal(false); setEmailForm({ email: "", message: "" }); }}
                      className="flex-1 rounded-xl border border-border py-2.5 text-sm hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        const targetEmail = emailForm.email || selectedQuote.contact?.email;
                        if (!targetEmail) {
                          alert("Please enter an email address");
                          return;
                        }
                        setSendingEmail(true);
                        try {
                          const res = await sendQuoteEmail({
                            businessId: businessId ?? undefined,
                            quoteId: selectedQuote.id,
                            recipientEmail: targetEmail,
                            message: emailForm.message || undefined,
                          });
                          if (res.data?.success) {
                            setQuotes((q) => q.map((qItem) => 
                              qItem.id === selectedQuote.id ? { ...qItem, status: "SENT" } : qItem
                            ));
                            setShowEmailModal(false);
                            setEmailForm({ email: "", message: "" });
                            alert(`Quote sent to ${targetEmail}!`);
                          } else {
                            alert(res.error || "Failed to send email");
                          }
                        } catch (err) {
                          alert(err instanceof Error ? err.message : "Failed to send email");
                        } finally {
                          setSendingEmail(false);
                        }
                      }}
                      disabled={sendingEmail}
                      className="flex-1 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {sendingEmail ? "Sending..." : <><Send className="w-4 h-4" /> Send Quote</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "invoices" && (
          <motion.div
            key="invoices"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {showInvoiceBuilder && (
              <div className="rounded-2xl border border-primary/30 bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" /> {editingInvoiceId ? "Edit Invoice" : "Create Invoice"}
                  </h3>
                  <button onClick={() => { setShowInvoiceBuilder(false); resetInvoiceForm(); }} className="p-1 rounded hover:bg-muted">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {formError && <div className="text-xs text-amber-400">{formError}</div>}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Contact (optional)</label>
                    <select
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={invoiceForm.contactId}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, contactId: e.target.value }))}
                    >
                      <option value="">Select contact...</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName} {c.email ? `(${c.email})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="Due Date"
                    type="date"
                    value={invoiceForm.dueDate}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-3 rounded-xl bg-muted/20 border border-border/40">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={invoiceForm.taxRate}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, taxRate: e.target.value }))}
                      placeholder="12.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Discount Type</label>
                    <select
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={invoiceForm.discountType}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, discountType: e.target.value as "PERCENT" | "FIXED" }))}
                    >
                      <option value="PERCENT">Percentage (%)</option>
                      <option value="FIXED">Fixed Amount (TTD)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      Discount {invoiceForm.discountType === "PERCENT" ? "(%)" : "(TTD)"}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={invoiceForm.discountValue}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, discountValue: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</label>
                    <input
                      type="text"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={invoiceForm.notes}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="Payment terms, thank you message..."
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Line Items</label>
                    <Button variant="outline" onClick={addInvoiceItem} className="text-xs gap-1 px-2 py-1">
                      <Plus className="w-3 h-3" /> Add Item
                    </Button>
                  </div>
                  
                  {invoiceForm.items.map((item, index) => (
                    <div key={item.id} className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-2">
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-12 md:col-span-3">
                          <label className="text-xs text-muted-foreground mb-1 block">Product/Service</label>
                          <select
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            value={item.productId}
                            onChange={(e) => selectProductForItem(item.id, e.target.value)}
                          >
                            <option value="">Select item...</option>
                            <option value="__NEW__">
                              {item.isNewItem && item.newItemName ? `+ ${item.newItemName}` : "+ New item"}
                            </option>
                            {products.filter(p => p.isActive !== false).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} - {p.currency} {Number(p.price).toLocaleString()}
                              </option>
                            ))}
                          </select>
                        </div>
                        {item.isNewItem && (
                          <>
                            <div className="col-span-12 md:col-span-3">
                              <label className="text-xs text-muted-foreground mb-1 block">Item Name</label>
                              <input
                                className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                placeholder="Enter name for new item"
                                value={item.newItemName || ""}
                                onChange={(e) => updateInvoiceItem(item.id, "newItemName", e.target.value)}
                              />
                            </div>
                            <div className="col-span-6 md:col-span-2">
                              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                              <select
                                className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                value={item.newItemCategory || "SERVICE"}
                                onChange={(e) => updateInvoiceItem(item.id, "newItemCategory", e.target.value)}
                              >
                                {CATEGORIES.map((cat) => (
                                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}
                        <div className={`col-span-12 ${item.isNewItem ? "md:col-span-4" : "md:col-span-4"}`}>
                          <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                          <input
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder={item.isNewItem ? "New item name/description" : "Item description"}
                            value={item.description}
                            onChange={(e) => updateInvoiceItem(item.id, "description", e.target.value)}
                          />
                        </div>
                        <div className="col-span-4 md:col-span-2">
                          <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                          <input
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder="1"
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateInvoiceItem(item.id, "quantity", e.target.value)}
                          />
                        </div>
                        <div className="col-span-6 md:col-span-2">
                          <label className="text-xs text-muted-foreground mb-1 block">Price (TTD)</label>
                          <input
                            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder="0.00"
                            type="number"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => updateInvoiceItem(item.id, "unitPrice", e.target.value)}
                          />
                        </div>
                        <div className="col-span-2 md:col-span-1 flex justify-center">
                          {invoiceForm.items.length > 1 && (
                            <button
                              onClick={() => removeInvoiceItem(item.id)}
                              className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                              title="Remove item"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {item.isNewItem && (
                        <div className="flex items-center gap-2 pt-1 pl-1">
                          <input
                            type="checkbox"
                            id={`addToCatalog_${item.id}`}
                            checked={item.addToCatalog || false}
                            onChange={(e) => updateInvoiceItem(item.id, "addToCatalog", e.target.checked)}
                            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                          />
                          <label htmlFor={`addToCatalog_${item.id}`} className="text-xs text-muted-foreground cursor-pointer">
                            Add this item to my product catalog
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <div className="pt-4 border-t border-border/40 space-y-2">
                    {(() => {
                      const subtotal = invoiceForm.items.reduce((sum, item) => {
                        const qty = parseInt(item.quantity) || 0;
                        const price = parseFloat(item.unitPrice) || 0;
                        return sum + (qty * price);
                      }, 0);
                      const taxRate = parseFloat(invoiceForm.taxRate) || 0;
                      const taxAmount = (subtotal * taxRate) / 100;
                      const discountValue = parseFloat(invoiceForm.discountValue) || 0;
                      const discountAmount = invoiceForm.discountType === "PERCENT"
                        ? (subtotal * discountValue) / 100
                        : discountValue;
                      const total = subtotal + taxAmount - discountAmount;
                      
                      return (
                        <div className="flex justify-end">
                          <div className="text-sm space-y-1 min-w-[200px]">
                            <div className="flex justify-between text-muted-foreground">
                              <span>Subtotal:</span>
                              <span>TTD {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            {taxRate > 0 && (
                              <div className="flex justify-between text-muted-foreground">
                                <span>Tax ({taxRate}%):</span>
                                <span>TTD {taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                              </div>
                            )}
                            {discountAmount > 0 && (
                              <div className="flex justify-between text-emerald-400">
                                <span>Discount {invoiceForm.discountType === "PERCENT" ? `(${discountValue}%)` : ""}:</span>
                                <span>-TTD {discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-bold text-primary border-t border-border/40 pt-1">
                              <span>Total:</span>
                              <span>TTD {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setShowInvoiceBuilder(false); resetInvoiceForm(); }}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateOrUpdateInvoice}>{editingInvoiceId ? "Update Invoice" : "Create Invoice"}</Button>
                </div>
              </div>
            )}

            {invoiceError && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                {invoiceError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <select
                  className="rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={invoiceStatusFilter}
                  onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                >
                  {INVOICE_STATUS_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <span className="text-sm text-muted-foreground">
                {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
              </span>
            </div>

            {invoices.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No invoices yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {loading ? "Loading invoices..." : "Create your first invoice to start billing"}
                </p>
                {!loading && (
                  <Button onClick={() => setShowInvoiceBuilder(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Create Invoice
                  </Button>
                )}
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
                <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <h3 className="text-base font-medium mb-1">No {invoiceStatusFilter.toLowerCase()} invoices</h3>
                <p className="text-sm text-muted-foreground">
                  Try selecting a different filter
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/30 border-b border-border/60">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Invoice
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Contact
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {filteredInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setSelectedInvoice(inv)}
                              className="font-mono text-sm text-primary hover:underline"
                            >
                              {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {inv.contact
                              ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() ||
                                inv.contact.email ||
                                "—"
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">
                            {inv.currency} {Number(inv.total).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadge(
                                inv.status
                              )}`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              {/* View - always available */}
                              <button
                                onClick={() => setSelectedInvoice(inv)}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                                title="View details"
                              >
                                <Eye className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                              </button>
                              {/* Edit - always available */}
                              <button
                                onClick={() => {
                                  setEditingInvoiceId(inv.id);
                                  setInvoiceForm({
                                    contactId: inv.contactId || "",
                                    dueDate: inv.dueDate ? inv.dueDate.split("T")[0] : "",
                                    items: (inv.items ?? []).map((item) => ({
                                      id: item.id,
                                      productId: item.productId ?? "",
                                      description: item.description,
                                      quantity: String(item.quantity),
                                      unitPrice: String(item.unitPrice),
                                    })),
                                    taxRate: String(inv.taxRate || 0),
                                    discountType: (inv.discountType as "PERCENT" | "FIXED") || "PERCENT",
                                    discountValue: inv.discountValue ? String(inv.discountValue) : "",
                                    notes: inv.notes || "",
                                  });
                                  setShowInvoiceBuilder(true);
                                }}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                                title="Edit invoice"
                              >
                                <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                              </button>
                              {/* Copy payment link - always available */}
                              <button
                                onClick={() => copyPaymentLink(inv.id)}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                                title={copiedLink === inv.id ? "Copied!" : "Copy payment link"}
                              >
                                <Copy className={`w-4 h-4 ${copiedLink === inv.id ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"}`} />
                              </button>
                              {/* Send - DRAFT only */}
                              {inv.status === "DRAFT" && (
                                <Button
                                  variant="outline"
                                  className="px-2.5 py-1 text-xs gap-1"
                                  onClick={() => handleSendInvoice(inv.id)}
                                >
                                  <Send className="w-3 h-3" /> Send
                                </Button>
                              )}
                              {/* Mark Paid - DRAFT and SENT */}
                              {(inv.status === "DRAFT" || inv.status === "SENT") && (
                                <Button
                                  variant="outline"
                                  className="px-2.5 py-1 text-xs gap-1"
                                  onClick={() => handleMarkPaid(inv.id, inv)}
                                >
                                  <CheckCircle className="w-3 h-3" /> Paid
                                </Button>
                              )}
                              {/* Delete - always available */}
                              <button
                                onClick={() => handleDeleteInvoice(inv.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                                title="Delete invoice"
                              >
                                <Trash2 className="w-4 h-4 text-red-400 hover:text-red-300" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
                  <Package className="w-5 h-5 text-primary" />
                  {editingProductId ? "Edit Product" : "Add Product"}
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
                  <label className="block text-sm font-medium mb-1.5">Product Name *</label>
                  <input
                    type="text"
                    value={productForm.name}
                    onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g., Web Design Package"
                    className="w-full px-4 py-2.5 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Description</label>
                  <textarea
                    value={productForm.description}
                    onChange={(e) => setProductForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Describe your product or service..."
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Category *</label>
                    <select
                      value={productForm.category}
                      onChange={(e) => setProductForm((f) => ({ ...f, category: e.target.value as "SERVICE" | "PRODUCT" | "PACKAGE" }))}
                      className="w-full px-4 py-2.5 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Price (TTD) *</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="number"
                        value={productForm.price}
                        onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                      />
                    </div>
                  </div>
                </div>
                {productForm.category === "SERVICE" && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Duration (minutes)</label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="number"
                        value={productForm.duration}
                        onChange={(e) => setProductForm((f) => ({ ...f, duration: e.target.value }))}
                        placeholder="60"
                        min="0"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">How long does this service take?</p>
                  </div>
                )}
                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/60">
                  <div>
                    <label className="block text-sm font-medium">Active</label>
                    <p className="text-xs text-muted-foreground">Show this in your catalog</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProductForm((f) => ({ ...f, isActive: !f.isActive }))}
                    className={`p-1 rounded-lg transition-colors ${productForm.isActive ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {productForm.isActive ? (
                      <ToggleRight className="w-8 h-8" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>
              </div>
              <div className="p-5 border-t border-border flex gap-3 justify-end">
                <Button variant="outline" onClick={closeProductForm}>
                  Cancel
                </Button>
                <Button onClick={handleSaveProduct}>
                  {editingProductId ? "Save Changes" : "Add Product"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedInvoice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setSelectedInvoice(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Invoice {selectedInvoice.invoiceNumber ?? selectedInvoice.id.slice(0, 8)}
                </h2>
                <button onClick={() => setSelectedInvoice(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${getStatusBadge(selectedInvoice.status)}`}
                  >
                    {selectedInvoice.status}
                  </span>
                  <span className="text-2xl font-bold text-primary">
                    {selectedInvoice.currency} {Number(selectedInvoice.total).toLocaleString()}
                  </span>
                </div>

                {selectedInvoice.contact && (
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
                    <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {`${selectedInvoice.contact.firstName ?? ""} ${selectedInvoice.contact.lastName ?? ""}`.trim() || "Unknown"}
                      </p>
                      {selectedInvoice.contact.email && (
                        <p className="text-sm text-muted-foreground">{selectedInvoice.contact.email}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
                    <p className="text-xs text-muted-foreground mb-1">Issue Date</p>
                    <p className="font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {selectedInvoice.issueDate 
                        ? new Date(selectedInvoice.issueDate).toLocaleDateString() 
                        : "—"}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
                    <p className="text-xs text-muted-foreground mb-1">Due Date</p>
                    <p className="font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {selectedInvoice.dueDate 
                        ? new Date(selectedInvoice.dueDate).toLocaleDateString() 
                        : "—"}
                    </p>
                  </div>
                </div>

                {selectedInvoice.items && selectedInvoice.items.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Line Items</h4>
                    <div className="rounded-xl border border-border/60 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 border-b border-border/40">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Qty</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Price</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {selectedInvoice.items.map((item: any, idx: number) => (
                            <tr key={item.id ?? idx}>
                              <td className="px-3 py-2">{item.description}</td>
                              <td className="px-3 py-2 text-right">{item.quantity}</td>
                              <td className="px-3 py-2 text-right">{Number(item.unitPrice).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right font-medium">{Number(item.total).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-border/40 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="gap-2 flex-1"
                    onClick={() => copyPaymentLink(selectedInvoice.id)}
                  >
                    <Copy className={`w-4 h-4 ${copiedLink === selectedInvoice.id ? "text-emerald-400" : ""}`} />
                    {copiedLink === selectedInvoice.id ? "Copied!" : "Copy Payment Link"}
                  </Button>
                  {selectedInvoice.status === "DRAFT" && (
                    <Button
                      className="gap-2 flex-1"
                      onClick={() => {
                        handleSendInvoice(selectedInvoice.id);
                        setSelectedInvoice(null);
                      }}
                    >
                      <Send className="w-4 h-4" /> Send Invoice
                    </Button>
                  )}
                  {(selectedInvoice.status === "DRAFT" || selectedInvoice.status === "SENT") && (
                    <Button
                      className="gap-2 flex-1 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        handleMarkPaid(selectedInvoice.id, selectedInvoice);
                        setSelectedInvoice(null);
                      }}
                    >
                      <CheckCircle className="w-4 h-4" /> Mark Paid
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
