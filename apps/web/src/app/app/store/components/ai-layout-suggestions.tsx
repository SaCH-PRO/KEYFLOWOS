"use client";

import { Sparkles, ArrowRight, Star, TrendingUp, ImageIcon, MessageSquare } from "lucide-react";

interface Suggestion {
  id: string;
  icon: typeof Sparkles;
  title: string;
  description: string;
  action: string;
  actionTab: string;
}

interface Props {
  hasPremiumService: boolean;
  hasTestimonials: boolean;
  hasHeroImage: boolean;
  heroHeadlineLength: number;
  onModeChange: (tab: string) => void;
}

export function AiLayoutSuggestions({
  hasPremiumService,
  hasTestimonials,
  hasHeroImage,
  heroHeadlineLength,
  onModeChange,
}: Props) {
  const suggestions: Suggestion[] = [];

  if (!hasPremiumService) {
    suggestions.push({
      id: "premium",
      icon: TrendingUp,
      title: "Feature your premium service",
      description: "Detect and highlight your highest-margin offering to maximize revenue.",
      action: "Go to Catalog",
      actionTab: "catalog",
    });
  }

  if (!hasTestimonials) {
    suggestions.push({
      id: "trust",
      icon: Star,
      title: "Add trust signals",
      description: "Testimonials and reviews increase conversion by up to 34%.",
      action: "Add Reviews",
      actionTab: "merchandising",
    });
  }

  if (!hasHeroImage || heroHeadlineLength < 10) {
    suggestions.push({
      id: "hero",
      icon: ImageIcon,
      title: "Improve hero layout",
      description: "A strong headline and hero image significantly boost first impressions.",
      action: "Edit Hero",
      actionTab: "design",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: "optimize",
      icon: MessageSquare,
      title: "Store looks great!",
      description: "Your storefront has strong fundamentals. Consider running a promotion.",
      action: "Create Campaign",
      actionTab: "launch",
    });
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">AI Layout Suggestions</h3>
      </div>
      <div className="space-y-2">
        {suggestions.map((s) => (
          <button
            key={s.id}
            onClick={() => onModeChange(s.actionTab)}
            className="w-full text-left flex items-start gap-3 p-3 rounded-lg border border-border/30 bg-background/50 hover:border-border/60 hover:bg-background transition-all group"
          >
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <s.icon className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium">{s.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-primary shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {s.action}
              <ArrowRight className="w-3 h-3" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
