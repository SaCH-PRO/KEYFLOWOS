"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  ChevronDown,
  Loader2,
  Receipt,
  Eye,
  X,
  Monitor,
  Smartphone,
  Printer,
  Check,
} from "lucide-react";
import { SideSheet } from "./side-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TaskContinuityHeader } from "@/components/ui/task-continuity-header";
import type { Contact, Product } from "@/lib/client";
import { InvoiceLineItem } from "./commerce-types";
import { formatAmount } from "../utils/commerce-utils";
import { fetchDocumentTemplates, setDocumentTemplate } from "@/lib/client";
import { toast } from "sonner";
import { FormDetailsSection } from "./form-sections/form-details-section";
import { FormLineItemsSection } from "./form-sections/form-line-items-section";
import { FormTaxDiscountSection } from "./form-sections/form-tax-discount-section";
import { FormNotesSection } from "./form-sections/form-notes-section";
import { FormTemplateSection } from "./form-sections/form-template-section";
import { useBusinessPreview } from "../hooks/use-business-preview";
import { InvoiceTemplateRenderer } from "./invoice-templates/template-renderer";
import type { TemplateId, InvoiceTemplateData } from "./invoice-templates/template-types";
import { TEMPLATE_META } from "./invoice-templates/template-types";

type DocType = "invoice" | "quote";

interface BillingFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  docType: DocType;
  isEditing: boolean;
  saving?: boolean;
  formError?: string | null;
  contacts: Contact[];
  products: Product[];
  currency?: string;
  contactId: string;
  onContactChange: (id: string) => void;
  dateValue: string;
  onDateChange: (v: string) => void;
  items: InvoiceLineItem[];
  onAddItem: () => void;
  onRemoveItem: (id: string) => void;
  onUpdateItem: (id: string, field: keyof InvoiceLineItem, value: string | boolean) => void;
  onSelectProduct: (itemId: string, productId: string) => void;
  taxRate: string;
  onTaxRateChange: (v: string) => void;
  discountType: "PERCENT" | "FIXED";
  onDiscountTypeChange: (v: "PERCENT" | "FIXED") => void;
  discountValue: string;
  onDiscountValueChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  onPaymentTermsChange?: (termKey: string) => void;
  originLabel?: string | null;
  originRoute?: string | null;
  onReturn?: () => void;
  businessId?: string | null;
}

const THEME = {
  invoice: {
    accent: "rgb(6,182,212)",
    accentLight: "rgba(6,182,212,0.15)",
    accentBorder: "rgba(6,182,212,0.3)",
    label: "Invoice",
    icon: CreditCard,
    dateLabel: "Due Date",
  },
  quote: {
    accent: "rgb(139,92,246)",
    accentLight: "rgba(139,92,246,0.15)",
    accentBorder: "rgba(139,92,246,0.3)",
    label: "Quote",
    icon: Receipt,
    dateLabel: "Expiry Date",
  },
};

