"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Layers,
  Check,
  Loader2,
  Briefcase,
  Scissors,
  Utensils,
  Dumbbell,
  Wrench,
  GraduationCap,
  Heart,
  Camera,
  ShoppingBag,
  Building2,
} from "lucide-react";
import { fetchTemplates, applyTemplate, type BusinessTemplate } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

/**
 * R0-09f-D11-FINANCE-TAX-AND-WEB (R0-09d review CR-1): applying a template is
 * OWNER only (owner ruling D-11; POST .../templates/:templateId/apply answers a
 * non-owner 403 BUSINESS_PROFILE_OWNER_ONLY). apiPost returns a refusal as
 * `{ data: null, error, status }` rather than throwing, so handleApply reads the
 * result: a refused apply shows the server's refusal on the template's card (a
 * 403 without a usable message names the owner-only rule) and no success state.
 */
const OWNER_ONLY_FALLBACK_TEXT = "Only the business owner can apply a template.";
const APPLY_FAILED_TEXT = "Could not apply the template.";
const GENERIC_FORBIDDEN = new Set(["forbidden", "forbidden resource", "request failed"]);

function applyRefusalText(res: { error: string | null; status?: number }): string {
  const message = res.error?.trim() ?? "";
  if (res.status === 403 && (!message || GENERIC_FORBIDDEN.has(message.toLowerCase()))) return OWNER_ONLY_FALLBACK_TEXT;
  return message || APPLY_FAILED_TEXT;
}

const INDUSTRY_ICONS: Record<string, React.ElementType> = {
  consulting: Briefcase,
  salon: Scissors,
  restaurant: Utensils,
  fitness: Dumbbell,
  repair: Wrench,
  education: GraduationCap,
  health: Heart,
  photography: Camera,
  retail: ShoppingBag,
  default: Building2,
};

function getIndustryIcon(industry: string) {
  const key = industry.toLowerCase();
  for (const [k, icon] of Object.entries(INDUSTRY_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return INDUSTRY_ICONS.default;
}

export default function TemplatesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<BusinessTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ templateId: string; message: string } | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (bid) setBusinessId(bid);
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTemplates();
      if (res.data) setTemplates(res.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    void loadTemplates();
  }, [loadTemplates]);

  const handleApply = async (templateId: string) => {
    if (!businessId) return;
    setApplying(templateId);
    setConfirmId(null);
    setRefusal(null);
    try {
      const res: { data: unknown; error: string | null; status?: number } = await applyTemplate(businessId, templateId);
      if (res.data) {
        setSuccessId(templateId);
        setTimeout(() => setSuccessId(null), 3000);
      } else {
        setRefusal({ templateId, message: applyRefusalText(res) });
      }
    } catch (err) {
      setRefusal({ templateId, message: err instanceof Error && err.message ? err.message : APPLY_FAILED_TEXT });
    }
    setApplying(null);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
            Business Templates
          </h1>
          <p className="text-sm text-muted-foreground">Loading templates...</p>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-48 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Layers className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
          Business Templates
        </h1>
        <p className="text-sm text-muted-foreground">Jumpstart your business with pre-built templates</p>
      </div>

      <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4">
        <p className="text-sm text-muted-foreground">
          Templates pre-configure your business with industry-specific products, services, and expense categories so you can start operating faster.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-12 text-center">
          <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No templates available</h3>
          <p className="text-sm text-muted-foreground">Templates will appear here once they are configured.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template, index) => {
            const Icon = getIndustryIcon(template.industry || template.archetype || "");
            return (
              <motion.div
                key={template.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all flex flex-col"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.2), hsl(var(--kf-accent2) / 0.2))" }}
                  >
                    <Icon className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold">{template.displayName}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{template.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  {template.industry && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">
                      {template.industry}
                    </span>
                  )}
                  {template.archetype && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">
                      {template.archetype}
                    </span>
                  )}
                </div>

                <div className="mt-auto">
                  {successId === template.id ? (
                    <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                      <Check className="w-4 h-4" />
                      Template applied successfully!
                    </div>
                  ) : confirmId === template.id ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        This will add sample products, services, and categories to your business. Continue?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApply(template.id)}
                          disabled={applying === template.id}
                          className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                        >
                          {applying === template.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : null}
                          {applying === template.id ? "Applying..." : "Yes, Apply"}
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted/30"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {refusal?.templateId === template.id && (
                        <p role="alert" className="text-xs text-[hsl(var(--kf-error))]">
                          {refusal.message}
                        </p>
                      )}
                      <button
                        onClick={() => setConfirmId(template.id)}
                        disabled={!!applying}
                        className="w-full px-4 py-2 rounded-xl text-sm font-medium bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50"
                      >
                        Apply Template
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}