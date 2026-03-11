"use client";

import { motion } from "framer-motion";
import {
  Mail,
  ClipboardList,
  Share2,
  Plus,
  Sparkles,
  Target,
  Users,
  TrendingUp,
  Megaphone,
  PenTool,
} from "lucide-react";

interface MarketingEmptyStateProps {
  onAction?: () => void;
}

export function CampaignsEmptyState({ onAction }: MarketingEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="kf-card rounded-2xl border border-border/40 p-10 text-center"
    >
      <div className="relative mx-auto mb-6 w-20 h-20">
        <div
          className="absolute inset-0 rounded-2xl rotate-6"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
        />
        <div
          className="absolute inset-0 rounded-2xl -rotate-3 flex items-center justify-center"
          style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
        >
          <Mail className="w-10 h-10" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">Launch your first campaign</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        Reach your contacts with beautifully crafted email campaigns. Segment your audience, track opens and clicks, and grow your business.
      </p>
      <div className="flex items-center justify-center gap-6 mb-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          Smart segmentation
        </span>
        <span className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          Open & click tracking
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          AI-powered writing
        </span>
      </div>
      {onAction && (
        <button
          onClick={onAction}
          className="kf-btn-primary px-5 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Campaign
        </button>
      )}
    </motion.div>
  );
}

export function FormsEmptyState({ onAction }: MarketingEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="kf-card rounded-2xl border border-border/40 p-10 text-center"
    >
      <div className="relative mx-auto mb-6 w-20 h-20">
        <div
          className="absolute inset-0 rounded-2xl rotate-6"
          style={{ background: "hsl(var(--kf-accent2, var(--kf-accent1)) / 0.1)" }}
        />
        <div
          className="absolute inset-0 rounded-2xl -rotate-3 flex items-center justify-center"
          style={{ background: "hsl(var(--kf-accent2, var(--kf-accent1)) / 0.15)" }}
        >
          <ClipboardList className="w-10 h-10" style={{ color: "hsl(var(--kf-accent2, var(--kf-accent1)))" }} />
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">Capture leads with custom forms</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        Build lead capture forms, embed them anywhere, and watch your contact list grow automatically. Every submission creates a new contact.
      </p>
      <div className="flex items-center justify-center gap-6 mb-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <PenTool className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2, var(--kf-accent1)))" }} />
          Drag & drop builder
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2, var(--kf-accent1)))" }} />
          Auto-create contacts
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2, var(--kf-accent1)))" }} />
          AI optimization
        </span>
      </div>
      {onAction && (
        <button
          onClick={onAction}
          className="kf-btn-primary px-5 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Form
        </button>
      )}
    </motion.div>
  );
}

export function SocialEmptyState({ onAction }: MarketingEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="kf-card rounded-2xl border border-border/40 p-10 text-center"
    >
      <div className="relative mx-auto mb-6 w-20 h-20">
        <div
          className="absolute inset-0 rounded-2xl rotate-6"
          style={{ background: "hsl(260 60% 55% / 0.1)" }}
        />
        <div
          className="absolute inset-0 rounded-2xl -rotate-3 flex items-center justify-center"
          style={{ background: "hsl(260 60% 55% / 0.15)" }}
        >
          <Share2 className="w-10 h-10" style={{ color: "hsl(260 60% 55%)" }} />
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">Start posting on social media</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
        Create, schedule, and publish posts across all your social channels from one place. Use AI to generate engaging content effortlessly.
      </p>
      <div className="flex items-center justify-center gap-6 mb-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Megaphone className="w-3.5 h-3.5" style={{ color: "hsl(260 60% 55%)" }} />
          Multi-platform
        </span>
        <span className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(260 60% 55%)" }} />
          Schedule & publish
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(260 60% 55%)" }} />
          AI content studio
        </span>
      </div>
      {onAction && (
        <button
          onClick={onAction}
          className="kf-btn-primary px-5 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Post
        </button>
      )}
    </motion.div>
  );
}
