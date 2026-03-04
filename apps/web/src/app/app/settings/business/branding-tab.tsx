"use client";

import { motion } from "framer-motion";
import { Palette, Eye, Sparkles } from "lucide-react";
import { Input } from "@keyflow/ui";
import { FormState } from "./use-business-settings";
import { useThemeColors } from "@/lib/theme-context";

type Props = {
  form: FormState;
  setField: (field: keyof FormState, value: string) => void;
};

const presetPalettes = [
  { name: "Sunset Orange", primary: "#F97316", secondary: "#14B8A6" },
  { name: "Ocean Blue", primary: "#3B82F6", secondary: "#06B6D4" },
  { name: "Royal Purple", primary: "#8B5CF6", secondary: "#EC4899" },
  { name: "Forest Green", primary: "#10B981", secondary: "#84CC16" },
  { name: "Ruby Red", primary: "#EF4444", secondary: "#F59E0B" },
  { name: "Midnight", primary: "#6366F1", secondary: "#8B5CF6" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
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

  const applyPalette = (primary: string, secondary: string) => {
    handlePrimaryChange(primary);
    handleSecondaryChange(secondary);
  };

  return (
    <motion.div variants={{ show: { transition: { staggerChildren: 0.05 } } }} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <p className="text-sm text-muted-foreground mb-4">
          Customize your brand identity. Changes preview live across the entire app.
        </p>
      </motion.div>

      <motion.div variants={fadeUp} className="space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Quick Palettes
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {presetPalettes.map((p) => (
            <button
              key={p.name}
              onClick={() => applyPalette(p.primary, p.secondary)}
              className={`group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all hover:scale-105 ${
                form.primaryColor === p.primary && form.secondaryColor === p.secondary
                  ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10 ring-1 ring-[hsl(var(--kf-accent1))]/30"
                  : "border-border/40 hover:border-border/80"
              }`}
            >
              <div className="flex gap-0.5">
                <div className="w-5 h-5 rounded-full shadow-sm" style={{ backgroundColor: p.primary }} />
                <div className="w-5 h-5 rounded-full shadow-sm" style={{ backgroundColor: p.secondary }} />
              </div>
              <span className="text-[10px] text-muted-foreground group-hover:text-foreground truncate w-full text-center">{p.name}</span>
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-2 font-medium">
              <Palette className="h-3.5 w-3.5" />
              Primary Accent Color
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => handlePrimaryChange(e.target.value)}
                  className="w-14 h-14 rounded-xl border-2 border-border/60 cursor-pointer bg-transparent"
                />
              </div>
              <Input
                value={form.primaryColor}
                onChange={(e) => handlePrimaryChange(e.target.value)}
                placeholder="#F97316"
                className="flex-1 font-mono"
              />
            </div>
          </label>
          <p className="text-[11px] text-muted-foreground">Buttons, highlights, active states</p>
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
          <p className="text-[11px] text-muted-foreground">Badges, staff avatars, complementary</p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-5 space-y-4">
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
      </motion.div>

    </motion.div>
  );
}
