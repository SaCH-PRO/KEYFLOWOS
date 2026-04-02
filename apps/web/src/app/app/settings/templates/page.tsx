"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Zap,
  Mail,
  Play,
  CheckCircle2,
  Loader2,
  Palette,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { TEMPLATE_META } from "@/app/app/commerce/components/invoice-templates/template-types";
import type { TemplateId } from "@/app/app/commerce/components/invoice-templates/template-types";
import {
  AUTOMATION_TEMPLATES,
  getTriggerLabel,
  getActionLabel,
} from "@/app/app/automations/components/automation-constants";
import type { AutomationTemplate } from "@/app/app/automations/components/automation-constants";
import { createPlaybook } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import Link from "next/link";

type TemplateCategory = "all" | "invoice" | "automation" | "email";

const CATEGORY_TABS: { key: TemplateCategory; label: string; icon: typeof FileText }[] = [
  { key: "all", label: "All Templates", icon: Sparkles },
  { key: "invoice", label: "Invoice", icon: FileText },
  { key: "automation", label: "Automation", icon: Zap },
  { key: "email", label: "Email", icon: Mail },
];

const INVOICE_TEMPLATES: { id: TemplateId; preview: string }[] = [
  { id: "classic", preview: "Structured header with clean line items. Great for professional services." },
  { id: "modern", preview: "Bold accent colors with contemporary typography. Perfect for creative businesses." },
  { id: "minimal", preview: "Elegant whitespace design with fine accents. Ideal for premium brands." },
];

const EMAIL_TEMPLATES = [
  { id: "invoice-sent", name: "Invoice Sent", description: "Sent when an invoice is issued to a client", category: "Commerce" },
  { id: "payment-received", name: "Payment Received", description: "Confirmation email after a payment is processed", category: "Commerce" },
  { id: "booking-confirmed", name: "Booking Confirmed", description: "Sent when a booking is confirmed with schedule details", category: "Bookings" },
  { id: "booking-reminder", name: "Booking Reminder", description: "Automated reminder sent 24 hours before appointment", category: "Bookings" },
  { id: "welcome-new-contact", name: "Welcome Email", description: "Onboarding email for new contacts and leads", category: "CRM" },
  { id: "follow-up", name: "Follow-Up", description: "Automated follow-up after service completion", category: "CRM" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Commerce: "hsl(var(--kf-accent1))",
  Bookings: "hsl(var(--kf-accent2))",
  CRM: "hsl(var(--kf-info))",
  Marketing: "hsl(var(--kf-success))",
  "Time-Based": "hsl(var(--kf-warning))",
};

export default function TemplateGalleryPage() {
  const [category, setCategory] = useState<TemplateCategory>("all");
  const [activating, setActivating] = useState<string | null>(null);
  const [activated, setActivated] = useState<Set<string>>(new Set());
  const businessId = getStoredBusinessId();

  const handleActivateAutomation = useCallback(async (template: AutomationTemplate) => {
    setActivating(template.id);
    try {
      const { data } = await createPlaybook({
        name: template.name,
        triggerEvent: template.trigger,
        actions: template.actions,
        businessId: businessId ?? undefined,
      });
      if (data) {
        setActivated((prev) => new Set(prev).add(template.id));
      }
    } catch {
    } finally {
      setActivating(null);
    }
  }, [businessId]);

  const showInvoice = category === "all" || category === "invoice";
  const showAutomation = category === "all" || category === "automation";
  const showEmail = category === "all" || category === "email";

  const automationCategories = Array.from(new Set(AUTOMATION_TEMPLATES.map((t) => t.category)));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Palette className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          Template Gallery
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and activate pre-built templates for invoices, automations, and email notifications
        </p>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-muted/30 border border-border/40 overflow-x-auto">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setCategory(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all shrink-0 min-h-[40px] ${
              category === tab.key
                ? "bg-background border border-border/60 shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {showInvoice && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-accent1))" }} />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invoice Templates</h3>
            </div>
            <Link
              href="/app/settings/business"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              Configure in Business Settings <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {INVOICE_TEMPLATES.map((tmpl) => {
              const meta = TEMPLATE_META[tmpl.id];
              return (
                <div
                  key={tmpl.id}
                  className="rounded-2xl border border-border/60 bg-card p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                    >
                      <FileText className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{meta.name}</div>
                      <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{meta.description}</p>
                      <p className="text-[11px] text-muted-foreground/70 mt-1">{tmpl.preview}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {showAutomation && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-accent2))" }} />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Automation Templates</h3>
            </div>
            <Link
              href="/app/automations"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              View all automations <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {automationCategories.map((cat) => (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-1.5 px-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] ?? "hsl(var(--kf-accent1))" }} />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{cat}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {AUTOMATION_TEMPLATES.filter((t) => t.category === cat).map((template) => {
                  const isActivated = activated.has(template.id);
                  const catColor = CATEGORY_COLORS[cat] ?? "hsl(var(--kf-accent1))";
                  return (
                    <div
                      key={template.id}
                      className="rounded-xl border border-border/50 bg-card p-3 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: "hsl(var(--muted) / 0.5)" }}
                        >
                          <Zap className="w-3.5 h-3.5" style={{ color: catColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold">{template.name}</div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{template.description}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
                              style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                            >
                              {getTriggerLabel(template.trigger)}
                            </span>
                            {template.actions.slice(0, 2).map((a, i) => (
                              <span
                                key={i}
                                className="text-[9px] px-1.5 py-0.5 rounded-md"
                                style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}
                              >
                                {getActionLabel(a.type)}
                              </span>
                            ))}
                          </div>
                          <button
                            onClick={() => handleActivateAutomation(template)}
                            disabled={activating === template.id || isActivated}
                            className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors min-h-[28px]"
                            style={{
                              background: isActivated ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-accent1) / 0.15)",
                              color: isActivated ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
                            }}
                          >
                            {activating === template.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : isActivated ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            {activating === template.id ? "Activating..." : isActivated ? "Activated" : "Activate"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {showEmail && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-info))" }} />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email Notification Templates</h3>
            </div>
            <Link
              href="/app/settings/notifications"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              Configure notifications <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {EMAIL_TEMPLATES.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-xl border border-border/50 bg-card p-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "hsl(var(--kf-info) / 0.1)" }}
                  >
                    <Mail className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-info))" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">{tmpl.name}</span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: `${CATEGORY_COLORS[tmpl.category] ?? "hsl(var(--kf-info))"}15`, color: CATEGORY_COLORS[tmpl.category] ?? "hsl(var(--kf-info))" }}
                      >
                        {tmpl.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{tmpl.description}</p>
                    <div className="mt-1.5">
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Built-in
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
