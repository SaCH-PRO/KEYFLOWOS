"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Scissors,
  Dumbbell,
  Camera,
  Briefcase,
  UtensilsCrossed,
  ShoppingBag,
  Check,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Loader2,
  X,
  Copy,
  ExternalLink,
  Share2,
  MessageCircle,
  Bot,
  Send,
  ArrowRight,
  Rocket,
  DollarSign,
  Clock,
  Plus,
  Trash2,
  Globe,
  CheckCircle2,
} from "lucide-react";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import {
  fetchConciergeState,
  sendConciergeChat,
  conciergeAutoConfigure,
  conciergeDetectType,
  deferConciergeOnboarding,
  markConciergeComplete,
  fetchConciergeTemplatePreview,
  updateBusiness,
  createProduct,
  IndustryTemplatePreview,
} from "@/lib/client";
import { RedirectExplainerBanner } from "@/components/ui/redirect-explainer-banner";
import { useNavigationContext } from "@/lib/navigation-context";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";

interface TemplateCard {
  id: string;
  label: string;
  description: string;
  businessType: "Services" | "Products" | "Mixed";
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}

const TEMPLATES: TemplateCard[] = [
  {
    id: "salon",
    label: "Salon & Beauty",
    description: "Hair, nails, makeup, spa services",
    businessType: "Services",
    icon: Scissors,
    color: "--kf-accent1",
  },
  {
    id: "fitness",
    label: "Fitness & Wellness",
    description: "Gym, yoga, personal training, classes",
    businessType: "Services",
    icon: Dumbbell,
    color: "--kf-accent2",
  },
  {
    id: "photography",
    label: "Photography & Media",
    description: "Photo shoots, events, video production",
    businessType: "Services",
    icon: Camera,
    color: "--kf-info",
  },
  {
    id: "consulting",
    label: "Consulting & Services",
    description: "Coaching, freelance, professional services",
    businessType: "Services",
    icon: Briefcase,
    color: "--kf-warning",
  },
  {
    id: "food",
    label: "Food & Beverage",
    description: "Restaurant, catering, bakery, meal prep",
    businessType: "Mixed",
    icon: UtensilsCrossed,
    color: "--kf-error",
  },
  {
    id: "retail",
    label: "Retail & E-commerce",
    description: "Shop, boutique, online store, handmade",
    businessType: "Products",
    icon: ShoppingBag,
    color: "--kf-success",
  },
];

interface EditableProduct {
  name: string;
  price: number;
  currency: string;
  category: string;
  duration?: number;
  description?: string;
  included: boolean;
}

interface ConciergeActionLocal {
  id: string;
  label: string;
  type: "confirm" | "customize" | "skip" | "navigate";
  href?: string;
}

interface ChatMsg {
  role: "assistant" | "user";
  content: string;
  quickReplies?: string[];
  actions?: ConciergeActionLocal[];
}

interface ConciergeMilestone {
  id: string;
  label: string;
  completed: boolean;
  route: string;
}

interface ConciergeNextBestAction {
  id: string;
  label: string;
  description: string;
  route: string;
  priority: "high" | "medium" | "low";
}

const STEPS = [
  { label: "Business Type", number: 1 },
  { label: "Your First Offering", number: 2 },
  { label: "Go Live", number: 3 },
];

const STEP_KEY_MAP: Record<string, number> = {
  products: 1,
  hours: 1,
  storefront: 2,
  payments: 2,
};

const PAIN_OPTIONS = [
  "Missed follow-ups",
  "Late invoice payments",
  "Underbooked calendar",
  "Unclear daily priorities",
] as const;

const AUTOMATION_OPTIONS = [
  "Overdue invoice reminders",
  "Lead follow-up sequence",
  "Booking confirmation flow",
  "Daily priorities summary",
] as const;

const REPLACING_OPTIONS = [
  "Spreadsheets",
  "Multiple disconnected apps",
  "Mostly manual process",
  "First business system",
] as const;

type FirstWinId = "invoice" | "followup" | "booking" | "payments";

const FIRST_WIN_OPTIONS: Array<{
  id: FirstWinId;
  title: string;
  description: string;
  route: string;
}> = [
  {
    id: "invoice",
    title: "Send first invoice",
    description: "Create and send your first invoice now.",
    route: "/app/commerce?tab=invoices",
  },
  {
    id: "followup",
    title: "Launch lead follow-up",
    description: "Create a follow-up sequence for stale leads.",
    route: "/app/crm/pipeline",
  },
  {
    id: "booking",
    title: "Publish booking page",
    description: "Share your booking link and fill your calendar.",
    route: "/app/bookings",
  },
  {
    id: "payments",
    title: "Connect payment methods",
    description: "Enable faster collection and reminders.",
    route: "/app/settings/connections",
  },
];

const COREBLUEPRINT_PILLARS = [
  {
    title: "Identity Core",
    description: "Capture your business model, pain points, and priorities.",
  },
  {
    title: "Adaptive Blueprint",
    description: "Auto-configure products, hours, payments, and storefront setup.",
  },
  {
    title: "Grand Opening Momentum",
    description: "Launch your page, share your link, and complete your first real win.",
  },
] as const;

