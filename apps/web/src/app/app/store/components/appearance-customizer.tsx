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

const TEMPLATES: { key: string; label: string; desc: string; style: string }[] = [
  { key: "default", label: "Classic", desc: "Clean, professional storefront", style: "Glassmorphism cards, rounded corners, pill tabs" },
  { key: "minimal", label: "Minimal", desc: "Airy, whitespace-focused design", style: "Transparent cards, underline nav, light fonts" },
  { key: "bold", label: "Bold", desc: "High-impact, vibrant energy", style: "Gradient accents, uppercase headers, block tabs" },
  { key: "elegant", label: "Elegant", desc: "Refined luxury aesthetic", style: "Serif fonts, italic text, chip navigation" },
  { key: "luxe", label: "Luxe", desc: "Premium high-end brand feel", style: "Cinematic hero, editorial layout, spaced type" },
  { key: "fresh", label: "Fresh", desc: "Modern, startup-style clean", style: "Soft shadows, rounded elements, warm glow" },
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

function TemplatePreview({ template, selected, onClick }: {
  template: typeof TEMPLATES[number];
  selected: boolean;
  onClick: () => void;
}) {
  const isMinimal = template.key === "minimal";
  const isBold = template.key === "bold";
  const isElegant = template.key === "elegant";
  const isLuxe = template.key === "luxe";
  const isFresh = template.key === "fresh";

  const cardRadius = isElegant || isLuxe ? "rounded-2xl" : isBold ? "rounded-lg" : isMinimal ? "rounded-md" : "rounded-xl";
  const headerBar = isBold ? "h-1.5 w-2/3" : isMinimal ? "h-1 w-1/2" : isLuxe ? "h-1 w-1/3" : "h-1 w-1/2";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="rounded-xl text-left transition-all w-full group relative"
      style={{
        background: selected ? "hsl(var(--kf-accent1)/0.08)" : "hsl(var(--kf-card))",
        border: selected ? "2px solid hsl(var(--kf-accent1)/0.4)" : "1px solid hsl(var(--kf-border)/0.5)",
        padding: selected ? "7px" : "8px",
      }}
    >
      {selected && (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center z-10"
          style={{ background: "hsl(var(--kf-accent1))" }}
        >
          <Check className="w-3 h-3 text-white" />
        </div>
      )}

      <div
        className="rounded-lg overflow-hidden mb-2.5"
        style={{ background: "#08080c", border: "1px solid hsl(var(--kf-border)/0.2)" }}
      >
        <div className="p-2.5 space-y-1.5">
          {(isBold || isLuxe) && (
            <div
              className="h-4 rounded-md"
              style={{
                background: isLuxe
                  ? "linear-gradient(180deg, rgba(255,255,255,0.06), transparent)"
                  : "linear-gradient(135deg, hsl(var(--kf-accent1)/0.12), hsl(var(--kf-accent2)/0.06))",
              }}
            />
          )}
          <div className="flex items-center gap-1.5">
            <div className={`w-3 h-3 ${isElegant || isLuxe ? "rounded-full" : "rounded"}`} style={{ background: "hsl(var(--kf-accent1)/0.2)" }} />
            <div className={`${headerBar} rounded-full`} style={{ background: "rgba(255,255,255,0.2)" }} />
          </div>
          <div className={`flex gap-1.5 ${isLuxe ? "mt-1" : ""}`}>
            <div className={`h-9 flex-1 ${cardRadius}`} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
            <div className={`h-9 flex-1 ${cardRadius}`} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
          </div>
          {isFresh && (
            <div className="flex gap-1.5">
              <div className="h-9 flex-1 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
              <div className="h-9 flex-1 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
            </div>
          )}
          <div className="flex gap-1">
            <div className="h-1 flex-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="h-1 w-8 rounded-full" style={{ background: "hsl(var(--kf-accent1)/0.15)" }} />
          </div>
        </div>
      </div>

      <p className="text-xs font-semibold mb-0.5">{template.label}</p>
      <p className="text-[10px] text-muted-foreground leading-snug">{template.desc}</p>
    </button>
  );
}

export function AppearanceCustomizer({ config, onConfigChange, onSave, saving, businessData }: Props) {
  const hero = config.hero ?? {};
  const appearance = config.appearance ?? {};
  const seo = config.seo ?? {};

  const currentPrimary = (appearance as any).primaryColor || businessData?.primaryColor || "";
  const currentSecondary = (appearance as any).secondaryColor || businessData?.secondaryColor || "";

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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Primary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentPrimary || "#e8863a"}
                  onChange={(e) => onConfigChange("appearance", { primaryColor: e.target.value })}
                  className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
                />
                <input
                  type="text"
                  value={currentPrimary || ""}
                  onChange={(e) => onConfigChange("appearance", { primaryColor: e.target.value })}
                  placeholder="From settings"
                  className="kf-input flex-1 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Secondary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentSecondary || "#d4a574"}
                  onChange={(e) => onConfigChange("appearance", { secondaryColor: e.target.value })}
                  className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
                />
                <input
                  type="text"
                  value={currentSecondary || ""}
                  onChange={(e) => onConfigChange("appearance", { secondaryColor: e.target.value })}
                  placeholder="From settings"
                  className="kf-input flex-1 text-xs"
                />
              </div>
            </div>
          </div>

          {(!currentPrimary && businessData?.primaryColor) && (
            <p className="text-[10px] text-muted-foreground">
              Using brand colors from your business settings. Override above to customize for your store.
            </p>
          )}
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
