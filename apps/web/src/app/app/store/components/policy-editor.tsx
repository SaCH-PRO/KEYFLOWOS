"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Save,
  Loader2,
  ChevronDown,
  Shield,
  Truck,
  RefreshCw,
  Scale,
} from "lucide-react";
import type { StorefrontConfig, StorefrontPolicies, PolicyConfig } from "@/lib/client";

type Props = {
  config: StorefrontConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

type PolicyKey = "refund" | "privacy" | "delivery" | "terms";

const POLICY_META: {
  key: PolicyKey;
  label: string;
  description: string;
  icon: React.ElementType;
  placeholder: string;
}[] = [
  {
    key: "refund",
    label: "Refund Policy",
    description: "Explain your refund and cancellation terms",
    icon: RefreshCw,
    placeholder:
      "We offer full refunds within 24 hours of purchase. Cancellations made less than 24 hours before a scheduled appointment may be subject to a cancellation fee...",
  },
  {
    key: "privacy",
    label: "Privacy Policy",
    description: "How you collect and use customer data",
    icon: Shield,
    placeholder:
      "We collect personal information such as name, email, and phone number to process bookings. We do not share your information with third parties...",
  },
  {
    key: "delivery",
    label: "Delivery / Shipping Policy",
    description: "Shipping methods, timeframes, and fees",
    icon: Truck,
    placeholder:
      "Orders are processed within 1-2 business days. Standard shipping takes 3-5 business days. Express shipping is available for an additional fee...",
  },
  {
    key: "terms",
    label: "Terms of Service",
    description: "General terms and conditions",
    icon: Scale,
    placeholder:
      "By using our services, you agree to these terms. We reserve the right to refuse service to anyone. All prices are subject to change without notice...",
  },
];

function PolicySection({
  meta,
  policy,
  onChange,
}: {
  meta: (typeof POLICY_META)[number];
  policy: PolicyConfig | undefined;
  onChange: (updates: Partial<PolicyConfig>) => void;
}) {
  const [open, setOpen] = useState(policy?.enabled ?? false);
  const Icon = meta.icon;
  const enabled = policy?.enabled ?? false;
  const content = policy?.content ?? "";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: enabled ? "hsl(var(--kf-accent1) / 0.04)" : "hsl(var(--kf-muted) / 0.15)",
        border: enabled
          ? "1px solid hsl(var(--kf-accent1) / 0.15)"
          : "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)]"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: enabled ? "hsl(var(--kf-accent1) / 0.12)" : "hsl(var(--kf-muted) / 0.3)",
          }}
        >
          <Icon
            className="w-4 h-4"
            style={{
              color: enabled ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
            }}
          />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{meta.label}</p>
            {enabled && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: "hsl(var(--kf-accent1) / 0.12)",
                  color: "hsl(var(--kf-accent1))",
                }}
              >
                Active
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">{meta.description}</p>
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
              className="px-4 pb-4 pt-2 space-y-3"
              style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.2)" }}
            >
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => onChange({ enabled: !enabled })}
                className="flex items-center justify-between w-full py-1 group"
              >
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                  Enable this policy
                </span>
                <div
                  className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
                  style={{
                    background: enabled
                      ? "hsl(var(--kf-accent1))"
                      : "hsl(var(--kf-muted-foreground) / 0.3)",
                  }}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      enabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </div>
              </button>

              {enabled && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-2"
                >
                  <textarea
                    value={content}
                    onChange={(e) => onChange({ content: e.target.value })}
                    placeholder={meta.placeholder}
                    className="kf-input w-full text-sm min-h-[120px] resize-y"
                    rows={5}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {content.length > 0
                      ? `${content.length} characters`
                      : "Enter your policy content above"}
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PolicyEditor({ config, onConfigChange, onSave, saving }: Props) {
  const policies: StorefrontPolicies = config.policies ?? {};

  function handlePolicyChange(key: PolicyKey, updates: Partial<PolicyConfig>) {
    const current = policies[key] ?? { enabled: false, content: "" };
    onConfigChange("policies", { [key]: { ...current, ...updates } });
  }

  const enabledCount = POLICY_META.filter((m) => policies[m.key]?.enabled).length;

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
            <FileText className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Store Policies</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {enabledCount} of {POLICY_META.length} policies active
            </p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? "Saving..." : "Save Policies"}
        </button>
      </div>

      <div className="p-5 space-y-3">
        {POLICY_META.map((meta) => (
          <PolicySection
            key={meta.key}
            meta={meta}
            policy={policies[meta.key]}
            onChange={(updates) => handlePolicyChange(meta.key, updates)}
          />
        ))}
      </div>
    </motion.div>
  );
}
