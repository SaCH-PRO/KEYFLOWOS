"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Paintbrush,
  Type,
  LayoutGrid,
  List,
  Globe,
  ChevronDown,
  Save,
  Loader2,
  Sparkles,
  Palette,
  Check,
} from "lucide-react";
import type { StorefrontConfig } from "@/lib/client";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";

type Props = {
  config: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  businessData?: {
    name?: string;
    logoUrl?: string | null;
    tagline?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
  } | null;
};

const TEMPLATES: { key: string; label: string; desc: string; inspiration: string }[] = [
  { key: "default", label: "Classic", desc: "Clean, versatile, professional", inspiration: "Shopify Dawn" },
  { key: "minimal", label: "Minimal", desc: "Zen-like, content-first", inspiration: "Aesop" },
  { key: "bold", label: "Bold", desc: "High-energy, statement-making", inspiration: "Nike" },
  { key: "elegant", label: "Elegant", desc: "Refined editorial luxury", inspiration: "Net-a-Porter" },
  { key: "luxe", label: "Luxe", desc: "Cinematic, dark & moody", inspiration: "Aman Resorts" },
  { key: "fresh", label: "Fresh", desc: "Friendly, modern & playful", inspiration: "Glossier" },
];

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className="flex items-center justify-between w-full py-2.5 group"
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

function Section({
  icon: Icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border)/0.5)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)]"
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="px-5 pb-5 pt-1 space-y-4"
              style={{ borderTop: "1px solid hsl(var(--kf-border)/0.3)" }}
            >
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type MiniProps = { p: string; s: string; a: string };

