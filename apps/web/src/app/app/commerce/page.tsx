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
  MoreVertical,
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
};

export default function CommercePage() {
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>({ name: "", description: "", price: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [showInvoiceBuilder, setShowInvoiceBuilder] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    contactId: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    dueDate: "",
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [productsRes, invoicesRes, contactsRes] = await Promise.all([
        fetchProducts(),
        fetchInvoices(),
        fetchContacts(),
      ]);
      setProducts((productsRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
      setInvoices(invoicesRes.data ?? []);
      setContacts(contactsRes.data ?? []);
      if (productsRes.error) setError(productsRes.error);
      if (invoicesRes.error) setInvoiceError(invoicesRes.error);
      setLoading(false);
    };
    void load();
  }, []);

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
    setProductForm({ name: "", description: "", price: "" });
    setFormError(null);
    setShowProductForm(true);
  }

  function openEditProduct(product: Product) {
    setEditingProductId(product.id);
    setProductForm({
      name: product.name,
      description: product.description ?? "",
      price: String(product.price),
    });
    setFormError(null);
    setShowProductForm(true);
  }

  function closeProductForm() {
    setShowProductForm(false);
    setEditingProductId(null);
    setProductForm({ name: "", description: "", price: "" });
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

    if (editingProductId) {
      const { data, error } = await updateProduct({
        productId: editingProductId,
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description ?? null,
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
        name: parsed.data.name,
        price: parsed.data.price,
        description: parsed.data.description,
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
    const { error } = await deleteProduct(productId);
    if (error) {
      setError(error);
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setDeleteConfirm(null);
  }

  async function handleCreateInvoice() {
    setFormError(null);
    if (!invoiceForm.description.trim() || !invoiceForm.unitPrice) {
      setFormError("Description and price are required");
      return;
    }
    const { data, error } = await createInvoice({
      contactId: invoiceForm.contactId || undefined,
      items: [
        {
          description: invoiceForm.description,
          quantity: parseInt(invoiceForm.quantity) || 1,
          unitPrice: parseFloat(invoiceForm.unitPrice),
        },
      ],
      dueDate: invoiceForm.dueDate || undefined,
    });
    if (error) setFormError(error);
    if (data) {
      setInvoices((prev) => [data, ...prev]);
      setInvoiceForm({ contactId: "", description: "", quantity: "1", unitPrice: "", dueDate: "" });
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
                    className="group relative rounded-2xl border border-border/60 bg-card hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
                  >
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-base truncate">{product.name}</h3>
                          {product.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
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
                      <div className="flex items-center gap-2">
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
                  <button onClick={() => setShowInvoiceBuilder(false)} className="p-1 rounded hover:bg-muted">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {formError && <div className="text-xs text-amber-400">{formError}</div>}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
                    label="Item Description"
                    placeholder="Consultation service"
                    value={invoiceForm.description}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, description: e.target.value }))}
                  />
                  <Input
                    label="Quantity"
                    placeholder="1"
                    value={invoiceForm.quantity}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                  <Input
                    label="Unit Price (TTD)"
                    placeholder="500"
                    value={invoiceForm.unitPrice}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, unitPrice: e.target.value }))}
                  />
                  <Input
                    label="Due Date"
                    type="date"
                    value={invoiceForm.dueDate}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowInvoiceBuilder(false)}>
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
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <span className="font-mono text-sm">{inv.invoiceNumber ?? inv.id}</span>
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
    </div>
  );
}
