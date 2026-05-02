"use client";

import { useState, useCallback } from "react";
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
  Image as ImageIcon,
  Zap,
  ChevronRight,
} from "lucide-react";
import type { StorefrontConfig, StorefrontHeroProofChip } from "@/lib/client";
import {
  getThemeStyles,
  type ThemeKey,
  STOREFRONT_MODELS,
  LEGACY_MODELS,
  BRAND_PALETTE_PRESETS,
  getAIPaletteForPersonality,
  getContrastRatio,
  getContrastGrade,
  type StorefrontModel,
} from "@/lib/storefront-themes";
import { FONT_PAIRINGS } from "./store-types";
import Image from "next/image";

type Props = {
  config: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, unknown>) => void;
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
  subtitle,
  children,
  defaultOpen = true,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
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
          <div className="text-left">
            <span className="text-sm font-semibold">{title}</span>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {badge && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
              style={{ background: "hsl(var(--kf-accent1)/0.12)", color: "hsl(var(--kf-accent1))" }}>
              {badge}
            </span>
          )}
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
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

function ModelMiniature({ modelKey, p, s, a }: MiniProps & { modelKey: ThemeKey }) {
  const isLuxury = ["luxury_editorial", "luxe"].includes(modelKey);
  const isBold = ["bold", "conversion_first"].includes(modelKey);
  const isMinimal = ["minimal", "luxury_editorial"].includes(modelKey);
  const radius = isLuxury ? "0px" : isBold ? "10px" : isMinimal ? "4px" : "8px";

  return (
    <div className="p-2 space-y-1.5">
      <div className="h-6 relative overflow-hidden" style={{
        borderRadius: radius,
        background: isBold
          ? `linear-gradient(135deg, ${p}25, ${s}12)`
          : `radial-gradient(ellipse at 50% 0%, ${p}18, transparent 80%)`,
        border: `1px solid ${p}15`,
      }}>
        <div className="absolute inset-0 flex items-center px-2 gap-1">
          <div className="h-1 w-8 rounded-full" style={{ background: isLuxury ? `${p}25` : "rgba(0,0,0,0.1)" }} />
          {!isMinimal && <div className="h-3 px-1.5 rounded-full ml-auto" style={{ background: isBold ? `${p}` : `${p}20`, border: `1px solid ${p}30` }} />}
        </div>
      </div>
      <div className="flex gap-1">
        {[p, s, a].map((c, n) => (
          <div key={n} className="flex-1 h-1 rounded-full" style={{ background: `${c}${n === 0 ? "30" : "15"}` }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div className="h-8 overflow-hidden" style={{ borderRadius: radius, background: `${p}08`, border: `1px solid ${p}18` }}>
          <div className="h-4 w-full" style={{ background: `${p}12` }} />
          <div className="px-1 pt-0.5 space-y-0.5">
            <div className="h-0.5 w-6 rounded-full" style={{ background: `${p}30` }} />
          </div>
        </div>
        <div className="h-8 overflow-hidden" style={{ borderRadius: radius, background: `${s}08`, border: `1px solid ${s}18` }}>
          <div className="h-4 w-full" style={{ background: `${s}12` }} />
          <div className="px-1 pt-0.5 space-y-0.5">
            <div className="h-0.5 w-5 rounded-full" style={{ background: `${s}30` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelCard({
  model,
  selected,
  onClick,
  primary,
  secondary,
  accent,
}: {
  model: StorefrontModel;
  selected: boolean;
  onClick: () => void;
  primary: string;
  secondary: string;
  accent: string;
}) {
  const ts = getThemeStyles(model.key, primary, secondary, accent);

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
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <ModelMiniature modelKey={model.key} p={primary} s={secondary} a={accent} />
      </div>

      <div className="px-1 pb-0.5">
        <p className="text-[11px] font-semibold mb-0.5">{model.label}</p>
        <p className="text-[9px] text-muted-foreground leading-snug">{model.tagline}</p>
      </div>
    </button>
  );
}

function ContrastIndicator({ hex1, hex2, label }: { hex1: string; hex2: string; label: string }) {
  const ratio = getContrastRatio(hex1, hex2);
  const { grade, pass } = getContrastGrade(ratio);
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono tabular-nums">{ratio.toFixed(1)}:1</span>
        <span
          className="px-1.5 py-0.5 rounded font-semibold"
          style={{
            background: pass ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            color: pass ? "#16a34a" : "#dc2626",
          }}
        >
          {grade}
        </span>
      </div>
    </div>
  );
}

function AIPalettePanel({
  onApply,
  currentPrimary,
}: {
  onApply: (primary: string, secondary: string, accent: string) => void;
  currentPrimary: string;
}) {
  const [personality, setPersonality] = useState("");
  const [suggestions, setSuggestions] = useState<typeof BRAND_PALETTE_PRESETS>([]);

  const handleGenerate = useCallback(() => {
    const results = getAIPaletteForPersonality(personality || currentPrimary);
    setSuggestions(results);
  }, [personality, currentPrimary]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="Describe your brand (e.g. luxury wellness, tech startup…)"
          className="kf-input flex-1 text-xs"
          onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
        />
        <button
          type="button"
          onClick={handleGenerate}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white transition-all hover:scale-[1.02]"
          style={{ background: "hsl(var(--kf-accent1))" }}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Suggest
        </button>
      </div>

      {suggestions.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {suggestions.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApply(preset.primary, preset.secondary, preset.accent)}
              className="flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:scale-[1.01]"
              style={{
                background: "hsl(var(--kf-muted)/0.15)",
                border: "1px solid hsl(var(--kf-border)/0.4)",
              }}
            >
              <div className="flex gap-1 flex-shrink-0">
                {[preset.primary, preset.secondary, preset.accent].map((c, i) => (
                  <div key={i} className="w-5 h-5 rounded-full" style={{ background: c }} />
                ))}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold">{preset.name}</p>
                <p className="text-[9px] text-muted-foreground truncate">{preset.personality}</p>
              </div>
              <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0 ml-auto" />
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {BRAND_PALETTE_PRESETS.slice(0, 4).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApply(preset.primary, preset.secondary, preset.accent)}
              className="flex items-center gap-2 p-2.5 rounded-xl text-left transition-all hover:scale-[1.01]"
              style={{
                background: "hsl(var(--kf-muted)/0.15)",
                border: "1px solid hsl(var(--kf-border)/0.4)",
              }}
            >
              <div className="flex gap-0.5 flex-shrink-0">
                {[preset.primary, preset.secondary, preset.accent].map((c, i) => (
                  <div key={i} className="w-3.5 h-3.5 rounded-full" style={{ background: c }} />
                ))}
              </div>
              <p className="text-[10px] font-medium truncate">{preset.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type ProofChip = StorefrontHeroProofChip;

export function AppearanceCustomizer({ config, onConfigChange, onSave, saving, businessData }: Props) {
  const hero = config.hero ?? {};
  const appearance = config.appearance ?? {};
  const seo = config.seo ?? {};

  const currentPrimary = appearance.primaryColor || businessData?.primaryColor || "#F97316";
  const currentSecondary = appearance.secondaryColor || businessData?.secondaryColor || "#14B8A6";
  const currentAccent = appearance.accentColor || "#a78bfa";

  const [showAllModels, setShowAllModels] = useState(false);
  const [showAIPalette, setShowAIPalette] = useState(false);

  const currentTheme = (appearance.theme ?? "conversion_first") as ThemeKey;

  const proofChips: ProofChip[] = hero.proofChips ?? [];

  const handleApplyPalette = useCallback((primary: string, secondary: string, accent: string) => {
    onConfigChange("appearance", { primaryColor: primary, secondaryColor: secondary, accentColor: accent });
    setShowAIPalette(false);
  }, [onConfigChange]);

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
            <h2 className="text-base font-bold">Design Mode</h2>
            <p className="text-[11px] text-muted-foreground">Build your storefront identity</p>
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

      <Section icon={Zap} title="Storefront Model" subtitle="Choose what this store is optimizing for" badge="New">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Each model configures layout priorities, hero hierarchy, CTA emphasis, and section sequencing for a specific commercial outcome.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" role="radiogroup" aria-label="Storefront model selection">
            {STOREFRONT_MODELS.map((model) => (
              <ModelCard
                key={model.key}
                model={model}
                selected={currentTheme === model.key}
                onClick={() => onConfigChange("appearance", { theme: model.key })}
                primary={currentPrimary || "#F97316"}
                secondary={currentSecondary || "#14B8A6"}
                accent={currentAccent || "#a78bfa"}
              />
            ))}
          </div>

          {LEGACY_MODELS.some((m) => m.key === currentTheme) && (
            <div
              className="rounded-xl px-3 py-2 text-[10px] flex items-start gap-2"
              style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)", color: "#a16207" }}
            >
              <span className="flex-shrink-0 mt-0.5">⚠️</span>
              <span>You are using a legacy theme. Switch to a storefront model above for full layout control and better conversion outcomes.</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowAllModels(!showAllModels)}
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors w-full justify-center py-1"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showAllModels ? "rotate-180" : ""}`} />
            {showAllModels ? "Hide" : "Show"} legacy themes (deprecated)
          </button>

          <AnimatePresence>
            {showAllModels && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="space-y-2">
                  <div
                    className="rounded-lg px-3 py-2 text-[10px]"
                    style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)", color: "#991b1b" }}
                  >
                    These legacy aesthetic skins are deprecated and do not support hero composer, section sequencing, or model-level conversion controls. Migrate to a storefront model for the full feature set.
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 opacity-60" role="radiogroup">
                    {LEGACY_MODELS.map((model) => (
                      <ModelCard
                        key={model.key}
                        model={model}
                        selected={currentTheme === model.key}
                        onClick={() => onConfigChange("appearance", { theme: model.key })}
                        primary={currentPrimary || "#F97316"}
                        secondary={currentSecondary || "#14B8A6"}
                        accent={currentAccent || "#a78bfa"}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {currentTheme && (
            <div
              className="rounded-xl p-3 space-y-2 mt-1"
              style={{ background: `${currentPrimary}08`, border: `1px solid ${currentPrimary}20` }}
            >
              {(() => {
                const allModels = [...STOREFRONT_MODELS, ...LEGACY_MODELS];
                const model = allModels.find((m) => m.key === currentTheme);
                if (!model) return null;
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <Zap className="w-3 h-3" style={{ color: currentPrimary }} />
                      <p className="text-[11px] font-semibold" style={{ color: currentPrimary }}>{model.label}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-1">
                      <div className="text-[10px] text-muted-foreground"><span className="font-medium text-foreground/60">Fit:</span> {model.businessFit}</div>
                      <div className="text-[10px] text-muted-foreground"><span className="font-medium text-foreground/60">Tone:</span> {model.visualTone}</div>
                      <div className="text-[10px] text-muted-foreground"><span className="font-medium text-foreground/60">Optimizes for:</span> {model.conversionEmphasis}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {model.bestFor.map((tag) => (
                        <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${currentPrimary}15`, color: currentPrimary }}>{tag}</span>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </Section>

      <Section icon={Palette} title="Brand Palette" subtitle="Colors, contrast validation, and AI suggestions">
        <div className="space-y-4">
          {businessData?.logoUrl && (
            <div className="flex items-center gap-3">
              <Image
                src={businessData.logoUrl}
                alt="Logo"
                className="w-10 h-10 rounded-xl object-cover"
                style={{ border: "1px solid hsl(var(--kf-border)/0.5)" }}
               width={40} height={40} unoptimized />
              <div>
                <p className="text-xs font-medium">{businessData.name || "Your Business"}</p>
                <p className="text-[10px] text-muted-foreground">Logo from your business settings</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: "primaryColor", label: "Primary", value: currentPrimary, default: "#F97316", hint: "Main CTAs & services" },
              { key: "secondaryColor", label: "Secondary", value: currentSecondary, default: "#14B8A6", hint: "Products & accents" },
              { key: "accentColor", label: "Accent", value: currentAccent, default: "#a78bfa", hint: "Packages & highlights" },
            ].map(({ key, label, value, default: def, hint }) => (
              <div key={key}>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
                <p className="text-[9px] text-muted-foreground mb-1.5">{hint}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={value || def}
                    onChange={(e) => onConfigChange("appearance", { [key]: e.target.value })}
                    className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent flex-shrink-0"
                  />
                  <input
                    type="text"
                    value={value || ""}
                    onChange={(e) => onConfigChange("appearance", { [key]: e.target.value })}
                    placeholder={def}
                    className="kf-input flex-1 min-w-0 text-xs font-mono"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 rounded-xl p-3" style={{ background: "hsl(var(--kf-muted)/0.1)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
            <p className="text-[10px] font-semibold text-muted-foreground mb-2">Contrast Check</p>
            <ContrastIndicator hex1={currentPrimary} hex2="#ffffff" label="Primary on white" />
            <ContrastIndicator hex1={currentSecondary} hex2="#ffffff" label="Secondary on white" />
            <ContrastIndicator hex1={currentAccent} hex2="#ffffff" label="Accent on white" />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAIPalette(!showAIPalette)}
              className="flex items-center gap-2 text-xs font-medium transition-all py-2 px-3 rounded-xl w-full"
              style={{
                background: showAIPalette ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.15)",
                border: `1px solid ${showAIPalette ? "hsl(var(--kf-accent1)/0.3)" : "hsl(var(--kf-border)/0.4)"}`,
                color: showAIPalette ? "hsl(var(--kf-accent1))" : undefined,
              }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI Palette Suggestions
              <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${showAIPalette ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {showAIPalette && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3">
                    <AIPalettePanel onApply={handleApplyPalette} currentPrimary={currentPrimary} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Section>

      <Section icon={ImageIcon} title="Hero Composer" subtitle="Headline, CTAs, proof chips, and cover media" badge="Enhanced">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
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
              <textarea
                value={hero.subheadline ?? ""}
                onChange={(e) => onConfigChange("hero", { subheadline: e.target.value })}
                placeholder={businessData?.tagline || "Book services and shop products"}
                className="kf-input w-full text-sm resize-none"
                rows={2}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Primary CTA</label>
              <input
                type="text"
                value={hero.ctaLabel ?? ""}
                onChange={(e) => onConfigChange("hero", { ctaLabel: e.target.value })}
                placeholder="Browse Services"
                className="kf-input w-full text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Secondary CTA</label>
              <input
                type="text"
                value={hero.secondaryCtaLabel ?? ""}
                onChange={(e) => onConfigChange("hero", { secondaryCtaLabel: e.target.value })}
                placeholder="Learn More"
                className="kf-input w-full text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Promotional Ribbon</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={hero.promotionalRibbon ?? ""}
                onChange={(e) => onConfigChange("hero", { promotionalRibbon: e.target.value })}
                placeholder="🔥 Limited time: 20% off all services this week"
                className="kf-input flex-1 text-sm"
              />
              <input
                type="color"
                value={hero.promotionalRibbonColor ?? "#f59e0b"}
                onChange={(e) => onConfigChange("hero", { promotionalRibbonColor: e.target.value })}
                className="w-9 h-9 rounded-lg cursor-pointer border-0 bg-transparent flex-shrink-0"
                title="Ribbon color"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Proof Chips</label>
            <p className="text-[10px] text-muted-foreground mb-2">Social proof signals shown below the headline (e.g. &quot;500+ clients&quot;, &quot;4.9 stars&quot;)</p>
            <div className="space-y-2">
              {proofChips.map((chip: ProofChip, idx: number) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={chip.icon ?? ""}
                    onChange={(e) => {
                      const updated = [...proofChips];
                      updated[idx] = { ...updated[idx], icon: e.target.value };
                      onConfigChange("hero", { proofChips: updated });
                    }}
                    placeholder="⭐"
                    className="kf-input w-12 text-center text-sm flex-shrink-0"
                  />
                  <input
                    type="text"
                    value={chip.label}
                    onChange={(e) => {
                      const updated = [...proofChips];
                      updated[idx] = { ...updated[idx], label: e.target.value };
                      onConfigChange("hero", { proofChips: updated });
                    }}
                    placeholder="500+ happy clients"
                    className="kf-input flex-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const updated = proofChips.filter((_: ProofChip, i: number) => i !== idx);
                      onConfigChange("hero", { proofChips: updated });
                    }}
                    className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                  >
                    ×
                  </button>
                </div>
              ))}
              {proofChips.length < 4 && (
                <button
                  type="button"
                  onClick={() => onConfigChange("hero", { proofChips: [...proofChips, { label: "", icon: "" }] })}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 py-1"
                >
                  + Add proof chip
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
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
                    <Image
                      src={hero.coverImageUrl}
                      alt="Cover preview"
                      className="h-full w-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                     fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Cover Video <span className="text-muted-foreground/60 font-normal">(overrides image when set)</span>
              </label>
              <input
                type="text"
                value={hero.coverVideoUrl ?? ""}
                onChange={(e) => onConfigChange("hero", { coverVideoUrl: e.target.value })}
                placeholder="https://example.com/cover.mp4"
                className="kf-input w-full text-sm"
              />
              {hero.coverVideoUrl && (
                <p className="text-[10px] text-muted-foreground/60 mt-1">Video will autoplay muted in a loop.</p>
              )}
            </div>
          </div>

          <div
            className="rounded-xl p-3 space-y-1"
            style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
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
      </Section>

      <Section icon={Type} title="Typography" subtitle="Font pairing with usage guidance" defaultOpen={false}>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Curated heading + body combinations. Each pairing is designed for a specific tone.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {FONT_PAIRINGS.map((pairing) => {
              const isActive = (appearance.fontPairing ?? "inter-inter") === pairing.id;
              return (
                <button
                  key={pairing.id}
                  type="button"
                  onClick={() => onConfigChange("appearance", { fontPairing: pairing.id })}
                  className="flex flex-col items-start gap-1.5 p-3 rounded-xl text-left transition-all relative"
                  style={{
                    background: isActive ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                    border: isActive ? "2px solid hsl(var(--kf-accent1)/0.4)" : "1px solid hsl(var(--kf-border)/0.5)",
                    padding: isActive ? "11px" : "12px",
                  }}
                >
                  {isActive && (
                    <div
                      className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: "hsl(var(--kf-accent1))" }}
                    >
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                  <span className="text-lg font-bold leading-tight" style={{ fontFamily: `'${pairing.heading}', sans-serif` }}>Aa</span>
                  <span className="text-[10px] text-muted-foreground leading-tight" style={{ fontFamily: `'${pairing.body}', sans-serif` }}>Body text</span>
                  <span className="text-[9px] font-semibold mt-0.5" style={{ color: isActive ? "hsl(var(--kf-accent1))" : undefined }}>{pairing.name}</span>
                  <span className="text-[8px] text-muted-foreground leading-tight">{pairing.heading}</span>
                </button>
              );
            })}
          </div>

          {(() => {
            const currentPairing = FONT_PAIRINGS.find((p) => p.id === (appearance.fontPairing ?? "inter-inter")) ?? FONT_PAIRINGS[0];
            return (
              <div className="rounded-xl p-4 space-y-2" style={{ background: "hsl(var(--kf-muted)/0.1)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Preview</p>
                <h3 className="text-xl font-bold" style={{ fontFamily: `'${currentPairing.heading}', sans-serif` }}>
                  {businessData?.name || "Your Business"}
                </h3>
                <p className="text-sm text-muted-foreground" style={{ fontFamily: `'${currentPairing.body}', sans-serif` }}>
                  {businessData?.tagline || "Premium services and products crafted for you."}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1" style={{ fontFamily: `'${currentPairing.body}', sans-serif` }}>
                  Heading: {currentPairing.heading} · Body: {currentPairing.body}
                </p>
              </div>
            );
          })()}
        </div>
      </Section>

      <Section icon={LayoutGrid} title="Layout & Density" subtitle="Card style, spacing, and display options" defaultOpen={false}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Card Style</label>
            <div className="grid grid-cols-2 gap-2">
              {(["grid", "list"] as const).map((style) => {
                const isActive = (appearance.cardStyle ?? "grid") === style;
                return (
                  <button
                    key={style}
                    type="button"
                    onClick={() => onConfigChange("appearance", { cardStyle: style })}
                    className="flex flex-col items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: isActive ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                      border: isActive ? "2px solid hsl(var(--kf-accent1)/0.3)" : "1px solid hsl(var(--kf-border)/0.5)",
                      color: isActive ? "hsl(var(--kf-accent1))" : undefined,
                    }}
                  >
                    {style === "grid" ? (
                      <>
                        <LayoutGrid className="w-5 h-5" />
                        <span className="text-xs">Grid</span>
                        <span className="text-[9px] text-muted-foreground">Visual cards</span>
                      </>
                    ) : (
                      <>
                        <List className="w-5 h-5" />
                        <span className="text-xs">List</span>
                        <span className="text-[9px] text-muted-foreground">Dense rows</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Content Density</label>
            <div className="flex gap-2">
              {([
                { key: "comfortable", label: "Comfortable", desc: "Spacious, airy" },
                { key: "compact", label: "Compact", desc: "Dense, efficient" },
              ] as const).map((opt) => {
                const isActive = (appearance.density ?? "comfortable") === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onConfigChange("appearance", { density: opt.key })}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: isActive ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                      border: isActive ? "1px solid hsl(var(--kf-accent1)/0.3)" : "1px solid hsl(var(--kf-border)/0.5)",
                      color: isActive ? "hsl(var(--kf-accent1))" : undefined,
                    }}
                  >
                    <div>{opt.label}</div>
                    <div className="text-[9px] text-muted-foreground">{opt.desc}</div>
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
          </div>
        </div>
      </Section>

      <Section icon={LayoutGrid} title="Section Styles" subtitle="Per-section emphasis and layout" defaultOpen={false}>
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Catalog Section</p>
            <div
              className="rounded-xl p-3 space-y-1"
              style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
            >
              <Toggle
                enabled={(config.sectionStyles?.catalog?.showSectionHeader) ?? true}
                onToggle={() => onConfigChange("sectionStyles", { catalog: { ...(config.sectionStyles?.catalog ?? {}), showSectionHeader: !((config.sectionStyles?.catalog?.showSectionHeader) ?? true) } })}
                label="Show Section Header"
              />
              <Toggle
                enabled={(config.sectionStyles?.catalog?.sectionHeaderEmphasis) ?? false}
                onToggle={() => onConfigChange("sectionStyles", { catalog: { ...(config.sectionStyles?.catalog ?? {}), sectionHeaderEmphasis: !((config.sectionStyles?.catalog?.sectionHeaderEmphasis) ?? false) } })}
                label="Accent Header Color"
              />
            </div>
            {(config.sectionStyles?.catalog?.showSectionHeader ?? true) && (
              <div className="mt-2">
                <input
                  type="text"
                  value={config.sectionStyles?.catalog?.sectionHeaderLabel ?? ""}
                  onChange={(e) => onConfigChange("sectionStyles", { catalog: { ...(config.sectionStyles?.catalog ?? {}), sectionHeaderLabel: e.target.value } })}
                  placeholder="Browse & Book"
                  className="kf-input w-full text-sm"
                />
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Trust Bar</p>
            <div
              className="rounded-xl p-3 space-y-1"
              style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
            >
              <Toggle
                enabled={(config.sectionStyles?.trust?.showPaymentBadge) ?? true}
                onToggle={() => onConfigChange("sectionStyles", { trust: { ...(config.sectionStyles?.trust ?? {}), showPaymentBadge: !((config.sectionStyles?.trust?.showPaymentBadge) ?? true) } })}
                label="Show Payment Badge"
              />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold mb-2 text-muted-foreground uppercase tracking-wide">FAQ Section</p>
            <div
              className="rounded-xl p-3 space-y-1"
              style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
            >
              <Toggle
                enabled={(config.sectionStyles?.faq?.showIcon) !== false}
                onToggle={() => onConfigChange("sectionStyles", { faq: { ...(config.sectionStyles?.faq ?? {}), showIcon: !((config.sectionStyles?.faq?.showIcon) !== false) } })}
                label="Show Section Icon"
              />
            </div>
            <div className="mt-2">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">FAQ Layout</label>
              <div className="flex gap-2">
                {([
                  { key: "accordion", label: "Accordion", desc: "Expandable items" },
                  { key: "grid", label: "Compact", desc: "Dense layout" },
                ] as const).map((opt) => {
                  const isActive = (config.sectionStyles?.faq?.style ?? "accordion") === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onConfigChange("sectionStyles", { faq: { ...(config.sectionStyles?.faq ?? {}), style: opt.key } })}
                      className="flex-1 py-2 rounded-xl text-xs font-medium transition-all"
                      style={{
                        background: isActive ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                        border: isActive ? "1px solid hsl(var(--kf-accent1)/0.3)" : "1px solid hsl(var(--kf-border)/0.5)",
                        color: isActive ? "hsl(var(--kf-accent1))" : undefined,
                      }}
                    >
                      <div>{opt.label}</div>
                      <div className="text-[9px] text-muted-foreground">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Hero Section</p>
            <div
              className="rounded-xl p-3 space-y-1"
              style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)" }}
            >
              <Toggle
                enabled={(config.sectionStyles?.hero?.showScrollCta) !== false}
                onToggle={() => onConfigChange("sectionStyles", { hero: { ...(config.sectionStyles?.hero ?? {}), showScrollCta: !((config.sectionStyles?.hero?.showScrollCta) !== false) } })}
                label="Show 'Browse Services' CTA"
              />
            </div>
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
                  <Image
                    src={seo.socialImage}
                    alt="Social preview"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                   fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                </div>
              )}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
