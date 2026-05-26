"use client";

import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  Image as ImageIcon,
  Repeat,
  DollarSign,
  FileText,
  Store,
  Tag,
  Calendar,
  CreditCard,
  FolderKanban,
  Users,
  Briefcase,
  Sparkles,
  Loader2,
  HardDrive,
  Receipt,
  ScanLine,
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
} from "@/lib/client";
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
  onClose: () => void;
  onSaved: () => void;
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
  onClose,
  onSaved,
}: ExpenseFormSideSheetProps) {
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
      };
    }
    return {
      description: "",
      amount: "",
      date: new Date().toISOString().split("T")[0],
      vendor: "",
      categoryId: "",
      notes: "",
      receiptUrl: "",
      receiptMimeType: "",
      paymentMethod: "",
      tags: "" as string,
      isRecurring: false,
      recurringFrequency: "MONTHLY",
      projectId: "",
      contactId: "",
      serviceId: "",
    };
  });

  const [extracting, setExtracting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  const handleSubmit = async () => {
    if (!formData.description.trim() || !formData.amount) return;
    const payload: Partial<Expense> = {
      description: formData.description.trim(),
      amount: parseFloat(formData.amount),
      date: formData.date,
      vendor: formData.vendor.trim() || undefined,
      categoryId: formData.categoryId || undefined,
      notes: formData.notes.trim() || undefined,
      receiptUrl: formData.receiptUrl.trim() || undefined,
      currency: "TTD",
      paymentMethod: formData.paymentMethod || undefined,
      tags: formData.tags ? formData.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      isRecurring: formData.isRecurring,
      recurringFrequency: formData.isRecurring ? formData.recurringFrequency : undefined,
      projectId: formData.projectId || null,
      contactId: formData.contactId || null,
      serviceId: formData.serviceId || null,
    };
    try {
      let expenseId = editingExpense?.id;
      if (editingExpense) {
        await updateExpense(businessId, editingExpense.id, payload);
      } else {
        const res = await createExpense(businessId, payload);
        if (res.data) expenseId = res.data.id;
      }

      // Upload receipt to Google Drive if a file was selected
      if (expenseId && selectedFileRef.current && formData.receiptUrl) {
        const file = selectedFileRef.current;
        const arr = await file.arrayBuffer();
        uploadToDrive({
          businessId,
          entityType: "expense",
          entityId: expenseId,
          fileName: `Receipt-${formData.description || "Expense"}-${new Date().toISOString().split("T")[0]}.${file.name.split(".").pop()}`,
          mimeType: file.type || "application/octet-stream",
          content: arr,
          contentFormat: "binary",
          silent: true,
        }).then((ok) => {
          if (ok) toast.success("Receipt saved to Drive");
        });
      }

      toast.success("Expense saved");
      selectedFileRef.current = null;
      onSaved();
      onClose();
    } catch (_err) {
      toast.error("Failed to save expense");
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
        title={editingExpense ? "Edit Expense" : "New Expense"}
        subtitle={editingExpense ? `Editing ${editingExpense.description}` : "Record a business expense"}
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
                {amountNum > 0 ? `TTD ${amountNum.toLocaleString("en-TT", { minimumFractionDigits: 2 })}` : "—"}
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
                disabled={!formData.description.trim() || !formData.amount}
                className="px-4 py-2.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                style={{
                  background: ACCENT_BG,
                  color: ACCENT,
                  border: `1px solid ${ACCENT_BORDER}`,
                }}
              >
                {editingExpense ? "Update Expense" : "Add Expense"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
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
              <label className="text-xs text-muted-foreground mb-1.5 block">Amount (TTD) *</label>
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
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border border-border/40 hover:border-rose-500/40 hover:bg-rose-500/5 transition-all cursor-pointer text-center">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground">Upload File</span>
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleReceiptUpload} />
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
  const [Component, setComponent] = React.useState<React.ComponentType<any> | null>(null);

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
