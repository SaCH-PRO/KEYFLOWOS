"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Paintbrush,
  Type,
  Image,
  ToggleLeft,
  ToggleRight,
  LayoutGrid,
  List,
  Search as SearchIcon,
  Globe,
  ChevronDown,
  ChevronUp,
  Save,
  Loader2,
  Sparkles,
  Eye,
} from "lucide-react";
import type { StorefrontConfig } from "@/lib/client";

type Props = {
  config: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

const THEMES: { key: string; label: string; desc: string; accent: string }[] = [
  { key: "default", label: "Default", desc: "Clean glassmorphism", accent: "hsl(var(--kf-accent1))" },
  { key: "minimal", label: "Minimal", desc: "Airy & spacious", accent: "hsl(var(--kf-muted-foreground))" },
  { key: "bold", label: "Bold", desc: "Vibrant & impactful", accent: "hsl(var(--kf-accent1))" },
  { key: "elegant", label: "Elegant", desc: "Refined & luxurious", accent: "hsl(var(--kf-accent2))" },
];

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between w-full py-2 group"
    >
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      <div
        className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
        style={{ background: enabled ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? "left-[22px]" : "left-0.5"}`}
        />
      </div>
    </button>
  );
}

function CollapsibleSection({
  icon: Icon,
  title,
  subtitle,
  accent,
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  accent: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: `1px solid ${accent}`,
        boxShadow: `0 4px 24px hsl(var(--kf-accent1) / 0.05)`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: open ? `1px solid ${accent}` : "none",
          background: `linear-gradient(135deg, ${accent.replace("0.15", "0.06")}, transparent)`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: accent.replace("0.15", "0.15") }}
          >
            <Icon className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-5 space-y-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ThemeCard({
  theme,
  selected,
  onClick,
}: {
  theme: { key: string; label: string; desc: string; accent: string };
  selected: boolean;
  onClick: () => void;
}) {
  const isMinimal = theme.key === "minimal";
  const isBold = theme.key === "bold";
  const isElegant = theme.key === "elegant";

  const cardBg = isMinimal ? "transparent" : isBold ? "hsl(var(--kf-accent1) / 0.08)" : isElegant ? "hsl(var(--kf-muted) / 0.2)" : "hsl(var(--kf-muted) / 0.3)";
  const cardBorder = isMinimal ? "1px solid hsl(var(--kf-border) / 0.15)" : isBold ? "2px solid hsl(var(--kf-accent1) / 0.2)" : isElegant ? "1px solid hsl(var(--kf-border) / 0.2)" : "1px solid hsl(var(--kf-border) / 0.2)";
  const cardRadius = isElegant ? "rounded-2xl" : isBold ? "rounded-lg" : isMinimal ? "rounded-md" : "rounded-xl";
  const headerH = isBold ? "h-2.5" : "h-1.5";
  const headerW = isMinimal ? "w-1/2" : "w-3/4";
  const headerFont = isBold ? "font-black" : isElegant ? "font-serif" : isMinimal ? "font-light" : "font-bold";

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl p-2.5 text-left transition-all w-full group"
      style={{
        background: selected ? "hsl(var(--kf-accent1) / 0.1)" : "hsl(var(--kf-muted) / 0.2)",
        border: selected ? "2px solid hsl(var(--kf-accent1) / 0.5)" : "2px solid hsl(var(--kf-border) / 0.4)",
      }}
    >
      <div
        className="rounded-lg overflow-hidden mb-2"
        style={{ background: "#0a0a0f", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
      >
        <div className="p-2 space-y-1.5">
          {isBold && (
            <div className="h-3 rounded-md mb-1" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.08))" }} />
          )}
          <div className="flex items-center gap-1 mb-1">
            <div className={`w-3 h-3 ${isElegant ? "rounded-full" : "rounded"}`} style={{ background: "hsl(var(--kf-accent1) / 0.2)" }} />
            <div className={`${headerH} ${headerW} rounded-full`} style={{ background: `${theme.accent} / 0.5)`.replace("/ 0.5)", "").includes("--kf") ? theme.accent.replace(")", " / 0.5)") : "rgba(255,255,255,0.3)" }} />
          </div>
          <div className="flex gap-1">
            <div className={`h-8 flex-1 ${cardRadius}`} style={{ background: cardBg, border: cardBorder }} />
            <div className={`h-8 flex-1 ${cardRadius}`} style={{ background: cardBg, border: cardBorder }} />
          </div>
          <div className="flex gap-1">
            <div className={`h-8 flex-1 ${cardRadius}`} style={{ background: cardBg, border: cardBorder }} />
            <div className={`h-8 flex-1 ${cardRadius}`} style={{ background: cardBg, border: cardBorder }} />
          </div>
          {isBold && (
            <div className="h-2 rounded-lg mt-0.5" style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }} />
          )}
        </div>
      </div>
      <p className={`text-xs ${headerFont}`} style={{ color: selected ? "hsl(var(--kf-accent1))" : undefined }}>
        {theme.label}
      </p>
      <p className="text-[10px] text-muted-foreground leading-tight">{theme.desc}</p>
    </button>
  );
}

export function AppearanceCustomizer({ config, onConfigChange, onSave, saving }: Props) {
  const hero = config.hero ?? {};
  const appearance = config.appearance ?? {};
  const seo = config.seo ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paintbrush className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h2
            className="text-lg font-bold bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            Appearance
          </h2>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save All"}
        </button>
      </div>

      <CollapsibleSection
        icon={Type}
        title="Hero Section"
        subtitle="Customize your storefront headline and hero area"
        accent="hsl(var(--kf-accent1) / 0.15)"
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Headline</label>
            <input
              type="text"
              value={hero.headline ?? ""}
              onChange={(e) => onConfigChange("hero", { headline: e.target.value })}
              placeholder="Welcome to our store"
              className="kf-input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Subheadline</label>
            <input
              type="text"
              value={hero.subheadline ?? ""}
              onChange={(e) => onConfigChange("hero", { subheadline: e.target.value })}
              placeholder="Book services and shop products"
              className="kf-input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">CTA Button Label</label>
            <input
              type="text"
              value={hero.ctaLabel ?? ""}
              onChange={(e) => onConfigChange("hero", { ctaLabel: e.target.value })}
              placeholder="Browse Services"
              className="kf-input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Cover Image URL</label>
            <div className="flex gap-3 items-start">
              <input
                type="text"
                value={hero.coverImageUrl ?? ""}
                onChange={(e) => onConfigChange("hero", { coverImageUrl: e.target.value })}
                placeholder="https://example.com/cover.jpg"
                className="kf-input flex-1 text-sm"
              />
              {hero.coverImageUrl && (
                <div
                  className="h-14 w-20 rounded-lg overflow-hidden flex-shrink-0"
                  style={{ border: "1px solid hsl(var(--kf-border) / 0.5)" }}
                >
                  <img
                    src={hero.coverImageUrl}
                    alt="Cover preview"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}
            </div>
          </div>
          <div
            className="rounded-xl p-3 space-y-1"
            style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
          >
            <Toggle
              enabled={hero.showHours ?? true}
              onToggle={() => onConfigChange("hero", { showHours: !(hero.showHours ?? true) })}
              label="Show Business Hours"
            />
            <Toggle
              enabled={hero.showWhatsApp ?? true}
              onToggle={() => onConfigChange("hero", { showWhatsApp: !(hero.showWhatsApp ?? true) })}
              label="Show WhatsApp Chat"
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={Sparkles}
        title="Theme & Layout"
        subtitle="Choose a visual theme and layout preferences"
        accent="hsl(var(--kf-accent2) / 0.15)"
        defaultOpen={false}
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Theme Preset</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {THEMES.map((t) => (
                <ThemeCard
                  key={t.key}
                  theme={t}
                  selected={(appearance.theme ?? "default") === t.key}
                  onClick={() => onConfigChange("appearance", { theme: t.key })}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Card Style</label>
            <div className="flex gap-2">
              {(["grid", "list"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => onConfigChange("appearance", { cardStyle: style })}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: (appearance.cardStyle ?? "grid") === style
                      ? "hsl(var(--kf-accent2) / 0.12)"
                      : "hsl(var(--kf-muted) / 0.3)",
                    border: (appearance.cardStyle ?? "grid") === style
                      ? "1px solid hsl(var(--kf-accent2) / 0.4)"
                      : "1px solid hsl(var(--kf-border) / 0.5)",
                    color: (appearance.cardStyle ?? "grid") === style
                      ? "hsl(var(--kf-accent2))"
                      : undefined,
                  }}
                >
                  {style === "grid" ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
                  {style === "grid" ? "Grid" : "List"}
                </button>
              ))}
            </div>
          </div>

          <div
            className="rounded-xl p-3 space-y-1"
            style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
          >
            <Toggle
              enabled={appearance.showPrices ?? true}
              onToggle={() => onConfigChange("appearance", { showPrices: !(appearance.showPrices ?? true) })}
              label="Show Prices"
            />
            <Toggle
              enabled={appearance.showDuration ?? true}
              onToggle={() => onConfigChange("appearance", { showDuration: !(appearance.showDuration ?? true) })}
              label="Show Duration"
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={Globe}
        title="SEO Settings"
        subtitle="Optimize your store for search engines and social sharing"
        accent="hsl(var(--kf-accent1) / 0.15)"
        defaultOpen={false}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Meta Title</label>
            <input
              type="text"
              value={seo.metaTitle ?? ""}
              onChange={(e) => onConfigChange("seo", { metaTitle: e.target.value })}
              placeholder="Your Store Name - Book Services Online"
              className="kf-input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Meta Description
              <span
                className="ml-2 text-[10px] font-normal"
                style={{ color: (seo.metaDescription?.length ?? 0) > 160 ? "hsl(0 70% 55%)" : "hsl(var(--kf-muted-foreground))" }}
              >
                {seo.metaDescription?.length ?? 0}/160
              </span>
            </label>
            <textarea
              value={seo.metaDescription ?? ""}
              onChange={(e) => {
                if (e.target.value.length <= 160) {
                  onConfigChange("seo", { metaDescription: e.target.value });
                }
              }}
              placeholder="A brief description of your store for search engines..."
              className="kf-input w-full text-sm min-h-[80px] resize-none"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Social Share Image URL</label>
            <div className="flex gap-3 items-start">
              <input
                type="text"
                value={seo.socialImage ?? ""}
                onChange={(e) => onConfigChange("seo", { socialImage: e.target.value })}
                placeholder="https://example.com/og-image.jpg"
                className="kf-input flex-1 text-sm"
              />
              {seo.socialImage && (
                <div
                  className="h-14 w-20 rounded-lg overflow-hidden flex-shrink-0"
                  style={{ border: "1px solid hsl(var(--kf-border) / 0.5)" }}
                >
                  <img
                    src={seo.socialImage}
                    alt="Social preview"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
