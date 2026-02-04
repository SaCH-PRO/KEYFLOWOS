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
  Product,
  Invoice,
  Contact,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().positive("Price must be positive"),
  description: z.string().optional(),
});

type Tab = "products" | "invoices";

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
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const [invoiceForm, setInvoiceForm] = useState({
    contactId: "",
    dueDate: "",
    items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }] as InvoiceLineItem[],
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
        const [productsRes, invoicesRes, contactsRes] = await Promise.all([
          fetchProducts(businessId),
          fetchInvoices(businessId),
          fetchContacts(businessId),
        ]);
        setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
        setInvoices(invoicesRes.data ?? []);
        setContacts(contactsRes.data ?? []);
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
    setInvoiceForm({
      contactId: "",
      dueDate: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    });
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

  async function handleCreateInvoice() {
    setFormError(null);
    if (!businessId) return;
    const validItems = invoiceForm.items.filter(
      (item) => item.description.trim() && item.unitPrice
    );
    if (validItems.length === 0) {
      setFormError("At least one item with description and price is required");
      return;
    }
    
    // First, create any new items that should be added to catalog
    const itemsToAddToCatalog = validItems.filter(
      (item) => item.isNewItem && item.addToCatalog
    );
    
    for (const item of itemsToAddToCatalog) {
      const { data: newProduct, error: productError } = await createProduct({
        businessId,
        name: item.description,
        price: parseFloat(item.unitPrice),
        category: item.newItemCategory || "SERVICE",
        description: "",
        isActive: true,
      });
      if (productError) {
        setFormError(`Failed to add "${item.description}" to catalog: ${productError}`);
        return;
      }
      if (newProduct) {
        setProducts((prev) => [newProduct, ...prev]);
      }
    }
    
    const { data, error } = await createInvoice({
      businessId,
      contactId: invoiceForm.contactId || undefined,
      items: validItems.map((item) => ({
        description: item.description,
        quantity: parseInt(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice),
      })),
      dueDate: invoiceForm.dueDate || undefined,
    });
    if (error) setFormError(error);
    if (data) {
      setInvoices((prev) => [data, ...prev]);
      resetInvoiceForm();
      setShowInvoiceBuilder(false);
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
        <div className="flex gap-2">
          {tab === "products" && (
            <Button onClick={openAddProduct} className="gap-2">
              <Plus className="w-4 h-4" />
              Add Product
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

      <div className="flex gap-2">
        {(["products", "invoices"] as Tab[]).map((t) => (
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
            {t === "invoices" && <FileText className="w-4 h-4" />}
            {t === "products" ? "Products & Services" : "Invoices"}
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
                    <FileText className="w-5 h-5 text-primary" /> Create Invoice
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
                              {item.isNewItem && item.description ? `+ ${item.description}` : "+ New item"}
                            </option>
                            {products.filter(p => p.isActive !== false).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} - {p.currency} {Number(p.price).toLocaleString()}
                              </option>
                            ))}
                          </select>
                        </div>
                        {item.isNewItem && (
                          <div className="col-span-12 md:col-span-2">
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
                        )}
                        <div className={`col-span-12 ${item.isNewItem ? "md:col-span-3" : "md:col-span-4"}`}>
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
                  
                  <div className="flex justify-end pt-2 border-t border-border/40">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Total: </span>
                      <span className="font-bold text-primary">
                        TTD {invoiceForm.items.reduce((sum, item) => {
                          const qty = parseInt(item.quantity) || 0;
                          const price = parseFloat(item.unitPrice) || 0;
                          return sum + (qty * price);
                        }, 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => { setShowInvoiceBuilder(false); resetInvoiceForm(); }}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateInvoice}>Create Invoice</Button>
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
                              <button
                                onClick={() => setSelectedInvoice(inv)}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                                title="View details"
                              >
                                <Eye className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                              </button>
                              <button
                                onClick={() => copyPaymentLink(inv.id)}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                                title={copiedLink === inv.id ? "Copied!" : "Copy payment link"}
                              >
                                <Copy className={`w-4 h-4 ${copiedLink === inv.id ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"}`} />
                              </button>
                              {inv.status === "DRAFT" && (
                                <Button
                                  variant="outline"
                                  className="px-2.5 py-1 text-xs gap-1"
                                  onClick={() => handleSendInvoice(inv.id)}
                                >
                                  <Send className="w-3 h-3" /> Send
                                </Button>
                              )}
                              {(inv.status === "DRAFT" || inv.status === "SENT") && (
                                <Button
                                  variant="outline"
                                  className="px-2.5 py-1 text-xs gap-1"
                                  onClick={() => handleMarkPaid(inv.id, inv)}
                                >
                                  <CheckCircle className="w-3 h-3" /> Paid
                                </Button>
                              )}
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
