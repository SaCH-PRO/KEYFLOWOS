"use client";

import { ReadFailureNote, readFailure } from "./read-failure-note";
import { readState } from "@/lib/failure-kit";
import type { BlockRead } from "./use-expenses-data";
import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { businessCurrency, dayAfter, formatCurrency as formatAmount, formatShortDate, isCalendarDay, useShownBusiness, todayInBusinessZone, refusedStart, canStartFor, writeFailure } from "./expense-utils";
import { SideSheet } from "../../commerce/components/side-sheet";
import { EmptyState } from "@/components/ui/empty-state";

interface RecurringExpensesPanelProps {
  businessId: string | null;
  categories: ExpenseCategory[];
  triggerNew?: number;
  /** R12: the data hook's check that the business an action was for is still the one shown. */
  isCurrentBusiness?: (businessId: string) => boolean;
  /** R24b: the categories read's own state; a refused one is said here, where schedules name their category. */
  categoriesRead?: BlockRead;
  onRetryCategories?: () => void;
}

const FREQUENCIES: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export default function RecurringExpensesPanel({ businessId, categories, triggerNew, isCurrentBusiness: hookCheck, categoriesRead, onRetryCategories }: RecurringExpensesPanelProps) {
  const shownCheck = useShownBusiness(businessId);
  const isCurrentBusiness = hookCheck ?? shownCheck;
  // R19-5: every reply is judged by the start check's test (the given check, and the stored id).
  const live = () => canStartFor(businessId, isCurrentBusiness);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  // R25-2: the list's own read state: a refused, thrown or no-access read is said, never "No recurring expenses".
  const [listRead, setListRead] = useState<BlockRead>({ kind: "loading" });
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  // R14-6: an editor opened for one business closes when the panel shows another, so Update can never send a
  // schedule of the old business to the new one (React's "reset state on a prop change", during render).
  const [editorFor, setEditorFor] = useState(businessId);
  if (editorFor !== businessId) {
    setEditorFor(businessId);
    setShowBuilder(false);
    // Not observable on its own (every path that opens the builder sets `editing` first, and only the builder
    // saves): kept so no state of the old business outlives the switch. R15's mutation table lists it as equivalent.
    setEditing(null);
    // R20-4: and none of the old business's schedules stays listed (or can be run) while the new one's read is out.
    setRecurring([]);
    // R21-3: and the new business's read is out, so no "No recurring expenses" shows before it answers.
    setLoading(true);
    setListRead({ kind: "loading" });
  }

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchRecurringExpenses(businessId);
      // R12: a read for a business no longer shown writes nothing. (A read, not a write's reply: it is judged by the
      // business this panel shows, which may be one other than the stored, R19-5 leaves it so.)
      if (!isCurrentBusiness(businessId)) return;
      const st = readState(res, { what: "recurring expenses" });
      setListRead(st);
      setRecurring(st.kind === "ok" ? res.data ?? [] : []);
    } catch {
      // R22-1: a read that fails for a business no longer shown leaves the one shown loading: its own read is out.
      if (!isCurrentBusiness(businessId)) return;
      setListRead({ kind: "failed", message: "Couldn't load recurring expenses." });
    }
    setLoading(false);
  }, [businessId, isCurrentBusiness]);

  useEffect(() => { queueMicrotask(load); }, [load]);
  useEffect(() => {
    if (triggerNew) {
      queueMicrotask(() => {
        setEditing(null);
        setShowBuilder(true);
      });
    }
  }, [triggerNew]);

  // SEC-r1-2: one save at a time (a double click creates one schedule); cleared however the save ends.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const handleSave = async (form: RecurringFormData) => {
    if (!businessId || savingRef.current) return;
    if (refusedStart(businessId, isCurrentBusiness)) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
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
      // An edit that leaves a past next run as it was (a paused or failed schedule) does not send it back:
      // the PATCH leaves nextRunDate untouched when it is absent (RecurringExpenseService.update).
      if (editing && form.nextRunDate === storedDay(editing.nextRunDate)) delete payload.nextRunDate;
      // A refused save is said, never reported as saved (EXPENSES-HUB-2: the schedule is real or it is not).
      const res = editing
        ? await updateRecurringExpense(businessId, editing.id, payload)
        : await createRecurringExpense(businessId, payload);
      // R12: answered after a switch to another business: nothing is said or reloaded there.
      if (!live()) return;
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Recurring expense updated" : "Recurring expense created");
      setShowBuilder(false);
      setEditing(null);
      void load();
    } catch {
      if (live()) toast.error("Failed to save");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!businessId) return;
    if (refusedStart(businessId, isCurrentBusiness)) return;
    if (!window.confirm("Cancel this recurring expense?")) return;
    // R18-1: the confirm blocked this tab: a switch made while it was open is seen only now.
    if (refusedStart(businessId, isCurrentBusiness)) return;
    try {
      const res = await cancelRecurringExpense(businessId, id);
      if (!live()) return;
      // R24-1: the client answers a refusal as { error }; it is said, never reported as cancelled.
      const failure = writeFailure(res, "cancel this recurring expense");
      if (failure) { toast.error(failure); return; }
      toast.success("Cancelled");
      void load();
    } catch {
      if (live()) toast.error("Failed to cancel");
    }
  };

  const handleRunNow = async (id: string) => {
    if (!businessId) return;
    if (refusedStart(businessId, isCurrentBusiness)) return;
    try {
      const res = await runRecurringExpenseNow(businessId, id);
      if (!live()) return;
      const failure = writeFailure(res, "run this recurring expense");
      if (failure) { toast.error(failure); return; }
      toast.success("Expense generated");
      void load();
    } catch {
      if (live()) toast.error("Failed to run");
    }
  };

  return (
    <div className="space-y-4">
      <ReadFailureNote read={categoriesRead} onRetry={onRetryCategories} />
      {readFailure(listRead) ? (
        <div className="kf-card rounded-xl p-6 text-center">
          <ReadFailureNote read={listRead} onRetry={() => { void load(); }} className="text-sm text-muted-foreground" />
        </div>
      ) : recurring.length === 0 && !loading ? (
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
              businessId={businessId}
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
            // Each schedule and the create form get their own builder state: without a key, a builder brought
            // back (New during an Edit sheet, or its exit animation) kept the other's fields, and Update could
            // PATCH create-form fields onto a schedule.
            key={editing?.id ?? "new"}
            businessId={businessId}
            saving={saving}
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
  businessId,
  item,
  categories,
  onEdit,
  onCancel,
  onRunNow,
}: {
  item: RecurringExpense;
  businessId: string | null;
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
            <span>Next: {formatShortDate(item.nextRunDate, businessId)}</span>
            <span className="text-border">·</span>
            <span>{item.runCount} runs</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-foreground">{formatAmount(item.amount, item.currency, businessId)}</p>
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

/** The YYYY-MM-DD the builder shows for a stored next run. */
function storedDay(nextRunDate: string | null | undefined): string {
  return nextRunDate ? nextRunDate.split("T")[0] : "";
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
  businessId,
  saving,
  categories,
  editing,
  onClose,
  onSave,
}: {
  businessId: string | null;
  saving: boolean;
  categories: ExpenseCategory[];
  editing: RecurringExpense | null;
  onClose: () => void;
  onSave: (form: RecurringFormData) => void | Promise<void>;
}) {
  const [form, setForm] = useState<RecurringFormData>(() => {
    if (editing) {
      return {
        name: editing.name,
        description: editing.description,
        amount: String(editing.amount),
        frequency: editing.frequency,
        nextRunDate: storedDay(editing.nextRunDate),
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
  // BUG-027: the business currency (the server writes it on the schedule), never a literal TTD; this panel's
  // business, never another cached one (SEC-r1-1).
  const currency = businessCurrency(businessId);
  // SEC-r1-2: the server generates one expense per due period from nextRunDate, so a run on or before today
  // would book every missed period at once: the first run is tomorrow at the earliest, in the business zone.
  const earliestRun = dayAfter(todayInBusinessZone(new Date(), businessId));
  const [dateError, setDateError] = useState<string | null>(null);
  const save = () => {
    // On Create the floor applies; on Update only when the next run was changed (a paused schedule's past run
    // can stay as it is while its amount changes).
    const unchanged = editing !== null && form.nextRunDate === storedDay(editing.nextRunDate);
    if (!unchanged && !isCalendarDay(form.nextRunDate)) {
      setDateError("The next run must be a date (YYYY-MM-DD) after today.");
      return;
    }
    if (!unchanged && form.nextRunDate < earliestRun) {
      setDateError("The next run must be after today: a past run would book every missed period at once.");
      return;
    }
    setDateError(null);
    onSave(form);
  };

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
              {amountNum > 0 ? formatCurrency(amountNum, currency) : "—"}
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
              onClick={save}
              disabled={saving || !form.name.trim() || !form.amount || !form.nextRunDate}
              aria-busy={saving || undefined}
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
            <label className="text-xs text-muted-foreground mb-1.5 block">Amount ({currency}) *</label>
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
              min={earliestRun}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? "recurring-next-run-error" : undefined}
              onChange={(e) => { setDateError(null); setForm({ ...form, nextRunDate: e.target.value }); }}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
            />
            {dateError && (
              <p id="recurring-next-run-error" role="alert" className="text-[11px] text-red-400 mt-1">{dateError}</p>
            )}
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
