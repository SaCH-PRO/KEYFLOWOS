"use client";

import React, { useState, useRef, useId } from "react";
import {
  X,
  Upload,
  Camera,
  Image as ImageIcon,
  Repeat,
  FileText,
  Sparkles,
  Loader2,
  HardDrive,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Expense,
  ExpenseCategory,
  PAYMENT_METHODS,
  createExpense,
  updateExpense,
  extractReceipt,
  createRecurringExpense,
} from "@/lib/client";
import { createBill, type CreateBillBody } from "@/lib/api/finance";
import { formatCurrency as formatMoney } from "@/lib/currency";
import { businessCurrency, businessTimeZone, dayInZone, recurringScheduleBody, todayInBusinessZone } from "./expense-utils";
import { useUpload } from "@/hooks/use-upload";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { API_BASE } from "@/lib/api";
import { SideSheet } from "../../commerce/components/side-sheet";
import type { ProjectOption, ContactOption, ServiceOption } from "./use-expenses-data";
import { motion, AnimatePresence } from "framer-motion";

interface ExpenseFormSideSheetProps {
  businessId: string;
  categories: ExpenseCategory[];
  editingExpense: Expense | null;
  projects?: ProjectOption[];
  contacts?: ContactOption[];
  services?: ServiceOption[];
  prefill?: ExpensePrefill | null;
  /** EXPENSES-HUB-2 (BUG-059): "bill" opens the sheet as a bill to pay later (the page's Record bill). */
  initialKind?: "expense" | "bill";
  onClose: () => void;
  onSaved: () => void;
}

export interface ExpensePrefill {
  description?: string;
  amount?: number;
  date?: string;
  vendor?: string;
  receiptUrl?: string;
}

const ACCENT = "rgb(244,63,94)"; // rose-500
const ACCENT_BG = "rgba(244,63,94,0.15)";
const ACCENT_BORDER = "rgba(244,63,94,0.3)";

