"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Building2, 
  Package, 
  Users, 
  Zap, 
  Check, 
  ChevronRight, 
  ArrowLeft,
  Sparkles,
  Trophy,
  Rocket,
  MapPin,
  Wallet,
  Clock,
  User,
  UsersRound,
  Loader2,
  Bot
} from "lucide-react";
import { refreshWorkspace, getStoredBusinessId, getCachedBusiness } from "@/lib/workspace";
import { 
  fetchProducts, 
  fetchContacts, 
  fetchPlaybooks, 
  updateBusiness 
} from "@/lib/client";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  cta: string;
  skipLabel?: string;
}

const DETAILED_STEPS: OnboardingStep[] = [
  {
    id: "profile",
    title: "Set Up Your Business Profile",
    description: "Add your business name, logo, contact info, and branding colors. This information appears on invoices and quotes.",
    icon: Building2,
    href: "/app/settings/business",
    cta: "Complete Profile",
    skipLabel: "Skip for now",
  },
  {
    id: "products",
    title: "Add Your Products or Services",
    description: "Create your catalog of services, products, or packages. These will be used when creating quotes and invoices.",
    icon: Package,
    href: "/app/commerce?tab=products&action=new",
    cta: "Add First Product",
    skipLabel: "I'll do this later",
  },
  {
    id: "contacts",
    title: "Import Your Contacts",
    description: "Add your customers and leads. You can import from CSV, vCard, or add them manually.",
    icon: Users,
    href: "/app/crm/pipeline?action=import",
    cta: "Import Contacts",
    skipLabel: "Add contacts later",
  },
  {
    id: "automation",
    title: "Set Up Your First Automation",
    description: "Create a playbook to automatically follow up with customers after bookings or payments.",
    icon: Zap,
    href: "/app/automations?action=new",
    cta: "Create Playbook",
    skipLabel: "Skip automation",
  },
];

