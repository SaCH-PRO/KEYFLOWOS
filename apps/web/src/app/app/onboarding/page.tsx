"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  Check,
  ChevronRight,
  Sparkles,
  Loader2,
  X,
  Settings,
  Package,
  Clock,
  CreditCard,
  Globe,
  Users,
  Building2,
  Trophy,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Scissors,
  Dumbbell,
  Camera,
  Briefcase,
  UtensilsCrossed,
  ShoppingBag,
} from "lucide-react";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import {
  fetchConciergeState,
  fetchConciergeWelcome,
  sendConciergeChat,
  conciergeAutoConfigure,
  conciergeDetectType,
  dismissConcierge,
  markConciergeComplete,
  fetchConciergeTemplatePreview,
  ConciergeMessage,
  ConciergeSetupStatus,
  ConciergeState,
  IndustryTemplatePreview,
  AutoConfigureResult,
  updateBusiness,
} from "@/lib/client";

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
  quickReplies?: string[];
  setupStatus?: ConciergeSetupStatus;
  isConfiguring?: boolean;
  configResult?: AutoConfigureResult;
}

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  salon: Scissors,
  fitness: Dumbbell,
  photography: Camera,
  consulting: Briefcase,
  food: UtensilsCrossed,
  retail: ShoppingBag,
};

const SETUP_STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  profile: Building2,
  products: Package,
  businessHours: Clock,
  payments: CreditCard,
  storefront: Globe,
  contacts: Users,
};

const SETUP_STEP_LABELS: Record<string, string> = {
  profile: "Profile",
  products: "Products",
  businessHours: "Hours",
  payments: "Payments",
  storefront: "Storefront",
  contacts: "Contacts",
};

