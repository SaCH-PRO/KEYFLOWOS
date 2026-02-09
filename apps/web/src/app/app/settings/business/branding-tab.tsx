"use client";

import { Palette, Percent, Eye } from "lucide-react";
import { Input } from "@keyflow/ui";
import { FormState } from "./use-business-settings";
import { useThemeColors } from "@/lib/theme-context";

type Props = {
  form: FormState;
  setField: (field: keyof FormState, value: string) => void;
};

export function BrandingTab({ form, setField }: Props) {
  const { setAccent1, setAccent2 } = useThemeColors();

  const handlePrimaryChange = (value: string) => {
    setField("primaryColor", value);
    setAccent1(value);
  };

  const handleSecondaryChange = (value: string) => {
    setField("secondaryColor", value);
    setAccent2(value);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Customize your brand accent colors. Changes preview live across the entire app and are saved when you click Save.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-2 font-medium">
              <Palette className="h-3.5 w-3.5" />
              Primary Accent Color
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.primaryColor}
                onChange={(e) => handlePrimaryChange(e.target.value)}
                className="w-14 h-14 rounded-xl border-2 border-border/60 cursor-pointer bg-transparent"
              />
              <Input
                value={form.primaryColor}
                onChange={(e) => handlePrimaryChange(e.target.value)}
                placeholder="#F97316"
                className="flex-1 font-mono"
              />
            </div>
          </label>
          <p className="text-[11px] text-muted-foreground">
            Used for buttons, highlights, active states, and primary accents.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-2 font-medium">
              <Palette className="h-3.5 w-3.5" />
              Secondary Accent Color
            </div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.secondaryColor}
                onChange={(e) => handleSecondaryChange(e.target.value)}
                className="w-14 h-14 rounded-xl border-2 border-border/60 cursor-pointer bg-transparent"
              />
              <Input
                value={form.secondaryColor}
                onChange={(e) => handleSecondaryChange(e.target.value)}
                placeholder="#14B8A6"
                className="flex-1 font-mono"
              />
            </div>
          </label>
          <p className="text-[11px] text-muted-foreground">
            Used for secondary badges, staff avatars, and complementary accents.
          </p>
        </div>
      </div>

      <div className="kf-card p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Eye className="w-4 h-4" /> Live Preview
        </h3>
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg"
            style={{ backgroundColor: form.primaryColor }}
          >
            {form.name?.charAt(0) || "K"}
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: form.primaryColor }}>
              {form.name || "Your Business"}
            </div>
            <div className="text-sm font-medium" style={{ color: form.secondaryColor }}>
              Professional Services
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <button className="kf-btn-primary text-sm">Primary Button</button>
          <button className="kf-btn-secondary text-sm">Secondary Button</button>
          <span className="kf-badge kf-badge-primary">Primary Badge</span>
          <span className="kf-badge kf-badge-secondary">Secondary Badge</span>
        </div>
        <div className="flex gap-3 pt-1">
          <div className="flex-1 kf-card-accent p-3 text-center text-sm font-medium">Accent Card</div>
          <div className="flex-1 kf-card p-3 text-center text-sm font-medium">Standard Card</div>
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