const STAGE_LABEL: Record<string, string> = {
  not_started: "Not started",
  profiled: "Profiled",
  configured: "Configured",
  launched: "Launched",
  activated: "Activated",
  deferred: "Deferred",
  completed: "Completed",
};

function getPublicPageUrl(businessId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/book/${businessId}`;
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const done = current > i;
        const active = current === i;
        return (
          <div key={step.number} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className="w-8 h-px"
                style={{
                  background: done
                    ? "hsl(var(--kf-accent1))"
                    : "hsl(var(--kf-border) / 0.4)",
                }}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
                style={{
                  background: done
                    ? "hsl(var(--kf-accent1))"
                    : active
                      ? "hsl(var(--kf-accent1) / 0.15)"
                      : "hsl(var(--kf-muted) / 0.3)",
                  color: done
                    ? "white"
                    : active
                      ? "hsl(var(--kf-accent1))"
                      : "hsl(var(--kf-muted-foreground))",
                }}
              >
                {done ? <Check className="w-3 h-3" /> : step.number}
              </div>
              <span
                className="text-xs font-medium hidden sm:inline"
                style={{
                  color: active
                    ? "hsl(var(--kf-foreground))"
                    : "hsl(var(--kf-muted-foreground))",
                }}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HelpDrawer({
  open,
  onClose,
  businessId,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your setup assistant. Ask me anything about getting your business online — pricing advice, what to offer first, or how KeyFlowOS works.",
      quickReplies: ["What should I charge?", "Help me pick a business type", "How does the public page work?"],
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || sending) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setSending(true);
    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await sendConciergeChat(businessId, msg, history);
      if (res.data) {
        const responseActions = res.data!.actions as ConciergeActionLocal[] | undefined;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.data!.content,
            quickReplies: res.data!.quickReplies,
            actions: responseActions,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I had trouble with that. Try again?",
        },
      ]);
    }
    setSending(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{ background: "hsl(var(--kf-background) / 0.6)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-sm z-50 flex flex-col border-l"
            style={{
              background: "hsl(var(--kf-background))",
              borderColor: "hsl(var(--kf-border) / 0.4)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "hsl(var(--kf-border) / 0.4)" }}>
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  }}
                >
                  <Bot className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-foreground))" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold">Setup Assistant</p>
                  <p className="text-[10px] text-muted-foreground">
                    Ask me anything
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className="space-y-2">
                  <div
                    className="flex"
                    style={{ justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
                  >
                    <div
                      className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
                      style={
                        m.role === "user"
                          ? {
                              background:
                                "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                              color: "hsl(var(--kf-foreground))",
                            }
                          : {
                              background: "hsl(var(--kf-muted) / 0.3)",
                              border: "1px solid hsl(var(--kf-border) / 0.4)",
                            }
                      }
                    >
                      {m.content}
                    </div>
                  </div>
                  {i === messages.length - 1 && !sending && (
                    <>
                      {m.actions && m.actions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pl-1">
                          {m.actions.map((action) => (
                            <button
                              key={action.id}
                              onClick={() => {
                                if (action.type === "navigate" && action.href) {
                                  window.location.href = action.href;
                                } else {
                                  handleSend(action.label);
                                }
                              }}
                              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all hover:scale-[1.02]"
                              style={{
                                background: action.type === "confirm"
                                  ? "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))"
                                  : "hsl(var(--kf-muted) / 0.2)",
                                border: action.type === "confirm"
                                  ? "none"
                                  : "1px solid hsl(var(--kf-border) / 0.3)",
                                color: action.type === "confirm"
                                  ? "hsl(var(--kf-foreground))"
                                  : "hsl(var(--kf-accent1))",
                              }}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {m.quickReplies && m.quickReplies.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pl-1">
                          {m.quickReplies.map((reply) => (
                            <button
                              key={reply}
                              onClick={() => handleSend(reply)}
                              className="px-2.5 py-1 text-[11px] font-medium rounded-full transition-all hover:scale-[1.02]"
                              style={{
                                background: "hsl(var(--kf-accent1) / 0.08)",
                                border: "1px solid hsl(var(--kf-accent1) / 0.2)",
                                color: "hsl(var(--kf-accent1))",
                              }}
                            >
                              {reply}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 px-3.5 py-2 rounded-2xl bg-muted/30 border border-border/40">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="px-4 py-3 border-t" style={{ borderColor: "hsl(var(--kf-border) / 0.4)" }}>
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask a question..."
                  className="flex-1 bg-muted/20 border border-border/40 rounded-xl px-3 py-2 text-sm focus:outline-none transition-all"
                  style={{ borderColor: "hsl(var(--kf-border) / 0.4)" }}
                  disabled={sending}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || sending}
                  className="p-2 rounded-xl disabled:opacity-30 transition-all"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    color: "hsl(var(--kf-foreground))",
                  }}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getOriginContext, setCurrentMeta, setTaskOrigin, getTaskOrigin } = useNavigationContext();
  const originSnapshotRef = useRef<ReturnType<typeof getOriginContext>>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [resumeTaskId, setResumeTaskId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [configuring, setConfiguring] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activationProfile, setActivationProfile] = useState({
    businessType: "",
    primaryPain: "",
    firstAutomation: "",
    replacingSystem: "",
  });
  const [selectedFirstWin, setSelectedFirstWin] = useState<FirstWinId | null>(null);
  const [savingFirstWin, setSavingFirstWin] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [conciergeMilestones, setConciergeMilestones] = useState<ConciergeMilestone[]>([]);
  const [conciergeNextBestActions, setConciergeNextBestActions] = useState<ConciergeNextBestAction[]>([]);
  const [onboardingStage, setOnboardingStage] = useState<keyof typeof STAGE_LABEL>("not_started");
  const [firstWinAchieved, setFirstWinAchieved] = useState(false);

  const profileComplete = useMemo(
    () =>
      Boolean(
        activationProfile.businessType &&
          activationProfile.primaryPain &&
          activationProfile.firstAutomation &&
          activationProfile.replacingSystem
      ),
    [activationProfile],
  );

  const checklist = useMemo(
    () => [
      { label: "Business profile answers", done: profileComplete },
      { label: "Template selected", done: Boolean(selectedTemplate) },
      { label: "First offering configured", done: step >= 2 && products.some((p) => p.included && p.name.trim()) },
      { label: "Public page live", done: Boolean(publicUrl) },
      { label: "First win selected", done: Boolean(selectedFirstWin) },
    ],
    [profileComplete, products, publicUrl, selectedFirstWin, selectedTemplate, step],
  );

  const onboardingStageLabel = STAGE_LABEL[onboardingStage] ?? "Not started";
  const completedMilestoneCount = conciergeMilestones.filter((milestone) => milestone.completed).length;
  const activeMomentumActions = conciergeNextBestActions.slice(0, 3);

  useEffect(() => {
    originSnapshotRef.current = getOriginContext();
  }, [getOriginContext]);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      const bid = fresh || getStoredBusinessId();
      if (!bid) {
        setLoading(false);
        return;
      }
      setBusinessId(bid);

      const queryStep = searchParams.get("step");
      const numericStep = queryStep ? parseInt(queryStep, 10) : NaN;
      const requestedStep = !isNaN(numericStep) ? numericStep : (queryStep && queryStep in STEP_KEY_MAP ? STEP_KEY_MAP[queryStep] : null);

      try {
        const stateRes = await fetchConciergeState(bid);
        if (stateRes.data) {
          setConciergeMilestones(stateRes.data.milestones ?? []);
          setConciergeNextBestActions(stateRes.data.nextBestActions ?? []);
          if (stateRes.data.onboardingState?.stage) {
            setOnboardingStage(stateRes.data.onboardingState.stage);
          }
          setFirstWinAchieved(Boolean(stateRes.data.onboardingState?.firstWinAchieved));

          const profileFromMeta =
            stateRes.data.metaData &&
            typeof stateRes.data.metaData === "object" &&
            "activationProfile" in stateRes.data.metaData
              ? (stateRes.data.metaData.activationProfile as
                  | {
                      businessType?: string;
                      primaryPain?: string;
                      firstAutomation?: string;
                      replacingSystem?: string;
                    }
                  | null)
              : null;
          if (profileFromMeta) {
            setActivationProfile((prev) => ({
              businessType: profileFromMeta.businessType ?? prev.businessType,
              primaryPain: profileFromMeta.primaryPain ?? prev.primaryPain,
              firstAutomation: profileFromMeta.firstAutomation ?? prev.firstAutomation,
              replacingSystem: profileFromMeta.replacingSystem ?? prev.replacingSystem,
            }));
          }

          const firstWinFromMeta =
            stateRes.data.metaData &&
            typeof stateRes.data.metaData === "object" &&
            "firstWin" in stateRes.data.metaData
              ? (stateRes.data.metaData.firstWin as FirstWinId | null)
              : null;
          if (firstWinFromMeta) {
            setSelectedFirstWin(firstWinFromMeta);
          }

          if (stateRes.data.templateId) {
            setSelectedTemplate(stateRes.data.templateId);
            const previewRes = await fetchConciergeTemplatePreview(bid, stateRes.data.templateId);
            if (previewRes.data) {
              setProducts(
                previewRes.data.products.map((p: IndustryTemplatePreview["products"][0]) => ({ ...p, included: true }))
              );
            }
            if (stateRes.data.setupStatus.products) {
              setPublicUrl(getPublicPageUrl(bid));
              setStep(requestedStep !== null && requestedStep >= 0 && requestedStep <= 2 ? requestedStep : 2);
            } else {
              setStep(requestedStep !== null && requestedStep >= 0 && requestedStep <= 1 ? requestedStep : 1);
            }
          } else if (requestedStep === 0 || requestedStep === null) {
            setStep(0);
          }
        }
      } catch (err) {
        console.error("Failed to init onboarding:", err);
      }
      setLoading(false);

      const origin = originSnapshotRef.current;
      const taskId = registerInterruptedTask({
        id: `onboarding-${bid}`,
        module: "onboarding",
        label: "Business Setup",
        description: "Complete your business configuration to start using the app",
        route: "/app/onboarding",
        draftId: null,
        originRoute: origin?.route ?? null,
        originLabel: origin?.workspace ?? null,
        taskIntent: "onboarding-setup",
        formData: null,
      });
      setResumeTaskId(taskId);
      setCurrentMeta({ taskIntent: "onboarding-setup" });
    };
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSelectTemplate = async (templateId: string) => {
    if (!businessId) return;
    if (!profileComplete) {
      setSetupError("Answer all four setup questions first so we can tailor your onboarding.");
      return;
    }
    setSetupError(null);
    setSelectedTemplate(templateId);
    const template = TEMPLATES.find((t) => t.id === templateId);

    try {
      await conciergeDetectType(businessId, template?.label || templateId);
      await updateBusiness({
        businessId,
        businessIntent: template?.label || templateId,
        industry: template?.label || templateId,
        metaData: {
          conciergeTemplateId: templateId,
          activationProfile,
          onboardingStep: 1,
        },
      });

      const previewRes = await fetchConciergeTemplatePreview(businessId, templateId);
      if (previewRes.data) {
        setProducts(
          previewRes.data.products.map((p: IndustryTemplatePreview["products"][0]) => ({ ...p, included: true }))
        );
      }
    } catch (err) {
      console.error("Template select error:", err);
    }

    setStep(1);
  };

  const handleProductToggle = (index: number) => {
    setProducts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, included: !p.included } : p))
    );
  };

  const handleProductEdit = (index: number, field: keyof EditableProduct, value: string | number) => {
    setProducts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  };

  const handleAddProduct = () => {
    setProducts((prev) => [
      ...prev,
      {
        name: "",
        price: 0,
        currency: "TTD",
        category: "SERVICE",
        included: true,
      },
    ]);
  };

  const handleRemoveProduct = (index: number) => {
    setProducts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConfigure = async () => {
    if (!businessId || !selectedTemplate || configuring) return;
    setConfiguring(true);
    try {
      const includedProducts = products.filter(
        (p) => p.included && p.name.trim()
      );

      for (const p of includedProducts) {
        await createProduct({
          businessId,
          name: p.name,
          price: p.price,
          currency: p.currency || "TTD",
          category: p.category || "SERVICE",
          duration: p.duration || null,
          description: p.description,
          isActive: true,
        });
      }

      await conciergeAutoConfigure(businessId, selectedTemplate, {
        createProducts: false,
        setBusinessHours: true,
        setPaymentMethods: true,
        configureStorefront: true,
      });

      await updateBusiness({
        businessId,
        storeEnabled: true,
        metaData: {
          conciergeTemplateId: selectedTemplate,
          onboardingStep: 2,
          onboardingState: {
            stage: "launched",
            firstWin: "storefront_live",
            firstWinAchieved: true,
            lastUpdatedAt: new Date().toISOString(),
          },
        },
      });

      setOnboardingStage("launched");
      setFirstWinAchieved(true);
      setPublicUrl(getPublicPageUrl(businessId));
      setStep(2);
    } catch (err) {
      console.error("Configure error:", err);
    }
    setConfiguring(false);
  };

  const handleCopyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = publicUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShareWhatsApp = () => {
    if (!publicUrl) return;
    const text = encodeURIComponent(
      `Check out my business! Book or shop here: ${publicUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const handleShareSocial = async () => {
    if (!publicUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "My Business on KeyFlowOS",
          text: "Check out my business page!",
          url: publicUrl,
        });
      } catch {
        window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent("Check out my business page!")}`, "_blank");
      }
    } else {
      handleCopyLink();
    }
  };

  const handleFinish = async () => {
    if (businessId) {
      await markConciergeComplete(businessId);
    }
    if (resumeTaskId) markTaskCompleted(resumeTaskId);
    const firstWinTarget = FIRST_WIN_OPTIONS.find((option) => option.id === selectedFirstWin)?.route;
    const returnEntry = getTaskOrigin();
    setTaskOrigin(null);
    router.push(firstWinTarget ?? returnEntry?.route ?? "/app");
  };

  const handleSelectFirstWin = async (firstWin: FirstWinId) => {
    if (!businessId || savingFirstWin) return;
    setSavingFirstWin(true);
    setSelectedFirstWin(firstWin);
    try {
      await updateBusiness({
        businessId,
        metaData: {
          onboardingStep: 3,
          firstWin,
          activationProfile,
        },
      });
      setFirstWinAchieved(true);
    } catch (err) {
      console.error("Failed to save first win:", err);
    } finally {
      setSavingFirstWin(false);
    }
  };

  const handleSkip = async () => {
    if (resumeTaskId) markTaskCompleted(resumeTaskId);
    if (businessId) {
      await deferConciergeOnboarding(businessId);
    }
    const returnEntry = getTaskOrigin();
    setTaskOrigin(null);
    router.push(returnEntry?.route ?? "/app");
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <div
            className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center animate-pulse"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            }}
          >
            <Rocket className="w-6 h-6" style={{ color: "hsl(var(--kf-foreground))" }} />
          </div>
          <p className="text-sm text-muted-foreground">
            Preparing your setup...
          </p>
        </div>
      </div>
    );
  }

  const origin = getOriginContext();
  const wasRedirected = !!origin && origin.taskIntent !== "onboarding-setup";

  return (
    <div className="h-full flex flex-col bg-background">
      {wasRedirected && origin && (
        <div className="px-4 sm:px-6 pt-3">
          <RedirectExplainerBanner
            reason="Business setup is required before using the app"
            missingRequirement="Complete your business profile and initial configuration"
            postCompletionNote="After finishing setup you'll be taken to the dashboard"
            primaryCta={{ label: "Complete Setup" }}
            backCta={{
              label: `Back to ${origin.workspace ?? "Previous"}${origin.tab ? ` › ${origin.tab.charAt(0).toUpperCase() + origin.tab.slice(1)}` : ""}`,
              href: origin.route,
            }}
            variant="info"
          />
        </div>
      )}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b" style={{ borderColor: "hsl(var(--kf-border) / 0.4)" }}>
        <StepIndicator current={step} />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-[1.02]"
            style={{
              background: "hsl(var(--kf-accent1) / 0.1)",
              color: "hsl(var(--kf-accent1))",
              border: "1px solid hsl(var(--kf-accent1) / 0.2)",
            }}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Need help?
          </button>
          <button
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-all px-2 py-1.5"
          >
            Skip
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-4">
        <div
          className="rounded-xl p-3 mb-3"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.05))",
            border: "1px solid hsl(var(--kf-accent1) / 0.2)",
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2 text-muted-foreground">
            CoreBlueprint Activation
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {COREBLUEPRINT_PILLARS.map((pillar) => (
              <div
                key={pillar.title}
                className="rounded-lg px-3 py-2"
                style={{
                  background: "hsl(var(--kf-background) / 0.65)",
                  border: "1px solid hsl(var(--kf-border) / 0.2)",
                }}
              >
                <p className="text-xs font-semibold">{pillar.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{pillar.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-xl p-3"
          style={{
            background: "hsl(var(--kf-muted) / 0.12)",
            border: "1px solid hsl(var(--kf-border) / 0.35)",
          }}
        >
          <p className="text-xs font-semibold mb-2">Setup progress checklist</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-xs">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={{
                    background: item.done ? "hsl(var(--kf-success) / 0.18)" : "hsl(var(--kf-muted) / 0.3)",
                    color: item.done ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))",
                  }}
                >
                  {item.done ? <Check className="w-2.5 h-2.5" /> : item.label[0]}
                </div>
                <span className="text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div
              className="rounded-lg px-2.5 py-2"
              style={{
                background: "hsl(var(--kf-background) / 0.6)",
                border: "1px solid hsl(var(--kf-border) / 0.25)",
              }}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Current onboarding stage</p>
              <p className="text-xs font-semibold">{onboardingStageLabel}</p>
            </div>
            <div
              className="rounded-lg px-2.5 py-2"
              style={{
                background: "hsl(var(--kf-background) / 0.6)",
                border: "1px solid hsl(var(--kf-border) / 0.25)",
              }}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Completed milestones</p>
              <p className="text-xs font-semibold">
                {completedMilestoneCount}/{Math.max(conciergeMilestones.length, checklist.length)}
              </p>
            </div>
            <div
              className="rounded-lg px-2.5 py-2"
              style={{
                background: "hsl(var(--kf-background) / 0.6)",
                border: "1px solid hsl(var(--kf-border) / 0.25)",
              }}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Grand opening status</p>
              <p className="text-xs font-semibold">
                {firstWinAchieved ? "First win unlocked" : "Pending launch momentum"}
              </p>
            </div>
          </div>
          {conciergeMilestones.length > 0 && (
            <div className="mt-3 grid gap-1 sm:grid-cols-2">
              {conciergeMilestones.slice(0, 4).map((milestone) => (
                <button
                  key={milestone.id}
                  onClick={() => router.push(milestone.route)}
                  className="text-left rounded-lg px-2.5 py-2 text-xs transition-all hover:bg-muted/20"
                  style={{
                    border: "1px solid hsl(var(--kf-border) / 0.22)",
                    background: "hsl(var(--kf-background) / 0.55)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-full inline-flex items-center justify-center"
                      style={{
                        background: milestone.completed
                          ? "hsl(var(--kf-success) / 0.18)"
                          : "hsl(var(--kf-muted) / 0.32)",
                        color: milestone.completed
                          ? "hsl(var(--kf-success))"
                          : "hsl(var(--kf-muted-foreground))",
                      }}
                    >
                      {milestone.completed ? <Check className="w-2.5 h-2.5" /> : "•"}
                    </span>
                    <span className="font-medium">{milestone.label}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="step-0"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="max-w-2xl mx-auto px-4 sm:px-6 py-8"
            >
              <div className="text-center mb-8">
                <div
                  className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.1))",
                  }}
                >
                  <Sparkles
                    className="w-7 h-7"
                    style={{ color: "hsl(var(--kf-accent1))" }}
                  />
                </div>
                <h1 className="text-xl font-bold mb-2">
                  What type of business do you run?
                </h1>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  We&apos;ll set up your account with smart defaults — pricing in
                  TTD, hours, and services tailored to your industry.
                </p>
              </div>

              <div
                className="rounded-xl p-4 mb-6 space-y-3"
                style={{
                  background: "hsl(var(--kf-muted) / 0.12)",
                  border: "1px solid hsl(var(--kf-border) / 0.35)",
                }}
              >
                <p className="text-sm font-semibold">Quick setup profile</p>

                <div>
                  <p className="text-xs mb-1 text-muted-foreground">What business type best matches you?</p>
                  <div className="flex flex-wrap gap-2">
                    {["Services", "Products", "Mixed"].map((option) => (
                      <button
                        key={option}
                        onClick={() => setActivationProfile((prev) => ({ ...prev, businessType: option }))}
                        className="px-2.5 py-1.5 rounded-lg text-xs transition-all"
                        style={{
                          background:
                            activationProfile.businessType === option
                              ? "hsl(var(--kf-accent1) / 0.16)"
                              : "hsl(var(--kf-muted) / 0.25)",
                          color:
                            activationProfile.businessType === option
                              ? "hsl(var(--kf-accent1))"
                              : "hsl(var(--kf-muted-foreground))",
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs mb-1 text-muted-foreground">Biggest pain right now?</p>
                  <div className="flex flex-wrap gap-2">
                    {PAIN_OPTIONS.map((option) => (
                      <button
                        key={option}
                        onClick={() => setActivationProfile((prev) => ({ ...prev, primaryPain: option }))}
                        className="px-2.5 py-1.5 rounded-lg text-xs transition-all"
                        style={{
                          background:
                            activationProfile.primaryPain === option
                              ? "hsl(var(--kf-accent1) / 0.16)"
                              : "hsl(var(--kf-muted) / 0.25)",
                          color:
                            activationProfile.primaryPain === option
                              ? "hsl(var(--kf-accent1))"
                              : "hsl(var(--kf-muted-foreground))",
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs mb-1 text-muted-foreground">What should we automate first?</p>
                  <div className="flex flex-wrap gap-2">
                    {AUTOMATION_OPTIONS.map((option) => (
                      <button
                        key={option}
                        onClick={() => setActivationProfile((prev) => ({ ...prev, firstAutomation: option }))}
                        className="px-2.5 py-1.5 rounded-lg text-xs transition-all"
                        style={{
                          background:
                            activationProfile.firstAutomation === option
                              ? "hsl(var(--kf-accent1) / 0.16)"
                              : "hsl(var(--kf-muted) / 0.25)",
                          color:
                            activationProfile.firstAutomation === option
                              ? "hsl(var(--kf-accent1))"
                              : "hsl(var(--kf-muted-foreground))",
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs mb-1 text-muted-foreground">What are you replacing?</p>
                  <div className="flex flex-wrap gap-2">
                    {REPLACING_OPTIONS.map((option) => (
                      <button
                        key={option}
                        onClick={() => setActivationProfile((prev) => ({ ...prev, replacingSystem: option }))}
                        className="px-2.5 py-1.5 rounded-lg text-xs transition-all"
                        style={{
                          background:
                            activationProfile.replacingSystem === option
                              ? "hsl(var(--kf-accent1) / 0.16)"
                              : "hsl(var(--kf-muted) / 0.25)",
                          color:
                            activationProfile.replacingSystem === option
                              ? "hsl(var(--kf-accent1))"
                              : "hsl(var(--kf-muted-foreground))",
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                {setupError && (
                  <p className="text-xs" style={{ color: "hsl(var(--kf-error))" }}>
                    {setupError}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {TEMPLATES.map((t) => {
                  const Icon = t.icon;
                  const isSelected = selectedTemplate === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTemplate(t.id)}
                      disabled={!profileComplete}
                      className="relative rounded-xl p-4 text-left transition-all hover:scale-[1.02]"
                      style={{
                        background: isSelected
                          ? "hsl(var(--kf-accent1) / 0.08)"
                          : "hsl(var(--kf-muted) / 0.15)",
                        border: isSelected
                          ? "2px solid hsl(var(--kf-accent1) / 0.5)"
                          : "1px solid hsl(var(--kf-border) / 0.3)",
                        opacity: profileComplete ? 1 : 0.45,
                      }}
                    >
                      {isSelected && (
                        <div
                          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{
                            background: "hsl(var(--kf-accent1))",
                          }}
                        >
                          <Check className="w-3 h-3" style={{ color: "hsl(var(--kf-foreground))" }} />
                        </div>
                      )}
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                        style={{ background: `hsl(var(${t.color}) / 0.12)` }}
                      >
                        <Icon
                          className="w-5 h-5"
                          style={{ color: `hsl(var(${t.color}))` }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-semibold">
                          {t.label}
                        </p>
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                          style={{
                            background: t.businessType === "Services"
                              ? "hsl(var(--kf-accent2) / 0.12)"
                              : t.businessType === "Products"
                                ? "hsl(var(--kf-accent1) / 0.12)"
                                : "hsl(var(--kf-warning) / 0.12)",
                            color: t.businessType === "Services"
                              ? "hsl(var(--kf-accent2))"
                              : t.businessType === "Products"
                                ? "hsl(var(--kf-accent1))"
                                : "hsl(var(--kf-warning))",
                          }}
                        >
                          {t.businessType}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {t.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="max-w-2xl mx-auto px-4 sm:px-6 py-8"
            >
              <div className="mb-6">
                <button
                  onClick={() => setStep(0)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-all mb-4"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Change business type
                </button>
                <h1 className="text-xl font-bold mb-2">
                  Your first offerings
                </h1>
                <p className="text-sm text-muted-foreground">
                  We&apos;ve pre-filled popular{" "}
                  {TEMPLATES.find((t) => t.id === selectedTemplate)?.label.toLowerCase() || "business"}{" "}
                  offerings with TTD pricing. Edit, add, or remove as needed.
                </p>
              </div>

              <div className="space-y-2 mb-6">
                {products.map((product, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-3 transition-all"
                    style={{
                      background: product.included
                        ? "hsl(var(--kf-muted) / 0.15)"
                        : "hsl(var(--kf-muted) / 0.08)",
                      border: product.included
                        ? "1px solid hsl(var(--kf-border) / 0.3)"
                        : "1px solid hsl(var(--kf-border) / 0.15)",
                      opacity: product.included ? 1 : 0.5,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => handleProductToggle(i)}
                        className="mt-1 flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all"
                        style={{
                          background: product.included
                            ? "hsl(var(--kf-accent1))"
                            : "hsl(var(--kf-muted) / 0.3)",
                          border: product.included
                            ? "none"
                            : "1px solid hsl(var(--kf-border) / 0.4)",
                        }}
                      >
                        {product.included && (
                          <Check className="w-3 h-3" style={{ color: "hsl(var(--kf-foreground))" }} />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <input
                            value={product.name}
                            onChange={(e) =>
                              handleProductEdit(i, "name", e.target.value)
                            }
                            className="flex-1 bg-transparent text-sm font-medium focus:outline-none border-b border-transparent focus:border-muted-foreground/30 transition-all"
                            placeholder="Service or product name"
                          />
                          <button
                            onClick={() => handleRemoveProduct(i)}
                            className="p-1 rounded text-muted-foreground/50 transition-all"
                            style={{ ["--hover-color" as string]: "hsl(var(--kf-error))" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "hsl(var(--kf-error))")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <div className="flex items-center gap-1">
                            <DollarSign
                              className="w-3 h-3"
                              style={{
                                color: "hsl(var(--kf-accent1))",
                              }}
                            />
                            <input
                              type="number"
                              value={product.price}
                              onChange={(e) =>
                                handleProductEdit(
                                  i,
                                  "price",
                                  Number(e.target.value)
                                )
                              }
                              className="w-16 bg-transparent focus:outline-none border-b border-transparent focus:border-muted-foreground/30 transition-all"
                            />
                            <span className="text-muted-foreground">TTD</span>
                          </div>
                          {product.duration !== undefined &&
                            product.duration > 0 && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                <input
                                  type="number"
                                  value={product.duration}
                                  onChange={(e) =>
                                    handleProductEdit(
                                      i,
                                      "duration",
                                      Number(e.target.value)
                                    )
                                  }
                                  className="w-10 bg-transparent focus:outline-none border-b border-transparent focus:border-muted-foreground/30 transition-all"
                                />
                                <span>min</span>
                              </div>
                            )}
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              background: "hsl(var(--kf-accent2) / 0.1)",
                              color: "hsl(var(--kf-accent2))",
                            }}
                          >
                            {product.category}
                          </span>
                        </div>
                        {product.description && (
                          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                            {product.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleAddProduct}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all hover:scale-[1.01]"
                style={{
                  background: "hsl(var(--kf-muted) / 0.1)",
                  border: "1px dashed hsl(var(--kf-border) / 0.4)",
                  color: "hsl(var(--kf-muted-foreground))",
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add another offering
              </button>

              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={() => setStep(0)}
                  className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleConfigure}
                  disabled={
                    configuring ||
                    products.filter((p) => p.included && p.name.trim()).length ===
                      0
                  }
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 transition-all hover:scale-[1.02]"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    color: "hsl(var(--kf-foreground))",
                  }}
                >
                  {configuring ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      Set up & go live
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="max-w-lg mx-auto px-4 sm:px-6 py-8"
            >
              <div className="text-center mb-8">
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", damping: 10 }}
                  className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-success) / 0.15), hsl(var(--kf-accent2) / 0.1))",
                  }}
                >
                  <CheckCircle2
                    className="w-8 h-8"
                    style={{ color: "hsl(var(--kf-success))" }}
                  />
                </motion.div>
                <h1 className="text-xl font-bold mb-2">You&apos;re live!</h1>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Your business is set up and ready for customers. Share your
                  link to start receiving bookings and orders.
                </p>
              </div>

              {publicUrl && (
                <div
                  className="rounded-xl overflow-hidden mb-6"
                  style={{
                    border: "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  <div
                    className="w-full h-48 relative"
                    style={{
                      background: "hsl(var(--kf-muted) / 0.1)",
                    }}
                  >
                    <iframe
                      src={publicUrl}
                      className="w-full h-full pointer-events-none"
                      title="Your public page preview"
                      style={{ transform: "scale(0.5)", transformOrigin: "top left", width: "200%", height: "200%" }}
                    />
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all hover:scale-105"
                      style={{
                        background: "hsl(var(--kf-background) / 0.9)",
                        border: "1px solid hsl(var(--kf-border) / 0.3)",
                        color: "hsl(var(--kf-accent1))",
                      }}
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open full page
                    </a>
                  </div>

                  <div className="p-4" style={{ background: "hsl(var(--kf-muted) / 0.15)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Globe
                        className="w-4 h-4"
                        style={{ color: "hsl(var(--kf-accent1))" }}
                      />
                      <span className="text-xs font-medium">
                        Your public link
                      </span>
                    </div>
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2 mb-4"
                    style={{
                      background: "hsl(var(--kf-muted) / 0.2)",
                      border: "1px solid hsl(var(--kf-border) / 0.2)",
                    }}
                  >
                    <span className="flex-1 text-sm truncate text-muted-foreground">
                      {publicUrl}
                    </span>
                    <button
                      onClick={handleCopyLink}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover:scale-105"
                      style={{
                        background: copied
                          ? "hsl(var(--kf-success) / 0.15)"
                          : "hsl(var(--kf-accent1) / 0.1)",
                        color: copied
                          ? "hsl(var(--kf-success))"
                          : "hsl(var(--kf-accent1))",
                      }}
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={handleCopyLink}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all hover:scale-[1.02]"
                      style={{
                        background: "hsl(var(--kf-muted) / 0.2)",
                        border: "1px solid hsl(var(--kf-border) / 0.2)",
                      }}
                    >
                      <Copy
                        className="w-4 h-4"
                        style={{ color: "hsl(var(--kf-accent1))" }}
                      />
                      Copy Link
                    </button>
                    <button
                      onClick={handleShareWhatsApp}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all hover:scale-[1.02]"
                      style={{
                        background: "hsl(var(--kf-success) / 0.08)",
                        border: "1px solid hsl(var(--kf-success) / 0.2)",
                        color: "hsl(var(--kf-success))",
                      }}
                    >
                      <MessageCircle className="w-4 h-4" />
                      WhatsApp
                    </button>
                    <button
                      onClick={handleShareSocial}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-all hover:scale-[1.02]"
                      style={{
                        background: "hsl(var(--kf-info) / 0.08)",
                        border: "1px solid hsl(var(--kf-info) / 0.2)",
                        color: "hsl(var(--kf-info))",
                      }}
                    >
                      <Share2 className="w-4 h-4" />
                      Share
                    </button>
                  </div>
                  </div>
                </div>
              )}

              <div
                className="rounded-xl p-4 mb-6"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
                  border: "1px solid hsl(var(--kf-accent1) / 0.15)",
                }}
              >
                <p className="text-sm font-medium mb-3">
                  Grand Opening Momentum actions
                </p>
                <div className="space-y-2">
                  {(activeMomentumActions.length > 0
                    ? activeMomentumActions
                    : [
                        {
                          id: "default-storefront",
                          label: "Customize your storefront",
                          description: "Polish your page before sharing it publicly.",
                          route: "/app/store",
                          priority: "high" as const,
                        },
                        {
                          id: "default-crm",
                          label: "Add your first customer",
                          description: "Start your CRM pipeline with one lead.",
                          route: "/app/crm/pipeline",
                          priority: "medium" as const,
                        },
                      ]).map((action) => (
                    <button
                      key={action.id}
                      onClick={() => router.push(action.route)}
                      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-all hover:bg-muted/20"
                    >
                      <span className="text-base leading-none">
                        {action.priority === "high"
                          ? "🚀"
                          : action.priority === "medium"
                            ? "⚡"
                            : "📌"}
                      </span>
                      <span className="flex-1">
                        <span className="block font-medium">{action.label}</span>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {action.description}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground mt-0.5" />
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="rounded-xl p-4 mb-6"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.08), hsl(var(--kf-accent1) / 0.04))",
                  border: "1px solid hsl(var(--kf-accent2) / 0.2)",
                }}
              >
                <p className="text-sm font-semibold mb-1">Pick your first concrete win</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Choose what you want to complete in this first session.
                </p>
                <div className="space-y-2">
                  {FIRST_WIN_OPTIONS.map((option) => {
                    const active = selectedFirstWin === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => handleSelectFirstWin(option.id)}
                        className="w-full text-left rounded-lg px-3 py-2.5 transition-all"
                        style={{
                          background: active ? "hsl(var(--kf-accent2) / 0.16)" : "hsl(var(--kf-muted) / 0.2)",
                          border: active
                            ? "1px solid hsl(var(--kf-accent2) / 0.45)"
                            : "1px solid hsl(var(--kf-border) / 0.25)",
                        }}
                      >
                        <p className="text-sm font-medium">{option.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={handleFinish}
                disabled={!selectedFirstWin || savingFirstWin}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all hover:scale-[1.01]"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  color: "hsl(var(--kf-foreground))",
                  opacity: !selectedFirstWin ? 0.55 : 1,
                }}
              >
                {savingFirstWin ? "Saving first win..." : "Start first win"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {businessId && (
        <HelpDrawer
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          businessId={businessId}
        />
      )}
    </div>
  );
}
