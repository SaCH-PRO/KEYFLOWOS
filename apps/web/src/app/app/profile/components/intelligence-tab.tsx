"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Brain, FileText, Sparkles,
  Target, Users, Zap,
  DollarSign, BarChart3, CheckCircle2,
  AlertCircle, Shield, Calendar, Globe,
} from "lucide-react";
import { ContextDepthCard } from "./context-depth-card";
import { ProgressivePrompts } from "./progressive-prompts";
import BusinessBuilderCard from "./business-builder-card";
import DocumentsTab from "./documents-tab";
import { ProfileSectionErrorBoundary } from "./profile-section-error-boundary";
import type { ProfileBusinessData } from "./profile-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const MODULE_CONNECTIONS = [
  { icon: Users, label: "Clients", description: "Customer insights, relationship guidance, and ideal customer profiling", color: "--kf-accent1" },
  { icon: DollarSign, label: "Revenue", description: "Financial assumptions, compliance readiness, and cash flow intelligence", color: "--kf-success" },
  { icon: BarChart3, label: "Content", description: "Audience framing, positioning, and offer communication", color: "--kf-accent2" },
  { icon: Zap, label: "Flows", description: "Recommended automations by business stage and type", color: "--kf-warning" },
  { icon: Target, label: "Projects", description: "Delivery templates, package mapping, and role structure", color: "--kf-info" },
  { icon: FileText, label: "Documents", description: "All recommendations, generation quality, and legal readiness", color: "--kf-accent1" },
  { icon: Calendar, label: "Calendar", description: "Operating hours, service readiness, and scheduling context", color: "--kf-accent2" },
];

const DOCUMENT_MODULE_LINKS = [
  { doc: "Client Service Agreement", modules: "Clients + Projects", icon: Users },
  { doc: "Financial Statement", modules: "Revenue + Reports", icon: DollarSign },
  { doc: "Privacy Policy", modules: "Store + Compliance", icon: Shield },
  { doc: "Terms of Service", modules: "Store + Revenue", icon: Globe },
  { doc: "Budget Template", modules: "Revenue + Reports", icon: BarChart3 },
  { doc: "License & Permit Register", modules: "Flows + Compliance", icon: FileText },
];

interface IntelligenceTabProps {
  businessId: string | null;
  businessData?: ProfileBusinessData | null;
}

function ConfidencePanel({ businessData }: { businessData?: ProfileBusinessData | null }) {
  const checks = useMemo(() => [
    { label: "Business Name", filled: !!businessData?.name, impact: "High" },
    { label: "Industry", filled: !!businessData?.industry, impact: "High" },
    { label: "Business Stage", filled: !!businessData?.businessStage, impact: "High" },
    { label: "Description", filled: !!businessData?.description, impact: "Medium" },
    { label: "Team Size", filled: !!businessData?.teamSize, impact: "Medium" },
    { label: "Location", filled: !!(businessData?.city || businessData?.country), impact: "Medium" },
    { label: "Skills", filled: (businessData?.skills?.length ?? 0) > 0, impact: "Low" },
    { label: "Headline", filled: !!businessData?.headline, impact: "Low" },
  ], [businessData]);

  const filledCount = checks.filter((c) => c.filled).length;
  const confidenceLevel = filledCount >= 7 ? "High" : filledCount >= 4 ? "Medium" : "Low";
  const confidenceColor = confidenceLevel === "High" ? "--kf-success" : confidenceLevel === "Medium" ? "--kf-warning" : "--kf-error";

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" style={{ color: `hsl(var(${confidenceColor}))` }} />
          <span className="text-xs font-semibold">Intelligence Confidence</span>
        </div>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{
            background: `hsl(var(${confidenceColor}) / 0.12)`,
            color: `hsl(var(${confidenceColor}))`,
          }}
        >
          {confidenceLevel}
        </span>
      </div>
      <p className="text-[10px] mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
        Intelligence quality depends on the data you provide. Missing fields reduce confidence and accuracy of generated outputs.
      </p>
      <div className="space-y-1.5">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-2">
            {check.filled ? (
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
            ) : (
              <AlertCircle className="w-3 h-3 flex-shrink-0" style={{ color: check.impact === "High" ? "hsl(var(--kf-error))" : "hsl(var(--kf-warning))" }} />
            )}
            <span className="text-[10px] flex-1" style={{ color: check.filled ? "hsl(var(--kf-muted-foreground))" : "hsl(var(--kf-foreground))" }}>
              {check.label}
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{
                background: check.impact === "High" ? "hsl(var(--kf-error) / 0.08)" : check.impact === "Medium" ? "hsl(var(--kf-warning) / 0.08)" : "hsl(var(--kf-muted) / 0.1)",
                color: check.impact === "High" ? "hsl(var(--kf-error))" : check.impact === "Medium" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-muted-foreground))",
              }}
            >
              {check.impact} impact
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2" style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.15)" }}>
        <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          <strong>{filledCount}/{checks.length}</strong> data points available.{" "}
          {filledCount < checks.length && (
            <span>Complete {checks.length - filledCount} more field{checks.length - filledCount > 1 ? "s" : ""} to improve intelligence accuracy.</span>
          )}
          {filledCount === checks.length && (
            <span style={{ color: "hsl(var(--kf-success))" }}>All core data points are available. Your intelligence is at maximum confidence.</span>
          )}
        </p>
      </div>
    </div>
  );
}

function DocumentModuleLinks() {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-xs font-semibold">Document-to-Module Links</span>
      </div>
      <p className="text-[10px] mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
        Each recommended document connects to specific modules. Generating these documents strengthens the corresponding areas of your business.
      </p>
      <div className="space-y-1.5">
        {DOCUMENT_MODULE_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <div
              key={link.doc}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
              style={{ background: "hsl(var(--kf-muted) / 0.05)" }}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-[10px] font-medium flex-1">{link.doc}</span>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded"
                style={{ background: "hsl(var(--kf-accent2) / 0.08)", color: "hsl(var(--kf-accent2))" }}
              >
                {link.modules}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IntelligenceTab({ businessId, businessData }: IntelligenceTabProps) {
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
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.05))",
          border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-sm font-semibold">Intelligence Engine</span>
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full ml-auto"
            style={{ background: "hsl(var(--kf-accent1) / 0.12)", color: "hsl(var(--kf-accent1))" }}
          >
            Premium
          </span>
        </div>
        <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Your business intelligence is generated from your profile data, business context, and industry analysis.
          This is where raw profile data becomes strategic output — the more complete your profile, the more accurate and useful your intelligence becomes.
        </p>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ConfidencePanel businessData={businessData} />
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

      <motion.div variants={fadeUp}>
        <DocumentModuleLinks />
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
        <p className="text-[10px] mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Your profile and intelligence data feeds directly into these modules, making each one smarter and more personalized.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MODULE_CONNECTIONS.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.label}
                className="flex items-start gap-2 p-2.5 rounded-lg"
                style={{
                  background: `hsl(var(${mod.color}) / 0.04)`,
                  border: `1px solid hsl(var(${mod.color}) / 0.08)`,
                }}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: `hsl(var(${mod.color}))` }} />
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
