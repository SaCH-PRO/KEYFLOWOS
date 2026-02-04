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
  Rocket
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

const STEPS: OnboardingStep[] = [
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

export default function OnboardingPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      const bid = fresh || getStoredBusinessId();
      if (bid) {
        setBusinessId(bid);
        await checkProgress(bid);
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

    const firstIncomplete = STEPS.findIndex(s => !completed.has(s.id));
    if (firstIncomplete >= 0) {
      setCurrentStep(firstIncomplete);
    }
  }

  function handleStepAction(step: OnboardingStep) {
    router.push(step.href);
  }

  function handleSkip() {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleFinish();
    }
  }

  async function handleFinish() {
    if (businessId) {
      await updateBusiness({
        businessId,
        metaData: { onboardingComplete: true, onboardingCompletedAt: new Date().toISOString() },
      });
    }
    router.push("/app");
  }

  const progress = completedSteps.size / STEPS.length;
  const currentStepData = STEPS[currentStep];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/20 mb-4">
            <Rocket className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium text-orange-500">Getting Started</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Welcome to KEYFLOWOS</h1>
          <p className="text-muted-foreground">
            Let's set up your business in just a few steps
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
          {STEPS.map((step, index) => {
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

          {currentStep === STEPS.length - 1 ? (
            <button
              onClick={handleFinish}
              className="inline-flex items-center gap-2 px-6 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-medium hover:opacity-90 transition-opacity"
            >
              <Trophy className="w-4 h-4" />
              Complete Setup
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
      </div>
    </div>
  );
}
