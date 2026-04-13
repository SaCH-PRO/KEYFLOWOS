"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Facebook, Instagram, Mail, MessageCircle, Globe,
  ChevronDown, ChevronUp, Copy, Wand2, RotateCcw,
  Check, AlertCircle,
} from "lucide-react";
import type { ChannelDestination } from "@/lib/client";

interface VariantData {
  destinationId: string;
  platform: string;
  body: string;
  subject?: string;
  customized: boolean;
}

interface ChannelVariantsPanelProps {
  masterBody: string;
  masterSubject?: string;
  selectedDestinations: ChannelDestination[];
  variants: VariantData[];
  onVariantsChange: (variants: VariantData[]) => void;
}

const PLATFORM_META: Record<string, { icon: React.ElementType; color: string; label: string; charLimit?: number }> = {
  FACEBOOK: { icon: Facebook, color: "#1877F2", label: "Facebook", charLimit: 63206 },
  INSTAGRAM: { icon: Instagram, color: "#E4405F", label: "Instagram", charLimit: 2200 },
  GOOGLE: { icon: Mail, color: "#F97316", label: "Email" },
  EMAIL: { icon: Mail, color: "#F97316", label: "Email" },
  WHATSAPP: { icon: MessageCircle, color: "#25D366", label: "WhatsApp", charLimit: 4096 },
  META: { icon: Globe, color: "#0668E1", label: "Meta" },
};

function getPlatformMeta(platform: string) {
  return PLATFORM_META[platform.toUpperCase()] || { icon: Globe, color: "#94a3b8", label: platform };
}

export function ChannelVariantsPanel({
  masterBody,
  masterSubject,
  selectedDestinations,
  variants,
  onVariantsChange,
}: ChannelVariantsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const updated = selectedDestinations.map((dest) => {
      const existing = variants.find((v) => v.destinationId === dest.id);
      if (existing) return existing;
      return {
        destinationId: dest.id,
        platform: dest.platform,
        body: masterBody,
        subject: masterSubject,
        customized: false,
      };
    });
    const destIds = new Set(selectedDestinations.map((d) => d.id));
    const filtered = updated.filter((v) => destIds.has(v.destinationId));
    if (JSON.stringify(filtered) !== JSON.stringify(variants)) {
      onVariantsChange(filtered);
    }
  }, [selectedDestinations, masterBody, masterSubject]);

  const updateVariant = useCallback((destinationId: string, field: "body" | "subject", value: string) => {
    onVariantsChange(
      variants.map((v) =>
        v.destinationId === destinationId
          ? { ...v, [field]: value, customized: true }
          : v
      )
    );
  }, [variants, onVariantsChange]);

  const resetVariant = useCallback((destinationId: string) => {
    onVariantsChange(
      variants.map((v) =>
        v.destinationId === destinationId
          ? { ...v, body: masterBody, subject: masterSubject, customized: false }
          : v
      )
    );
  }, [variants, onVariantsChange, masterBody, masterSubject]);

  const copyFromMaster = useCallback((destinationId: string) => {
    onVariantsChange(
      variants.map((v) =>
        v.destinationId === destinationId
          ? { ...v, body: masterBody, subject: masterSubject, customized: v.body !== masterBody }
          : v
      )
    );
  }, [variants, onVariantsChange, masterBody, masterSubject]);

  if (selectedDestinations.length === 0) {
    return null;
  }

  const customizedCount = variants.filter((v) => v.customized).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Wand2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Channel Variants</span>
        </div>
        {customizedCount > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] font-medium">
            {customizedCount} customized
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {variants.map((variant) => {
          const dest = selectedDestinations.find((d) => d.id === variant.destinationId);
          if (!dest) return null;
          const meta = getPlatformMeta(variant.platform);
          const Icon = meta.icon;
          const isExpanded = expandedId === variant.destinationId;
          const charLimit = meta.charLimit;
          const overLimit = charLimit && variant.body.length > charLimit;

          return (
            <div key={variant.destinationId} className="rounded-xl border border-border/30 bg-card overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : variant.destinationId)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/10 transition-colors"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: meta.color }} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium truncate">{dest.displayName}</p>
                </div>
                {variant.customized && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] font-medium">
                    Custom
                  </span>
                )}
                {overLimit && (
                  <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                )}
                {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 space-y-2 border-t border-border/20 pt-2">
                      {(variant.platform === "GOOGLE" || variant.platform === "EMAIL") && (
                        <div>
                          <label className="text-[10px] text-muted-foreground mb-1 block">Subject Line</label>
                          <input
                            type="text"
                            value={variant.subject || ""}
                            onChange={(e) => updateVariant(variant.destinationId, "subject", e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-muted/10 border border-border/30 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                            placeholder="Email subject..."
                          />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] text-muted-foreground">Content</label>
                          {charLimit && (
                            <span className={`text-[9px] ${overLimit ? "text-red-400" : "text-muted-foreground/60"}`}>
                              {variant.body.length}/{charLimit}
                            </span>
                          )}
                        </div>
                        <textarea
                          value={variant.body}
                          onChange={(e) => updateVariant(variant.destinationId, "body", e.target.value)}
                          rows={4}
                          className="w-full px-2.5 py-2 rounded-lg bg-muted/10 border border-border/30 text-xs resize-none focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                          placeholder="Customize content for this channel..."
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyFromMaster(variant.destinationId)}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy className="w-3 h-3" /> Copy from master
                        </button>
                        {variant.customized && (
                          <button
                            onClick={() => resetVariant(variant.destinationId)}
                            className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" /> Reset
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { VariantData };
