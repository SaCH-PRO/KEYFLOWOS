"use client";

import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw,
  Pencil,
  Play,
  Ban,
  Repeat,
  FileText,
} from "lucide-react";
import {
  fetchRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  cancelRecurringExpense,
  runRecurringExpenseNow,
  type RecurringExpense,
  type ExpenseCategory,
} from "@/lib/client";
import { formatCurrency } from "@/lib/currency";
import { SideSheet } from "../../commerce/components/side-sheet";
import { EmptyState } from "@/components/ui/empty-state";

interface RecurringExpensesPanelProps {
  businessId: string | null;
  categories: ExpenseCategory[];
  triggerNew?: number;
}

const FREQUENCIES: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export default function RecurringExpensesPanel({ businessId, categories, triggerNew }: RecurringExpensesPanelProps) {
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchRecurringExpenses(businessId);
      if (res.data) setRecurring(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { queueMicrotask(load); }, [load]);
  useEffect(() => {
    if (triggerNew) {
      queueMicrotask(() => {
        setEditing(null);
        setShowBuilder(true);
      });
    }
  }, [triggerNew]);

  const handleSave = async (form: RecurringFormData) => {
    if (!businessId) return;
    try {
      const payload = {
        name: form.name,
        description: form.description,
        amount: parseFloat(form.amount),
        frequency: form.frequency,
        nextRunDate: form.nextRunDate,
        endDate: form.endDate || null,
        vendor: form.vendor || null,
        paymentMethod: form.paymentMethod || null,
        categoryId: form.categoryId || null,
        notes: form.notes || null,
        createsBill: form.createsBill,
        dueOffsetDays: form.dueOffsetDays ? parseInt(form.dueOffsetDays) : null,
      };
      if (editing) {
        await updateRecurringExpense(businessId, editing.id, payload);
        toast.success("Recurring expense updated");
      } else {
        await createRecurringExpense(businessId, payload);
        toast.success("Recurring expense created");
      }
      setShowBuilder(false);
      setEditing(null);
      void load();
    } catch {
      toast.error("Failed to save");
    }
  };

  const handleCancel = async (id: string) => {
    if (!businessId) return;
    if (!window.confirm("Cancel this recurring expense?")) return;
    try {
      await cancelRecurringExpense(businessId, id);
      toast.success("Cancelled");
      void load();
    } catch {
      toast.error("Failed to cancel");
    }
  };

  const handleRunNow = async (id: string) => {
    if (!businessId) return;
    try {
      await runRecurringExpenseNow(businessId, id);
      toast.success("Expense generated");
      void load();
    } catch {
      toast.error("Failed to run");
    }
  };

  return (
    <div className="space-y-4">
      {recurring.length === 0 && !loading ? (
        <EmptyState
          icon={Repeat}
          title="No recurring expenses"
          description="Set up recurring expenses for rent, subscriptions, salaries, and other regular payments."
          actionLabel="Add Recurring Expense"
          onAction={() => { setEditing(null); setShowBuilder(true); }}
        />
      ) : (
        <div className="space-y-2">
          {recurring.map((item) => (
            <RecurringCard
              key={item.id}
              item={item}
              categories={categories}
              onEdit={() => { setEditing(item); setShowBuilder(true); }}
              onCancel={() => handleCancel(item.id)}
              onRunNow={() => handleRunNow(item.id)}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showBuilder && (
          <RecurringBuilder
            categories={categories}
            editing={editing}
            onClose={() => { setShowBuilder(false); setEditing(null); }}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RecurringCard({
  item,
  categories,
  onEdit,
  onCancel,
  onRunNow,
}: {
  item: RecurringExpense;
  categories: ExpenseCategory[];
  onEdit: () => void;
  onCancel: () => void;
  onRunNow: () => void;
}) {
  const cat = categories.find((c) => c.id === item.categoryId) || item.category;
  const isActive = item.isActive;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative rounded-2xl border border-border/40 bg-card hover:border-rose-500/30 hover:bg-white/[0.02] transition-all overflow-hidden"
    >
      <div className="flex items-center gap-3 p-3.5">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isActive ? "bg-rose-500/10" : "bg-muted/20"}`}>
          <RefreshCw className={`w-4 h-4 ${isActive ? "text-rose-400" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">{item.name}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider border ${
              isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted/20 text-muted-foreground border-muted/30"
            }`}>
              {isActive ? "Active" : "Inactive"}
            </span>
            {item.createsBill && (
              <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-md border border-amber-500/20">
                Bill
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{FREQUENCIES[item.frequency] || item.frequency}</span>
            {cat && (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: cat.color || "#6366f1" }} />
                  {cat.name}
                </span>
              </>
            )}
            <span className="text-border">·</span>
            <span>Next: {new Date(item.nextRunDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <span className="text-border">·</span>
            <span>{item.runCount} runs</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-foreground">{formatCurrency(item.amount, item.currency)}</p>
        </div>
      </div>

      <div className="border-t border-border/30 bg-white/[0.02] flex items-center gap-0.5 px-2 py-1.5 opacity-0 max-h-0 group-hover:opacity-100 group-hover:max-h-20 transition-all overflow-x-auto">
        <ActionBtn icon={Pencil} label="Edit" onClick={onEdit} />
        {isActive && <ActionBtn icon={Play} label="Run Now" variant="primary" onClick={onRunNow} />}
        <ActionBtn icon={Ban} label="Cancel" variant="danger" onClick={onCancel} />
      </div>
    </motion.div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  variant = "default",
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  variant?: "primary" | "danger" | "default";
}) {
  const variantClasses = {
    primary: "text-rose-400 hover:bg-rose-400/10",
    danger: "text-red-400 hover:bg-red-400/10",
    default: "text-muted-foreground hover:text-foreground hover:bg-white/[0.05]",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${variantClasses[variant]} shrink-0`}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

interface RecurringFormData {
  name: string;
  description: string;
  amount: string;
  frequency: string;
  nextRunDate: string;
  endDate: string;
  vendor: string;
  paymentMethod: string;
  categoryId: string;
  notes: string;
  createsBill: boolean;
  dueOffsetDays: string;
}

function RecurringBuilder({
  categories,
  editing,
  onClose,
  onSave,
}: {
  categories: ExpenseCategory[];
  editing: RecurringExpense | null;
  onClose: () => void;
  onSave: (form: RecurringFormData) => void;
}) {
  const [form, setForm] = useState<RecurringFormData>(() => {
    if (editing) {
      return {
        name: editing.name,
        description: editing.description,
        amount: String(editing.amount),
        frequency: editing.frequency,
        nextRunDate: editing.nextRunDate ? editing.nextRunDate.split("T")[0] : "",
        endDate: editing.endDate ? editing.endDate.split("T")[0] : "",
        vendor: editing.vendor || "",
        paymentMethod: editing.paymentMethod || "",
        categoryId: editing.categoryId || "",
        notes: editing.notes || "",
        createsBill: editing.createsBill,
        dueOffsetDays: editing.dueOffsetDays ? String(editing.dueOffsetDays) : "",
      };
    }
    return {
      name: "",
      description: "",
      amount: "",
      frequency: "MONTHLY",
      nextRunDate: "",
      endDate: "",
      vendor: "",
      paymentMethod: "",
      categoryId: "",
      notes: "",
      createsBill: false,
      dueOffsetDays: "",
    };
  });

  const amountNum = parseFloat(form.amount || "0");

  return (
    <SideSheet
      open={true}
      onClose={onClose}
      title={editing ? "Edit Recurring Expense" : "New Recurring Expense"}
      subtitle={editing ? `Editing ${editing.name}` : "Schedule a recurring business expense"}
      width="md"
      icon={
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-rose-500/15 border border-rose-500/30">
          <RefreshCw className="w-5 h-5 text-rose-400" />
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <span className="block">Per Invoice</span>
            <span className="font-semibold text-rose-400">
              {amountNum > 0 ? formatCurrency(amountNum, "TTD") : "—"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors border border-border/40"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(form)}
              disabled={!form.name.trim() || !form.amount || !form.nextRunDate}
              className="px-4 py-2.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-50 bg-rose-500/10 text-rose-400 border border-rose-500/30"
            >
              {editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Name *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Office Rent"
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Description *</label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What is this expense for?"
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Amount (TTD) *</label>
            <input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Frequency *</label>
            <select
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
            >
              {Object.entries(FREQUENCIES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Next Run Date *</label>
            <input
              type="date"
              value={form.nextRunDate}
              onChange={(e) => setForm({ ...form, nextRunDate: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">End Date (optional)</label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Vendor</label>
            <input
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              placeholder="Vendor name"
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Category</label>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-border/40">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.createsBill}
              onChange={(e) => setForm({ ...form, createsBill: e.target.checked })}
              className="accent-rose-500"
            />
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            Creates a bill (unpaid expense)
          </label>
        </div>
        {form.createsBill && (
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Due Offset (days)</label>
            <input
              type="number"
              value={form.dueOffsetDays}
              onChange={(e) => setForm({ ...form, dueOffsetDays: e.target.value })}
              placeholder="Days until due"
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
            />
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Additional notes..."
            rows={2}
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40 resize-none"
          />
        </div>
      </div>
    </SideSheet>
  );
}
