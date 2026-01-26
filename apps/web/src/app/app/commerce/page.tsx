"use client";

import { useEffect, useMemo, useState } from "react";
import { Table, Button, Input, Badge } from "@keyflow/ui";
import {
  Contact,
  Invoice,
  Product,
  Quote,
  createInvoice,
  createProduct,
  createQuote,
  fetchContacts,
  fetchInvoices,
  fetchProducts,
  fetchQuotes,
  markInvoicePaid,
} from "@/lib/client";

const emptyItem = { description: "", quantity: 1, unitPrice: 0 };

export default function CommercePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [productForm, setProductForm] = useState({ name: "", price: "", currency: "TTD" });
  const [invoiceForm, setInvoiceForm] = useState({
    contactId: "",
    dueDate: "",
    status: "DRAFT",
    currency: "TTD",
    items: [{ ...emptyItem }],
  });
  const [quoteForm, setQuoteForm] = useState({
    contactId: "",
    expiryDate: "",
    status: "DRAFT",
    currency: "TTD",
    items: [{ ...emptyItem }],
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [productRes, invoiceRes, quoteRes, contactRes] = await Promise.all([
        fetchProducts(),
        fetchInvoices(),
        fetchQuotes(),
        fetchContacts(undefined, { take: 50 }),
      ]);
      setProducts((productRes.data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
      setInvoices(invoiceRes.data ?? []);
      setQuotes(quoteRes.data ?? []);
      const contactData = contactRes.data ?? [];
      setContacts(contactData);
      if (contactData[0]?.id) {
        setInvoiceForm((prev) => ({ ...prev, contactId: prev.contactId || contactData[0].id }));
        setQuoteForm((prev) => ({ ...prev, contactId: prev.contactId || contactData[0].id }));
      }
      setError(productRes.error);
      setInvoiceError(invoiceRes.error || quoteRes.error);
      setLoading(false);
    };
    void load();
  }, []);

  const productRows = useMemo(
    () =>
      products.map((product) => [
        product.name,
        `${product.currency ?? "TTD"} ${Number(product.price).toLocaleString()}`,
        <Button key={product.id} variant="outline" className="px-3 py-1.5">
          Mark as billed
        </Button>,
      ]),
    [products],
  );

  const invoiceRows = useMemo(
    () =>
      invoices.map((inv) => [
        inv.invoiceNumber ?? inv.id,
        inv.contact ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() || inv.contact.email || "—" : "—",
        `${inv.currency} ${Number(inv.total ?? 0).toLocaleString()}`,
        inv.status,
        <div key={inv.id} className="flex gap-2">
          <Button
            variant="outline"
            className="px-3 py-1.5"
            onClick={async () => {
              await markInvoicePaid(inv.id);
              const refreshed = await fetchInvoices();
              setInvoices(refreshed.data ?? []);
            }}
          >
            Mark paid
          </Button>
          <Button
            variant="outline"
            className="px-3 py-1.5"
            onClick={() => window.open(`/public/pay?invoiceId=${inv.id}`, "_blank")}
          >
            Share link
          </Button>
        </div>,
      ]),
    [invoices],
  );

  const quoteRows = useMemo(
    () =>
      quotes.map((quote) => [
        quote.quoteNumber ?? quote.id,
        quote.contact
          ? `${quote.contact.firstName ?? ""} ${quote.contact.lastName ?? ""}`.trim() || quote.contact.email || "—"
          : "—",
        `${quote.currency} ${Number(quote.total ?? 0).toLocaleString()}`,
        quote.status,
      ]),
    [quotes],
  );

  async function handleCreateProduct() {
    setFormError(null);
    if (!productForm.name.trim()) {
      setFormError("Product name required.");
      return;
    }
    const price = Number(productForm.price);
    if (Number.isNaN(price) || price < 0) {
      setFormError("Enter a valid price.");
      return;
    }
    const { data, error } = await createProduct({
      name: productForm.name.trim(),
      price,
      currency: productForm.currency,
    });
    if (error) setFormError(error);
    if (data) {
      setProducts((prev) => [data, ...prev]);
      setProductForm({ name: "", price: "", currency: "TTD" });
    }
  }

  async function handleCreateInvoice() {
    setFormError(null);
    if (!invoiceForm.contactId) {
      setFormError("Select a contact for the invoice.");
      return;
    }
    const items = invoiceForm.items
      .filter((item) => item.description.trim())
      .map((item) => ({
        description: item.description,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
      }));
    if (items.length === 0) {
      setFormError("Add at least one line item.");
      return;
    }
    const res = await createInvoice({
      contactId: invoiceForm.contactId,
      dueDate: invoiceForm.dueDate || null,
      status: invoiceForm.status,
      currency: invoiceForm.currency,
      items,
    });
    if (res.error) setFormError(res.error);
    else {
      const refreshed = await fetchInvoices();
      setInvoices(refreshed.data ?? []);
      setInvoiceForm({ contactId: "", dueDate: "", status: "DRAFT", currency: "TTD", items: [{ ...emptyItem }] });
    }
  }

  async function handleCreateQuote() {
    setFormError(null);
    if (!quoteForm.contactId) {
      setFormError("Select a contact for the quote.");
      return;
    }
    const items = quoteForm.items
      .filter((item) => item.description.trim())
      .map((item) => ({
        description: item.description,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
      }));
    if (items.length === 0) {
      setFormError("Add at least one line item.");
      return;
    }
    const res = await createQuote({
      contactId: quoteForm.contactId,
      expiryDate: quoteForm.expiryDate || null,
      status: quoteForm.status,
      currency: quoteForm.currency,
      items,
    });
    if (res.error) setFormError(res.error);
    else {
      const refreshed = await fetchQuotes();
      setQuotes(refreshed.data ?? []);
      setQuoteForm({ contactId: "", expiryDate: "", status: "DRAFT", currency: "TTD", items: [{ ...emptyItem }] });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Commerce</h1>
          <p className="text-sm text-muted-foreground">Products, invoices, quotes, and payment tracking.</p>
        </div>
        <Badge tone="info">{invoices.length} invoices</Badge>
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Live API unreachable — showing demo data.
        </div>
      )}

      <div className="rounded-3xl border border-border/60 bg-slate-950/60 p-4 space-y-3">
        <div className="text-sm font-semibold">Create product</div>
        <div className="flex flex-wrap gap-2 items-end">
          <Input
            className="w-44"
            label="Name"
            placeholder="Product name"
            value={productForm.name}
            onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            className="w-28"
            label="Price"
            placeholder="0"
            value={productForm.price}
            onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
          />
          <Input
            className="w-20"
            label="Currency"
            value={productForm.currency}
            onChange={(e) => setProductForm((f) => ({ ...f, currency: e.target.value }))}
          />
          <Button onClick={handleCreateProduct}>Add</Button>
        </div>
        {productRows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
            {loading ? "Loading products..." : "No products yet. Add one to begin billing."}
          </div>
        ) : (
          <Table headers={["Product", "Price", "Action"]} rows={productRows} />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-border/60 bg-slate-950/60 p-4 space-y-3">
          <div className="text-sm font-semibold">Create invoice</div>
          <label className="text-xs text-muted-foreground">
            Contact
            <select
              className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              value={invoiceForm.contactId}
              onChange={(e) => setInvoiceForm((prev) => ({ ...prev, contactId: e.target.value }))}
            >
              <option value="">Select contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName ||
                    `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ||
                    c.email ||
                    "Unnamed"}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              label="Due date"
              type="date"
              value={invoiceForm.dueDate}
              onChange={(e) => setInvoiceForm((prev) => ({ ...prev, dueDate: e.target.value }))}
            />
            <Input
              label="Currency"
              value={invoiceForm.currency}
              onChange={(e) => setInvoiceForm((prev) => ({ ...prev, currency: e.target.value }))}
            />
          </div>
          {invoiceForm.items.map((item, idx) => (
            <div key={`inv-${idx}`} className="grid gap-2 md:grid-cols-3">
              <Input
                label="Description"
                value={item.description}
                onChange={(e) =>
                  setInvoiceForm((prev) => {
                    const items = [...prev.items];
                    items[idx] = { ...items[idx], description: e.target.value };
                    return { ...prev, items };
                  })
                }
              />
              <Input
                label="Qty"
                value={String(item.quantity)}
                onChange={(e) =>
                  setInvoiceForm((prev) => {
                    const items = [...prev.items];
                    items[idx] = { ...items[idx], quantity: Number(e.target.value) || 1 };
                    return { ...prev, items };
                  })
                }
              />
              <Input
                label="Unit price"
                value={String(item.unitPrice)}
                onChange={(e) =>
                  setInvoiceForm((prev) => {
                    const items = [...prev.items];
                    items[idx] = { ...items[idx], unitPrice: Number(e.target.value) || 0 };
                    return { ...prev, items };
                  })
                }
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setInvoiceForm((prev) => ({ ...prev, items: [...prev.items, { ...emptyItem }] }))}
            >
              Add item
            </Button>
            <Button onClick={handleCreateInvoice}>Create invoice</Button>
          </div>
        </div>

        <div className="rounded-3xl border border-border/60 bg-slate-950/60 p-4 space-y-3">
          <div className="text-sm font-semibold">Create quote</div>
          <label className="text-xs text-muted-foreground">
            Contact
            <select
              className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              value={quoteForm.contactId}
              onChange={(e) => setQuoteForm((prev) => ({ ...prev, contactId: e.target.value }))}
            >
              <option value="">Select contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName ||
                    `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ||
                    c.email ||
                    "Unnamed"}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              label="Expiry date"
              type="date"
              value={quoteForm.expiryDate}
              onChange={(e) => setQuoteForm((prev) => ({ ...prev, expiryDate: e.target.value }))}
            />
            <Input
              label="Currency"
              value={quoteForm.currency}
              onChange={(e) => setQuoteForm((prev) => ({ ...prev, currency: e.target.value }))}
            />
          </div>
          {quoteForm.items.map((item, idx) => (
            <div key={`quote-${idx}`} className="grid gap-2 md:grid-cols-3">
              <Input
                label="Description"
                value={item.description}
                onChange={(e) =>
                  setQuoteForm((prev) => {
                    const items = [...prev.items];
                    items[idx] = { ...items[idx], description: e.target.value };
                    return { ...prev, items };
                  })
                }
              />
              <Input
                label="Qty"
                value={String(item.quantity)}
                onChange={(e) =>
                  setQuoteForm((prev) => {
                    const items = [...prev.items];
                    items[idx] = { ...items[idx], quantity: Number(e.target.value) || 1 };
                    return { ...prev, items };
                  })
                }
              />
              <Input
                label="Unit price"
                value={String(item.unitPrice)}
                onChange={(e) =>
                  setQuoteForm((prev) => {
                    const items = [...prev.items];
                    items[idx] = { ...items[idx], unitPrice: Number(e.target.value) || 0 };
                    return { ...prev, items };
                  })
                }
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setQuoteForm((prev) => ({ ...prev, items: [...prev.items, { ...emptyItem }] }))}
            >
              Add item
            </Button>
            <Button onClick={handleCreateQuote}>Create quote</Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Invoices</h2>
          {invoiceError && <span className="text-xs text-amber-400">API unreachable — showing demo data.</span>}
        </div>
        {invoiceRows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
            {loading ? "Loading invoices..." : "No invoices yet."}
          </div>
        ) : (
          <Table headers={["Invoice", "Contact", "Amount", "Status", "Action"]} rows={invoiceRows} />
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quotes</h2>
        </div>
        {quoteRows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
            {loading ? "Loading quotes..." : "No quotes yet."}
          </div>
        ) : (
          <Table headers={["Quote", "Contact", "Amount", "Status"]} rows={quoteRows} />
        )}
      </div>
    </div>
  );
}
