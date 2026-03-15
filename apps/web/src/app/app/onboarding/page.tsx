"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  markConciergeComplete,
  fetchConciergeTemplatePreview,
  updateBusiness,
  createProduct,
  IndustryTemplatePreview,
} from "@/lib/client";

interface TemplateCard {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}

const TEMPLATES: TemplateCard[] = [
  {
    id: "salon",
    label: "Salon & Beauty",
    description: "Hair, nails, makeup, spa services",
    icon: Scissors,
    color: "--kf-accent1",
  },
  {
    id: "fitness",
    label: "Fitness & Wellness",
    description: "Gym, yoga, personal training, classes",
    icon: Dumbbell,
    color: "--kf-accent2",
  },
  {
    id: "photography",
    label: "Photography & Media",
    description: "Photo shoots, events, video production",
    icon: Camera,
    color: "--kf-info",
  },
  {
    id: "consulting",
    label: "Consulting & Services",
    description: "Coaching, freelance, professional services",
    icon: Briefcase,
    color: "--kf-warning",
  },
  {
    id: "food",
    label: "Food & Beverage",
    description: "Restaurant, catering, bakery, meal prep",
    icon: UtensilsCrossed,
    color: "--kf-error",
  },
  {
    id: "retail",
    label: "Retail & E-commerce",
    description: "Shop, boutique, online store, handmade",
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

interface ChatMsg {
  role: "assistant" | "user";
  content: string;
}

const STEPS = [
  { label: "Business Type", number: 1 },
  { label: "Your First Offering", number: 2 },
  { label: "Go Live", number: 3 },
];

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
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const msg = input.trim();
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
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: res.data!.content },
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
            style={{ background: "hsl(0 0% 0% / 0.5)" }}
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
                  <Bot className="w-3.5 h-3.5 text-white" />
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
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "text-white"
                        : "bg-muted/30 border border-border/40"
                    }`}
                    style={
                      m.role === "user"
                        ? {
                            background:
                              "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                          }
                        : undefined
                    }
                  >
                    {m.content}
                  </div>
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
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="p-2 rounded-xl text-white disabled:opacity-30 transition-all"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
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
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [configuring, setConfiguring] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      const bid = fresh || getStoredBusinessId();
      if (!bid) {
        setLoading(false);
        return;
      }
      setBusinessId(bid);

      try {
        const stateRes = await fetchConciergeState(bid);
        if (stateRes.data) {
          if (stateRes.data.templateId) {
            setSelectedTemplate(stateRes.data.templateId);
            const previewRes = await fetchConciergeTemplatePreview(bid, stateRes.data.templateId);
            if (previewRes.data) {
              setProducts(
                previewRes.data.products.map((p: IndustryTemplatePreview["products"][0]) => ({ ...p, included: true }))
              );
            }
            if (stateRes.data.setupStatus.products) {
              const origin = typeof window !== "undefined" ? window.location.origin : "";
              setPublicUrl(`${origin}/book/${bid}`);
              setStep(2);
            } else {
              setStep(1);
            }
          }
        }
      } catch (err) {
        console.error("Failed to init onboarding:", err);
      }
      setLoading(false);
    };
    void init();
  }, []);

  const handleSelectTemplate = async (templateId: string) => {
    if (!businessId) return;
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
          onboardingComplete: true,
        },
      });

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setPublicUrl(`${origin}/book/${businessId}`);
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

  const handleShareSocial = () => {
    if (!publicUrl) return;
    if (navigator.share) {
      navigator.share({
        title: "My Business on KeyFlowOS",
        text: "Check out my business page!",
        url: publicUrl,
      });
    } else {
      handleCopyLink();
    }
  };

  const handleFinish = async () => {
    if (businessId) {
      await markConciergeComplete(businessId);
    }
    router.push("/app");
  };

  const handleSkip = async () => {
    if (businessId) {
      await markConciergeComplete(businessId);
    }
    router.push("/app");
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
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <p className="text-sm text-muted-foreground">
            Preparing your setup...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
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
                  We'll set up your account with smart defaults — pricing in
                  TTD, hours, and services tailored to your industry.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {TEMPLATES.map((t) => {
                  const Icon = t.icon;
                  const isSelected = selectedTemplate === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTemplate(t.id)}
                      className={`relative rounded-xl p-4 text-left transition-all hover:scale-[1.02] ${
                        isSelected
                          ? "ring-2"
                          : "hover:bg-muted/20"
                      }`}
                      style={{
                        background: isSelected
                          ? "hsl(var(--kf-accent1) / 0.08)"
                          : "hsl(var(--kf-muted) / 0.15)",
                        border: `1px solid ${isSelected ? "hsl(var(--kf-accent1) / 0.4)" : "hsl(var(--kf-border) / 0.3)"}`,
                        ringColor: isSelected
                          ? "hsl(var(--kf-accent1) / 0.5)"
                          : undefined,
                      }}
                    >
                      {isSelected && (
                        <div
                          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{
                            background: "hsl(var(--kf-accent1))",
                          }}
                        >
                          <Check className="w-3 h-3 text-white" />
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
                      <p className="text-sm font-semibold mb-0.5">
                        {t.label}
                      </p>
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
                  We've pre-filled popular{" "}
                  {TEMPLATES.find((t) => t.id === selectedTemplate)?.label.toLowerCase() || "business"}{" "}
                  offerings with TTD pricing. Edit, add, or remove as needed.
                </p>
              </div>

              <div className="space-y-2 mb-6">
                {products.map((product, i) => (
                  <div
                    key={i}
                    className={`rounded-xl p-3 transition-all ${
                      product.included ? "" : "opacity-50"
                    }`}
                    style={{
                      background: product.included
                        ? "hsl(var(--kf-muted) / 0.15)"
                        : "hsl(var(--kf-muted) / 0.08)",
                      border: `1px solid ${product.included ? "hsl(var(--kf-border) / 0.3)" : "hsl(var(--kf-border) / 0.15)"}`,
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
                          <Check className="w-3 h-3 text-white" />
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
                            className="p-1 rounded text-muted-foreground/50 hover:text-red-400 transition-all"
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
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all hover:scale-[1.02]"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
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
                <h1 className="text-xl font-bold mb-2">You're live!</h1>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Your business is set up and ready for customers. Share your
                  link to start receiving bookings and orders.
                </p>
              </div>

              {publicUrl && (
                <div
                  className="rounded-xl p-4 mb-6"
                  style={{
                    background: "hsl(var(--kf-muted) / 0.15)",
                    border: "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
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
              )}

              <div
                className="rounded-xl p-4 mb-6"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
                  border: "1px solid hsl(var(--kf-accent1) / 0.15)",
                }}
              >
                <p className="text-sm font-medium mb-3">What's next?</p>
                <div className="space-y-2">
                  {[
                    {
                      label: "Add your first customer",
                      href: "/app/crm/pipeline",
                      icon: "👤",
                    },
                    {
                      label: "Customize your storefront",
                      href: "/app/store",
                      icon: "🏪",
                    },
                    {
                      label: "Set up payment methods",
                      href: "/app/settings/connections",
                      icon: "💳",
                    },
                  ].map((item) => (
                    <button
                      key={item.href}
                      onClick={() => router.push(item.href)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-all hover:bg-muted/20"
                    >
                      <span className="text-base">{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.01]"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                }}
              >
                Go to Dashboard
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
