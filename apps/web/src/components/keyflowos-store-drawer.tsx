"use client";

import { useState, useRef, useEffect } from "react";
import { X, Send, ExternalLink, Sparkles, CheckCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitPublicIntake } from "@/lib/client";

const KEYFLOWOS_SLUG = "keyflowos";

const SERVICE_CATEGORIES = [
  { value: "automation", label: "Business Automation" },
  { value: "web-design", label: "Website & Store Setup" },
  { value: "branding", label: "Branding & Identity" },
  { value: "ai-integration", label: "AI Integration" },
  { value: "marketing", label: "Digital Marketing" },
  { value: "consulting", label: "Strategy Consulting" },
  { value: "custom", label: "Custom Project" },
];

const BUDGET_OPTIONS = [
  { value: "starter", label: "Under $500" },
  { value: "growth", label: "$500 – $2,000" },
  { value: "scale", label: "$2,000 – $5,000" },
  { value: "enterprise", label: "$5,000+" },
  { value: "discuss", label: "Let's discuss" },
];

const URGENCY_OPTIONS = [
  { value: "low", label: "No rush" },
  { value: "normal", label: "Within a week" },
  { value: "high", label: "ASAP" },
];

interface KeyflowOSStoreDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function KeyflowOSStoreDrawer({ open, onClose }: KeyflowOSStoreDrawerProps) {
  const [step, setStep] = useState<"browse" | "form" | "success">("browse");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [urgency, setUrgency] = useState("normal");

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep("browse");
        setError(null);
      }, 300);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }
  }, [open, onClose]);

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !category || !description.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await submitPublicIntake(KEYFLOWOS_SLUG, {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      category,
      description: description.trim(),
      budget: budget || undefined,
      urgency,
    });
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setStep("success");
  };

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setCategory("");
    setDescription("");
    setBudget("");
    setUrgency("normal");
    setError(null);
    setStep("browse");
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        ref={drawerRef}
        className={cn(
          "fixed top-0 right-0 z-[61] h-full w-full sm:w-[420px] bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-out flex flex-col",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #F97316, #14B8A6)" }}
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">KeyflowOS Store</h2>
              <p className="text-[11px] text-muted-foreground">Services & Solutions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === "browse" && (
            <div className="p-5 space-y-5">
              <div
                className="rounded-xl p-5 relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(20, 184, 166, 0.08))" }}
              >
                <h3 className="text-base font-semibold mb-1.5">Grow your business with KeyflowOS</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  From automation setup to full digital transformation — our team builds the systems that let you focus on what matters.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Services</h4>
                <div className="grid gap-2">
                  {SERVICE_CATEGORIES.map((svc) => (
                    <button
                      key={svc.value}
                      onClick={() => {
                        setCategory(svc.value);
                        setStep("form");
                      }}
                      className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-muted-foreground/30 hover:bg-muted/50 transition-all text-left group"
                    >
                      <span className="text-sm font-medium">{svc.label}</span>
                      <Send className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <a
                  href={`/book/${KEYFLOWOS_SLUG}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm hover:underline transition-colors"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Visit our full storefront
                </a>
              </div>
            </div>
          )}

          {step === "form" && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <button
                  onClick={() => setStep("browse")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Back
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>
                  {SERVICE_CATEGORIES.find((c) => c.value === category)?.label}
                </span>
              </div>

              <h3 className="text-base font-semibold">Tell us about your project</h3>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Your name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Smith"
                    maxLength={200}
                    className="kf-input w-full"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Email <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@business.com"
                    maxLength={320}
                    className="kf-input w-full"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Phone <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 868 555 0000"
                    maxLength={50}
                    className="kf-input w-full"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    What do you need? <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe your project, goals, or the problem you're trying to solve..."
                    rows={4}
                    maxLength={5000}
                    className="kf-input w-full resize-none"
                  />
                  <div className="text-[10px] text-muted-foreground text-right mt-0.5">
                    {description.length}/5000
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Budget range</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {BUDGET_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setBudget(opt.value === budget ? "" : opt.value)}
                        className={cn(
                          "px-2.5 py-2 rounded-lg border text-xs font-medium transition-all",
                          budget === opt.value
                            ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                            : "border-border text-muted-foreground hover:border-muted-foreground/30"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Timeline</label>
                  <div className="flex gap-1.5">
                    {URGENCY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setUrgency(opt.value)}
                        className={cn(
                          "flex-1 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all",
                          urgency === opt.value
                            ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                            : "border-border text-muted-foreground hover:border-muted-foreground/30"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="p-5 flex flex-col items-center justify-center text-center h-full min-h-[400px]">
              <div
                className="h-14 w-14 rounded-full flex items-center justify-center mb-4"
                style={{ background: "rgba(20, 184, 166, 0.15)" }}
              >
                <CheckCircle className="w-7 h-7" style={{ color: "#14B8A6" }} />
              </div>
              <h3 className="text-lg font-semibold mb-2">Request submitted!</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px] mb-6">
                Our team will review your request and reach out within 24 hours. Check your email for updates.
              </p>
              <div className="flex gap-2.5">
                <button
                  onClick={resetForm}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                >
                  Submit another
                </button>
                <button
                  onClick={onClose}
                  className="kf-btn-primary !px-4 !py-2 !text-sm !rounded-lg"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {step === "form" && (
          <div className="border-t border-border px-5 py-3 flex-shrink-0">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="kf-btn-primary w-full !py-2.5 !text-sm !rounded-lg inline-flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Request
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
