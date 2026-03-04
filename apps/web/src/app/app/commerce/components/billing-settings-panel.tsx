"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Percent, FileText, Save, Loader2, ChevronDown } from "lucide-react";
import { Input } from "@keyflow/ui";
import { TemplatePicker } from "./invoice-templates";
import type { TemplateId } from "./invoice-templates";
import { useBillingSettings } from "../hooks/use-billing-settings";

export const BillingSettingsPanel = React.memo(function BillingSettingsPanel() {
  const { data, setField, loading, saving, save, isDirty } = useBillingSettings();
  const [open, setOpen] = useState(false);

  if (loading) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-white/[0.03] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground/90 hover:bg-white/[0.04] transition-colors"
      >
        <span className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          Billing Settings
        </span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

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
                <h4 className="text-xs font-medium flex items-center gap-1.5 mb-1 text-foreground/80">
                  <FileText className="h-3.5 w-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Invoice & Quote Template
                </h4>
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
  );
});