export function SectionHeader({ label, icon: Icon, open, onToggle, accentColor }: {
  label: string;
  icon: React.ElementType;
  open: boolean;
  onToggle: () => void;
  accentColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider hover:text-foreground transition-colors text-muted-foreground"
    >
      <Icon className="w-3.5 h-3.5" style={{ color: accentColor }} />
      {label}
      <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

export const BillingFormModal = React.memo(function BillingFormModal({
  open,
  onClose,
  onSubmit,
  docType,
  isEditing,
  saving,
  formError,
  contacts,
  products,
  currency = "TTD",
  contactId,
  onContactChange,
  dateValue,
  onDateChange,
  items,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  onSelectProduct,
  taxRate,
  onTaxRateChange,
  discountType,
  onDiscountTypeChange,
  discountValue,
  onDiscountValueChange,
  notes,
  onNotesChange,
  onPaymentTermsChange,
  originLabel,
  originRoute,
  onReturn,
  businessId,
}: BillingFormModalProps) {
  const theme = THEME[docType];
  const ThemeIcon = theme.icon;
  const { businessData } = useBusinessPreview();

  const [sections, setSections] = useState({
    details: true,
    items: true,
    financials: false,
    notes: false,
    template: false,
  });
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; type: string; isDefault: boolean }> | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateId>("classic");
  const [previewView, setPreviewView] = useState<"desktop" | "mobile" | "print">("desktop");
  const toggle = (key: keyof typeof sections) =>
    setSections((s) => ({ ...s, [key]: !s[key] }));

  useEffect(() => {
    if (!open) {
      setShowPreview(false);
      return;
    }
    fetchDocumentTemplates(businessId ?? undefined).then((res) => {
      if (res.data) {
        const type = docType === "invoice" ? "invoice" : "quote";
        const typeTemplates = res.data.templates.filter((t) => t.type === type);
        setTemplates(typeTemplates);
        const def = typeTemplates.find((t) => t.isDefault);
        const defaultId = def?.id ?? (docType === "invoice" ? res.data.branding?.invoiceTemplate : res.data.branding?.quoteTemplate) ?? "classic";
        setSelectedTemplate(defaultId);
        setPreviewTemplate(defaultId as TemplateId);
      }
    });
  }, [open, docType, businessId]);

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const isDirty = useMemo(() => {
    return contactId !== "" || dateValue !== "" || notes !== "" ||
      items.some((i) => i.description !== "" || i.unitPrice !== "");
  }, [contactId, dateValue, notes, items]);

  const handleClose = useCallback(() => {
    if (isDirty && !isEditing) {
      setShowDiscardDialog(true);
      return;
    }
    onClose();
  }, [isDirty, isEditing, onClose]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      return sum + qty * price;
    }, 0);
    const tax = taxRate ? subtotal * (parseFloat(taxRate) / 100) : 0;
    let discount = 0;
    if (discountValue) {
      const dv = parseFloat(discountValue);
      discount = discountType === "PERCENT" ? subtotal * (dv / 100) : dv;
    }
    const total = subtotal + tax - discount;
    return { subtotal, tax, discount, total };
  }, [items, taxRate, discountType, discountValue]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.isActive !== false),
    [products],
  );

  const handleSelectTemplate = useCallback(async (templateId: string) => {
    if (savingTemplate || selectedTemplate === templateId) return;
    setSavingTemplate(true);
    try {
      const body = docType === "invoice"
        ? { invoiceTemplate: templateId as 'classic' | 'modern' | 'minimal' }
        : { quoteTemplate: templateId as 'classic' | 'modern' | 'minimal' };
      const res = await setDocumentTemplate(body, businessId ?? undefined);
      if (res.data) {
        setSelectedTemplate(templateId);
        setPreviewTemplate(templateId as TemplateId);
        toast.success("Template updated");
      } else {
        toast.error("Failed to update template");
      }
    } catch {
      toast.error("Failed to update template");
    } finally {
      setSavingTemplate(false);
    }
  }, [savingTemplate, selectedTemplate, docType, businessId]);

  // Build preview data from current form state
  const previewData: InvoiceTemplateData | null = useMemo(() => {
    if (!businessData) return null;
    const contact = contacts.find((c) => c.id === contactId) ?? null;
    const subtotal = totals.subtotal;
    const taxAmount = totals.tax;
    const discountAmount = totals.discount;
    const total = totals.total;

    return {
      type: docType,
      number: isEditing ? "EDIT-001" : "PREVIEW",
      status: docType === "invoice" ? "SENT" : "SENT",
      issueDate: new Date().toISOString().split("T")[0],
      dueDate: docType === "invoice" ? dateValue || null : null,
      expiryDate: docType === "quote" ? dateValue || null : null,
      contact: contact ? {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
      } : null,
      items: items
        .filter((i) => i.description || i.unitPrice)
        .map((i) => ({
          id: i.id,
          description: i.description,
          quantity: parseFloat(i.quantity) || 0,
          unitPrice: parseFloat(i.unitPrice) || 0,
          total: (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0),
        })),
      subtotal,
      taxRate: parseFloat(taxRate) || 0,
      taxAmount,
      discountType: discountType || null,
      discountValue: discountValue ? parseFloat(discountValue) : null,
      discountAmount,
      total,
      currency,
      notes: notes || null,
      business: {
        name: businessData.name,
        logoUrl: businessData.logoUrl || null,
        address: businessData.address,
        city: businessData.city,
        country: businessData.country,
        phone: businessData.phone,
        email: businessData.email,
        website: businessData.website,
        tagline: businessData.tagline,
        primaryColor: businessData.primaryColor,
        secondaryColor: businessData.secondaryColor,
      },
    };
  }, [businessData, contacts, contactId, docType, isEditing, dateValue, items, totals, taxRate, discountType, discountValue, currency, notes]);

  const hasContentForPreview = contactId || items.some((i) => i.description || i.unitPrice);

  const previewWidth = previewView === "desktop" ? 800 : previewView === "print" ? 794 : 375;

  if (!open) return null;

  return (
    <>
      <SideSheet
        open={open}
        onClose={handleClose}
        title={isEditing ? `Edit ${theme.label}` : `New ${theme.label}`}
        subtitle={isEditing ? `Update ${theme.label.toLowerCase()} details` : `Create a new ${theme.label.toLowerCase()} for your client`}
        icon={
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: theme.accentLight }}
          >
            <ThemeIcon className="w-4.5 h-4.5" style={{ color: theme.accent }} />
          </div>
        }
        footer={
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between gap-8">
                  <span>Subtotal</span>
                  <span className="text-foreground">{formatAmount(totals.subtotal, currency)}</span>
                </div>
                {totals.tax > 0 && (
                  <div className="flex justify-between gap-8 text-xs">
                    <span>Tax ({taxRate}%)</span>
                    <span className="text-foreground/80">+{formatAmount(totals.tax, currency)}</span>
                  </div>
                )}
                {totals.discount > 0 && (
                  <div className="flex justify-between gap-8 text-xs">
                    <span>Discount</span>
                    <span className="text-green-400">-{formatAmount(totals.discount, currency)}</span>
                  </div>
                )}
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
                <p className="text-xl font-bold" style={{ color: theme.accent }}>
                  {formatAmount(totals.total, currency)}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 text-sm font-medium rounded-xl border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                disabled={!hasContentForPreview}
                className="px-4 py-2.5 text-sm font-medium rounded-xl border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-all disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={saving}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl text-white transition-all flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: theme.accent }}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ThemeIcon className="w-4 h-4" />
                )}
                {saving
                  ? "Saving..."
                  : isEditing
                    ? `Update ${theme.label}`
                    : `Create ${theme.label}`}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-1">
                {originLabel && (onReturn || originRoute) && (
                  <TaskContinuityHeader
                    taskLabel={isEditing ? `Edit ${theme.label}` : `New ${theme.label}`}
                    returnLabel={`Back to ${originLabel}`}
                    returnHref={originRoute ?? undefined}
                    onBack={onReturn}
                    className="mb-3"
                  />
                )}
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200 mb-3"
                  >
                    {formError}
                  </motion.div>
                )}

                <FormDetailsSection
                  open={sections.details}
                  onToggle={() => toggle("details")}
                  accentColor={theme.accent}
                  docType={docType}
                  contactId={contactId}
                  onContactChange={onContactChange}
                  contacts={contacts}
                  dateValue={dateValue}
                  onDateChange={onDateChange}
                  dateLabel={theme.dateLabel}
                  label={theme.label}
                  onPaymentTermsChange={onPaymentTermsChange}
                />

                <FormLineItemsSection
                  open={sections.items}
                  onToggle={() => toggle("items")}
                  accentColor={theme.accent}
                  items={items}
                  currency={currency}
                  activeProducts={activeProducts}
                  onAddItem={onAddItem}
                  onRemoveItem={onRemoveItem}
                  onUpdateItem={onUpdateItem}
                  onSelectProduct={onSelectProduct}
                />

                <FormTaxDiscountSection
                  open={sections.financials}
                  onToggle={() => toggle("financials")}
                  accentColor={theme.accent}
                  taxRate={taxRate}
                  onTaxRateChange={onTaxRateChange}
                  discountType={discountType}
                  onDiscountTypeChange={onDiscountTypeChange}
                  discountValue={discountValue}
                  onDiscountValueChange={onDiscountValueChange}
                />

                <FormNotesSection
                  open={sections.notes}
                  onToggle={() => toggle("notes")}
                  accentColor={theme.accent}
                  notes={notes}
                  onNotesChange={onNotesChange}
                  placeholder={`Add notes to this ${theme.label.toLowerCase()}...`}
                />

                <FormTemplateSection
                  open={sections.template}
                  onToggle={() => toggle("template")}
                  accentColor={theme.accent}
                  templates={templates}
                  selectedTemplate={selectedTemplate}
                  savingTemplate={savingTemplate}
                  onSelectTemplate={handleSelectTemplate}
                />
              </div>
      </SideSheet>

      {/* Preview Overlay */}
      <AnimatePresence>
        {showPreview && previewData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border/40">
              <div className="flex items-center gap-3">
                <Eye className="w-4 h-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-semibold">Preview {theme.label}</h3>
                  <p className="text-[10px] text-muted-foreground">See how your client will see it</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* View mode toggles */}
                <div className="flex items-center rounded-lg border border-border/40 overflow-hidden">
                  <PreviewViewButton icon={Monitor} active={previewView === "desktop"} onClick={() => setPreviewView("desktop")} />
                  <PreviewViewButton icon={Smartphone} active={previewView === "mobile"} onClick={() => setPreviewView("mobile")} />
                  <PreviewViewButton icon={Printer} active={previewView === "print"} onClick={() => setPreviewView("print")} />
                </div>
                <button
                  onClick={() => setShowPreview(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/[0.05] rounded-xl transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-center gap-2 px-4 py-2 bg-card/50 border-b border-border/30">
              {(["classic", "modern", "minimal"] as TemplateId[]).map((tid) => (
                <button
                  key={tid}
                  onClick={() => setPreviewTemplate(tid)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    previewTemplate === tid
                      ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                      : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border/40"
                  }`}
                >
                  {previewTemplate === tid && <Check className="w-3 h-3" />}
                  {TEMPLATE_META[tid].name}
                </button>
              ))}
            </div>

            {/* Preview canvas */}
            <div className="flex-1 overflow-auto flex items-start justify-center p-6">
              <motion.div
                animate={{ width: previewWidth }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="bg-white rounded-xl shadow-2xl overflow-hidden"
              >
                <InvoiceTemplateRenderer templateId={previewTemplate} data={previewData} />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={showDiscardDialog}
        title="Discard changes?"
        message={`You have unsaved changes on this ${theme.label.toLowerCase()}. Are you sure you want to discard them?`}
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onConfirm={() => { setShowDiscardDialog(false); onClose(); }}
        onCancel={() => setShowDiscardDialog(false)}
        variant="danger"
      />
    </>
  );
});

function PreviewViewButton({
  icon: Icon,
  active,
  onClick,
}: {
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 transition-colors ${
        active ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
