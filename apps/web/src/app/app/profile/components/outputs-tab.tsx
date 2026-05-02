"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  FileText, Sparkles,
  Shield, DollarSign,
  BarChart3, CheckCircle2, AlertCircle,
  Lock, Package,
} from "lucide-react";
import DocumentsTab from "./documents-tab";
import { ProfileSectionErrorBoundary } from "./profile-section-error-boundary";
import type { ProfileBusinessData } from "./profile-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const DOCUMENT_CATEGORIES = [
  {
    category: "Legal & Compliance",
    icon: Shield,
    color: "--kf-error",
    documents: [
      { name: "Privacy Policy", feeds: "Business name, industry, location, services", modules: "Store + Compliance" },
      { name: "Terms of Service", feeds: "Business name, description, services, location", modules: "Store + Revenue" },
      { name: "Service Agreement", feeds: "Services, pricing, business terms", modules: "Clients + Projects" },
    ],
  },
  {
    category: "Business Operations",
    icon: Package,
    color: "--kf-accent1",
    documents: [
      { name: "Business Plan", feeds: "Industry, stage, team size, revenue model, goals", modules: "Intelligence" },
      { name: "Standard Operating Procedures", feeds: "Services, processes, team structure", modules: "Flows + Projects" },
      { name: "Company Profile", feeds: "Name, description, tagline, industry, achievements", modules: "Clients + Store" },
    ],
  },
  {
    category: "Financial",
    icon: DollarSign,
    color: "--kf-success",
    documents: [
      { name: "Budget Template", feeds: "Revenue targets, expense categories, team size", modules: "Revenue + Reports" },
      { name: "Financial Statement", feeds: "Revenue data, expenses, business stage", modules: "Revenue + Compliance" },
      { name: "Proposal Template", feeds: "Services, pricing, brand identity", modules: "Revenue + Clients" },
    ],
  },
  {
    category: "Marketing & Brand",
    icon: BarChart3,
    color: "--kf-accent2",
    documents: [
      { name: "Brand Guidelines", feeds: "Logo, colors, tagline, brand voice", modules: "Content + Store" },
      { name: "Marketing Plan", feeds: "Industry, audience, goals, channels", modules: "Content + Growth" },
    ],
  },
];

interface OutputsTabProps {
  businessId: string | null;
  businessData: ProfileBusinessData | null;
  profileCompleteness: number;
}

export function OutputsTab({ businessId, businessData, profileCompleteness }: OutputsTabProps) {
  const readinessChecks = useMemo(() => {
    const checks = [
      { label: "Business Name", filled: !!businessData?.name, required: true },
      { label: "Industry", filled: !!businessData?.industry, required: true },
      { label: "Business Stage", filled: !!businessData?.businessStage, required: false },
      { label: "Description", filled: !!businessData?.description, required: true },
      { label: "Location", filled: !!(businessData?.city || businessData?.country), required: false },
      { label: "Team Size", filled: !!businessData?.teamSize, required: false },
    ];
    const requiredFilled = checks.filter((c) => c.required && c.filled).length;
    const requiredTotal = checks.filter((c) => c.required).length;
    return { checks, requiredFilled, requiredTotal, allRequiredMet: requiredFilled === requiredTotal };
  }, [businessData]);

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
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-sm font-semibold">Documents & Exports</span>
        </div>
        <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Generate AI-powered business documents from your profile data. The more complete your profile, the higher quality and more relevant your generated documents will be.
        </p>
      </motion.div>

      <motion.div variants={fadeUp}>
        <div
          className="rounded-xl p-4"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" style={{ color: readinessChecks.allRequiredMet ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))" }} />
              <span className="text-xs font-semibold">Generation Readiness</span>
            </div>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: readinessChecks.allRequiredMet ? "hsl(var(--kf-success) / 0.12)" : "hsl(var(--kf-warning) / 0.12)",
                color: readinessChecks.allRequiredMet ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
              }}
            >
              {readinessChecks.requiredFilled}/{readinessChecks.requiredTotal} required
            </span>
          </div>
          <p className="text-[10px] mb-2.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {readinessChecks.allRequiredMet
              ? "All required fields are complete. Your documents will be generated with maximum quality."
              : "Complete the required fields below to improve document generation quality. Documents can still be generated but may have gaps."}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {readinessChecks.checks.map((check) => (
              <div key={check.label} className="flex items-center gap-1.5 py-1">
                {check.filled ? (
                  <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                ) : check.required ? (
                  <AlertCircle className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-warning))" }} />
                ) : (
                  <Lock className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }} />
                )}
                <span className="text-[10px]" style={{ color: check.filled ? "hsl(var(--kf-muted-foreground))" : "hsl(var(--kf-foreground))" }}>
                  {check.label}
                  {check.required && !check.filled && (
                    <span className="text-[8px] ml-0.5" style={{ color: "hsl(var(--kf-warning))" }}>*</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <div
          className="rounded-xl p-4"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-xs font-semibold">Document Data Sources</span>
          </div>
          <p className="text-[10px] mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Each document type draws from specific profile fields. Understanding these connections helps you provide the right data for better outputs.
          </p>
          <div className="space-y-3">
            {DOCUMENT_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <div key={cat.category}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon className="w-3 h-3" style={{ color: `hsl(var(${cat.color}))` }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: `hsl(var(${cat.color}))` }}>
                      {cat.category}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {cat.documents.map((doc) => (
                      <div
                        key={doc.name}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                        style={{ background: `hsl(var(${cat.color}) / 0.03)` }}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-medium">{doc.name}</span>
                          <p className="text-[9px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                            Uses: {doc.feeds}
                          </p>
                        </div>
                        <span
                          className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{ background: `hsl(var(${cat.color}) / 0.08)`, color: `hsl(var(${cat.color}))` }}
                        >
                          {doc.modules}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
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
