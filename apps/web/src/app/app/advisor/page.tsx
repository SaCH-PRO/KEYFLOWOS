"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Sun,
  TrendingUp,
  TrendingDown,
  Send,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  DollarSign,
  BarChart3,
  Mic,
  MicOff,
  FlaskConical,
  Loader2,
  Brain,
} from "lucide-react";
import {
  sendAiChat,
  fetchAiBriefing,
  fetchCashFlowForecast,
  AiChatResponse,
  AiBriefing,
  CashFlowForecast,
  runSimulation,
  SimulationResult,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { FeatureGuide } from "@/components/ui/feature-guide";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Hi! I'm KeyFlow, your AI business co-founder. Ask me anything about your business, strategy, finances, or operations.",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-TT", {
    style: "currency",
    currency: "TTD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function AdvisorPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [briefing, setBriefing] = useState<AiBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [simScenario, setSimScenario] = useState("");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));
  }, []);

  const handleSend = useCallback(async () => {
    if (!businessId || !input.trim() || sending) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const history = [...messages.slice(1), userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    try {
      const res = await sendAiChat(businessId, userMsg.content, history);
      const reply = res.data?.reply || "Sorry, I couldn't process that. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    }
    setSending(false);
  }, [businessId, input, sending, messages]);

  const handleGenerateBriefing = useCallback(async () => {
    if (!businessId || briefingLoading) return;
    setBriefingLoading(true);
    try {
      const res = await fetchAiBriefing(businessId);
      if (res.data) setBriefing(res.data);
    } catch {}
    setBriefingLoading(false);
  }, [businessId, briefingLoading]);

  const handleRefreshForecast = useCallback(async () => {
    if (!businessId || forecastLoading) return;
    setForecastLoading(true);
    try {
      const res = await fetchCashFlowForecast(businessId);
      if (res.data) setForecast(res.data);
    } catch {}
    setForecastLoading(false);
  }, [businessId, forecastLoading]);

  const handleSimulate = useCallback(async () => {
    if (!businessId || !simScenario.trim() || simLoading) return;
    setSimLoading(true);
    try {
      const res = await runSimulation(businessId, simScenario.trim());
      if (res.data) setSimResult(res.data);
    } catch {}
    setSimLoading(false);
  }, [businessId, simScenario, simLoading]);

  const startVoice = useCallback(() => {
    if (!voiceSupported) return;
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setVoiceListening(false);
    };
    recognition.onerror = () => setVoiceListening(false);
    recognition.onend = () => setVoiceListening(false);
    setVoiceListening(true);
    recognition.start();
  }, [voiceSupported]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Brain}
        title="KeyFlow AI Advisor"
        subtitle="Your AI co-founder for strategy, finances, and operations"
        rightSlot={
          <button
            onClick={() => setShowContactPicker(true)}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-4 h-4" />
            Broadcast
          </button>
        }
      />

      <FeatureGuide
        featureKey="advisor"
        title="Meet Your AI Co-Founder"
        description="Get strategic business advice, financial forecasts, and simulation scenarios powered by AI."
        steps={[
          { title: "Chat with AI", description: "Ask questions about your business, strategy, pricing, or operations in natural language." },
          { title: "Daily Briefing", description: "Get an AI-generated summary of your business activity, priorities, and suggestions." },
          { title: "Cash Flow Forecast", description: "View AI-predicted revenue and expense trends for the coming months." },
          { title: "What-If Scenarios", description: "Simulate business decisions (e.g., raise prices, hire staff) to see projected impact." },
          { title: "Voice Input", description: "Use the microphone button to speak your questions instead of typing." },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: "calc(100vh - 200px)" }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 backdrop-blur border border-white/10 rounded-xl flex flex-col overflow-hidden"
          style={{ minHeight: 500 }}
        >
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
              }}
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">KeyFlow AI</h2>
              <p className="text-[10px] text-muted-foreground">Business Co-Founder</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-orange-500/20 border border-orange-500/30 text-orange-100"
                        : "bg-white/5 border border-white/10 text-gray-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {sending && (
              <div className="flex justify-start">
                <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                  <span
                    className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"
                    style={{ animationDelay: "0.2s" }}
                  />
                  <span
                    className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"
                    style={{ animationDelay: "0.4s" }}
                  />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 border-t border-white/10">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="Ask KeyFlow anything..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500/50 placeholder:text-muted-foreground"
                disabled={sending || !businessId}
              />
              {voiceSupported && (
                <button
                  onClick={startVoice}
                  className={`p-2.5 rounded-lg transition-colors ${voiceListening ? "bg-red-500/20 text-red-400" : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10"}`}
                  title={voiceListening ? "Listening..." : "Voice input"}
                >
                  {voiceListening ? <MicOff className="w-4 h-4 animate-pulse" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={sending || !input.trim() || !businessId}
                className="p-2.5 rounded-lg transition-colors disabled:opacity-40"
                style={{ background: "hsl(var(--kf-accent1))" }}
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </motion.div>

        <div className="flex flex-col gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden flex"
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-amber-400" />
                <h2 className="text-sm font-semibold">Morning Briefing</h2>
              </div>
              <button
                onClick={handleGenerateBriefing}
                disabled={briefingLoading || !businessId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 bg-white/5 border border-white/10 hover:bg-white/10"
              >
                <RefreshCw className={`w-3 h-3 ${briefingLoading ? "animate-spin" : ""}`} />
                {briefing ? "Refresh" : "Generate Briefing"}
              </button>
            </div>

            <div className="p-4 overflow-y-auto" style={{ maxHeight: 350 }}>
              {briefingLoading && !briefing ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-4 rounded bg-white/5 animate-pulse"
                      style={{ width: `${60 + i * 10}%` }}
                    />
                  ))}
                </div>
              ) : briefing ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-300 leading-relaxed">{briefing.summary}</p>

                  {briefing.highlights.length > 0 && (
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Highlights
                      </h3>
                      {briefing.highlights.map((h, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-300">{h}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {briefing.priorities.length > 0 && (
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Priorities
                      </h3>
                      {briefing.priorities.map((p, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-300">{p}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/5 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
                      <p className="text-sm font-semibold text-green-400">
                        {formatCurrency(briefing.cashFlow.revenue)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase">Expenses</p>
                      <p className="text-sm font-semibold text-red-400">
                        {formatCurrency(briefing.cashFlow.expenses)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase">Net</p>
                      <p
                        className={`text-sm font-semibold ${
                          briefing.cashFlow.net >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {formatCurrency(briefing.cashFlow.net)}
                      </p>
                    </div>
                  </div>

                  {briefing.suggestion && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-amber-300 mb-1">AI Suggestion</p>
                          <p className="text-sm text-amber-100/80 leading-relaxed">
                            {briefing.suggestion}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Sun className="w-10 h-10 text-amber-400/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Click &quot;Generate Briefing&quot; to get your daily business summary
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden flex"
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-teal-400" />
                <h2 className="text-sm font-semibold">Cash Flow Forecast</h2>
              </div>
              <button
                onClick={handleRefreshForecast}
                disabled={forecastLoading || !businessId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 bg-white/5 border border-white/10 hover:bg-white/10"
              >
                <RefreshCw className={`w-3 h-3 ${forecastLoading ? "animate-spin" : ""}`} />
                {forecast ? "Refresh" : "Load Forecast"}
              </button>
            </div>

            <div className="p-4 overflow-y-auto" style={{ maxHeight: 350 }}>
              {forecastLoading && !forecast ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-12 rounded-lg bg-white/5 animate-pulse"
                    />
                  ))}
                </div>
              ) : forecast ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">
                        Current Balance
                      </p>
                      <p
                        className={`text-lg font-bold ${
                          forecast.currentBalance >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {formatCurrency(forecast.currentBalance)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">
                        Projected (30d)
                      </p>
                      <p
                        className={`text-lg font-bold ${
                          forecast.projectedBalance >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {formatCurrency(forecast.projectedBalance)}
                      </p>
                    </div>
                  </div>

                  {forecast.daysUntilNegative !== null && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-red-300">Cash Warning</p>
                        <p className="text-xs text-red-300/70">
                          Balance may go negative in {forecast.daysUntilNegative} days
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 bg-white/5 rounded-lg p-3">
                    {forecast.trend === "up" || forecast.trend === "improving" ? (
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">Trend</p>
                      <p className="text-sm font-medium capitalize">{forecast.trend}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <DollarSign className="w-3 h-3 text-green-400" />
                        <p className="text-[10px] text-muted-foreground uppercase">
                          Daily Revenue
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-green-400">
                        {formatCurrency(forecast.dailyRevenueRate)}
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <DollarSign className="w-3 h-3 text-red-400" />
                        <p className="text-[10px] text-muted-foreground uppercase">
                          Daily Expenses
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-red-400">
                        {formatCurrency(forecast.dailyExpenseRate)}
                      </p>
                    </div>
                  </div>

                  {forecast.alerts.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Alerts
                      </h3>
                      {forecast.alerts.map((alert, i) => (
                        <div
                          key={i}
                          className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 flex items-start gap-2"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-amber-200">{alert}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <BarChart3 className="w-10 h-10 text-teal-400/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Click &quot;Load Forecast&quot; to see your cash flow projections
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <FlaskConical className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
              <h2 className="text-sm font-semibold">Business Simulation</h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Run &quot;what-if&quot; scenarios using your real business data.</p>
              <div className="space-y-2">
                <textarea
                  value={simScenario}
                  onChange={(e) => setSimScenario(e.target.value)}
                  placeholder="e.g., What if I hire 2 employees at $3000/month each? What if I raise prices by 20%? What if I launch a new product line?"
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none placeholder:text-muted-foreground resize-none"
                  style={{ "--tw-border-opacity": "1" } as any}
                  onFocus={(e) => e.currentTarget.style.borderColor = "hsl(var(--kf-accent1) / 0.5)"}
                  onBlur={(e) => e.currentTarget.style.borderColor = "hsl(var(--tw-border-color) / var(--tw-border-opacity))"}
                  disabled={!businessId}
                />
                <button
                  onClick={handleSimulate}
                  disabled={simLoading || !simScenario.trim() || !businessId}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 text-white"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                >
                  {simLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                  {simLoading ? "Running Simulation..." : "Simulate Scenario"}
                </button>
              </div>
              {simResult && (
                <div className="bg-white/5 rounded-lg p-4 max-h-96 overflow-y-auto" style={{ borderColor: "hsl(var(--kf-accent1) / 0.2)", borderWidth: "1px" }}>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{simResult.simulation}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {["What if I hire 2 new employees?", "What if I raise prices by 15%?", "What if I expand to a second location?"].map(q => (
                  <button
                    key={q}
                    onClick={() => setSimScenario(q)}
                    className="text-[10px] px-2 py-1 rounded-full transition-colors"
                    style={{
                      backgroundColor: "hsl(var(--kf-accent1) / 0.1)",
                      borderColor: "hsl(var(--kf-accent1) / 0.2)",
                      borderWidth: "1px",
                      color: "hsl(var(--kf-accent1) / 0.8)",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "hsl(var(--kf-accent1) / 0.2)"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "hsl(var(--kf-accent1) / 0.1)"}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
