"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPostSimple as apiPost } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ChevronRight,
  CheckCircle2,
  Building2,
  Wrench,
  Users,
  Share2,
  CreditCard,
  Store,
  Clock,
  ArrowRight,
  Loader2,
  PartyPopper,
} from "lucide-react";

interface Template {
  id: string;
  label: string;
  keywords: string[];
}

interface SetupStatus {
  products: boolean;
  businessHours: boolean;
  payments: boolean;
  storefront: boolean;
  contacts: boolean;
  profile: boolean;
  completedCount: number;
  totalSteps: number;
  percentage: number;
}

const STEPS = [
  { key: "welcome", label: "Welcome", icon: Sparkles },
  { key: "template", label: "Business Type", icon: Building2 },
  { key: "configure", label: "Set Up", icon: Wrench },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "share", label: "Share", icon: Share2 },
  { key: "done", label: "Done", icon: PartyPopper },
];

export default function OnboardingPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const fetchStatus = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<SetupStatus>(`/onboarding-concierge/businesses/${businessId}/status`);
    if (res.data) setStatus(res.data);
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    apiGet<{ templates: Template[] }>(`/onboarding-concierge/businesses/${businessId}/templates`).then((res) => {
      if (res.data?.templates) setTemplates(res.data.templates);
    });
    fetchStatus();
  }, [businessId, fetchStatus]);

  const handleAutoConfigure = async () => {
    if (!businessId || !selectedTemplate) return;
    setConfiguring(true);
    try {
      const res = await apiPost<{
        templateId: string;
        templateLabel: string;
        productsCreated?: number;
        productsSkipped?: boolean;
        businessHoursSet?: boolean;
        paymentMethodsSet?: boolean;
        storefrontEnabled?: boolean;
      }>(`/onboarding-concierge/businesses/${businessId}/auto-configure`, {
        templateId: selectedTemplate,
        createProducts: true,
        setBusinessHours: true,
        setPaymentMethods: true,
        configureStorefront: true,
      });
      if (res.data) {
        toast.success(`Set up ${res.data.templateLabel}!`);
        await fetchStatus();
        setStep(3);
      }
    } catch {
      toast.error("Setup failed. Please try again.");
    } finally {
      setConfiguring(false);
    }
  };

  const handleAddContact = async () => {
    if (!businessId || !contactName.trim()) return;
    setLoading(true);
    try {
      await apiPost(`/crm/businesses/${businessId}/contacts`, {
        firstName: contactName.trim(),
        email: contactEmail.trim() || undefined,
        phone: contactPhone.trim() || undefined,
        status: "lead",
      });
      toast.success("Contact added!");
      await fetchStatus();
      setStep(4);
    } catch {
      toast.error("Failed to add contact.");
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!businessId) return;
    await apiPost(`/onboarding-concierge/businesses/${businessId}/complete`, {});
    toast.success("You're all set! Welcome to KeyflowOS.");
    router.push("/app/keyflow-command");
  };

  if (!businessId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">No business selected.</p>
      </div>
    );
  }

  const currentStepKey = STEPS[step]?.key;
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-8">
      {/* Progress */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Set Up Your Business</h1>
          <span className="text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "hsl(var(--kf-accent1))" }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        {currentStepKey === "welcome" && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-6"
          >
            <div className="text-center space-y-3">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
                style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
              >
                <Sparkles className="w-8 h-8" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <h2 className="text-2xl font-bold">Welcome to KeyflowOS</h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Let&apos;s get your business set up in about 3 minutes. We&apos;ll walk you through everything step by step.
              </p>
            </div>
            <button
              onClick={() => setStep(1)}
              className="kf-btn-primary w-full py-3 text-sm font-medium rounded-xl flex items-center justify-center gap-2"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {currentStepKey === "template" && (
          <motion.div
            key="template"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-4"
          >
            <h2 className="text-lg font-semibold">What type of business are you running?</h2>
            <p className="text-sm text-muted-foreground">
              We&apos;ll use this to suggest the right services, hours, and pricing for you.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplate(t.id)}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    selectedTemplate === t.id
                      ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))/0.05]"
                      : "border-border/50 hover:border-border hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{t.label}</span>
                    {selectedTemplate === t.id && (
                      <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    )}
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!selectedTemplate}
              className="kf-btn-primary w-full py-3 text-sm font-medium rounded-xl flex items-center justify-center gap-2 disabled:opacity-40"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {currentStepKey === "configure" && (
          <motion.div
            key="configure"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-5"
          >
            <h2 className="text-lg font-semibold">Let&apos;s set up your business</h2>
            <p className="text-sm text-muted-foreground">
              We&apos;ll automatically create services, set typical Trinidad business hours, enable payments, and turn on your storefront.
            </p>
            <div className="space-y-2">
              {[
                { label: "Services & pricing", icon: Wrench, desc: "Based on your business type" },
                { label: "Business hours", icon: Clock, desc: "Typical Trinidad hours" },
                { label: "Payment methods", icon: CreditCard, desc: "WiPay & PayPal ready" },
                { label: "Online storefront", icon: Store, desc: "Your public booking page" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                  >
                    <item.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-[11px] text-muted-foreground">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handleAutoConfigure}
              disabled={configuring}
              className="kf-btn-primary w-full py-3 text-sm font-medium rounded-xl flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {configuring ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Setting up…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Auto-Configure My Business
                </>
              )}
            </button>
          </motion.div>
        )}

        {currentStepKey === "contacts" && (
          <motion.div
            key="contacts"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-5"
          >
            <h2 className="text-lg font-semibold">Add your first contact</h2>
            <p className="text-sm text-muted-foreground">
              This could be a customer, lead, or supplier. You can always add more later.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  className="kf-input w-full mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</label>
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="kf-input w-full mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</label>
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="868-555-1234"
                  className="kf-input w-full mt-1"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(4)}
                className="flex-1 py-3 text-sm font-medium rounded-xl border border-border/50 hover:bg-muted/30 transition-colors"
              >
                Skip for now
              </button>
              <button
                onClick={handleAddContact}
                disabled={loading || !contactName.trim()}
                className="flex-1 kf-btn-primary py-3 text-sm font-medium rounded-xl disabled:opacity-40"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Add Contact"}
              </button>
            </div>
          </motion.div>
        )}

        {currentStepKey === "share" && (
          <motion.div
            key="share"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-5"
          >
            <h2 className="text-lg font-semibold">Share your booking page</h2>
            <p className="text-sm text-muted-foreground">
              Your storefront is live! Customers can now book and pay online. Here is how to share it.
            </p>
            <div className="p-4 rounded-xl border border-border/40 bg-background/50 space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
                >
                  <Store className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                </div>
                <div>
                  <div className="text-sm font-medium">Your storefront is ready</div>
                  <div className="text-[11px] text-muted-foreground">
                    Customers can book services and pay online
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>• Share your link on WhatsApp, Instagram, or Facebook</p>
                <p>• Add it to your email signature</p>
                <p>• Print a QR code for your physical location</p>
              </div>
            </div>
            <button
              onClick={handleComplete}
              className="kf-btn-primary w-full py-3 text-sm font-medium rounded-xl flex items-center justify-center gap-2"
            >
              Go to My Dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {currentStepKey === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-5 py-8"
          >
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "hsl(var(--kf-success) / 0.1)" }}
            >
              <PartyPopper className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold">You&apos;re all set!</h2>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Your business is configured and ready to go. KEY will help you manage everything from here.
            </p>
            {status && (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                {status.completedCount} of {status.totalSteps} setup steps complete
              </div>
            )}
            <button
              onClick={handleComplete}
              className="kf-btn-primary w-full py-3 text-sm font-medium rounded-xl"
            >
              Open My Dashboard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
