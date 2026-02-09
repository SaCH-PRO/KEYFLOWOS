"use client";

import { Sparkles, Wand2, MessageSquareText, TrendingUp, Lightbulb, Lock } from "lucide-react";

const AI_FEATURES = [
  {
    icon: Wand2,
    title: "AI Content Writer",
    description: "Generate engaging posts, captions, and hashtags tailored to your brand voice.",
  },
  {
    icon: MessageSquareText,
    title: "Smart Repurposing",
    description: "Turn one post into multiple formats - threads, stories, carousels, and more.",
  },
  {
    icon: TrendingUp,
    title: "Best Time to Post",
    description: "AI-recommended posting schedule based on your audience engagement patterns.",
  },
  {
    icon: Lightbulb,
    title: "Content Ideas",
    description: "Weekly content suggestions based on your industry, trends, and business goals.",
  },
];

export function AIStudio() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-[10px] px-2 py-0.5 rounded-full border" style={{ color: "hsl(var(--kf-accent1))", borderColor: "hsl(var(--kf-accent1) / 0.3)", background: "hsl(var(--kf-accent1) / 0.1)" }}>
          Coming Soon
        </span>
      </div>

      <div className="kf-card-accent p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
            <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">AI Content Studio</h3>
            <p className="text-[11px] text-muted-foreground">Your AI-powered social media assistant</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {AI_FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <div key={feat.title} className="kf-card p-3.5 space-y-1.5 opacity-60">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <span className="text-xs font-medium">{feat.title}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{feat.description}</p>
              </div>
            );
          })}
        </div>

        <div className="text-center pt-1">
          <button className="kf-btn-primary opacity-50 cursor-not-allowed inline-flex items-center gap-2" disabled>
            <Sparkles className="w-4 h-4" />
            Unlock AI Studio
          </button>
        </div>
      </div>
    </div>
  );
}
