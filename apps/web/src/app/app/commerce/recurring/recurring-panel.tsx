"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InfoBadge } from "@/components/ui/info-badge";
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
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Sparkles,
  History,
  Ban,
  ArrowRight,
} from "lucide-react";
import {
  fetchRecurringInvoices,
  createRecurringInvoice,
  updateRecurringInvoice,
  deleteRecurringInvoice,
  toggleRecurringInvoice,
  cancelRecurringInvoice,
  fetchRecurringGenerationHistory,
  RecurringInvoice,
  RecurringGenerationEntry,
  Product,
  Contact,
} from "@/lib/client";
import { ContactSelect } from "@/components/contacts";
import {
  InvoiceLineItem,
  generateItemId,
} from "../components/commerce-types";
import { useModuleEmit } from "@/hooks/use-module-events";
import { DateRangeFilter, filterByDateRange, DEFAULT_DATE_RANGE, type DateRange } from "../components/date-range-filter";
import { BulkActionBar, exportToCsv } from "../components/bulk-action-bar";

interface RecurringPanelProps {
  businessId: string | null;
  contacts: Contact[];
  products: Product[];
  triggerNew?: number;
  currency?: string;
}

const FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 Weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
];

export default function RecurringPanel({ businessId, contacts, products, triggerNew, currency = "TTD" }: RecurringPanelProps) {
  const emitEvent = useModuleEmit();
  const [recurring, setRecurring] = useState<RecurringInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [historyDrawer, setHistoryDrawer] = useState<{ open: boolean; recurring: RecurringInvoice | null; entries: RecurringGenerationEntry[]; loading: boolean }>({
    open: false,
    recurring: null,
    entries: [],
    loading: false,
  });

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
      items: (rec.lineItems ?? []).map((item: { description: string; quantity: number | string; unitPrice: number | string }) => ({
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

    const payload: {
      name: string;
      contactId: string;
      frequency: typeof form.frequency;
      nextRunDate?: string;
      endDate?: string;
      notes?: string;
      taxRate: number;
      discountType?: "PERCENT" | "FIXED";
      discountValue?: number;
      lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
    } = {
      name: form.name,
      contactId: form.contactId,
      frequency: form.frequency,
      nextRunDate: form.nextRunDate || undefined,
      endDate: form.endDate || undefined,
      notes: form.notes || undefined,
      taxRate: parseFloat(form.taxRate) || 0,
      discountType: form.discountValue ? form.discountType : undefined,
      discountValue: form.discountValue ? parseFloat(form.discountValue) : undefined,
      lineItems: validItems.map((i) => {
        const quantity = parseInt(i.quantity) || 1;
        const unitPrice = parseFloat(i.unitPrice);
        return { description: i.description, quantity, unitPrice, total: quantity * unitPrice };
      }),
    };

    if (editingId) {
      const res = await updateRecurringInvoice(businessId, editingId, payload);
      if (res.data) {
        setRecurring((prev) => prev.map((r) => (r.id === editingId ? res.data! : r)));
        setShowBuilder(false);
        resetForm();
        toast.success("Schedule updated");
      } else {
        setError(res.error || "Failed to update");
        toast.error(res.error || "Failed to update schedule");
      }
    } else {
      const res = await createRecurringInvoice(businessId, payload);
      if (res.data) {
        setRecurring((prev) => [res.data!, ...prev]);
        setShowBuilder(false);
        resetForm();
        toast.success("Recurring schedule created");
        emitEvent("billing:schedule_created", "commerce", { scheduleId: res.data.id });
      } else {
        setError(res.error || "Failed to create");
        toast.error(res.error || "Failed to create schedule");
      }
    }
  }

  async function handleDelete(id: string) {
    if (!businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        await deleteRecurringInvoice(businessId!, id);
        setRecurring((prev) => prev.filter((r) => r.id !== id));
        toast.success("Recurring schedule deleted");
      },
    });
  }

  async function handleToggle(id: string) {
    if (!businessId) return;
    const res = await toggleRecurringInvoice(businessId, id);
    if (res.data) {
      setRecurring((prev) => prev.map((r) => (r.id === id ? res.data! : r)));
      emitEvent("billing:schedule_toggled", "commerce", { scheduleId: id, active: res.data.isActive });
    }
  }

  function handleCancel(id: string) {
    if (!businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        const res = await cancelRecurringInvoice(businessId!, id);
        if (res.data) {
          setRecurring((prev) => prev.map((r) => (r.id === id ? res.data! : r)));
          emitEvent("billing:schedule_cancelled", "commerce", { scheduleId: id });
          toast.success("Schedule cancelled");
        } else {
          toast.error(res.error || "Failed to cancel schedule");
        }
      },
    });
  }

  async function openHistory(rec: RecurringInvoice) {
    if (!businessId) return;
    setHistoryDrawer({ open: true, recurring: rec, entries: [], loading: true });
    const res = await fetchRecurringGenerationHistory(businessId, rec.id);
    setHistoryDrawer({ open: true, recurring: rec, entries: res.data ?? [], loading: false });
  }

  function closeHistory() {
    setHistoryDrawer({ open: false, recurring: null, entries: [], loading: false });
  }

  // Surface missed-generation events into the canonical event taxonomy so R3 can
  // pick them up. Run once per render after data settles.
  useEffect(() => {
    const now = Date.now();
    for (const r of recurring) {
      if (!r.isActive) continue;
      const due = r.nextRunDate ? new Date(r.nextRunDate).getTime() : 0;
      const overdueByMs = now - due;
      const oneDay = 24 * 60 * 60 * 1000;
      if ((r.failureCount ?? 0) > 0) {
        emitEvent("billing:schedule_failed", "commerce", {
          scheduleId: r.id,
          failureCount: r.failureCount,
          lastError: r.lastError,
        });
      } else if (due > 0 && overdueByMs > oneDay) {
        emitEvent("billing:schedule_missed", "commerce", {
          scheduleId: r.id,
          dueAt: r.nextRunDate,
          overdueByDays: Math.floor(overdueByMs / oneDay),
        });
      }
    }
    // we deliberately depend only on recurring identity to avoid re-emitting on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurring]);

  const dateFiltered = useMemo(
    () => filterByDateRange(recurring, (r) => r.nextRunDate, dateRange),
    [recurring, dateRange],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (!businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        const ids = Array.from(selectedIds);
        await Promise.all(ids.map((id) => deleteRecurringInvoice(businessId!, id)));
        setRecurring((prev) => prev.filter((r) => !selectedIds.has(r.id)));
        setSelectedIds(new Set());
        toast.success(`${ids.length} schedule(s) deleted`);
      },
    });
  }, [businessId, selectedIds]);

  const handleExportCsv = useCallback(() => {
    const items = dateFiltered.filter((r) => selectedIds.size === 0 || selectedIds.has(r.id));
    exportToCsv(

      items as unknown as Record<string, unknown>[],
      [
        { key: "name", header: "Name" },
        { key: "frequency", header: "Frequency" },
        { key: "isActive", header: "Status", format: (v: unknown) => (v ? "Active" : "Paused") },
        { key: "total", header: `Amount (${currency})`, format: (v: unknown) => Number(v).toFixed(2) },
        { key: "nextRunDate", header: "Next Run", format: (v: unknown) => (v ? new Date(v as string).toLocaleDateString() : "—") },
        { key: "runCount", header: "Run Count" },
      ],
      `recurring-invoices-${new Date().toISOString().slice(0, 10)}`,
    );
    toast.success("CSV exported");
  }, [dateFiltered, selectedIds, currency]);

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
                <button onClick={() => { setShowBuilder(false); resetForm(); }} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
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
                <ContactSelect
                  value={form.contactId}
                  onChange={(id) => setForm((f) => ({ ...f, contactId: id }))}
                  contacts={contacts}
                  label="Contact"
                  required
                />
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 inline-flex items-center gap-1">Frequency * <InfoBadge title="Recurring Frequency" body="How often this invoice is auto-generated and sent. Monthly is most common for retainers. The system creates a new invoice each cycle and optionally sends it to the client." side="right" iconSize={10} /></label>
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
                        <label className="text-xs text-muted-foreground mb-1 block">Price ({currency})</label>
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
                    <option value="FIXED">Fixed ({currency})</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount {form.discountType === "PERCENT" ? "(%)" : `(${currency})`}</label>
                  <input type="number" step="0.01" min="0" className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} placeholder="0" />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1 max-w-xs ml-auto">
                <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal:</span><span>{currency} {totals.subtotal.toFixed(2)}</span></div>
                {totals.tax > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Tax:</span><span>{currency} {totals.tax.toFixed(2)}</span></div>}
                {totals.discount > 0 && <div className="flex justify-between text-sm text-emerald-400"><span>Discount:</span><span>-{currency} {totals.discount.toFixed(2)}</span></div>}
                <div className="flex justify-between text-sm font-bold text-primary border-t border-border/40 pt-1"><span>Per Invoice:</span><span>{currency} {totals.total.toFixed(2)}</span></div>
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

      {recurring.length > 0 && (() => {
        const active = recurring.filter((r) => r.isActive);
        const inactive = recurring.length - active.length;
        const dailyRate = active.reduce((sum, r) => {
          const scheduleTotal = Number(r.total ?? 0);
          const perDay: Record<string, number> = {
            WEEKLY: 1 / 7,
            BIWEEKLY: 1 / 14,
            MONTHLY: 12 / 365,
            QUARTERLY: 4 / 365,
            YEARLY: 1 / 365,
          };
          return sum + scheduleTotal * (perDay[r.frequency] ?? 12 / 365);
        }, 0);
        const expected30 = dailyRate * 30;
        const missedCount = recurring.filter((r) => r.isActive && (r.failureCount ?? 0) > 0).length;
        const nextRun = active
          .filter((r) => r.nextRunDate)
          .sort((a, b) => new Date(a.nextRunDate!).getTime() - new Date(b.nextRunDate!).getTime())[0];
        const nextRunLabel = nextRun?.nextRunDate ? new Date(nextRun.nextRunDate).toLocaleDateString("en-TT", { month: "short", day: "numeric" }) : null;
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Active</span>
              </div>
              <p className="text-lg font-bold text-emerald-400">{active.length}</p>
              <p className="text-[10px] text-muted-foreground/50">{inactive} paused/cancelled</p>
            </div>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Expected MRR (30d)</span>
              </div>
              <p className="text-lg font-bold text-blue-400">{currency} {Math.round(expected30).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground/50">based on active schedules</p>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Calendar className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Next run</span>
              </div>
              <p className="text-lg font-bold text-amber-400">{nextRunLabel ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground/50 truncate">{nextRun?.name ?? "no upcoming runs"}</p>
            </div>
            <div className={`rounded-xl border p-3 ${missedCount > 0 ? "border-red-500/30 bg-red-500/5" : "border-border/40 bg-muted/5"}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className={`w-3 h-3 ${missedCount > 0 ? "text-red-400" : "text-muted-foreground/40"}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Missed runs</span>
              </div>
              <p className={`text-lg font-bold ${missedCount > 0 ? "text-red-400" : "text-muted-foreground/60"}`}>{missedCount}</p>
              <p className="text-[10px] text-muted-foreground/50">need review</p>
            </div>
          </div>
        );
      })()}

      <div className="flex items-center gap-3 flex-wrap">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted/30 rounded-xl border border-border/50" />)}
        </div>
      ) : recurring.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-border/50 flex items-center justify-center mb-4">
            <RefreshCw className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Automate Your Revenue</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-3">
            Set up recurring billing schedules to automate invoice generation for retainer clients, subscriptions, and regular services.
          </p>
          <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto mb-5">
            {[
              { label: "Subscriptions", desc: "Monthly memberships" },
              { label: "Retainers", desc: "Ongoing client work" },
              { label: "Service Plans", desc: "Recurring services" },
              { label: "Auto-billing", desc: "Hands-off invoicing" },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border/30 p-2 text-left">
                <p className="text-[11px] font-medium">{item.label}</p>
                <p className="text-[9px] text-muted-foreground/50">{item.desc}</p>
              </div>
            ))}
          </div>
          <Button onClick={() => { resetForm(); setShowBuilder(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Create Your First Schedule
          </Button>
        </div>
      ) : dateFiltered.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm">
          No recurring invoices match the selected date range.
        </div>
      ) : (
        <div className="space-y-3">
          {dateFiltered.map((rec) => (
            <motion.div
              key={rec.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-xl border bg-card p-4 transition-all ${rec.isActive ? "border-border/50 hover:border-border/70" : "border-border/30 opacity-60"} ${selectedIds.has(rec.id) ? "ring-1 ring-[hsl(var(--kf-accent1))]/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <label className="min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(rec.id)}
                    onChange={() => toggleSelect(rec.id)}
                    className="w-4 h-4 rounded border-border accent-[hsl(var(--kf-accent1))]"
                  />
                </label>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-semibold text-base truncate">{rec.name}</h3>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${rec.isActive ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : rec.cancelledAt ? "bg-red-500/20 text-red-300 border-red-500/40" : "bg-slate-500/20 text-slate-400 border-slate-500/40"}`}>
                      {rec.isActive ? "Active" : rec.cancelledAt ? "Cancelled" : "Paused"}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                      <RefreshCw className="w-3 h-3" />
                      {FREQUENCIES.find((f) => f.value === rec.frequency)?.label ?? rec.frequency}
                    </span>
                    {(rec.failureCount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => openHistory(rec)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 transition-colors"
                        title={rec.lastError || "Last generation failed"}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Missed {rec.failureCount} {rec.failureCount === 1 ? "run" : "runs"}
                        <ArrowRight className="w-3 h-3 opacity-60" />
                      </button>
                    )}
                    {rec.isActive && (rec.failureCount ?? 0) > 0 && (
                      <a
                        href={`/app/inbox?source=recurring&recurringId=${rec.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-200 border border-amber-500/40 hover:bg-amber-500/25 transition-colors"
                      >
                        Review setup
                      </a>
                    )}
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
                    <button onClick={() => handleToggle(rec.id)} className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${rec.isActive ? "hover:bg-amber-500/20 text-amber-400" : "hover:bg-emerald-500/20 text-emerald-400"}`} title={rec.isActive ? "Pause" : "Resume"}>
                      {rec.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEdit(rec)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => openHistory(rec)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Generation history">
                      <History className="w-4 h-4" />
                    </button>
                    {!rec.cancelledAt && (
                      <button onClick={() => handleCancel(rec.id)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-orange-500/20 text-orange-400 transition-colors" title="Cancel schedule">
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(rec.id)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-red-500/20 text-red-400 transition-colors" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-border/30 space-y-2.5">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                    <div className="flex items-center gap-1 mb-0.5">
                      <DollarSign className="w-2.5 h-2.5 text-emerald-400" />
                      <span className="text-[10px] text-muted-foreground/50">Revenue to Date</span>
                    </div>
                    <span className="text-sm font-bold text-emerald-400">
                      {rec.currency} {(Number(rec.total) * rec.runCount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                    <div className="flex items-center gap-1 mb-0.5">
                      <TrendingUp className="w-2.5 h-2.5 text-blue-400" />
                      <span className="text-[10px] text-muted-foreground/50">Forecasted (12mo)</span>
                    </div>
                    <span className="text-sm font-bold text-blue-400">
                      {rec.currency} {(() => {
                        const total = Number(rec.total);
                        const freqMultiplier: Record<string, number> = { WEEKLY: 52, BIWEEKLY: 26, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 };
                        return (total * (freqMultiplier[rec.frequency] ?? 12)).toLocaleString(undefined, { minimumFractionDigits: 2 });
                      })()}
                    </span>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                    <div className="flex items-center gap-1 mb-0.5">
                      {rec.isActive ? <CheckCircle className="w-2.5 h-2.5 text-emerald-400" /> : <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />}
                      <span className="text-[10px] text-muted-foreground/50">Status</span>
                    </div>
                    <span className={`text-sm font-bold ${rec.isActive ? "text-emerald-400" : "text-amber-400"}`}>
                      {rec.isActive ? "Running" : "Paused"}
                    </span>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Sparkles className="w-2.5 h-2.5 text-purple-400" />
                      <span className="text-[10px] text-muted-foreground/50">Last Run</span>
                    </div>
                    <span className="text-sm font-bold text-muted-foreground/70">
                      {rec.lastRunDate ? new Date(rec.lastRunDate as string).toLocaleDateString() : rec.runCount > 0 ? "Completed" : "Pending"}
                    </span>
                  </div>
                </div>

                {rec.lineItems && rec.lineItems.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {rec.lineItems.map((item, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/30 border border-border/30 text-xs">
                        {item.description} x{item.quantity} @ {Number(item.unitPrice).toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
      <BulkActionBar
        selectedCount={selectedIds.size}
        totalCount={dateFiltered.length}
        onSelectAll={() => setSelectedIds(new Set(dateFiltered.map((r) => r.id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        onExportCsv={handleExportCsv}
        onBulkDelete={handleBulkDelete}
        statusOptions={[
          { value: "activate", label: "Activate" },
          { value: "pause", label: "Pause" },
        ]}
        onBulkStatusChange={async (action) => {
          if (!businessId) return;
          const wantActive = action === "activate";
          const eligible = Array.from(selectedIds).filter((id) => {
            const rec = recurring.find((r) => r.id === id);
            return rec ? rec.isActive !== wantActive : false;
          });
          if (eligible.length === 0) {
            toast.info(`All selected schedules are already ${wantActive ? "active" : "paused"}`);
            return;
          }
          const results = await Promise.all(eligible.map((id) => toggleRecurringInvoice(businessId!, id)));
          setRecurring((prev) =>
            prev.map((r) => {
              const match = results.find((res) => res.data?.id === r.id);
              return match?.data ?? r;
            }),
          );
          setSelectedIds(new Set());
          toast.success(`${eligible.length} schedule(s) ${wantActive ? "activated" : "paused"}`);
        }}
        entityLabel="schedules"
      />
      <ConfirmDialog
        open={confirmState.open}
        title="Confirm action"
        message="This action will affect the recurring schedule."
        confirmLabel="Confirm"
        variant="danger"
        onConfirm={() => { confirmState.action(); setConfirmState({open: false, action: () => {}}); }}
        onCancel={() => setConfirmState({open: false, action: () => {}})}
      />
      <AnimatePresence>
        {historyDrawer.open && historyDrawer.recurring && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end"
            onClick={closeHistory}
            data-testid="recurring-history-drawer"
          >
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-lg h-full bg-card border-l border-border/50 flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="p-4 border-b border-border/40 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Generation history</p>
                  <h3 className="text-base font-semibold truncate">{historyDrawer.recurring.name}</h3>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {historyDrawer.recurring.runCount} runs · {historyDrawer.recurring.failureCount ?? 0} failures
                  </p>
                </div>
                <button
                  onClick={closeHistory}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
                  aria-label="Close history"
                >
                  <X className="w-4 h-4" />
                </button>
              </header>
              {historyDrawer.recurring.lastError && (
                <div className="m-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">
                  <div className="flex items-center gap-1.5 mb-1 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" /> Last error
                  </div>
                  <p className="break-words">{historyDrawer.recurring.lastError}</p>
                  {historyDrawer.recurring.lastFailureAt && (
                    <p className="mt-1 text-[10px] text-red-300/70">
                      {new Date(historyDrawer.recurring.lastFailureAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {historyDrawer.loading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : historyDrawer.entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No invoices generated yet.</p>
                ) : (
                  historyDrawer.entries.map((entry) => (
                    <a
                      key={entry.id}
                      href={`/app/commerce?tab=invoices&invoice=${entry.id}`}
                      className="rounded-lg border border-border/40 bg-white/[0.02] p-3 flex items-center justify-between gap-3 hover:bg-white/[0.05] hover:border-border/60 transition-colors"
                      title="Open generated invoice"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate text-primary underline-offset-2 hover:underline">
                          {entry.invoiceNumber || entry.id.slice(0, 8)}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70">
                          {new Date(entry.createdAt).toLocaleString()} · {entry.status}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-400 shrink-0">
                        {entry.currency} {Number(entry.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </a>
                  ))
                )}
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
