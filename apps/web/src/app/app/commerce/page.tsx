"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Table, Button, Input } from "@keyflow/ui";
import { CreditCard, Package, FileText, Plus, Send, CheckCircle } from "lucide-react";
import { createProduct, fetchProducts, fetchInvoices, fetchContacts, markInvoicePaid, createInvoice, updateInvoiceStatus, Product, Invoice, Contact } from "@/lib/client";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().positive("Price must be positive"),
});

type Tab = "products" | "invoices";

export default function CommercePage() {
  const [tab, setTab] = useState<Tab>("invoices");
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", price: "" });
  const [formError, setFormError] = useState<string | null>(null);
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

  const productRows = useMemo(
    () =>
      products.map((product) => [
        product.name,
        `${product.currency} ${Number(product.price).toLocaleString()}`,
        <Button key={product.id} variant="outline" className="px-3 py-1.5 text-xs">
          Edit
        </Button>,
      ]),
    [products],
  );

  async function handleCreateProduct() {
    setFormError(null);
    const parsed = productSchema.safeParse({ name: form.name, price: Number(form.price) });
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    const { data, error } = await createProduct({
      name: parsed.data.name,
      price: parsed.data.price,
    });
    if (error) setFormError(error);
    if (data) {
      setProducts((prev) => [data, ...prev]);
      setForm({ name: "", price: "" });
    }
  }

  async function handleCreateInvoice() {
    setFormError(null);
    if (!invoiceForm.description.trim() || !invoiceForm.unitPrice) {
      setFormError("Description and price are required");
      return;
    }
    const { data, error } = await createInvoice({
      contactId: invoiceForm.contactId || undefined,
      items: [{
        description: invoiceForm.description,
        quantity: parseInt(invoiceForm.quantity) || 1,
        unitPrice: parseFloat(invoiceForm.unitPrice),
      }],
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
          }),
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Commerce</h1>
            <p className="text-sm text-muted-foreground">Products, invoices, and payment tracking.</p>
          </div>
        </div>
        <Button onClick={() => setShowInvoiceBuilder(!showInvoiceBuilder)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Invoice
        </Button>
      </div>

      <div className="flex gap-2 border-b border-border pb-2">
        {(["invoices", "products"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              tab === t
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {t === "invoices" && <FileText className="w-4 h-4 inline mr-2" />}
            {t === "products" && <Package className="w-4 h-4 inline mr-2" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {showInvoiceBuilder && (
        <div className="rounded-2xl border border-primary/30 bg-card p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" /> Create Invoice
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact (optional)</label>
              <select
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
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
            <Button variant="outline" onClick={() => setShowInvoiceBuilder(false)}>Cancel</Button>
            <Button onClick={handleCreateInvoice}>Create Invoice</Button>
          </div>
        </div>
      )}

      {tab === "invoices" && (
        <div className="space-y-4">
          {invoiceError && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {invoiceError}
            </div>
          )}
          {invoices.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground text-center">
              {loading ? "Loading invoices..." : "No invoices yet. Create one to start billing."}
            </div>
          ) : (
            <Table
              headers={["Invoice", "Contact", "Amount", "Status", "Actions"]}
              rows={invoices.map((inv) => [
                <span key={`num-${inv.id}`} className="font-mono text-xs">{inv.invoiceNumber ?? inv.id}</span>,
                inv.contact ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() || inv.contact.email || "—" : "—",
                `${inv.currency} ${Number(inv.total).toLocaleString()}`,
                <span key={`status-${inv.id}`} className={`rounded-full border px-2 py-0.5 text-[11px] ${getStatusBadge(inv.status)}`}>
                  {inv.status}
                </span>,
                <div key={`actions-${inv.id}`} className="flex gap-1">
                  {inv.status === "DRAFT" && (
                    <Button
                      variant="outline"
                      className="px-2 py-1 text-xs gap-1"
                      onClick={() => handleSendInvoice(inv.id)}
                    >
                      <Send className="w-3 h-3" /> Send
                    </Button>
                  )}
                  {(inv.status === "DRAFT" || inv.status === "SENT") && (
                    <Button
                      variant="outline"
                      className="px-2 py-1 text-xs gap-1"
                      onClick={() => handleMarkPaid(inv.id, inv)}
                    >
                      <CheckCircle className="w-3 h-3" /> Paid
                    </Button>
                  )}
                </div>,
              ])}
            />
          )}
        </div>
      )}

      {tab === "products" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-4 space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Product
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Product Name"
                placeholder="Consultation"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                label="Price (TTD)"
                placeholder="500"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <Button onClick={handleCreateProduct}>Add Product</Button>
          </div>

          {productRows.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
              {loading ? "Loading products..." : "No products yet. Add one to begin billing."}
            </div>
          ) : (
            <Table headers={["Product", "Price", "Action"]} rows={productRows} />
          )}
        </div>
      )}
    </div>
  );
}
