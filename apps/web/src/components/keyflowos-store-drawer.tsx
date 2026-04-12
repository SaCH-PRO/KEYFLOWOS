"use client";

import { useState, useRef, useEffect } from "react";
import {
  X, Send, ExternalLink, Sparkles, CheckCircle, Loader2,
  Rocket, Globe, Palette, Bot, TrendingUp, Users, Calculator,
  Scale, Shield, BookOpen, Wrench, Package, FileText, BarChart3,
  Lightbulb, Target, Megaphone, Settings, Building2, ChevronRight,
  Zap, GraduationCap, FolderOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { submitPublicIntake } from "@/lib/client";

const KEYFLOWOS_SLUG = "keyflowos" as const;

interface ServiceCategory {
  value: string;
  label: string;
  icon: typeof Rocket;
  desc: string;
  appBuiltIn?: boolean;
}

interface ServiceTier {
  id: string;
  label: string;
  tagline: string;
  color: string;
  icon: typeof Rocket;
  categories: ServiceCategory[];
}

const SERVICE_TIERS: ServiceTier[] = [
  {
    id: "build",
    label: "BUILD",
    tagline: "Idea to First Revenue (0 → 1)",
    color: "#14B8A6",
    icon: Rocket,
    categories: [
      { value: "idea-validation", label: "Idea Validation & Research", icon: Lightbulb, desc: "Problem-solution fit, market research, competitor mapping, and go/no-go framework" },
      { value: "mvp-development", label: "MVP & Proof of Concept", icon: Target, desc: "MVP design, offer structuring, pricing strategy, landing page, and early users" },
      { value: "launch-system", label: "Launch & First Revenue", icon: Rocket, desc: "Go-to-market strategy, brand identity, sales scripts, and launch campaign" },
      { value: "business-registration", label: "Business Registration & Setup", icon: FileText, desc: "Entity formation, tax ID, compliance, and bank account guidance", appBuiltIn: true },
      { value: "website-store", label: "Website & Online Store", icon: Globe, desc: "E-commerce store, booking page, landing pages, and domain setup", appBuiltIn: true },
      { value: "branding-identity", label: "Branding & Identity", icon: Palette, desc: "Logo, color palette, typography, brand guidelines, and social profiles", appBuiltIn: true },
    ],
  },
  {
    id: "grow",
    label: "GROW",
    tagline: "Revenue to Consistency (1 → 10)",
    color: "#F97316",
    icon: TrendingUp,
    categories: [
      { value: "marketing-engine", label: "Marketing Engine", icon: Megaphone, desc: "Funnel design, paid + organic strategy, content system, and lead automation", appBuiltIn: true },
      { value: "sales-system", label: "Sales & CRM System", icon: Users, desc: "Pipeline design, CRM setup, conversion optimization, and predictable revenue", appBuiltIn: true },
      { value: "operations-stability", label: "Operations & SOPs", icon: Settings, desc: "Workflow mapping, SOP creation, team structure, and delivery optimization", appBuiltIn: true },
      { value: "finance-accounting", label: "Finance & Accounting", icon: Calculator, desc: "Bookkeeping, invoicing, expense tracking, tax prep, and cash flow", appBuiltIn: true },
      { value: "legal-compliance", label: "Legal & Compliance", icon: Scale, desc: "Contracts, terms of service, privacy policies, and regulatory compliance" },
      { value: "content-media", label: "Content & Media Production", icon: FileText, desc: "Copywriting, video, photography, and content strategy" },
    ],
  },
  {
    id: "scale",
    label: "SCALE",
    tagline: "Systemization to Enterprise (10 → 100+)",
    color: "#8B5CF6",
    icon: Building2,
    categories: [
      { value: "automation-ai", label: "Business Automation & AI", icon: Bot, desc: "SOP digitization, AI copilots, workflow automation, and KPI dashboards", appBuiltIn: true },
      { value: "expansion-channels", label: "Multi-Channel Expansion", icon: Globe, desc: "New market entry, product expansion, partnerships, and distribution" },
      { value: "executive-structure", label: "Enterprise Architecture", icon: Building2, desc: "Org structure, leadership hiring, governance, and financial structuring" },
      { value: "analytics-reporting", label: "Analytics & Intelligence", icon: BarChart3, desc: "Custom dashboards, performance tracking, data insights, and reporting", appBuiltIn: true },
      { value: "tech-integration", label: "Tech & Integration", icon: Wrench, desc: "API connections, tool integrations, hosting, security, and maintenance" },
      { value: "hr-team", label: "HR & Team Building", icon: Shield, desc: "Hiring systems, onboarding, payroll, performance reviews, and training" },
    ],
  },
];

const CROSS_PRODUCTS = [
  { value: "digital-templates", label: "Digital Products & Templates", icon: FolderOpen, desc: "SOPs, pitch decks, financial models, funnels, and business kits" },
  { value: "education-training", label: "Education & Training", icon: GraduationCap, desc: "Masterclass courses, certifications, and founder training programs", appBuiltIn: true },
  { value: "coaching-advisory", label: "Coaching & Advisory", icon: BookOpen, desc: "1-on-1 strategy calls, growth accelerators, and pivot advisory" },
  { value: "subscription-bos", label: "Business Operating System", icon: Zap, desc: "Monthly access to tools, templates, strategy calls, and data insights", appBuiltIn: true },
  { value: "custom-project", label: "Custom Project", icon: Package, desc: "Something specific? Tell us exactly what you need" },
];

const BUDGET_OPTIONS = [
  { value: "micro", label: "Under $200" },
  { value: "starter", label: "$200 – $500" },
  { value: "growth", label: "$500 – $2,000" },
  { value: "scale", label: "$2,000 – $5,000" },
  { value: "enterprise", label: "$5,000+" },
  { value: "discuss", label: "Let's discuss" },
];

const URGENCY_OPTIONS = [
  { value: "low", label: "No rush" },
  { value: "normal", label: "This week" },
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
  const [businessStage, setBusinessStage] = useState("");

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
    setBusinessStage("");
    setError(null);
    setStep("browse");
  };

  const allCategories = [...SERVICE_TIERS.flatMap(t => t.categories), ...CROSS_PRODUCTS];
  const selectedCat = allCategories.find((c) => c.value === category);

  const selectCategory = (val: string, tier?: string) => {
    setCategory(val);
    setBusinessStage(tier || "");
    setStep("form");
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
          "fixed top-0 right-0 z-[61] h-full w-full sm:w-[460px] bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-out flex flex-col",
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
              <p className="text-[11px] text-muted-foreground">Business Progression Systems</p>
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
                <h3 className="text-base font-semibold mb-1">Idea to Enterprise. Fully handled.</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  We design, build, and scale businesses through fully integrated systems. Pick your stage, tell us what you need.
                </p>
              </div>

              {SERVICE_TIERS.map((tier) => {
                const TierIcon = tier.icon;
                return (
                  <div key={tier.id}>
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div
                        className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: `${tier.color}20` }}
                      >
                        <TierIcon className="w-3.5 h-3.5" style={{ color: tier.color }} />
                      </div>
                      <div>
                        <span className="text-[11px] font-bold tracking-wider" style={{ color: tier.color }}>{tier.label}</span>
                        <span className="text-[11px] text-muted-foreground ml-1.5">{tier.tagline}</span>
                      </div>
                    </div>
                    <div className="grid gap-1 ml-0.5">
                      {tier.categories.map((svc) => {
                        const SvcIcon = svc.icon;
                        return (
                          <button
                            key={svc.value}
                            onClick={() => selectCategory(svc.value, tier.id)}
                            className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border hover:border-muted-foreground/30 hover:bg-muted/50 transition-all text-left group"
                          >
                            <SvcIcon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-medium truncate">{svc.label}</span>
                                {svc.appBuiltIn && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0" style={{ background: `${tier.color}15`, color: tier.color }}>
                                    in-app
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-muted-foreground leading-tight block mt-0.5 line-clamp-1">{svc.desc}</span>
                            </div>
                            <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-foreground flex-shrink-0 transition-colors" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div>
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-muted">
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <span className="text-[11px] font-bold tracking-wider text-muted-foreground">PRODUCTS & PROGRAMS</span>
                </div>
                <div className="grid gap-1 ml-0.5">
                  {CROSS_PRODUCTS.map((svc) => {
                    const SvcIcon = svc.icon;
                    return (
                      <button
                        key={svc.value}
                        onClick={() => selectCategory(svc.value, "")}
                        className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border hover:border-muted-foreground/30 hover:bg-muted/50 transition-all text-left group"
                      >
                        <SvcIcon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-medium truncate">{svc.label}</span>
                            {svc.appBuiltIn && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-muted text-muted-foreground flex-shrink-0">
                                in-app
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground leading-tight block mt-0.5 line-clamp-1">{svc.desc}</span>
                        </div>
                        <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-foreground flex-shrink-0 transition-colors" />
                      </button>
                    );
                  })}
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
                  Browse full catalog with pricing
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
                {businessStage && (
                  <>
                    <span className="text-[10px] font-bold tracking-wider" style={{ color: SERVICE_TIERS.find(t => t.id === businessStage)?.color }}>
                      {businessStage.toUpperCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                  </>
                )}
                <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>
                  {selectedCat?.label}
                </span>
              </div>

              {selectedCat && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/50 border border-border">
                  <selectedCat.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">{selectedCat.desc}</p>
                  {selectedCat.appBuiltIn && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-[hsl(var(--kf-accent1))]/10 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }}>
                      also in-app
                    </span>
                  )}
                </div>
              )}

              <h3 className="text-base font-semibold">Tell us about your business</h3>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
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
                      Phone <span className="text-muted-foreground text-[10px]">(optional)</span>
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
                    What do you need? <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Tell us about your business, where you are now, what you're trying to achieve, and any specific challenges..."
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
                  <div className="grid grid-cols-3 gap-1.5">
                    {BUDGET_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setBudget(opt.value === budget ? "" : opt.value)}
                        className={cn(
                          "px-2 py-2 rounded-lg border text-xs font-medium transition-all",
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
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[300px] mb-6">
                Our team will review your request and reach out within 24 hours with a tailored plan for your business.
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
