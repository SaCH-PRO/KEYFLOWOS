"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Percent, FileText, Save, Loader2, ChevronDown, Eye } from "lucide-react";
import { Input } from "@keyflow/ui";
import { TemplatePicker } from "./invoice-templates";
import { TemplateCustomizer } from "./invoice-templates/template-customizer";
import type { TemplateId, InvoiceTemplateData } from "./invoice-templates/template-types";
import { useBillingSettings } from "../hooks/use-billing-settings";
import { apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";

function buildSampleData(data: {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
}): InvoiceTemplateData {
  return {
    type: "invoice",
    number: "INV-001",
    status: "SENT",
    issueDate: new Date().toISOString(),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    contact: {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      phone: "+1 868 555 0123",
    },
    items: [
      { id: "1", description: "Website Design & Development", quantity: 1, unitPrice: 5000, total: 5000 },
      { id: "2", description: "Logo & Brand Identity Package", quantity: 1, unitPrice: 1500, total: 1500 },
      { id: "3", description: "Monthly SEO Retainer", quantity: 3, unitPrice: 800, total: 2400 },
    ],
    subtotal: 8900,
    taxRate: 12.5,
    taxAmount: 1112.5,
    discountType: "PERCENT",
    discountValue: 5,
    discountAmount: 445,
    total: 9567.5,
    currency: "TTD",
    notes: "Payment is due within 30 days. Thank you for your business!",
    business: {
      name: data.name || "Your Business",
      logoUrl: data.logoUrl,
      address: "123 Main Street",
      city: "Port of Spain",
      country: "Trinidad & Tobago",
      phone: "+1 868 555 0000",
      email: "hello@yourbusiness.com",
      website: "www.yourbusiness.com",
      primaryColor: data.primaryColor,
      secondaryColor: data.secondaryColor,
    },
  };
}

export const BillingSettingsPanel = React.memo(function BillingSettingsPanel() {
  const { data, setField, loading, saving, save, isDirty } = useBillingSettings();
  const [open, setOpen] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);

  const handleSaveBranding = useCallback(async (overrides: Record<string, string>) => {
    const id = getStoredBusinessId();
    if (!id) return;
    setSavingBranding(true);
    try {
      const res = await apiPatch(`/identity/businesses/${id}`, overrides);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Branding updated");
        if (overrides.primaryColor) setField("primaryColor", overrides.primaryColor);
        if (overrides.secondaryColor) setField("secondaryColor", overrides.secondaryColor);
        if (overrides.name) setField("name", overrides.name);
      }
    } catch {
      toast.error("Failed to save branding");
    }
    setSavingBranding(false);
  }, [setField]);

  const handleTemplateChangeFromCustomizer = useCallback((id: TemplateId) => {
    setField("invoiceTemplate", id);
  }, [setField]);

  if (loading) return null;

  return (
    <>
      <div className="rounded-xl border border-border/30 bg-white/[0.03] overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((v) => !v);
            }
          }}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground/90 hover:bg-white/[0.04] transition-colors cursor-pointer select-none"
        >
          <span className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            Billing Settings
          </span>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-5 border-t border-border/20 pt-4">
                <div>
                  <h4 className="text-xs font-medium flex items-center gap-1.5 mb-2 text-foreground/80">
                    <Percent className="h-3.5 w-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                    Default Tax Rate
                  </h4>
                  <div className="max-w-xs">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={data.defaultTaxRate}
                      onChange={(e) => setField("defaultTaxRate", e.target.value)}
                      placeholder="12.5"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Applied by default when creating new invoices. Trinidad VAT is 12.5%.
                    </p>
                  </div>
                </div>

                <div className="border-t border-border/20 pt-4">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-xs font-medium flex items-center gap-1.5 text-foreground/80">
                      <FileText className="h-3.5 w-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                      Invoice & Quote Template
                    </h4>
                    <button
                      onClick={() => setShowCustomizer(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium hover:bg-white/[0.06] border border-border/30 transition-colors"
                      style={{ color: "hsl(var(--kf-accent1))" }}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Customize & Preview
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Choose a template for your invoices and quotes. Your brand colors are automatically applied.
                  </p>
                  <TemplatePicker
                    selected={(data.invoiceTemplate || "classic") as TemplateId}
                    onChange={(id) => setField("invoiceTemplate", id)}
                    businessName={data.name}
                    primaryColor={data.primaryColor}
                    secondaryColor={data.secondaryColor}
                    logoUrl={null}
                  />
                </div>

                {isDirty && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-end pt-2"
                  >
                    <button
                      onClick={save}
                      disabled={saving}
                      className="kf-btn-primary text-sm flex items-center gap-2 px-4 py-2"
                    >
                      {saving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      {saving ? "Saving..." : "Save Settings"}
                    </button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <TemplateCustomizer
        open={showCustomizer}
        onClose={() => setShowCustomizer(false)}
        data={buildSampleData(data)}
        activeTemplate={(data.invoiceTemplate || "classic") as TemplateId}
        onTemplateChange={handleTemplateChangeFromCustomizer}
        onSaveBranding={handleSaveBranding}
        savingBranding={savingBranding}
      />
    </>
  );
});
