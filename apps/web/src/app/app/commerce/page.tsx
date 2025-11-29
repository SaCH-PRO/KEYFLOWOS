"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Table, Button, Input } from "@keyflow/ui";
import { createProduct, fetchProducts, fetchInvoices, markInvoicePaid, Product, Invoice } from "@/lib/client";

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  price: z.number().positive("Price must be positive"),
});

export default function CommercePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", price: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchProducts();
      setProducts((data ?? []).map((p) => ({ ...p, currency: p.currency ?? "TTD" } as Product)));
      setError(error);

      const invoicesRes = await fetchInvoices();
      setInvoices(invoicesRes.data ?? []);
      if (invoicesRes.error) setInvoiceError(invoicesRes.error);
      setLoading(false);
    };
    void load();
  }, []);

  const rows = useMemo(
    () =>
      products.map((product) => [
        product.name,
        `${product.currency} ${Number(product.price).toLocaleString()}`,
        <Button key={product.id} variant="outline" className="px-3 py-1.5">
          Mark as billed
        </Button>,
      ]),
    [products],
  );

  async function handleCreate() {
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Commerce</h1>
          <p className="text-sm text-muted-foreground">Quotes, invoices, and payments dashboards.</p>
        </div>
        <div className="flex gap-2">
          <Input
            className="w-44"
            placeholder="Product name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            className="w-28"
            placeholder="Price"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
          <Button onClick={handleCreate}>Add</Button>
        </div>
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Live API unreachable — showing demo data.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
          {loading ? "Loading products..." : "No products yet. Add one to begin billing."}
        </div>
      ) : (
        <Table headers={["Product", "Price", "Action"]} rows={rows} />
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Invoices</h2>
          {invoiceError && <span className="text-xs text-amber-400">API unreachable — showing demo data.</span>}
        </div>
        {invoices.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
            {loading ? "Loading invoices..." : "No invoices yet."}
          </div>
        ) : (
          <Table
            headers={["Invoice", "Contact", "Amount", "Status", "Action"]}
            rows={invoices.map((inv) => [
              inv.invoiceNumber ?? inv.id,
              inv.contact ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() || inv.contact.email || "—" : "—",
              `${inv.currency} ${Number(inv.total).toLocaleString()}`,
              inv.status,
              <Button
                key={inv.id}
                variant="outline"
                className="px-3 py-1.5"
                onClick={async () => {
                  const { data, error } = await markInvoicePaid(inv.id);
                  if (!error && data) {
                    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: data.status ?? "PAID" } : i)));
                  } else {
                    setInvoiceError(error ?? "Failed to mark paid");
                  }
                }}
              >
                Mark paid
              </Button>,
            ])}
          />
        )}
      </div>
    </div>
  );
}