function SetupProgressBar({ status }: { status: ConciergeSetupStatus }) {
  return (
    <div className="px-4 py-3 border-b border-border/40">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">Setup Progress</span>
        <span className="text-xs font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
          {status.percentage}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mb-3">
        <motion.div
          className="h-full rounded-full"
          style={{ background: "linear-gradient(to right, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          initial={{ width: 0 }}
          animate={{ width: `${status.percentage}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {Object.entries(SETUP_STEP_LABELS).map(([key, label]) => {
          const done = status[key as keyof ConciergeSetupStatus] as boolean;
          const Icon = SETUP_STEP_ICONS[key];
          return (
            <div
              key={key}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                done
                  ? "bg-green-500/10 text-green-500 border border-green-500/20"
                  : "bg-muted/20 text-muted-foreground border border-border/30"
              }`}
            >
              {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MessageBubble({ message, isLast }: { message: ChatMessage; isLast: boolean }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}
    >
      <div className={`max-w-[85%] ${isUser ? "order-2" : "order-1"}`}>
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1">
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              <Bot className="w-3 h-3 text-white" />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">Concierge</span>
          </div>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "text-white"
              : "bg-muted/30 border border-border/40"
          }`}
          style={isUser ? { background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" } : undefined}
        >
          {message.isConfiguring ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Setting up your business...</span>
            </div>
          ) : message.configResult ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="font-medium">Setup Complete!</span>
              </div>
              {message.configResult.productsCreated ? (
                <p className="text-xs opacity-80">
                  Created {String(message.configResult.productsCreated)} products with TTD pricing
                </p>
              ) : null}
              {message.configResult.businessHoursSet ? (
                <p className="text-xs opacity-80">Business hours configured</p>
              ) : null}
              {message.configResult.paymentMethodsSet ? (
                <p className="text-xs opacity-80">Payment recommendations set</p>
              ) : null}
              {message.configResult.storefrontEnabled ? (
                <p className="text-xs opacity-80">Online storefront enabled</p>
              ) : null}
            </div>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [setupStatus, setSetupStatus] = useState<ConciergeSetupStatus | null>(null);
  const [detectedTemplate, setDetectedTemplate] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [conciergeState, setConciergeState] = useState<ConciergeState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        const [stateRes, welcomeRes] = await Promise.all([
          fetchConciergeState(bid),
          fetchConciergeWelcome(bid),
        ]);

        if (stateRes.data) {
          setConciergeState(stateRes.data);
          setSetupStatus(stateRes.data.setupStatus);
          if (stateRes.data.templateId) {
            setDetectedTemplate(stateRes.data.templateId);
          }
        }

        if (welcomeRes.data) {
          setMessages([{
            role: welcomeRes.data.role,
            content: welcomeRes.data.content,
            quickReplies: welcomeRes.data.quickReplies,
            setupStatus: welcomeRes.data.setupStatus,
          }]);
          if (welcomeRes.data.setupStatus) {
            setSetupStatus(welcomeRes.data.setupStatus);
          }
        }
      } catch (err) {
        console.error("Failed to init concierge:", err);
        setMessages([{
          role: "assistant",
          content: "Welcome! Tell me about your business and I'll help you get set up quickly.",
          quickReplies: ["Salon & Beauty", "Fitness & Wellness", "Food & Catering", "Photography", "Consulting", "Retail / E-commerce"],
        }]);
      }

      setLoading(false);
    };
    void init();
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!businessId || !msg || sending) return;

    const userMessage: ChatMessage = { role: "user", content: msg };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setSending(true);

    const history = messages
      .filter(m => m.content)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const isTemplateSelection = [
        "salon & beauty", "fitness & wellness", "food & catering",
        "photography", "consulting", "retail / e-commerce",
        "salon", "fitness", "food", "retail",
      ].some(t => msg.toLowerCase().includes(t));

      if (isTemplateSelection) {
        const detectRes = await conciergeDetectType(businessId, msg);
        if (detectRes.data) {
          setDetectedTemplate(detectRes.data.template.id);

          await updateBusiness({
            businessId,
            businessIntent: msg,
            industry: detectRes.data.template.label,
          });

          const previewRes = await fetchConciergeTemplatePreview(businessId, detectRes.data.template.id);

          if (previewRes.data) {
            const products = previewRes.data.products;
            const productList = products.slice(0, 3).map(p => `  • ${p.name} — $${p.price} TTD`).join("\n");
            const paymentRecs = previewRes.data.paymentRecommendations.join(", ");

            setMessages(prev => [...prev, {
              role: "assistant",
              content: `Great choice! I've matched you with our ${detectRes.data!.template.label} template. Here's what I'll set up for you:\n\n${productList}\n${products.length > 3 ? `  ...and ${products.length - 3} more\n` : ""}\nPayment options: ${paymentRecs}\n\nWant me to set this up automatically, or would you prefer to customize?`,
              quickReplies: ["Yes, set it up!", "Let me customize first", "Show me all products"],
            }]);
          } else {
            const res = await sendConciergeChat(businessId, msg, history);
            if (res.data) {
              setMessages(prev => [...prev, {
                role: res.data!.role,
                content: res.data!.content,
                quickReplies: res.data!.quickReplies,
                setupStatus: res.data!.setupStatus,
              }]);
              if (res.data.setupStatus) setSetupStatus(res.data.setupStatus);
            }
          }
        }
      } else if (
        msg.toLowerCase().includes("yes, set it up") ||
        msg.toLowerCase().includes("set it up") ||
        msg.toLowerCase().includes("auto-configure") ||
        msg.toLowerCase().includes("set up my") ||
        msg.toLowerCase().includes("go ahead")
      ) {
        await handleAutoConfigure();
      } else {
        const res = await sendConciergeChat(businessId, msg, history);
        if (res.data) {
          setMessages(prev => [...prev, {
            role: res.data!.role,
            content: res.data!.content,
            quickReplies: res.data!.quickReplies,
            setupStatus: res.data!.setupStatus,
          }]);
          if (res.data.setupStatus) setSetupStatus(res.data.setupStatus);
        }
      }
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I had trouble processing that. Could you try again?",
      }]);
    }

    setSending(false);
  }, [businessId, input, sending, messages, detectedTemplate]);

  const handleAutoConfigure = async () => {
    if (!businessId || configuring) return;
    const templateId = detectedTemplate || "consulting";
    setConfiguring(true);

    setMessages(prev => [...prev, {
      role: "assistant",
      content: "",
      isConfiguring: true,
    }]);

    try {
      const res = await conciergeAutoConfigure(businessId, templateId);

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "",
          configResult: res.data ?? undefined,
        };
        return updated;
      });

      const stateRes = await fetchConciergeState(businessId);
      if (stateRes.data) {
        setSetupStatus(stateRes.data.setupStatus);
        setConciergeState(stateRes.data);
      }

      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Your ${res.data?.templateLabel || "business"} is configured! You can customize anything from the Settings page. What would you like to do next?`,
          quickReplies: ["Go to dashboard", "Add contacts", "Customize products", "Set up storefront"],
        }]);
      }, 500);
    } catch (err) {
      console.error("Auto-configure error:", err);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "There was an issue with the auto-configuration. Let me help you set things up step by step instead.",
          quickReplies: ["Set up products", "Set business hours", "Configure payments"],
        };
        return updated;
      });
    }

    setConfiguring(false);
  };

  const handleQuickReply = (reply: string) => {
    const lower = reply.toLowerCase();
    if (lower === "go to dashboard") {
      handleFinish();
      return;
    }
    if (lower === "add contacts" || lower === "import contacts") {
      router.push("/app/crm/pipeline?action=import");
      return;
    }
    if (lower === "customize products" || lower === "show me all products") {
      router.push("/app/commerce?tab=products");
      return;
    }
    if (lower === "set up storefront" || lower === "enable storefront") {
      router.push("/app/settings/business");
      return;
    }
    if (lower === "review my setup") {
      router.push("/app/settings/business");
      return;
    }
    if (lower === "update products") {
      router.push("/app/commerce?tab=products");
      return;
    }
    handleSend(reply);
  };

  const handleFinish = async () => {
    if (businessId) {
      await markConciergeComplete(businessId);
    }
    router.push("/app");
  };

  const handleDismiss = async () => {
    if (businessId) {
      await dismissConcierge(businessId);
    }
    router.push("/app");
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <div
            className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center animate-pulse"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Bot className="w-6 h-6 text-white" />
          </div>
          <p className="text-sm text-muted-foreground">Preparing your concierge...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Onboarding Concierge</h1>
            <p className="text-[10px] text-muted-foreground">Your business setup assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/app/settings/business")}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={handleDismiss}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
            title="Dismiss and continue later"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {setupStatus && <SetupProgressBar status={setupStatus} />}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} isLast={idx === messages.length - 1} />
        ))}

        {messages.length > 0 && messages[messages.length - 1].quickReplies && !sending && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap gap-2 pl-7 mt-2"
          >
            {messages[messages.length - 1].quickReplies!.map((reply) => {
              const templateId = Object.keys(TEMPLATE_ICONS).find(k => reply.toLowerCase().includes(k));
              const TemplateIcon = templateId ? TEMPLATE_ICONS[templateId] : null;

              return (
                <button
                  key={reply}
                  onClick={() => handleQuickReply(reply)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-border/50 bg-background hover:bg-muted/30 transition-all hover:scale-[1.02]"
                  style={{ borderColor: "hsl(var(--kf-accent1) / 0.3)" }}
                >
                  {TemplateIcon && <TemplateIcon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />}
                  {reply}
                </button>
              );
            })}
          </motion.div>
        )}

        {sending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start mb-3"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <div
                className="w-5 h-5 rounded-md flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
              >
                <Bot className="w-3 h-3 text-white" />
              </div>
              <div className="flex items-center gap-1 px-3 py-2 rounded-2xl bg-muted/30 border border-border/40">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {setupStatus && setupStatus.percentage === 100 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-2 p-3 rounded-xl border border-green-500/30 bg-green-500/5"
        >
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-green-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-500">Setup Complete!</p>
              <p className="text-xs text-muted-foreground">Your business is ready to go</p>
            </div>
            <button
              onClick={handleFinish}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              Go to Dashboard
            </button>
          </div>
        </motion.div>
      )}

      <div className="px-4 py-3 border-t border-border/40">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your message..."
            className="flex-1 bg-muted/20 border border-border/40 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] transition-all"
            disabled={sending || configuring}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending || configuring}
            className="p-2.5 rounded-xl text-white disabled:opacity-30 transition-all hover:scale-105"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <button
            onClick={handleDismiss}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-all"
          >
            Skip setup and go to dashboard
          </button>
          <button
            onClick={() => router.push("/app/settings/business")}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-all flex items-center gap-1"
          >
            <Settings className="w-3 h-3" />
            Manual setup
          </button>
        </div>
      </div>
    </div>
  );
}