const ARCHETYPES = [
  { id: "LOCAL_SERVICE", label: "Local Service", icon: MapPin, desc: "Plumbers, cleaners, mobile services" },
  { id: "DIGITAL_PRODUCT", label: "Digital Products", icon: Package, desc: "Courses, templates, software" },
  { id: "AGENCY", label: "Agency / Consulting", icon: Users, desc: "Marketing, design, consulting" },
  { id: "CLINIC", label: "Clinic / Practice", icon: Building2, desc: "Medical, legal, professional" },
  { id: "ECOMMERCE", label: "E-commerce", icon: Wallet, desc: "Physical products, retail" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"autopilot" | "detailed">("autopilot");
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [businessIntent, setBusinessIntent] = useState("");
  const [location, setLocation] = useState("Trinidad and Tobago");
  const [budgetRange, setBudgetRange] = useState("MEDIUM");
  const [timeCommitment, setTimeCommitment] = useState("PART_TIME");
  const [teamSize, setTeamSize] = useState("SOLO");
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      const bid = fresh || getStoredBusinessId();
      if (bid) {
        setBusinessId(bid);
        const business = getCachedBusiness();
        if (business?.businessIntent) {
          setPhase("detailed");
          await checkProgress(bid);
        }
      }
      setLoading(false);
    };
    void init();
  }, []);

  async function checkProgress(bid: string) {
    const completed = new Set<string>();

    const [productsRes, contactsRes, playbooksRes] = await Promise.all([
      fetchProducts(bid),
      fetchContacts(bid),
      fetchPlaybooks(bid),
    ]);

    const business = getCachedBusiness();
    if (business && business.name && business.name.length > 0) {
      completed.add("profile");
    }
    if (productsRes.data && productsRes.data.length > 0) {
      completed.add("products");
    }
    if (contactsRes.data && contactsRes.data.length > 0) {
      completed.add("contacts");
    }
    if (playbooksRes.data && playbooksRes.data.length > 0) {
      completed.add("automation");
    }

    setCompletedSteps(completed);

    const firstIncomplete = DETAILED_STEPS.findIndex(s => !completed.has(s.id));
    if (firstIncomplete >= 0) {
      setCurrentStep(firstIncomplete);
    }
  }

  function inferArchetype(intent: string): string {
    const lower = intent.toLowerCase();
    if (lower.includes("service") || lower.includes("repair") || lower.includes("clean") || lower.includes("mobile") || lower.includes("plumb") || lower.includes("electric")) {
      return "LOCAL_SERVICE";
    }
    if (lower.includes("course") || lower.includes("template") || lower.includes("software") || lower.includes("app") || lower.includes("digital") || lower.includes("online")) {
      return "DIGITAL_PRODUCT";
    }
    if (lower.includes("agency") || lower.includes("consult") || lower.includes("marketing") || lower.includes("design") || lower.includes("freelance")) {
      return "AGENCY";
    }
    if (lower.includes("clinic") || lower.includes("doctor") || lower.includes("lawyer") || lower.includes("medical") || lower.includes("dental") || lower.includes("therapy")) {
      return "CLINIC";
    }
    if (lower.includes("shop") || lower.includes("store") || lower.includes("sell") || lower.includes("product") || lower.includes("retail") || lower.includes("ecommerce")) {
      return "ECOMMERCE";
    }
    return "LOCAL_SERVICE";
  }

  function inferIndustry(intent: string): string {
    const lower = intent.toLowerCase();
    if (lower.includes("car") || lower.includes("auto")) return "Automotive";
    if (lower.includes("beauty") || lower.includes("salon") || lower.includes("hair")) return "Beauty & Personal Care";
    if (lower.includes("food") || lower.includes("restaurant") || lower.includes("catering")) return "Food & Beverage";
    if (lower.includes("fitness") || lower.includes("gym") || lower.includes("yoga")) return "Health & Fitness";
    if (lower.includes("tech") || lower.includes("software") || lower.includes("app")) return "Technology";
    if (lower.includes("marketing") || lower.includes("advertising")) return "Marketing & Advertising";
    if (lower.includes("photo") || lower.includes("video")) return "Photography & Media";
    if (lower.includes("construction") || lower.includes("building")) return "Construction";
    if (lower.includes("education") || lower.includes("tutor") || lower.includes("training")) return "Education";
    return "Professional Services";
  }

  function inferRevenueModel(archetype: string): string {
    switch (archetype) {
      case "LOCAL_SERVICE": return "ONE_TIME";
      case "DIGITAL_PRODUCT": return "ONE_TIME";
      case "AGENCY": return "RETAINER";
      case "CLINIC": return "ONE_TIME";
      case "ECOMMERCE": return "ONE_TIME";
      default: return "ONE_TIME";
    }
  }

  async function handleAutopilotSubmit() {
    if (!businessId || !businessIntent.trim()) return;

    setSaving(true);
    const archetype = selectedArchetype || inferArchetype(businessIntent);
    const industry = inferIndustry(businessIntent);
    const revenueModel = inferRevenueModel(archetype);

    try {
      await updateBusiness({
        businessId,
        businessIntent: businessIntent.trim(),
        archetype,
        industry,
        revenueModel,
        budgetRange,
        timeCommitment,
        teamSize,
        autopilotEnabled: true,
        autopilotStage: "SETUP",
        complianceStatus: "GREEN",
        country: location,
        metaData: { 
          autopilotSetupAt: new Date().toISOString(),
          onboardingPhase: "detailed"
        },
      });

      setPhase("detailed");
      await checkProgress(businessId);
    } catch (err) {
      console.error("Failed to save autopilot settings:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleLaunchAutopilot() {
    if (!businessId) return;
    
    await updateBusiness({
      businessId,
      autopilotStage: "LAUNCHING",
      metaData: { 
        onboardingComplete: true, 
        onboardingCompletedAt: new Date().toISOString() 
      },
    });
    router.push("/app");
  }

  function handleStepAction(step: OnboardingStep) {
    router.push(step.href);
  }

  function handleSkip() {
    if (currentStep < DETAILED_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleLaunchAutopilot();
    }
  }

  const progress = phase === "autopilot" 
    ? (businessIntent ? 0.25 : 0) 
    : (completedSteps.size + 1) / (DETAILED_STEPS.length + 1);
  const currentStepData = DETAILED_STEPS[currentStep];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (phase === "autopilot") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-orange-950/10 p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/20 mb-4">
              <Bot className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-medium text-orange-500">Business Autopilot</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Tell Us About Your Business</h1>
            <p className="text-muted-foreground">
              Answer a few quick questions and we'll set everything up for you
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="kf-card p-6 md:p-8 space-y-6"
          >
            <div>
              <label className="block text-sm font-medium mb-2">
                What business do you want to run? <span className="text-red-500">*</span>
              </label>
              <textarea
                value={businessIntent}
                onChange={(e) => setBusinessIntent(e.target.value)}
                placeholder="e.g., I want to start a mobile car wash service for busy professionals..."
                className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all resize-none"
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Be specific - KeyFlowOS will auto-configure your business based on this
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                <MapPin className="w-4 h-4 inline mr-1" />
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-3">
                <Wallet className="w-4 h-4 inline mr-1" />
                Budget Range
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "LOW", label: "Low", desc: "< $500" },
                  { id: "MEDIUM", label: "Medium", desc: "$500-$2K" },
                  { id: "HIGH", label: "High", desc: "$2K+" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setBudgetRange(opt.id)}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      budgetRange === opt.id
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-border hover:border-border/80"
                    }`}
                  >
                    <span className="font-medium block">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-3">
                <Clock className="w-4 h-4 inline mr-1" />
                Time Commitment
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "MINIMAL", label: "Minimal", desc: "< 5 hrs/wk" },
                  { id: "PART_TIME", label: "Part-time", desc: "10-20 hrs" },
                  { id: "FULL_TIME", label: "Full-time", desc: "40+ hrs" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setTimeCommitment(opt.id)}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      timeCommitment === opt.id
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-border hover:border-border/80"
                    }`}
                  >
                    <span className="font-medium block">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-3">
                <User className="w-4 h-4 inline mr-1" />
                Team Size
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "SOLO", label: "Solo", icon: User },
                  { id: "SMALL_TEAM", label: "Small Team", icon: Users },
                  { id: "GROWING", label: "Growing", icon: UsersRound },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setTeamSize(opt.id)}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      teamSize === opt.id
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-border hover:border-border/80"
                    }`}
                  >
                    <opt.icon className="w-5 h-5 mx-auto mb-1" />
                    <span className="font-medium text-sm block">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {businessIntent.length > 10 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="p-4 rounded-xl bg-teal-500/10 border border-teal-500/20"
              >
                <p className="text-sm text-teal-400 mb-2">
                  <Sparkles className="w-4 h-4 inline mr-1" />
                  KeyFlowOS detected: <strong>{inferIndustry(businessIntent)}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  We'll configure your business as a {ARCHETYPES.find(a => a.id === inferArchetype(businessIntent))?.label || "service business"}
                </p>
              </motion.div>
            )}

            <button
              onClick={handleAutopilotSubmit}
              disabled={!businessIntent.trim() || saving}
              className="w-full kf-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Setting up your business...
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4" />
                  Launch Business Autopilot
                </>
              )}
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-orange-950/10 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 mb-4">
            <Check className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-green-500">Autopilot Active</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Fine-Tune Your Setup</h1>
          <p className="text-muted-foreground">
            Optional: Complete these steps to customize your business further
          </p>
        </motion.div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Setup Progress</span>
            <span className="text-sm font-medium">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500"
              initial={{ width: 0 }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>

        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {DETAILED_STEPS.map((step, index) => {
            const isCompleted = completedSteps.has(step.id);
            const isCurrent = index === currentStep;
            const Icon = step.icon;

            return (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all whitespace-nowrap ${
                  isCurrent
                    ? "border-orange-500 bg-orange-500/10 text-orange-500"
                    : isCompleted
                    ? "border-green-500/50 bg-green-500/10 text-green-500"
                    : "border-border text-muted-foreground hover:border-border/80"
                }`}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                <span className="text-sm font-medium">{step.title.split(" ").slice(0, 2).join(" ")}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="kf-card p-6 md:p-8"
          >
            {currentStepData && (
              <>
                <div className="flex items-start gap-4 mb-6">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0">
                    <currentStepData.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold mb-1">{currentStepData.title}</h2>
                    <p className="text-muted-foreground">{currentStepData.description}</p>
                  </div>
                </div>

                {completedSteps.has(currentStepData.id) ? (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20 mb-6">
                    <Check className="w-5 h-5 text-green-500" />
                    <span className="text-green-500 font-medium">This step is complete!</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-6">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    <span className="text-amber-500 font-medium">Complete this step to earn XP!</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => handleStepAction(currentStepData)}
                    className="kf-btn-primary flex-1 inline-flex items-center justify-center gap-2"
                  >
                    {currentStepData.cta}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  {currentStepData.skipLabel && (
                    <button
                      onClick={handleSkip}
                      className="kf-btn-secondary inline-flex items-center justify-center"
                    >
                      {currentStepData.skipLabel}
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            Previous
          </button>

          {currentStep === DETAILED_STEPS.length - 1 ? (
            <button
              onClick={handleLaunchAutopilot}
              className="inline-flex items-center gap-2 px-6 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-medium hover:opacity-90 transition-opacity"
            >
              <Trophy className="w-4 h-4" />
              Launch Autopilot
            </button>
          ) : (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={handleLaunchAutopilot}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Skip setup and go to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
