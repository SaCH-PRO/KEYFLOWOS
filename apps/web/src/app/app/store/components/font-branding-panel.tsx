"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Type, Save, Loader2, Check, Palette } from "lucide-react";
import type { StorefrontConfig } from "@/lib/client";
import { FONT_PAIRINGS } from "./store-types";

type Props = {
  config: StorefrontConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  businessData?: {
    name?: string;
    tagline?: string | null;
  } | null;
};

const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato:wght@400&family=Poppins:wght@700&family=Open+Sans:wght@400&family=Montserrat:wght@700&family=Roboto:wght@400&family=DM+Serif+Display&family=DM+Sans:wght@400&family=Raleway:wght@700&family=Merriweather:wght@400&family=Space+Grotesk:wght@700&family=Work+Sans:wght@400&family=Cormorant+Garamond:wght@700&family=Proza+Libre:wght@400&family=Sora:wght@700&family=Crimson+Pro:wght@700&family=Source+Sans+3:wght@400&display=swap";

export function FontBrandingPanel({ config, onConfigChange, onSave, saving, businessData }: Props) {
  const currentPairing = config.appearance?.fontPairing ?? "inter-inter";
  const [, setFontsLoaded] = useState(false);

  useEffect(() => {
    if (document.querySelector('link[data-font-pairings]')) {
      setFontsLoaded(true);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    link.setAttribute("data-font-pairings", "true");
    link.onload = () => setFontsLoaded(true);
    document.head.appendChild(link);
  }, []);

  const selectedPairing = FONT_PAIRINGS.find((p) => p.id === currentPairing) ?? FONT_PAIRINGS[0];
  const previewName = businessData?.name || "Your Business";
  const previewTagline = businessData?.tagline || "Quality products and services";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent1) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent1) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
          >
            <Type className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Font Pairing</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Choose a curated heading + body font combination
            </p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {FONT_PAIRINGS.map((pairing) => {
            const isSelected = currentPairing === pairing.id;
            return (
              <button
                key={pairing.id}
                type="button"
                onClick={() => onConfigChange("appearance", { fontPairing: pairing.id })}
                className="rounded-xl text-left transition-all relative group"
                style={{
                  background: isSelected
                    ? "hsl(var(--kf-accent1) / 0.08)"
                    : "hsl(var(--kf-muted) / 0.15)",
                  border: isSelected
                    ? "2px solid hsl(var(--kf-accent1) / 0.4)"
                    : "1px solid hsl(var(--kf-border) / 0.3)",
                  padding: isSelected ? "11px" : "12px",
                }}
              >
                {isSelected && (
                  <div
                    className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center z-10"
                    style={{ background: "hsl(var(--kf-accent1))" }}
                  >
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <p
                    className="text-base font-bold leading-tight truncate"
                    style={{ fontFamily: `'${pairing.heading}', sans-serif` }}
                  >
                    Aa
                  </p>
                  <p
                    className="text-[10px] text-muted-foreground leading-tight"
                    style={{ fontFamily: `'${pairing.body}', sans-serif` }}
                  >
                    Body text
                  </p>
                  <p className="text-[9px] font-medium text-muted-foreground mt-1">{pairing.name}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div
          className="rounded-xl p-5 space-y-2"
          style={{
            background: "hsl(var(--kf-muted) / 0.1)",
            border: "1px solid hsl(var(--kf-border) / 0.3)",
          }}
        >
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-3">
            Live Preview
          </p>
          <h3
            className="text-xl font-bold"
            style={{ fontFamily: `'${selectedPairing.heading}', sans-serif` }}
          >
            {previewName}
          </h3>
          <p
            className="text-sm text-muted-foreground"
            style={{ fontFamily: `'${selectedPairing.body}', sans-serif` }}
          >
            {previewTagline}
          </p>
          <p
            className="text-xs text-muted-foreground/60 mt-2"
            style={{ fontFamily: `'${selectedPairing.body}', sans-serif` }}
          >
            Browse our collection of premium products and services. Each item is carefully curated to
            ensure the highest quality for our valued customers.
          </p>
          <div className="flex items-center gap-2 pt-2 text-[10px] text-muted-foreground">
            <Palette className="w-3 h-3" />
            <span>
              Heading: {selectedPairing.heading} &middot; Body: {selectedPairing.body}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
