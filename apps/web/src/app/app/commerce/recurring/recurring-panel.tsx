"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input } from "@keyflow/ui";
import {
  RefreshCw,
  Plus,
  X,
  Pencil,
  Trash2,
  Play,
  Pause,
  Calendar,
  User,
  Clock,
  Minus,
} from "lucide-react";
import {
  fetchRecurringInvoices,
  createRecurringInvoice,
  updateRecurringInvoice,
  deleteRecurringInvoice,
  toggleRecurringInvoice,
  RecurringInvoice,
  Product,
  Contact,
} from "@/lib/client";
import {
  InvoiceLineItem,
  CATEGORIES,
  generateItemId,
} from "../components/commerce-types";

interface RecurringPanelProps {
  businessId: string | null;
  contacts: Contact[];
  products: Product[];
  triggerNew?: number;
}

const FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 Weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
];

export default function RecurringPanel({ businessId, contacts, products, triggerNew }: RecurringPanelProps) {
  const [recurring, setRecurring] = useState<RecurringInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    contactId: "",
    frequency: "MONTHLY",
    nextRunDate: "",
    endDate: "",
    notes: "",
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }] as InvoiceLineItem[],
  });

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      const res = await fetchRecurringInvoices(businessId);
      if (res.data) setRecurring(res.data);
      setLoading(false);
    };
    void load();
  }, [businessId]);

  function resetForm() {
    setEditingId(null);
    setForm({
      name: "",
      contactId: "",
      frequency: "MONTHLY",
      nextRunDate: "",
      endDate: "",
      notes: "",
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    });
  }

  useEffect(() => {
    if (triggerNew && triggerNew > 0) {
      resetForm();
      setShowBuilder(true);
    }
  }, [triggerNew]);

  function addItem() {
    setForm((f) => ({
      ...f,
      items: [...f.items, { id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    }));
  }

  function removeItem(itemId: string) {
    setForm((f) => ({
      ...f,
      items: f.items.filter((i) => i.id !== itemId),
    }));
  }

  function updateItem(itemId: string, field: keyof InvoiceLineItem, value: string) {
    setForm((f) => ({
      ...f,
      items: f.items.map((i) => (i.id === itemId ? { ...i, [field]: value } : i)),
    }));
  }

  function selectProduct(itemId: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (product) {
      setForm((f) => ({
        ...f,
        items: f.items.map((i) =>
          i.id === itemId
            ? { ...i, productId, description: product.name, unitPrice: String(product.price) }
            : i
        ),
      }));
    } else {
      setForm((f) => ({
        ...f,
        items: f.items.map((i) => (i.id === itemId ? { ...i, productId: "" } : i)),
      }));
    }
  }

  function openEdit(rec: RecurringInvoice) {
    setEditingId(rec.id);
    setForm({
      name: rec.name,
      contactId: rec.contactId,
      frequency: rec.frequency,
      nextRunDate: rec.nextRunDate ? rec.nextRunDate.split("T")[0] : "",
      endDate: rec.endDate ? rec.endDate.split("T")[0] : "",
      notes: rec.notes || "",
      taxRate: String(rec.taxRate ?? 0),
      discountType: (rec.discountType as "PERCENT" | "FIXED") || "PERCENT",
      discountValue: rec.discountValue ? String(rec.discountValue) : "",
      items: (rec.lineItems ?? []).map((item: any) => ({
        id: generateItemId(),
        productId: "",
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      })),
    });
    setShowBuilder(true);
  }

  async function handleSave() {
    if (!businessId) return;
    setError(null);
    const validItems = form.items.filter((i) => i.description.trim() && parseFloat(i.unitPrice) > 0);
    if (!form.name.trim()) { setError("Schedule name is required"); return; }
    if (!form.contactId) { setError("Contact is required"); return; }
    if (validItems.length === 0) { setError("At least one line item is required"); return; }

    const payload: any = {
      name: form.name,
      contactId: form.contactId,
      frequency: form.frequency,
      nextRunDate: form.nextRunDate || undefined,
      endDate: form.endDate || undefined,
      notes: form.notes || undefined,
      taxRate: parseFloat(form.taxRate) || 0,
      discountType: form.discountValue ? form.discountType : undefined,
      discountValue: form.discountValue ? parseFloat(form.discountValue) : undefined,
      lineItems: validItems.map((i) => ({
        description: i.description,
        quantity: parseInt(i.quantity) || 1,
        unitPrice: parseFloat(i.unitPrice),
      })),
    };

    if (editingId) {
      const res = await updateRecurringInvoice(businessId, editingId, payload);
      if (res.data) {
        setRecurring((prev) => prev.map((r) => (r.id === editingId ? res.data! : r)));
        setShowBuilder(false);
        resetForm();
      } else {
        setError(res.error || "Failed to update");
      }
    } else {
      const res = await createRecurringInvoice(businessId, payload);
      if (res.data) {
        setRecurring((prev) => [res.data!, ...prev]);
        setShowBuilder(false);
        resetForm();
      } else {
        setError(res.error || "Failed to create");
      }
    }
  }

  async function handleDelete(id: string) {
    if (!businessId || !confirm("Delete this recurring invoice schedule?")) return;
    await deleteRecurringInvoice(businessId, id);
    setRecurring((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleToggle(id: string) {
    if (!businessId) return;
    const res = await toggleRecurringInvoice(businessId, id);
    if (res.data) {
      setRecurring((prev) => prev.map((r) => (r.id === id ? res.data! : r)));
    }
  }

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, i) => s + (parseInt(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0), 0);
    const tax = (subtotal * (parseFloat(form.taxRate) || 0)) / 100;
    const disc = form.discountType === "PERCENT" ? (subtotal * (parseFloat(form.discountValue) || 0)) / 100 : parseFloat(form.discountValue) || 0;
    return { subtotal, tax, discount: disc, total: subtotal + tax - disc };
  }, [form.items, form.taxRate, form.discountType, form.discountValue]);

  return (
    <motion.div
      key="recurring"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-primary/30 bg-card/80 backdrop-blur-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-primary" />
                  {editingId ? "Edit Schedule" : "New Recurring Invoice"}
                </h3>
                <button onClick={() => { setShowBuilder(false); resetForm(); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {error && <div className="text-xs text-amber-400 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">{error}</div>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Schedule Name *</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Monthly Retainer, Weekly Service"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Contact *</label>
                  <select
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={form.contactId}
                    onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))}
                  >
                    <option value="">Select contact...</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.firstName} {c.lastName} {c.email ? `(${c.email})` : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Frequency *</label>
                  <select
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={form.frequency}
                    onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                  >
                    {FREQUENCIES.map((fr) => (
                      <option key={fr.value} value={fr.value}>{fr.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Next Invoice Date"
                  type="date"
                  value={form.nextRunDate}
                  onChange={(e) => setForm((f) => ({ ...f, nextRunDate: e.target.value }))}
                />
                <Input
                  label="End Date (optional)"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Line Items</label>
                  <Button variant="outline" onClick={addItem} className="text-xs gap-1 px-2 py-1">
                    <Plus className="w-3 h-3" /> Add Item
                  </Button>
                </div>
                {form.items.map((item) => (
                  <div key={item.id} className="p-3 rounded-xl bg-muted/30 border border-border/40">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-12 md:col-span-3">
                        <label className="text-xs text-muted-foreground mb-1 block">Product/Service</label>
                        <select
                          className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm"
                          value={item.productId}
                          onChange={(e) => selectProduct(item.id, e.target.value)}
                        >
                          <option value="">Select or type below...</option>
                          {products.filter((p) => p.isActive !== false).map((p) => (
                            <option key={p.id} value={p.id}>{p.name} - {p.currency} {Number(p.price).toLocaleString()}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-12 md:col-span-4">
                        <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                        <input
                          className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm"
                          value={item.description}
                          onChange={(e) => updateItem(item.id, "description", e.target.value)}
                          placeholder="Item description"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-2">
                        <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                        <input className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm" type="number" min="1" value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} />
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <label className="text-xs text-muted-foreground mb-1 block">Price (TTD)</label>
                        <input className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm" type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(item.id, "unitPrice", e.target.value)} placeholder="0.00" />
                      </div>
                      <div className="col-span-2 md:col-span-1 flex justify-center">
                        {form.items.length > 1 && (
                          <button onClick={() => removeItem(item.id)} className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                            <Minus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 rounded-xl bg-muted/20 border border-border/40">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
                  <input type="number" step="0.01" min="0" max="100" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} placeholder="12.5" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount Type</label>
                  <select className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as "PERCENT" | "FIXED" }))}>
                    <option value="PERCENT">Percentage (%)</option>
                    <option value="FIXED">Fixed (TTD)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount {form.discountType === "PERCENT" ? "(%)" : "(TTD)"}</label>
                  <input type="number" step="0.01" min="0" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} placeholder="0" />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1 max-w-xs ml-auto">
                <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal:</span><span>TTD {totals.subtotal.toFixed(2)}</span></div>
                {totals.tax > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Tax:</span><span>TTD {totals.tax.toFixed(2)}</span></div>}
                {totals.discount > 0 && <div className="flex justify-between text-sm text-emerald-400"><span>Discount:</span><span>-TTD {totals.discount.toFixed(2)}</span></div>}
                <div className="flex justify-between text-sm font-bold text-primary border-t border-border/40 pt-1"><span>Per Invoice:</span><span>TTD {totals.total.toFixed(2)}</span></div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</label>
                <input type="text" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes for this schedule..." />
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => { setShowBuilder(false); resetForm(); }}>Cancel</Button>
                <Button onClick={handleSave}>{editingId ? "Update Schedule" : "Create Schedule"}</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted/30 rounded-2xl" />)}
        </div>
      ) : recurring.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <RefreshCw className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No recurring invoices</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
            Set up automatic invoice generation on a schedule for retainer clients, subscriptions, or regular services.
          </p>
          <Button onClick={() => { resetForm(); setShowBuilder(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Create Schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {recurring.map((rec) => (
            <motion.div
              key={rec.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl border bg-card/80 backdrop-blur-sm p-5 transition-all ${rec.isActive ? "border-border/60 hover:border-primary/40" : "border-border/30 opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-base truncate">{rec.name}</h3>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${rec.isActive ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-slate-500/20 text-slate-400 border-slate-500/40"}`}>
                      {rec.isActive ? "Active" : "Paused"}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                      <RefreshCw className="w-3 h-3" />
                      {FREQUENCIES.find((f) => f.value === rec.frequency)?.label ?? rec.frequency}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5" />
                      {rec.contact ? `${rec.contact.firstName ?? ""} ${rec.contact.lastName ?? ""}`.trim() : "—"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      Next: {rec.nextRunDate ? new Date(rec.nextRunDate).toLocaleDateString() : "—"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {rec.runCount} generated
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-lg font-bold text-primary">
                    {rec.currency} {Number(rec.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleToggle(rec.id)} className={`p-1.5 rounded-lg transition-colors ${rec.isActive ? "hover:bg-amber-500/20 text-amber-400" : "hover:bg-emerald-500/20 text-emerald-400"}`} title={rec.isActive ? "Pause" : "Resume"}>
                      {rec.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEdit(rec)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(rec.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {rec.lineItems && rec.lineItems.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/30">
                  <div className="flex flex-wrap gap-2">
                    {rec.lineItems.map((item, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/30 border border-border/30 text-xs">
                        {item.description} x{item.quantity} @ {Number(item.unitPrice).toLocaleString()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
