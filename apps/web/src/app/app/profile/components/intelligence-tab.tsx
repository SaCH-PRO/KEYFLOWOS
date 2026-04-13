"use client";

import { motion } from "framer-motion";
import {
  Brain, FileText, Sparkles, ArrowRight,
  Target, TrendingUp, Users, Zap,
  DollarSign, BarChart3,
} from "lucide-react";
import { ContextDepthCard } from "./context-depth-card";
import { ProgressivePrompts } from "./progressive-prompts";
import BusinessBuilderCard from "./business-builder-card";
import DocumentsTab from "./documents-tab";
import { ProfileSectionErrorBoundary } from "./profile-section-error-boundary";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const MODULE_CONNECTIONS = [
  { icon: Users, label: "Clients", description: "Customer insights and relationship guidance" },
  { icon: DollarSign, label: "Revenue", description: "Financial assumptions and compliance" },
  { icon: BarChart3, label: "Content", description: "Audience framing and positioning" },
  { icon: Zap, label: "Flows", description: "Recommended automations by stage" },
  { icon: Target, label: "Projects", description: "Delivery templates and role structure" },
  { icon: FileText, label: "Documents", description: "All recommendations and generation quality" },
];

interface IntelligenceTabProps {
  businessId: string | null;
}

export function IntelligenceTab({ businessId }: IntelligenceTabProps) {
  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div
        variants={fadeUp}
        className="rounded-xl p-4"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
          border: "1px solid hsl(var(--kf-accent1) / 0.12)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-sm font-semibold">Intelligence Engine</span>
        </div>
        <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Your business intelligence is generated from your profile data, business context, and industry analysis.
          The more complete your profile, the more accurate and useful your intelligence becomes.
        </p>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Business Intelligence">
          <ContextDepthCard businessId={businessId} />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Smart Suggestions">
          <ProgressivePrompts businessId={businessId} />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Business Intelligence Package">
          <BusinessBuilderCard />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div
        variants={fadeUp}
        className="rounded-xl p-4"
        style={{
          background: "hsl(var(--kf-card))",
          border: "1px solid hsl(var(--kf-border) / 0.3)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
          <span className="text-xs font-semibold">Intelligence Powers These Modules</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MODULE_CONNECTIONS.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.label}
                className="flex items-start gap-2 p-2.5 rounded-lg"
                style={{
                  background: "hsl(var(--kf-muted) / 0.06)",
                  border: "1px solid hsl(var(--kf-border) / 0.1)",
                }}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent2))" }} />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{mod.label}</p>
                  <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {mod.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Documents">
          <DocumentsTab businessId={businessId} />
        </ProfileSectionErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
