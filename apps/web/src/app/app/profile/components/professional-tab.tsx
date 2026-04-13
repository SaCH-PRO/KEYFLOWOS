"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  User, Briefcase, Target, TrendingUp, Users,
  Sparkles, Globe, FileText, BarChart3, Zap,
  CheckCircle2, MapPin,
} from "lucide-react";
import PersonalInfoSection from "./personal-info-section";
import ProfessionalProfileSection from "./professional-profile-section";
import { ProfileSectionErrorBoundary } from "./profile-section-error-boundary";
import type { ProfileBusinessData, StatusMessage } from "./profile-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

interface PowersNote {
  icon: React.ElementType;
  label: string;
  impact: string;
}

const PERSONAL_POWERS: PowersNote[] = [
  { icon: User, label: "Account Identity", impact: "Login & profile display" },
  { icon: Globe, label: "Public Profile", impact: "Community presence" },
  { icon: FileText, label: "Customer Communications", impact: "Email signatures & contacts" },
];

const PROFESSIONAL_POWERS: PowersNote[] = [
  { icon: Target, label: "AI Recommendations", impact: "Smarter guidance across all modules" },
  { icon: TrendingUp, label: "Growth Guidance", impact: "Stage-aware strategy in Revenue & Content" },
  { icon: Users, label: "Client Matching", impact: "Better CRM segmentation & targeting" },
  { icon: BarChart3, label: "Market Intelligence", impact: "Industry-specific insights & templates" },
  { icon: Zap, label: "Automation Fit", impact: "Stage-appropriate Flows suggestions" },
];

