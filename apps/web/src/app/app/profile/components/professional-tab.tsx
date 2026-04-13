"use client";

import { motion } from "framer-motion";
import {
  User, Briefcase, Target, TrendingUp, Users,
  Sparkles, Globe, FileText, BarChart3,
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
}

const PERSONAL_POWERS: PowersNote[] = [
  { icon: User, label: "Account Identity" },
  { icon: Globe, label: "Public Profile" },
  { icon: FileText, label: "Customer Communications" },
];

const PROFESSIONAL_POWERS: PowersNote[] = [
  { icon: Target, label: "AI Recommendations" },
  { icon: TrendingUp, label: "Growth Guidance" },
  { icon: Users, label: "Client Matching" },
  { icon: BarChart3, label: "Market Intelligence" },
];

function PowersIndicator({ powers, label }: { powers: PowersNote[]; label: string }) {
  return (
    <div
      className="rounded-lg p-2.5 mb-1"
      style={{
        background: "hsl(var(--kf-muted) / 0.06)",
        border: "1px solid hsl(var(--kf-border) / 0.1)",
      }}
    >
      <p className="text-[10px] font-semibold mb-1.5" style={{ color: "hsl(var(--kf-accent2))" }}>
        {label}
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
  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div variants={fadeUp}>
        <PowersIndicator powers={PERSONAL_POWERS} label="Personal identity powers" />
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
        <PowersIndicator powers={PROFESSIONAL_POWERS} label="Professional identity powers" />
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
    </motion.div>
  );
}
