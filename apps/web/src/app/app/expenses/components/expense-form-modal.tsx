"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Image, Repeat } from "lucide-react";
import { toast } from "sonner";
import {
  Expense, ExpenseCategory, PAYMENT_METHODS,
  createExpense, updateExpense,
} from "@/lib/client";
import { API_BASE, getAuthHeaders } from "@/lib/api";

interface ExpenseFormModalProps {
  businessId: string;
  categories: ExpenseCategory[];
  editingExpense: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ExpenseFormModal({ businessId, categories, editingExpense, onClose, onSaved }: ExpenseFormModalProps) {
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState(() => {
    if (editingExpense) {
      return {
        description: editingExpense.description, amount: String(editingExpense.amount), date: editingExpense.date ? editingExpense.date.split("T")[0] : "",
        vendor: editingExpense.vendor || "", categoryId: editingExpense.categoryId || "", notes: editingExpense.notes || "",
        receiptUrl: editingExpense.receiptUrl || "", paymentMethod: editingExpense.paymentMethod || "",
        tags: editingExpense.tags?.join(", ") || "", isRecurring: editingExpense.isRecurring, recurringFrequency: editingExpense.recurringFrequency || "MONTHLY",
      };
    }
    return {
      description: "", amount: "", date: new Date().toISOString().split("T")[0],
      vendor: "", categoryId: "", notes: "", receiptUrl: "", paymentMethod: "",
      tags: "" as string, isRecurring: false, recurringFrequency: "MONTHLY",
    };
  });

  const handleSubmit = async () => {
    if (!formData.description.trim() || !formData.amount) return;
    const payload: any = {
      description: formData.description.trim(), amount: parseFloat(formData.amount),
      date: formData.date, vendor: formData.vendor.trim() || undefined,
      categoryId: formData.categoryId || undefined, notes: formData.notes.trim() || undefined,
      receiptUrl: formData.receiptUrl.trim() || undefined, currency: "TTD",
      paymentMethod: formData.paymentMethod || undefined,
      tags: formData.tags ? formData.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      isRecurring: formData.isRecurring, recurringFrequency: formData.isRecurring ? formData.recurringFrequency : undefined,
    };
    try {
      if (editingExpense) {
        await updateExpense(businessId, editingExpense.id, payload);
      } else {
        await createExpense(businessId, payload);
      }
      toast.success("Expense saved");
      onSaved();
      onClose();
    } catch (err) { toast.error("Failed to save expense"); }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`${API_BASE}/businesses/${businessId}/uploads/request-url`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      const data = await res.json();
      if (data.uploadUrl) {
        await fetch(data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        setFormData(prev => ({ ...prev, receiptUrl: data.publicUrl || data.uploadUrl.split("?")[0] }));
        toast.success("Receipt uploaded");
      }
    } catch (err) { toast.error("Failed to upload receipt"); }
    setUploading(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))" }}>
          <h2 id="expense-modal-title" className="text-base font-semibold">{editingExpense ? "Edit Expense" : "Add Expense"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div><label className="text-xs text-muted-foreground mb-1 block">Description *</label><input value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="What was this expense for?" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground mb-1 block">Amount (TTD) *</label><input type="number" step="0.01" min="0" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} placeholder="0.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Date *</label><input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground mb-1 block">Vendor</label><input value={formData.vendor} onChange={e => setFormData({ ...formData, vendor: e.target.value })} placeholder="Vendor name" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Category</label><select value={formData.categoryId} onChange={e => setFormData({ ...formData, categoryId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"><option value="">No category</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground mb-1 block">Payment Method</label><select value={formData.paymentMethod} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"><option value="">Select method</option>{PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Tags</label><input value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} placeholder="tag1, tag2, ..." className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
          </div>
          <div><label className="text-xs text-muted-foreground mb-1 block">Notes</label><textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes..." rows={2} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none" /></div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={formData.isRecurring} onChange={e => setFormData({ ...formData, isRecurring: e.target.checked })} className="accent-[hsl(var(--kf-accent1))]" /><Repeat className="w-3.5 h-3.5 text-muted-foreground" /> Recurring</label>
            {formData.isRecurring && (
              <select value={formData.recurringFrequency} onChange={e => setFormData({ ...formData, recurringFrequency: e.target.value })} className="bg-transparent border border-border/60 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
                <option value="WEEKLY">Weekly</option><option value="BIWEEKLY">Bi-weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="YEARLY">Yearly</option>
              </select>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Receipt</label>
            <div className="flex items-center gap-2">
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""} bg-white/5 border border-border/60 hover:bg-white/10`}><Upload className="w-4 h-4" />{uploading ? "Uploading..." : "Upload Receipt"}<input type="file" accept="image/*,.pdf" onChange={handleReceiptUpload} className="hidden" /></label>
              {formData.receiptUrl && (
                <div className="flex items-center gap-1.5 text-xs text-green-400"><Image className="w-3.5 h-3.5" /><span className="truncate max-w-[150px]">Receipt attached</span><button onClick={() => setFormData(prev => ({ ...prev, receiptUrl: "" }))} className="text-muted-foreground hover:text-red-400"><X className="w-3 h-3" /></button></div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/30">Cancel</button>
            <button onClick={handleSubmit} disabled={!formData.description.trim() || !formData.amount} className="kf-btn-primary px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40">{editingExpense ? "Update" : "Add Expense"}</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
