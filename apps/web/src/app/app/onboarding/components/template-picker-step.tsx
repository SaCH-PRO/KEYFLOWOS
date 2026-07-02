"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, ArrowRight, ArrowLeft, Wrench } from "lucide-react";
import {
  fetchConciergeTemplates,
  fetchConciergeTemplatePreview,
  autoConfigureFromTemplate,
  type ConciergeTemplate,
  type TemplatePreview,
} from "@/lib/api/onboarding-concierge";
import { getStoredBusinessId } from "@/lib/workspace";
import { useOnboarding } from "../hooks/use-onboarding";

interface TemplatePickerStepProps {
  onComplete: () => void;
}

export function TemplatePickerStep({ onComplete }: TemplatePickerStepProps) {
  const { prevStep } = useOnboarding();
  const businessId = getStoredBusinessId();
  const [templates, setTemplates] = useState<ConciergeTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    fetchConciergeTemplates(businessId).then(({ data }) => {
      setTemplates(data?.templates ?? []);
      setLoading(false);
    });
  }, [businessId]);

  useEffect(() => {
    if (!businessId || !selected) {
      setPreview(null);
      return;
    }
    fetchConciergeTemplatePreview(businessId, selected).then(({ data }) => {
      if (data) setPreview(data);
    });
  }, [selected]);

  const handleConfirm = async () => {
    if (!businessId || !selected) return;
    setConfiguring(true);
    setError(null);

    if (selected === "skip") {
      setConfiguring(false);
      onComplete();
      return;
    }

    const { data, error: apiError } = await autoConfigureFromTemplate(businessId, selected, {
      createProducts: true,
      setBusinessHours: true,
      setPaymentMethods: true,
      configureStorefront: true,
    });

    setConfiguring(false);

    if (apiError || !data) {
      setError(apiError ?? "Template configuration failed. Please try again or skip the template.");
      return;
    }

    onComplete();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Finding the best template…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Pick a starting template</h2>
        <p className="text-sm text-muted-foreground">
          KEY will pre-fill services, hours, and payment options. You can customize everything later.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={`text-left p-4 rounded-xl border transition-all ${
              selected === t.id
                ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1)/0.06)]"
                : "border-border/40 bg-card/40 hover:bg-card"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{t.label}</span>
              {selected === t.id && (
                <CheckCircle2 className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              )}
            </div>
          </button>
        ))}

        <button
          onClick={() => setSelected("skip")}
          className={`text-left p-4 rounded-xl border transition-all ${
            selected === "skip"
              ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1)/0.06)]"
              : "border-border/40 bg-card/40 hover:bg-card"
          }`}
        >
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Skip template — start from scratch</span>
          </div>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {preview && selected !== "skip" && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold">What KEY will set up</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• {preview.products.length} products / services</li>
            <li>• Business hours</li>
            <li>• Recommended payment methods</li>
            <li>• Public storefront enabled</li>
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={() => void prevStep()}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          Back
        </button>
        <button
          onClick={() => void handleConfirm()}
          disabled={!selected || configuring}
          className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))] hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        >
          {configuring ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Configuring…
            </>
          ) : (
            <>
              {selected === "skip" ? "Continue without template" : "Use this template"}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