function ClassicMiniature({ p, s, a }: MiniProps) {
  return (
    <div className="p-2 space-y-1.5">
      <div className="h-5 rounded-lg" style={{ background: `radial-gradient(ellipse at 50% 0%, ${p}25, transparent 80%)` }} />
      <div className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-md" style={{ background: `${p}40` }} />
        <div className="h-1 w-10 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
      </div>
      <div className="flex gap-1 px-0.5">
        {[p, s, a].map((c, n) => (
          <div key={n} className="flex-1 space-y-1">
            <div className="h-1 rounded-full" style={{ background: `${c}12`, width: n === 1 ? "70%" : "100%" }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div className="h-8 rounded-lg" style={{ background: `${p}06`, border: `1px solid ${p}15` }} />
        <div className="h-8 rounded-lg" style={{ background: `${s}06`, border: `1px solid ${s}15` }} />
      </div>
      <div className="flex justify-end">
        <div className="h-1 w-6 rounded-full" style={{ background: `${p}20` }} />
      </div>
    </div>
  );
}

function MinimalMiniature({ p, s, a }: MiniProps) {
  return (
    <div className="p-3 space-y-2.5">
      <div className="space-y-1.5">
        <div className="h-0.5 w-6 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
        <div className="h-0.5 w-14 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />
      </div>
      <div className="h-px" style={{ background: `${p}08` }} />
      <div className="flex gap-3 px-0.5 mb-1">
        <div className="h-px flex-1" style={{ borderBottom: `1px solid ${p}20` }} />
        <div className="h-px flex-1" style={{ borderBottom: `1px solid ${a}10` }} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <div className="h-10 rounded-sm" style={{ background: `${p}04`, border: `1px solid ${p}08` }} />
          <div className="h-0.5 w-8" style={{ background: `${p}12` }} />
          <div className="h-0.5 w-4" style={{ background: `${a}08` }} />
        </div>
        <div className="space-y-1.5">
          <div className="h-10 rounded-sm" style={{ background: `${s}04`, border: `1px solid ${s}08` }} />
          <div className="h-0.5 w-6" style={{ background: `${s}12` }} />
          <div className="h-0.5 w-3" style={{ background: `${a}08` }} />
        </div>
      </div>
    </div>
  );
}

function BoldMiniature({ p, s, a }: MiniProps) {
  return (
    <div className="space-y-1">
      <div className="h-6 relative overflow-hidden" style={{ background: `linear-gradient(160deg, ${p}30, ${s}15 60%, ${a}0A)` }}>
        <div className="absolute bottom-1 left-2">
          <div className="h-1.5 w-8 rounded-sm" style={{ background: "rgba(255,255,255,0.3)" }} />
        </div>
      </div>
      <div className="px-2 pb-2 space-y-1">
        <div className="flex gap-1">
          <div className="h-2.5 px-2 rounded-xl" style={{ background: `${p}30`, border: `1px solid ${p}50` }} />
          <div className="h-2.5 px-2 rounded-xl" style={{ background: `${a}15` }} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div className="h-9 rounded-2xl" style={{ background: `${p}0C`, border: `2px solid ${p}25` }} />
          <div className="h-9 rounded-2xl" style={{ background: `${a}0C`, border: `2px solid ${a}25` }} />
        </div>
        <div className="h-1.5 w-10 rounded-sm" style={{ background: `linear-gradient(to right, ${p}, ${s}, ${a})`, opacity: 0.4 }} />
      </div>
    </div>
  );
}

function ElegantMiniature({ p, s, a }: MiniProps) {
  return (
    <div className="p-2.5 space-y-2">
      <div className="text-center space-y-1">
        <div className="h-0.5 w-4 rounded-full mx-auto" style={{ background: `${s}20` }} />
        <div className="h-0.5 w-10 rounded-full mx-auto" style={{ background: "rgba(255,255,255,0.06)" }} />
      </div>
      <div className="flex gap-2 justify-center">
        {[p, s, a].map((c, n) => (
          <div key={n} className="h-2 px-1.5 rounded-full" style={{ background: n === 0 ? `${c}18` : `${c}06`, border: `1px solid ${n === 0 ? `${c}30` : `${c}0A`}` }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="h-10 rounded-3xl" style={{ background: `${p}04`, border: `1px solid ${s}12`, boxShadow: `0 2px 8px ${p}10` }} />
        <div className="h-10 rounded-3xl" style={{ background: `${s}04`, border: `1px solid ${s}12`, boxShadow: `0 2px 8px ${s}10` }} />
      </div>
    </div>
  );
}

function LuxeMiniature({ p, s, a }: MiniProps) {
  return (
    <div className="space-y-0">
      <div className="h-10 relative" style={{ background: `linear-gradient(180deg, ${p}08, rgba(0,0,0,0.5))` }}>
        <div className="absolute bottom-1.5 left-2.5 space-y-0.5">
          <div className="h-0.5 w-8" style={{ background: "rgba(255,255,255,0.25)" }} />
          <div className="h-0.5 w-5" style={{ background: `${s}18` }} />
        </div>
        <div className="absolute bottom-1 right-2">
          <div className="w-1.5 h-1.5" style={{ background: `${a}20` }} />
        </div>
      </div>
      <div className="px-2.5 py-2 space-y-1.5">
        <div className="flex gap-2">
          <div className="h-0.5 w-4" style={{ borderBottom: `1px solid ${p}30` }} />
          <div className="h-0.5 w-4" style={{ borderBottom: `1px solid ${a}15` }} />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="h-8" style={{ background: `${p}06`, border: `1px solid ${s}12` }} />
          <div className="h-8" style={{ background: `${a}06`, border: `1px solid ${a}12` }} />
        </div>
      </div>
    </div>
  );
}

function FreshMiniature({ p, s, a }: MiniProps) {
  return (
    <div className="p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full" style={{ background: `${p}25` }} />
        <div className="h-1 w-8 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        <div className="ml-auto flex gap-0.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: `${s}20` }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: `${a}20` }} />
        </div>
      </div>
      <div className="h-4 rounded-full" style={{ background: `${p}08`, border: `1px solid ${p}12` }} />
      <div className="flex gap-1">
        <div className="h-2 px-1 rounded-full" style={{ background: `${p}18` }} />
        <div className="h-2 px-1.5 rounded-full" style={{ background: `${s}0A` }} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="h-9 rounded-2xl" style={{ background: `${p}08`, border: `1px solid ${p}12`, boxShadow: `0 2px 8px ${p}10` }} />
        <div className="h-9 rounded-2xl" style={{ background: `${s}08`, border: `1px solid ${s}12`, boxShadow: `0 2px 8px ${s}10` }} />
      </div>
    </div>
  );
}

const MINIATURES: Record<string, React.FC<MiniProps>> = {
  default: ClassicMiniature,
  minimal: MinimalMiniature,
  bold: BoldMiniature,
  elegant: ElegantMiniature,
  luxe: LuxeMiniature,
  fresh: FreshMiniature,
};

function TemplatePreview({ template, selected, onClick, primary, secondary, accent }: {
  template: typeof TEMPLATES[number];
  selected: boolean;
  onClick: () => void;
  primary: string;
  secondary: string;
  accent: string;
}) {
  const Mini = MINIATURES[template.key] ?? ClassicMiniature;
  const ts = getThemeStyles(template.key as ThemeKey, primary, secondary, accent);

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="rounded-xl text-left transition-all w-full group relative"
      style={{
        background: selected ? "hsl(var(--kf-accent1)/0.06)" : "hsl(var(--kf-card))",
        border: selected ? `2px solid ${primary}66` : "1px solid hsl(var(--kf-border)/0.4)",
        padding: selected ? "5px" : "6px",
      }}
    >
      {selected && (
        <div
          className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center z-10"
          style={{ background: primary }}
        >
          <Check className="w-2.5 h-2.5 text-white" />
        </div>
      )}

      <div
        className="rounded-lg overflow-hidden mb-2"
        style={{
          backgroundColor: ts.pageBg,
          backgroundImage: ts.pageGradient,
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Mini p={primary} s={secondary} a={accent} />
      </div>

      <div className="px-1 pb-0.5">
        <p className="text-[11px] font-semibold mb-0.5">{template.label}</p>
        <p className="text-[9px] text-muted-foreground leading-snug">{template.desc}</p>
      </div>
    </button>
  );
}

export function AppearanceCustomizer({ config, onConfigChange, onSave, saving, businessData }: Props) {
  const hero = config.hero ?? {};
  const appearance = config.appearance ?? {};
  const seo = config.seo ?? {};

  const currentPrimary = appearance.primaryColor || businessData?.primaryColor || "";
  const currentSecondary = appearance.secondaryColor || businessData?.secondaryColor || "";
  const currentAccent = appearance.accentColor || "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
          >
            <Paintbrush className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h2 className="text-base font-bold">Customize</h2>
            <p className="text-[11px] text-muted-foreground">Design your storefront</p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: "hsl(var(--kf-accent1))" }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <Section icon={Sparkles} title="Template">
        <div>
          <p className="text-xs text-muted-foreground mb-3">Choose a design template for your public storefront</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" role="radiogroup" aria-label="Template selection">
            {TEMPLATES.map((t) => (
              <TemplatePreview
                key={t.key}
                template={t}
                selected={(appearance.theme ?? "default") === t.key}
                onClick={() => onConfigChange("appearance", { theme: t.key })}
                primary={currentPrimary || "#F97316"}
                secondary={currentSecondary || "#14B8A6"}
                accent={currentAccent || "#a78bfa"}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section icon={Palette} title="Branding">
        <div className="space-y-4">
          {businessData?.logoUrl && (
            <div className="flex items-center gap-3">
              <img
                src={businessData.logoUrl}
                alt="Logo"
                className="w-10 h-10 rounded-xl object-cover"
                style={{ border: "1px solid hsl(var(--kf-border)/0.5)" }}
              />
              <div>
                <p className="text-xs font-medium">{businessData.name || "Your Business"}</p>
                <p className="text-[10px] text-muted-foreground">Logo from your business settings</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Primary</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentPrimary || "#e8863a"}
                  onChange={(e) => onConfigChange("appearance", { primaryColor: e.target.value })}
                  className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent flex-shrink-0"
                />
                <input
                  type="text"
                  value={currentPrimary || ""}
                  onChange={(e) => onConfigChange("appearance", { primaryColor: e.target.value })}
                  placeholder="Auto"
                  className="kf-input flex-1 min-w-0 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Secondary</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentSecondary || "#d4a574"}
                  onChange={(e) => onConfigChange("appearance", { secondaryColor: e.target.value })}
                  className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent flex-shrink-0"
                />
                <input
                  type="text"
                  value={currentSecondary || ""}
                  onChange={(e) => onConfigChange("appearance", { secondaryColor: e.target.value })}
                  placeholder="Auto"
                  className="kf-input flex-1 min-w-0 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Accent</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentAccent || "#a78bfa"}
                  onChange={(e) => onConfigChange("appearance", { accentColor: e.target.value })}
                  className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent flex-shrink-0"
                />
                <input
                  type="text"
                  value={currentAccent || ""}
                  onChange={(e) => onConfigChange("appearance", { accentColor: e.target.value })}
                  placeholder="#a78bfa"
                  className="kf-input flex-1 min-w-0 text-xs"
                />
              </div>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Your brand colors are used throughout the storefront. Primary for services, secondary for products, accent for packages.
          </p>
        </div>
      </Section>

      <Section icon={Type} title="Hero Section">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Headline</label>
            <input
              type="text"
              value={hero.headline ?? ""}
              onChange={(e) => onConfigChange("hero", { headline: e.target.value })}
              placeholder={businessData?.name ? `Welcome to ${businessData.name}` : "Welcome to our store"}
              className="kf-input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Subheadline</label>
            <input
              type="text"
              value={hero.subheadline ?? ""}
              onChange={(e) => onConfigChange("hero", { subheadline: e.target.value })}
              placeholder={businessData?.tagline || "Book services and shop products"}
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
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Cover Image</label>
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
                  style={{ border: "1px solid hsl(var(--kf-border)/0.5)" }}
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
        </div>
      </Section>

      <Section icon={LayoutGrid} title="Layout & Display" defaultOpen={false}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Card Style</label>
            <div className="flex gap-2">
              {(["grid", "list"] as const).map((style) => {
                const isActive = (appearance.cardStyle ?? "grid") === style;
                return (
                  <button
                    key={style}
                    type="button"
                    onClick={() => onConfigChange("appearance", { cardStyle: style })}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: isActive ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                      border: isActive ? "1px solid hsl(var(--kf-accent1)/0.3)" : "1px solid hsl(var(--kf-border)/0.5)",
                      color: isActive ? "hsl(var(--kf-accent1))" : undefined,
                    }}
                  >
                    {style === "grid" ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
                    {style === "grid" ? "Grid" : "List"}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Content Density</label>
            <div className="flex gap-2">
              {([
                { key: "comfortable", label: "Comfortable" },
                { key: "compact", label: "Compact" },
              ] as const).map((opt) => {
                const isActive = (appearance.density ?? "comfortable") === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onConfigChange("appearance", { density: opt.key })}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: isActive ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                      border: isActive ? "1px solid hsl(var(--kf-accent1)/0.3)" : "1px solid hsl(var(--kf-border)/0.5)",
                      color: isActive ? "hsl(var(--kf-accent1))" : undefined,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">Controls card spacing and padding on the public storefront</p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Font Family</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "system", label: "System", preview: "Aa" },
                { key: "sans", label: "Sans Serif", preview: "Aa" },
                { key: "serif", label: "Serif", preview: "Aa" },
              ] as const).map((font) => {
                const isActive = (appearance.fontFamily ?? "system") === font.key;
                const fontClass = font.key === "serif" ? "font-serif" : font.key === "sans" ? "font-sans" : "";
                return (
                  <button
                    key={font.key}
                    type="button"
                    onClick={() => onConfigChange("appearance", { fontFamily: font.key })}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium transition-all"
                    style={{
                      background: isActive ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                      border: isActive ? "1px solid hsl(var(--kf-accent1)/0.3)" : "1px solid hsl(var(--kf-border)/0.5)",
                      color: isActive ? "hsl(var(--kf-accent1))" : undefined,
                    }}
                  >
                    <span className={`text-lg ${fontClass}`}>{font.preview}</span>
                    <span>{font.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="rounded-xl p-3 space-y-1"
            style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
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
      </Section>

      <Section icon={Globe} title="SEO" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Meta Title</label>
            <input
              type="text"
              value={seo.metaTitle ?? ""}
              onChange={(e) => onConfigChange("seo", { metaTitle: e.target.value })}
              placeholder={businessData?.name ? `${businessData.name} - Book Online` : "Your Store Name - Book Services Online"}
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
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Social Share Image</label>
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
                  style={{ border: "1px solid hsl(var(--kf-border)/0.5)" }}
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
      </Section>
    </div>
  );
}
