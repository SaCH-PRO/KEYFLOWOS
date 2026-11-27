"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Upload, Image as ImageIcon, Repeat, DollarSign, FileText, Store, Tag, Calendar, CreditCard, FolderKanban, Users, Briefcase, Sparkles, Loader2 } from "lucide-react";
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
import { businessCurrency, businessTimeZone, recurringScheduleBody, todayInBusinessZone, useShownBusiness, canStartFor, refusedStart } from "./expense-utils";
import { useUpload } from "@/hooks/use-upload";
import { API_BASE } from "@/lib/api";
import type { ProjectOption, ContactOption, ServiceOption } from "./use-expenses-data";

interface ExpenseFormModalProps {
  businessId: string;
  categories: ExpenseCategory[];
  editingExpense: Expense | null;
  projects?: ProjectOption[];
  contacts?: ContactOption[];
  services?: ServiceOption[];
  onClose: () => void;
  onSaved: () => void;
  /**
   * R14: the check that the business this was opened for is still the one shown. A parent with the data hook passes
   * its ref-based `isCurrentBusiness`; without it, the component's own latest `businessId` (useShownBusiness).
   */
  isCurrentBusiness?: (businessId: string) => boolean;
}

export function ExpenseFormModal({ businessId, categories, editingExpense, projects = [], contacts = [], services = [], onClose, onSaved, isCurrentBusiness: hookCheck }: ExpenseFormModalProps) {
  const shownCheck = useShownBusiness(businessId);
  const isCurrentBusiness = hookCheck ?? shownCheck;
  // R14: a reply for a business no longer shown says nothing and neither saves nor closes.
  // R18-3: the start checks' test (the given check, and the stored id).
  const live = () => canStartFor(businessId, isCurrentBusiness);
  const { uploadFile, isUploading: uploading } = useUpload();
  // BUG-027: the business currency (the server writes it on the expense), never a literal TTD.
  const [currency] = useState(() => businessCurrency(businessId));
  const [formData, setFormData] = useState(() => {
    if (editingExpense) {
      return {
        description: editingExpense.description, amount: String(editingExpense.amount), date: editingExpense.date ? editingExpense.date.split("T")[0] : "",
        vendor: editingExpense.vendor || "", categoryId: editingExpense.categoryId || "", notes: editingExpense.notes || "",
        receiptUrl: editingExpense.receiptUrl || "", paymentMethod: editingExpense.paymentMethod || "",
        tags: editingExpense.tags?.join(", ") || "", isRecurring: editingExpense.isRecurring, recurringFrequency: editingExpense.recurringFrequency || "MONTHLY",
        projectId: editingExpense.projectId || "", contactId: editingExpense.contactId || "", serviceId: editingExpense.serviceId || "",
      };
    }
    return {
      // BUG-028: today in Trinidad (the business's zone), not the UTC date.
      description: "", amount: "", date: todayInBusinessZone(new Date(), businessId),
      vendor: "", categoryId: "", notes: "", receiptUrl: "", paymentMethod: "",
      tags: "" as string, isRecurring: false, recurringFrequency: "MONTHLY",
      projectId: "", contactId: "", serviceId: "",
    };
  });
  // R19-1: a form opened for one business keeps nothing of it when the modal shows another: the fields clear, and an
  // edit of the old business's expense is no longer an edit (React's reset-on-prop-change, during render).
  const [formFor, setFormFor] = useState(businessId);
  const [editingFor] = useState(businessId); // the business the edit (if any) was opened for
  if (formFor !== businessId) {
    setFormFor(businessId);
    setFormData({
        // BUG-028: today in Trinidad (the business's zone), not the UTC date.
        description: "", amount: "", date: todayInBusinessZone(new Date(), businessId),
        vendor: "", categoryId: "", notes: "", receiptUrl: "", paymentMethod: "",
        tags: "" as string, isRecurring: false, recurringFrequency: "MONTHLY",
        projectId: "", contactId: "", serviceId: "",
      });
  }
  const editing = editingFor === businessId ? editingExpense : null;

  const submit = async () => {
    if (!formData.description.trim() || !formData.amount) return;
    if (refusedStart(businessId, isCurrentBusiness)) return;
    const zone = businessTimeZone(businessId); // R18-8
    // No currency: the server writes the business currency (FOLLOW3-B4, D-13).
    const payload: Partial<Expense> = {
      description: formData.description.trim(), amount: parseFloat(formData.amount),
      date: formData.date, vendor: formData.vendor.trim() || undefined,
      categoryId: formData.categoryId || undefined, notes: formData.notes.trim() || undefined,
      receiptUrl: formData.receiptUrl.trim() || undefined,
      paymentMethod: formData.paymentMethod || undefined,
      tags: formData.tags ? formData.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      isRecurring: formData.isRecurring, recurringFrequency: formData.isRecurring ? formData.recurringFrequency : undefined,
      projectId: formData.projectId || null,
      contactId: formData.contactId || null,
      serviceId: formData.serviceId || null,
    };
    try {
      const res = editing
        ? await updateExpense(businessId, editing.id, payload)
        : await createExpense(businessId, payload);
      // FOLLOW3-B7 (D-67): a refused save (409 on a posted expense's amount) is shown, never reported as saved.
      if (res?.error) {
        if (live()) toast.error(res.error);
        return;
      }
      // R18-3: the first write has landed: its schedule below still completes for this business (in its zone, taken
      // when the save started), silently once the business is no longer chosen.
      // EXPENSES-HUB-2 (BUG-061): a recurring expense (new, or an edit that makes it recurring) creates its
      // schedule through the existing route, next due one period after this expense's date.
      if (formData.isRecurring && !(editing && editing.isRecurring)) {
        let refused: string | null = null;
        try {
          const scheduled = await createRecurringExpense(businessId, recurringScheduleBody({
            description: formData.description.trim(), amount: parseFloat(formData.amount), date: formData.date,
            frequency: formData.recurringFrequency, vendor: formData.vendor.trim() || null,
            paymentMethod: formData.paymentMethod || null, categoryId: formData.categoryId || null,
            notes: formData.notes.trim() || null, projectId: formData.projectId || null,
            contactId: formData.contactId || null, serviceId: formData.serviceId || null,
          }, businessId, zone));
          refused = scheduled?.error ? scheduled.error : null;
        } catch (err) {
          refused = err instanceof Error ? err.message : "the request failed";
        }
        if (!live()) return;
        if (refused) toast.error(`Expense saved, but its recurring schedule was not created: ${refused}`);
        else toast.success("Expense saved");
      } else {
        if (!live()) return;
        toast.success("Expense saved");
      }
      onSaved();
      onClose();
    } catch (_err) { if (live()) toast.error("Failed to save expense"); }
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

  const [extracting, setExtracting] = useState(false);

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (refusedStart(businessId, isCurrentBusiness)) return;
    try {
      const uploaded = await uploadFile(file);
      if (!live()) return;
      if (uploaded) {
        // Persist a directly-resolvable URL (matches the prior behaviour
        // before this callsite was migrated onto `useUpload`). The render
        // paths in `expense-detail-modal.tsx` use `expense.receiptUrl`
        // straight in `<img src>` / `<a href>`, so a relative
        // `/objects/...` path would resolve against the Next origin and
        // 404. Prefix with `API_BASE` so the URL points at the API.
        const path = uploaded.objectPath;
        const receiptUrl = path.startsWith("http") ? path : `${API_BASE}${path}`;
        setFormData(prev => ({ ...prev, receiptUrl }));
        toast.success("Receipt uploaded");
      } else {
        toast.error("Failed to upload receipt");
      }
    } catch (_err) { if (live()) toast.error("Failed to upload receipt"); }
  };

  const handleExtractReceipt = async () => {
    if (!formData.receiptUrl) return;
    if (refusedStart(businessId, isCurrentBusiness)) return;
    setExtracting(true);
    try {
      const res = await extractReceipt(businessId, { url: formData.receiptUrl, filename: "receipt.jpg" });
      if (!live()) return;
      if (res.error) {
        toast.error(res.error);
        setExtracting(false);
        return;
      }
      const data = res.data;
      if (data?.invoiceData) {
        const inv = data.invoiceData;
        setFormData(prev => ({
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
      if (live()) toast.error("Extraction failed");
    }
    setExtracting(false);
  };

  const selectedCategory = categories.find(c => c.id === formData.categoryId);
  const completionFields = [
    !!formData.description.trim(),
    !!formData.amount,
    !!formData.date,
    !!formData.vendor.trim(),
    !!formData.categoryId,
    !!formData.paymentMethod,
    !!formData.receiptUrl,
  ];
  const completionPct = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);

  const hasLinking = projects.length > 0 || contacts.length > 0 || services.length > 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))" }}>
          <div>
            <h2 id="expense-modal-title" className="text-base font-semibold">{editing ? "Edit Expense" : "Add Expense"}</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1 w-24 rounded-full bg-muted/30 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${completionPct}%`, background: completionPct === 100 ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))" }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{completionPct}% complete</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><FileText className="w-3 h-3" /> Description *</label>
            <input value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="What was this expense for?" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><DollarSign className="w-3 h-3" /> Amount ({currency}) *</label>
              <input type="number" step="0.01" min="0" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} placeholder="0.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Calendar className="w-3 h-3" /> Date *</label>
              <input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Store className="w-3 h-3" /> Vendor</label>
              <input value={formData.vendor} onChange={e => setFormData({ ...formData, vendor: e.target.value })} placeholder="Vendor name" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Category</label>
              <div className="relative">
                <select value={formData.categoryId} onChange={e => setFormData({ ...formData, categoryId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                  <option value="">No category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {selectedCategory && (
                  <div className="absolute right-8 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full" style={{ background: selectedCategory.color || "#6366f1" }} />
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><CreditCard className="w-3 h-3" /> Payment Method</label>
              <select value={formData.paymentMethod} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                <option value="">Select method</option>
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Tag className="w-3 h-3" /> Tags</label>
              <input value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="tag1, tag2, ..." className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
            </div>
          </div>

          {hasLinking && (
            <div className="space-y-3 p-3 rounded-lg bg-white/[0.02] border border-border/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <FolderKanban className="w-3 h-3" /> Link to Business Entity
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {projects.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><FolderKanban className="w-3 h-3" /> Project</label>
                    <select value={formData.projectId} onChange={e => setFormData({ ...formData, projectId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                      <option value="">None</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
                {contacts.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Users className="w-3 h-3" /> Client</label>
                    <select value={formData.contactId} onChange={e => setFormData({ ...formData, contactId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                      <option value="">None</option>
                      {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {services.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Briefcase className="w-3 h-3" /> Service</label>
                    <select value={formData.serviceId} onChange={e => setFormData({ ...formData, serviceId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                      <option value="">None</option>
                      {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
            <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes..." rows={2} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none" />
          </div>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.02] border border-border/30">
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={formData.isRecurring} onChange={e => setFormData({ ...formData, isRecurring: e.target.checked })} className="accent-[hsl(var(--kf-accent1))]" /><Repeat className="w-3.5 h-3.5 text-blue-400" /> Recurring expense</label>
            {formData.isRecurring && (
              <select value={formData.recurringFrequency} onChange={e => setFormData({ ...formData, recurringFrequency: e.target.value })} className="bg-transparent border border-border/60 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                <option value="WEEKLY">Weekly</option><option value="BIWEEKLY">Bi-weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="YEARLY">Yearly</option>
              </select>
            )}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Receipt</label>
            <div className="flex items-center gap-2 flex-wrap">
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""} bg-white/5 border border-border/60 hover:bg-white/10`}>
                <Upload className="w-4 h-4" />{uploading ? "Uploading..." : "Upload Receipt"}
                <input type="file" accept="image/*,.pdf" onChange={handleReceiptUpload} className="hidden" />
              </label>
              {formData.receiptUrl && (
                <>
                  <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-lg">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[150px]">Receipt attached</span>
                    <button onClick={() => setFormData(prev => ({ ...prev, receiptUrl: "" }))} className="text-muted-foreground hover:text-red-400 ml-1"><X className="w-3 h-3" /></button>
                  </div>
                  <button
                    onClick={handleExtractReceipt}
                    disabled={extracting}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border/60 bg-card/50 hover:bg-card/80 transition-colors disabled:opacity-50"
                  >
                    {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {extracting ? "Extracting…" : "Extract with AI"}
                  </button>
                </>
              )}
            </div>
            {!formData.receiptUrl && (
              <p className="text-[10px] text-muted-foreground/50 mt-1">Attach receipts for tax compliance and audit readiness.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/30">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/30">Cancel</button>
            <button onClick={handleSubmit} disabled={submitting || !formData.description.trim() || !formData.amount} aria-busy={submitting || undefined} className="kf-btn-primary px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40">{editing ? "Update" : "Add Expense"}</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
