"use client";

import { Palette, Percent } from "lucide-react";
import { Input } from "@keyflow/ui";
import { FormState } from "./use-business-settings";

type Props = {
  form: FormState;
  setField: (field: keyof FormState, value: string) => void;
};

export function BrandingTab({ form, setField }: Props) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Customize your brand colors and default tax rate for invoices.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-2">
            <Palette className="h-3 w-3" />
            Primary Brand Color
          </div>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.primaryColor}
              onChange={(e) => setField("primaryColor", e.target.value)}
              className="w-12 h-12 rounded-xl border border-border/60 cursor-pointer"
            />
            <Input
              value={form.primaryColor}
              onChange={(e) => setField("primaryColor", e.target.value)}
              placeholder="#F97316"
              className="flex-1"
            />
          </div>
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1 mb-2">
            <Palette className="h-3 w-3" />
            Secondary Brand Color
          </div>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.secondaryColor}
              onChange={(e) => setField("secondaryColor", e.target.value)}
              className="w-12 h-12 rounded-xl border border-border/60 cursor-pointer"
            />
            <Input
              value={form.secondaryColor}
              onChange={(e) => setField("secondaryColor", e.target.value)}
              placeholder="#14B8A6"
              className="flex-1"
            />
          </div>
        </label>
      </div>

      <div className="p-4 rounded-xl bg-slate-800/50 border border-border/40">
        <h3 className="text-sm font-medium mb-3">Preview</h3>
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: form.primaryColor }}
          >
            {form.name?.charAt(0) || "K"}
          </div>
          <div>
            <div className="font-semibold" style={{ color: form.primaryColor }}>
              {form.name || "Your Business"}
            </div>
            <div className="text-sm" style={{ color: form.secondaryColor }}>
              Professional Services
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border/40 pt-6">
        <h3 className="text-sm font-medium mb-4">Invoice Defaults</h3>
        <label className="block text-xs text-muted-foreground max-w-xs">
          <div className="flex items-center gap-1 mb-1">
            <Percent className="h-3 w-3" />
            Default Tax Rate (%)
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.defaultTaxRate}
            onChange={(e) => setField("defaultTaxRate", e.target.value)}
            placeholder="12.5"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            This rate will be applied by default when creating new invoices.
          </p>
        </label>
      </div>
    </div>
  );
}
