"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Wand2, MessageSquareText, TrendingUp, Lightbulb, Lock, Send } from "lucide-react";

const AI_FEATURES = [
  {
    icon: Wand2,
    title: "AI Content Writer",
    description: "Generate engaging posts, captions, and hashtags tailored to your brand voice.",
    gradient: "from-violet-500/20 to-purple-600/10",
    borderColor: "hsl(270 70% 50% / 0.3)",
  },
  {
    icon: MessageSquareText,
    title: "Smart Repurposing",
    description: "Turn one post into multiple formats - threads, stories, carousels, and more.",
    gradient: "from-cyan-500/20 to-blue-600/10",
    borderColor: "hsl(190 80% 50% / 0.3)",
  },
  {
    icon: TrendingUp,
    title: "Best Time to Post",
    description: "AI-recommended posting schedule based on your audience engagement patterns.",
    gradient: "from-emerald-500/20 to-green-600/10",
    borderColor: "hsl(150 60% 45% / 0.3)",
  },
  {
    icon: Lightbulb,
    title: "Content Ideas",
    description: "Weekly content suggestions based on your industry, trends, and business goals.",
    gradient: "from-amber-500/20 to-orange-600/10",
    borderColor: "hsl(35 90% 50% / 0.3)",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export function AIStudio() {
  const [prompt, setPrompt] = useState("");
  const [showToast, setShowToast] = useState(false);

  function handleSubmitPrompt() {
    if (!prompt.trim()) return;
    setShowToast(true);
    setPrompt("");
    setTimeout(() => setShowToast(false), 3000);
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={item} className="flex items-center gap-2 mb-1">
        <Lock className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-[10px] px-2 py-0.5 rounded-full border" style={{ color: "hsl(var(--kf-accent1))", borderColor: "hsl(var(--kf-accent1) / 0.3)", background: "hsl(var(--kf-accent1) / 0.1)" }}>
          Coming Soon
        </span>
      </motion.div>

      <motion.div
        variants={item}
        className="rounded-2xl border backdrop-blur-xl p-5 space-y-4"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
          borderColor: "hsl(var(--kf-accent1) / 0.2)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
            <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">AI Content Studio</h3>
            <p className="text-[11px] text-muted-foreground">Your AI-powered social media assistant</p>
          </div>
        </div>

        <div className="relative">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmitPrompt()}
            placeholder="Try: Write a promotion post for my hair salon..."
            className="kf-input w-full pr-10"
          />
          <button
            onClick={handleSubmitPrompt}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted))]"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border p-3 text-xs text-center"
            style={{
              background: "hsl(var(--kf-accent1) / 0.1)",
              borderColor: "hsl(var(--kf-accent1) / 0.3)",
              color: "hsl(var(--kf-accent1))",
            }}
          >
            ✨ AI features coming soon! We&apos;re training our models for Caribbean businesses.
          </motion.div>
        )}

        <motion.div variants={container} className="grid gap-3 md:grid-cols-2">
          {AI_FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <motion.div
                key={feat.title}
                variants={item}
                whileHover={{ scale: 1.02, y: -2 }}
                className={`rounded-xl border backdrop-blur-xl p-3.5 space-y-1.5 bg-gradient-to-br ${feat.gradient}`}
                style={{ borderColor: feat.borderColor }}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <span className="text-xs font-medium">{feat.title}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{feat.description}</p>
              </motion.div>
            );
          })}
        </motion.div>

        <div className="text-center pt-1">
          <button className="kf-btn-primary opacity-50 cursor-not-allowed inline-flex items-center gap-2" disabled>
            <Sparkles className="w-4 h-4" />
            Unlock AI Studio
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
