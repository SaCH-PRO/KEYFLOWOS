"use client";

import { motion } from "framer-motion";
import { Percent, Tag } from "lucide-react";
import { SectionHeader } from "../billing-form-modal";

interface FormTaxDiscountSectionProps {
  open: boolean;
  onToggle: () => void;
  accentColor: string;
  taxRate: number | string;
  onTaxRateChange: (value: string) => void;
  discountType: string | null;
  onDiscountTypeChange: (type: "PERCENT" | "FIXED") => void;
  discountValue: number | string;
  onDiscountValueChange: (value: string) => void;
}

export function FormTaxDiscountSection({
  open,
  onToggle,
  accentColor,
  taxRate,
  onTaxRateChange,
  discountType,
  onDiscountTypeChange,
  discountValue,
  onDiscountValueChange,
}: FormTaxDiscountSectionProps) {
  return (
    <>
      <SectionHeader label="Tax & Discount" icon={Percent} open={open} onToggle={onToggle} accentColor={accentColor} />
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="w-3 h-3" /> Tax Rate (%)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={taxRate}
                onChange={(e) => onTaxRateChange(e.target.value)}
                placeholder="12.5"
                className="kf-input w-full"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Tag className="w-3 h-3" /> Discount Type
              </label>
              <div className="flex rounded-lg border border-border/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => onDiscountTypeChange("PERCENT")}
                  className={`flex-1 min-h-[44px] text-xs font-medium transition-all ${
                    discountType === "PERCENT" ? "bg-white/[0.1] text-foreground" : "text-muted-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  Percent
                </button>
                <button
                  type="button"
                  onClick={() => onDiscountTypeChange("FIXED")}
                  className={`flex-1 min-h-[44px] text-xs font-medium transition-all ${
                    discountType === "FIXED" ? "bg-white/[0.1] text-foreground" : "text-muted-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  Fixed
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Tag className="w-3 h-3" /> Discount Value
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={discountValue}
                onChange={(e) => onDiscountValueChange(e.target.value)}
                placeholder={discountType === "PERCENT" ? "10" : "50.00"}
                className="kf-input w-full"
              />
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
}
