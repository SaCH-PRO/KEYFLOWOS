"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api";
import {
  Upload,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Palette,
  FileText,
  Type,
  Image as ImageIcon,
  Send,
} from "lucide-react";

type IntakeField = {
  id: string;
  label: string;
  type: "text" | "file" | "color" | "textarea";
  required?: boolean;
};

type Props = {
  journeyId: string;
  productName: string;
  primaryColor: string;
  secondaryColor: string;
  checklist?: IntakeField[];
  onComplete: () => void;
  onBack: () => void;
};

const DEFAULT_CHECKLIST: IntakeField[] = [
  { id: "brand_name", label: "Brand / Business Name", type: "text", required: true },
  { id: "brand_colors", label: "Brand Colors (hex codes or descriptions)", type: "text" },
  { id: "primary_color", label: "Primary Brand Color", type: "color" },
  { id: "logo_url", label: "Logo URL or File Link", type: "text" },
  { id: "style_references", label: "Style References (URLs, Pinterest boards, etc.)", type: "textarea" },
  { id: "target_audience", label: "Target Audience Description", type: "textarea" },
  { id: "platforms", label: "Target Platforms (Instagram, Facebook, Website, etc.)", type: "text" },
  { id: "additional_notes", label: "Additional Notes or Requirements", type: "textarea" },
];

const FIELD_ICONS: Record<string, typeof Type> = {
  text: Type,
  file: Upload,
  color: Palette,
  textarea: FileText,
};

export function AssetIntake({ journeyId, productName, primaryColor, secondaryColor, checklist, onComplete, onBack }: Props) {
  const fields = checklist && checklist.length > 0 ? checklist : DEFAULT_CHECKLIST;
  const [values, setValues] = useState<Record<string, string>>({});
  const [hp, setHp] = useState("");
  const [renderedAt] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const requiredFields = fields.filter(f => f.required);
  const allRequiredFilled = requiredFields.every(f => (values[f.id] ?? "").trim().length > 0);
  const filledCount = fields.filter(f => (values[f.id] ?? "").trim().length > 0).length;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const res = await apiPost({
      path: `/site/storefront/public/qualification/${journeyId}/intake`,
      body: { ...values, _hp: hp, _t: renderedAt },
    });
    setSubmitting(false);
    if (res.error) {
      setSubmitError(res.error || "We couldn't submit your assets. Please try again.");
      return;
    }
    setSubmitted(true);
    setTimeout(() => onComplete(), 1500);
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: `${primaryColor}15` }}
        >
          <CheckCircle2 className="w-8 h-8" style={{ color: primaryColor }} />
        </div>
        <h3 className="text-lg font-bold text-gray-900">Assets Submitted!</h3>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          Your brand assets have been received. We&apos;ll get started on your {productName} right away.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <div
          className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
          style={{ background: `${primaryColor}15` }}
        >
          <ImageIcon className="w-6 h-6" style={{ color: primaryColor }} />
        </div>
        <h3 className="text-xl font-bold text-gray-900">Brand Assets & Details</h3>
        <p className="text-sm text-gray-500">
          Help us get started on your <span className="font-medium" style={{ color: primaryColor }}>{productName}</span> by sharing your brand details.
        </p>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-gray-400 justify-center">
        <span>{filledCount} of {fields.length} fields completed</span>
        <div className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${fields.length > 0 ? (filledCount / fields.length) * 100 : 0}%`,
              background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`,
            }}
          />
        </div>
      </div>

      <div className="space-y-4">
        {fields.map(field => {
          const Icon = FIELD_ICONS[field.type] ?? Type;
          const value = values[field.id] ?? "";

          return (
            <div key={field.id} className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                <Icon className="w-3 h-3 text-gray-400" />
                {field.label}
                {field.required && <span style={{ color: primaryColor }}>*</span>}
              </label>

              {field.type === "textarea" ? (
                <textarea
                  value={value}
                  onChange={e => setValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all resize-none"
                  style={{ borderColor: value.trim() ? `${primaryColor}25` : undefined }}
                  placeholder={`Enter ${field.label.toLowerCase()}...`}
                />
              ) : field.type === "color" ? (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={value || "#000000"}
                    onChange={e => setValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={value}
                    onChange={e => setValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                    placeholder="#000000"
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none"
                    style={{ borderColor: value.trim() ? `${primaryColor}25` : undefined }}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={value}
                  onChange={e => setValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none transition-all"
                  style={{ borderColor: value.trim() ? `${primaryColor}25` : undefined }}
                  placeholder={`Enter ${field.label.toLowerCase()}...`}
                />
              )}
            </div>
          );
        })}
      </div>

      <input
        type="text"
        name="website_url"
        tabIndex={-1}
        autoComplete="off"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", opacity: 0, height: 0, width: 0 }}
      />

      {submitError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        <button
          onClick={handleSubmit}
          disabled={!allRequiredFilled || submitting}
          className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              Submit Assets
            </>
          )}
        </button>
      </div>

      <p className="text-[10px] text-gray-400 text-center">
        You can always update these details later. Fields marked with * are required to get started.
      </p>
    </div>
  );
}