function PowersIndicator({ powers, title, description }: { powers: PowersNote[]; title: string; description: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.04), hsl(var(--kf-accent1) / 0.02))",
        border: "1px solid hsl(var(--kf-accent2) / 0.1)",
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
        <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
          {title}
        </span>
      </div>
      <p className="text-[10px] mb-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
        {description}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {powers.map((p, i) => {
          const Icon = p.icon;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px]"
              style={{
                background: "hsl(var(--kf-accent2) / 0.08)",
                color: "hsl(var(--kf-accent2))",
              }}
              title={p.impact}
            >
              <Icon className="w-3 h-3" />
              {p.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ProfessionalCompletionStrip({ businessData, hasName, hasPhone }: { businessData: ProfileBusinessData | null; hasName: boolean; hasPhone: boolean }) {
  const sections = useMemo(() => [
    {
      label: "Personal",
      icon: User,
      completed: [hasName, hasPhone].filter(Boolean).length,
      total: 2,
    },
    {
      label: "Identity",
      icon: Briefcase,
      completed: [businessData?.headline, businessData?.bio].filter(Boolean).length,
      total: 2,
    },
    {
      label: "Industry",
      icon: TrendingUp,
      completed: [businessData?.industry, businessData?.businessStage].filter(Boolean).length,
      total: 2,
    },
    {
      label: "Skills",
      icon: Sparkles,
      completed: [(businessData?.skills?.length ?? 0) > 0, (businessData?.interests?.length ?? 0) > 0].filter(Boolean).length,
      total: 2,
    },
    {
      label: "Location",
      icon: MapPin,
      completed: [businessData?.city, businessData?.country].filter(Boolean).length > 0 ? 1 : 0,
      total: 1,
    },
  ], [businessData, hasName, hasPhone]);

  const totalCompleted = sections.reduce((a, s) => a + s.completed, 0);
  const totalFields = sections.reduce((a, s) => a + s.total, 0);

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">Professional Profile Completion</span>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{
            background: totalCompleted === totalFields ? "hsl(var(--kf-success) / 0.12)" : "hsl(var(--kf-accent1) / 0.12)",
            color: totalCompleted === totalFields ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
          }}
        >
          {totalCompleted}/{totalFields}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {sections.map((s) => {
          const Icon = s.icon;
          const isComplete = s.completed === s.total;
          return (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: isComplete ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-muted) / 0.1)",
                }}
              >
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
                ) : (
                  <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                )}
              </div>
              <span className="text-[10px] font-medium text-center" style={{ color: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))" }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldImpactBanner() {
  const impacts = [
    { icon: Briefcase, field: "Industry", impact: "templates, documents, and strategy guidance" },
    { icon: TrendingUp, field: "Business Stage", impact: "growth recommendations and intelligence logic" },
    { icon: MapPin, field: "Location", impact: "tax, compliance, permits, and local relevance" },
  ];

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.2)",
      }}
    >
      <p className="text-[10px] font-semibold mb-2" style={{ color: "hsl(var(--kf-accent1))" }}>
        How your professional data powers KeyFlow
      </p>
      <div className="space-y-1.5">
        {impacts.map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={i} className="flex items-center gap-2">
              <Icon className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
              <span className="text-[10px]">
                <strong style={{ color: "hsl(var(--kf-foreground))" }}>{item.field}</strong>
                <span style={{ color: "hsl(var(--kf-muted-foreground))" }}> powers {item.impact}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ProfessionalTabProps {
  businessId: string | null;
  businessData: ProfileBusinessData | null;
  businessLoading: boolean;
  savedForm: { email: string; name: string; firstName: string; lastName: string; phone: string };
  avatarUrl: string | null;
  onPersonalDirtyChange: (dirty: boolean) => void;
  onBizDirtyChange: (dirty: boolean) => void;
  onStatus: (status: StatusMessage | null) => void;
  onPersonalSaved: (form: { email: string; name: string; firstName: string; lastName: string; phone: string }, avatar: string | null) => void;
  onBusinessSaved: (saved: Partial<ProfileBusinessData>) => void;
  onCompletenessChange: (pct: number) => void;
}

export function ProfessionalTab({
  businessId,
  businessData,
  businessLoading,
  savedForm,
  avatarUrl,
  onPersonalDirtyChange,
  onBizDirtyChange,
  onStatus,
  onPersonalSaved,
  onBusinessSaved,
  onCompletenessChange,
}: ProfessionalTabProps) {
  const hasName = !!(savedForm.firstName || savedForm.name);
  const hasPhone = !!savedForm.phone;

  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div variants={fadeUp}>
        <ProfessionalCompletionStrip businessData={businessData} hasName={hasName} hasPhone={hasPhone} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <PowersIndicator
          powers={PERSONAL_POWERS}
          title="Personal identity powers these areas"
          description="Your name, contact info, and avatar define how you appear across KeyFlow and in customer communications."
        />
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-6">
        <ProfileSectionErrorBoundary sectionName="Personal Info">
          <PersonalInfoSection
            initialData={savedForm}
            avatarUrl={avatarUrl}
            onDirtyChange={onPersonalDirtyChange}
            onSaved={(newForm, newAvatar) => {
              onPersonalSaved(newForm, newAvatar);
            }}
            onStatus={onStatus}
          />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div variants={fadeUp}>
        <PowersIndicator
          powers={PROFESSIONAL_POWERS}
          title="Professional identity powers these modules"
          description="Your industry, stage, skills, and expertise shape how KeyFlow generates recommendations, documents, and guidance across every module."
        />
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-6">
        <ProfileSectionErrorBoundary sectionName="Professional Profile">
          <ProfessionalProfileSection
            businessId={businessId}
            businessData={businessData}
            businessLoading={businessLoading}
            userName={savedForm.name || `${savedForm.firstName} ${savedForm.lastName}`.trim()}
            onCompletenessChange={onCompletenessChange}
            onDirtyChange={onBizDirtyChange}
            onStatus={onStatus}
            onSaved={(saved) => {
              onBusinessSaved(saved);
            }}
          />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div variants={fadeUp}>
        <FieldImpactBanner />
      </motion.div>
    </motion.div>
  );
}