export function ExpenseFormSideSheet({
  businessId,
  categories,
  editingExpense,
  projects = [],
  contacts = [],
  services = [],
  prefill,
  initialKind = "expense",
  onClose,
  onSaved,
}: ExpenseFormSideSheetProps) {
  // BUG-027: the business currency (the server writes it on the expense), never a literal TTD.
  const [currency] = useState(() => businessCurrency(businessId));
  const dueDateId = useId();
  const billToggleId = useId();
  const { uploadFile, isUploading: uploading, progress } = useUpload();
  const { uploadToDrive } = useDriveUpload();
  const selectedFileRef = useRef<File | null>(null);
  const [formData, setFormData] = useState(() => {
    if (editingExpense) {
      return {
        description: editingExpense.description,
        amount: String(editingExpense.amount),
        date: editingExpense.date ? editingExpense.date.split("T")[0] : "",
        vendor: editingExpense.vendor || "",
        categoryId: editingExpense.categoryId || "",
        notes: editingExpense.notes || "",
        receiptUrl: editingExpense.receiptUrl || "",
        receiptMimeType: "",
        paymentMethod: editingExpense.paymentMethod || "",
        tags: editingExpense.tags?.join(", ") || "",
        isRecurring: editingExpense.isRecurring,
        recurringFrequency: editingExpense.recurringFrequency || "MONTHLY",
        projectId: editingExpense.projectId || "",
        contactId: editingExpense.contactId || "",
        serviceId: editingExpense.serviceId || "",
        isBill: false,
        dueDate: "",
      };
    }
    // BUG-028: today in Trinidad (the business's zone), not the UTC date (tomorrow after 20:00 in Port of Spain).
    const dateValue = prefill?.date ?? todayInBusinessZone(new Date(), businessId);
    const prefillDay = (value: string): string => {
      const at = new Date(value);
      return Number.isNaN(at.getTime()) ? todayInBusinessZone(new Date(), businessId) : dayInZone(at, businessTimeZone(businessId));
    };
    return {
      description: prefill?.description ?? "",
      amount: typeof prefill?.amount === "number" ? String(prefill.amount) : "",
      date:
        typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
          ? dateValue
          : prefillDay(String(dateValue)),
      vendor: prefill?.vendor ?? "",
      categoryId: "",
      notes: "",
      receiptUrl: prefill?.receiptUrl ?? "",
      receiptMimeType: "",
      paymentMethod: "",
      tags: "" as string,
      isRecurring: false,
      recurringFrequency: "MONTHLY",
      projectId: "",
      contactId: "",
      serviceId: "",
      isBill: initialKind === "bill",
      dueDate: "",
    };
  });
  // A bill is recorded new; an expense being edited stays what it is.
  const isBill = !editingExpense && formData.isBill;

  const [extracting, setExtracting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  /**
   * EXPENSES-HUB-2 (BUG-061): a recurring expense (new, or an edit that makes
   * it recurring) creates its schedule through the existing route; the expense
   * saved now is this period's, so the schedule is next due one period later.
   * Answers the refusal, if any.
   */
  const createSchedule = async (bill: boolean): Promise<string | null> => {
    const body = recurringScheduleBody({
      description: formData.description.trim(),
      amount: parseFloat(formData.amount),
      date: formData.date,
      frequency: formData.recurringFrequency,
      vendor: formData.vendor.trim() || null,
      paymentMethod: formData.paymentMethod || null,
      categoryId: formData.categoryId || null,
      notes: formData.notes.trim() || null,
      projectId: formData.projectId || null,
      contactId: formData.contactId || null,
      serviceId: formData.serviceId || null,
      bill: bill ? { dueDate: formData.dueDate || null } : null,
    }, businessId);
    try {
      const res = await createRecurringExpense(businessId, body);
      return res?.error ? res.error : null;
    } catch (err) {
      return err instanceof Error ? err.message : "the request failed";
    }
  };

  const submit = async () => {
    if (!formData.description.trim() || !formData.amount) return;
    const tags = formData.tags ? formData.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    // No currency: the server writes the business currency (FOLLOW3-B4, D-13).
    const payload: Partial<Expense> = {
      description: formData.description.trim(),
      amount: parseFloat(formData.amount),
      date: formData.date,
      vendor: formData.vendor.trim() || undefined,
      categoryId: formData.categoryId || undefined,
      notes: formData.notes.trim() || undefined,
      receiptUrl: formData.receiptUrl.trim() || undefined,
      paymentMethod: formData.paymentMethod || undefined,
      tags,
      isRecurring: formData.isRecurring,
      recurringFrequency: formData.isRecurring ? formData.recurringFrequency : undefined,
      projectId: formData.projectId || null,
      contactId: formData.contactId || null,
      serviceId: formData.serviceId || null,
    };
    const makesSchedule = formData.isRecurring && !(editingExpense && editingExpense.isRecurring);
    try {
      let expenseId = editingExpense?.id;
      const notices: string[] = [];
      if (isBill) {
        // BUG-059: a bill to pay later goes through the bill door (status BILL, payables), never as a paid expense.
        const billBody: CreateBillBody = {
          description: payload.description!,
          amount: payload.amount!,
          date: formData.date || undefined,
          dueDate: formData.dueDate || undefined,
          vendor: payload.vendor ?? undefined,
          notes: payload.notes ?? undefined,
          categoryId: formData.categoryId || undefined,
          contactId: formData.contactId || undefined,
        };
        const res = await createBill(businessId, billBody);
        if (res?.error || !res?.data) {
          toast.error(res?.error || "Failed to record bill");
          return;
        }
        expenseId = res.data.id;
        // The bill door takes no receipt, tags, project or service: they are written onto the bill it created.
        const extra: Partial<Expense> = {};
        if (payload.receiptUrl) extra.receiptUrl = payload.receiptUrl;
        if (tags.length) extra.tags = tags;
        if (formData.isRecurring) {
          extra.isRecurring = true;
          extra.recurringFrequency = formData.recurringFrequency;
        }
        if (formData.projectId) extra.projectId = formData.projectId;
        if (formData.serviceId) extra.serviceId = formData.serviceId;
        if (Object.keys(extra).length) {
          const patched = await updateExpense(businessId, res.data.id, extra);
          if (patched?.error) notices.push(`its receipt and tags were not saved: ${patched.error}`);
        }
      } else {
        const res = editingExpense
          ? await updateExpense(businessId, editingExpense.id, payload)
          : await createExpense(businessId, payload);
        // FOLLOW3-B7 (D-67): a refused save (409 on a posted expense's amount) is shown, never reported as saved.
        if (res?.error) {
          toast.error(res.error);
          return;
        }
        if (!editingExpense && res.data) expenseId = res.data.id;
      }

      if (makesSchedule) {
        const refused = await createSchedule(isBill);
        if (refused) notices.push(`its recurring schedule was not created: ${refused}`);
      }

      // Upload receipt to Google Drive if a file was selected
      if (expenseId && selectedFileRef.current && formData.receiptUrl) {
        const file = selectedFileRef.current;
        const arr = await file.arrayBuffer();
        uploadToDrive({
          businessId,
          entityType: "expense",
          entityId: expenseId,
          fileName: `Receipt-${formData.description || "Expense"}-${todayInBusinessZone(new Date(), businessId)}.${file.name.split(".").pop()}`,
          mimeType: file.type || "application/octet-stream",
          content: arr,
          contentFormat: "binary",
          silent: true,
        }).then((ok) => {
          if (ok) toast.success("Receipt saved to Drive");
        });
      }

      const what = isBill ? "Bill recorded" : "Expense saved";
      if (notices.length) toast.error(`${what}, but ${notices.join("; and ")}`);
      else toast.success(isBill ? "Bill recorded: pay it when it is due" : what);
      selectedFileRef.current = null;
      onSaved();
      onClose();
    } catch (_err) {
      toast.error(isBill ? "Failed to record bill" : "Failed to save expense");
    }
  };

  // COR-F3: one save at a time: a double click (or a second tap while the first is in flight) sends nothing.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await submit();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    selectedFileRef.current = file;
    try {
      const uploaded = await uploadFile(file);
      if (uploaded) {
        const path = uploaded.objectPath;
        const receiptUrl = path.startsWith("http") ? path : `${API_BASE}${path}`;
        setFormData((prev) => ({ ...prev, receiptUrl, receiptMimeType: file.type }));
        toast.success("Receipt uploaded");
        setScanError(null);
      } else {
        toast.error("Failed to upload receipt");
      }
    } catch (_err) {
      toast.error("Failed to upload receipt");
    }
  };

  const handleDriveSelect = (file: { id: string; name: string; mimeType: string }) => {
    const receiptUrl = `https://drive.google.com/file/d/${file.id}/view`;
    setFormData((prev) => ({ ...prev, receiptUrl, receiptMimeType: file.mimeType }));
    setShowDrivePicker(false);
    setScanError(null);
  };

  const handleExtractReceipt = async () => {
    if (!formData.receiptUrl) return;
    setExtracting(true);
    setScanError(null);
    try {
      const res = await extractReceipt(businessId, { url: formData.receiptUrl, filename: "receipt.jpg" });
      if (res.error) {
        setScanError(res.error);
        toast.error(res.error);
        setExtracting(false);
        return;
      }
      const data = res.data;
      if (data?.invoiceData) {
        const inv = data.invoiceData;
        setFormData((prev) => ({
          ...prev,
          description: inv.lineItems?.[0]?.description || prev.description,
          amount: String(inv.total || inv.subtotal || prev.amount),
          vendor: inv.contactName || prev.vendor,
          date: inv.issueDate ? inv.issueDate.split("T")[0] : prev.date,
        }));
        toast.success(`Receipt extracted (${Math.round((data.confidence || 0) * 100)}% confidence)`);
      } else {
        toast.info("Could not extract data from receipt");
      }
    } catch (_err) {
      toast.error("Extraction failed");
    }
    setExtracting(false);
  };

  const selectedCategory = categories.find((c) => c.id === formData.categoryId);
  const hasLinking = projects.length > 0 || contacts.length > 0 || services.length > 0;
  const amountNum = parseFloat(formData.amount || "0");

  return (
    <>
      <SideSheet
        open={true}
        onClose={onClose}
        title={editingExpense ? "Edit Expense" : isBill ? "New Bill" : "New Expense"}
        subtitle={editingExpense ? `Editing ${editingExpense.description}` : isBill ? "Record a bill to pay later" : "Record a business expense"}
        width="md"
        icon={
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}` }}
          >
            <Receipt className="w-5 h-5" style={{ color: ACCENT }} />
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              <span className="block">Amount</span>
              <span className="font-semibold" style={{ color: ACCENT }}>
                {amountNum > 0 ? formatMoney(amountNum, currency) : "—"}
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
                onClick={handleSubmit}
                disabled={submitting || !formData.description.trim() || !formData.amount}
                aria-busy={submitting || undefined}
                className="px-4 py-2.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                style={{
                  background: ACCENT_BG,
                  color: ACCENT,
                  border: `1px solid ${ACCENT_BORDER}`,
                }}
              >
                {editingExpense ? "Update Expense" : isBill ? "Record bill" : "Add Expense"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {/* EXPENSES-HUB-2 (BUG-059): a bill to pay later, or an expense paid now */}
          {!editingExpense && (
            <div className="p-3 rounded-xl bg-white/[0.02] border border-border/40">
              <label htmlFor={billToggleId} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  id={billToggleId}
                  type="checkbox"
                  checked={formData.isBill}
                  onChange={(e) => setFormData({ ...formData, isBill: e.target.checked })}
                  className="accent-rose-500"
                />
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                Bill to pay later
              </label>
              <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                {formData.isBill ? "Recorded as owed, not paid. Pay it from the bill when it is due." : "Leave unticked for an expense already paid."}
              </p>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Description *</label>
            <input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What was this expense for?"
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
            />
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Amount ({currency}) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Date *</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
              />
            </div>
          </div>

          {/* Vendor + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Vendor</label>
              <input
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                placeholder="Vendor name"
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Category</label>
              <div className="relative">
                <select
                  value={formData.categoryId}
                  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {selectedCategory && (
                  <div
                    className="absolute right-8 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full"
                    style={{ background: selectedCategory.color || "#6366f1" }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Payment Method + Tags */}
          <div className="grid grid-cols-2 gap-3">
            {isBill ? (
              <div>
                <label htmlFor={dueDateId} className="text-xs text-muted-foreground mb-1.5 block">Due date</label>
                <input
                  id={dueDateId}
                  type="date"
                  value={formData.dueDate}
                  min={formData.date || undefined}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Payment Method</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
                >
                  <option value="">Select method</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Tags</label>
              <input
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="tag1, tag2, ..."
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40"
              />
            </div>
          </div>

          {/* Linking */}
          {hasLinking && (
            <div className="p-3 rounded-xl bg-white/[0.02] border border-border/40 space-y-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                Link to Business Entity
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {projects.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Project</label>
                    <select
                      value={formData.projectId}
                      onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                      className="w-full px-2 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-xs text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
                    >
                      <option value="">None</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {contacts.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Client</label>
                    <select
                      value={formData.contactId}
                      onChange={(e) => setFormData({ ...formData, contactId: e.target.value })}
                      className="w-full px-2 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-xs text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
                    >
                      <option value="">None</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {services.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Service</label>
                    <select
                      value={formData.serviceId}
                      onChange={(e) => setFormData({ ...formData, serviceId: e.target.value })}
                      className="w-full px-2 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-xs text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
                    >
                      <option value="">None</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes..."
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500/40 resize-none"
            />
          </div>

          {/* Recurring */}
          <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-border/40">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isRecurring}
                onChange={(e) => setFormData({ ...formData, isRecurring: e.target.checked })}
                className="accent-rose-500"
              />
              <Repeat className="w-3.5 h-3.5 text-blue-400" />
              Recurring expense
            </label>
            {formData.isRecurring && (
              <select
                value={formData.recurringFrequency}
                onChange={(e) => setFormData({ ...formData, recurringFrequency: e.target.value })}
                className="px-3 py-1.5 rounded-xl bg-white/[0.03] border border-border/40 text-xs text-foreground focus:outline-none focus:border-rose-500/40 appearance-none"
              >
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Bi-weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            )}
          </div>

          {/* Receipt import */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-border/40 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Receipt</p>

            {!formData.receiptUrl ? (
              <div className="grid grid-cols-3 gap-2">
                {/* EXPENSES-HUB-3 (journey H4): on a phone a receipt is a photo, so Take photo opens the camera
                    (capture); Upload file keeps any image or PDF from the gallery or the disk. */}
                <label className="flex flex-col items-center gap-1.5 px-3 py-3 min-h-[44px] rounded-xl border border-border/40 hover:border-rose-500/40 hover:bg-rose-500/5 transition-all cursor-pointer text-center">
                  <Camera className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-[10px] font-medium text-muted-foreground">Take photo</span>
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleReceiptUpload} />
                </label>
                <label className="flex flex-col items-center gap-1.5 px-3 py-3 min-h-[44px] rounded-xl border border-border/40 hover:border-rose-500/40 hover:bg-rose-500/5 transition-all cursor-pointer text-center">
                  <Upload className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-[10px] font-medium text-muted-foreground">Upload file</span>
                  <input type="file" accept="image/*,.pdf" className="sr-only" onChange={handleReceiptUpload} />
                </label>
                <button
                  onClick={() => setShowDrivePicker(true)}
                  className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border border-border/40 hover:border-rose-500/40 hover:bg-rose-500/5 transition-all text-center"
                >
                  <HardDrive className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground">Google Drive</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border border-border/30">
                  {formData.receiptUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                    <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span className="text-xs truncate flex-1">Receipt attached</span>
                  <button
                    onClick={() => setFormData((prev) => ({ ...prev, receiptUrl: "", receiptMimeType: "" }))}
                    className="p-1 rounded hover:bg-white/[0.05] shrink-0"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>

                {!scanError && (
                  <button
                    onClick={handleExtractReceipt}
                    disabled={extracting || uploading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                  >
                    {extracting || uploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {uploading ? `Uploading ${progress}%` : extracting ? "Extracting…" : "Extract with AI"}
                  </button>
                )}

                {scanError && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {scanError}
                  </div>
                )}
              </div>
            )}

            {!formData.receiptUrl && (
              <p className="text-[10px] text-muted-foreground/50">Attach receipts for tax compliance and audit readiness.</p>
            )}
          </div>
        </div>
      </SideSheet>

      {/* Google Drive Picker Modal */}
      <AnimatePresence>
        {showDrivePicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            onClick={() => setShowDrivePicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[80vh] bg-card rounded-2xl border border-border/60 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                <h3 className="text-sm font-semibold">Select Receipt</h3>
                <button
                  onClick={() => setShowDrivePicker(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-xl transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DrivePickerLazy
                  businessId={businessId}
                  onSelect={handleDriveSelect}
                  allowedMimeTypes={["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function DrivePickerLazy({
  businessId,
  onSelect,
  allowedMimeTypes,
}: {
  businessId: string;
  onSelect: (file: { id: string; name: string; mimeType: string }) => void;
  allowedMimeTypes?: string[];
}) {
  const [Component, setComponent] = React.useState<React.ComponentType<{
    businessId: string;
    onSelect: (file: { id: string; name: string; mimeType: string }) => void;
    allowedMimeTypes?: string[];
    pickerTitle?: string;
  }> | null>(null);

  React.useEffect(() => {
    import("../../profile/components/google-drive-browser").then((mod) => {
      setComponent(() => mod.default);
    });
  }, []);

  if (!Component) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Component
      businessId={businessId}
      onSelect={onSelect}
      allowedMimeTypes={allowedMimeTypes}
      pickerTitle="Select a receipt file"
    />
  );
}
