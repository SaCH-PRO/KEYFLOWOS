"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { User, CheckCircle2, AlertCircle, Compass, FileText } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import GuidanceCard from "./components/guidance-card";
import BusinessGuidanceWizard from "./components/guidance-wizard";
import GuidanceDashboard from "./components/guidance-dashboard";
import { getGuidanceStatus } from "./components/guidance-storage";
import PersonalInfoSection from "./components/personal-info-section";
import MyBusinessSection from "./components/my-business-section";
import ProfessionalProfileSection from "./components/professional-profile-section";
import SecuritySection from "./components/security-section";
import DocumentsTab from "./components/documents-tab";
import { loadGuidanceDraft } from "./components/guidance-storage";

interface IdentityMe {
  id: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function ProfileCompletenessRing({ percentage }: { percentage: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = percentage >= 80
    ? "hsl(var(--kf-success))"
    : percentage >= 50
      ? "hsl(var(--kf-warning))"
      : "hsl(var(--kf-error))";

  return (
    <div className="relative w-20 h-20 flex items-center justify-center flex-shrink-0">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="5" opacity="0.3" />
        <circle
          cx="44" cy="44" r={radius} fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold">{percentage}%</span>
        <span className="text-[9px] text-muted-foreground">Complete</span>
      </div>
    </div>
  );
}

function SkeletonProfile() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-2xl bg-muted/40" />
        <div className="space-y-2 flex-1">
          <div className="h-5 w-40 bg-muted/40 rounded-lg" />
          <div className="h-3 w-56 bg-muted/30 rounded-lg" />
        </div>
      </div>
      <div className="kf-card p-6 space-y-4">
        <div className="h-4 w-24 bg-muted/40 rounded" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 bg-muted/30 rounded" />
              <div className="h-10 bg-muted/20 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type TabId = "profile" | "documents" | "guidance";

const TAB_CONFIG: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "guidance", label: "Guidance", icon: Compass },
];

export default function ProfileSettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get("tab") as TabId) || "profile";

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [initialForm, setInitialForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [profileCompleteness, setProfileCompleteness] = useState(0);

  const [showGuidanceWizard, setShowGuidanceWizard] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(TAB_CONFIG.some(t => t.id === initialTab) ? initialTab : "profile");

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const url = tab === "profile" ? "/app/profile" : `/app/profile?tab=${tab}`;
    router.replace(url, { scroll: false });
  }, [router]);
  const [guidanceStatus, setGuidanceStatusState] = useState<"not_started" | "in_progress" | "complete">("not_started");
  const [hasBackendAssessment, setHasBackendAssessment] = useState(false);

  const [isBizDirty, setIsBizDirty] = useState(false);
  const [isBizInfoDirty, setIsBizInfoDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const isDirty = useMemo(
    () =>
      form.email !== initialForm.email ||
      form.name !== initialForm.name ||
      form.firstName !== initialForm.firstName ||
      form.lastName !== initialForm.lastName ||
      form.phone !== initialForm.phone,
    [form, initialForm],
  );

  const hasUnsavedChanges = useMemo(() => isDirty || isBizDirty || isBizInfoDirty, [isDirty, isBizDirty, isBizInfoDirty]);
  useUnsavedChanges(hasUnsavedChanges);

  const handleBizDirtyChange = useCallback((dirty: boolean) => setIsBizDirty(dirty), []);
  const handleBizInfoDirtyChange = useCallback((dirty: boolean) => setIsBizInfoDirty(dirty), []);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
    const localStatus = getGuidanceStatus();
    setGuidanceStatusState(localStatus);
    if (bid) {
      apiGet<{ status: string; latestAssessment: unknown }>(`/business-guidance/${bid}/dashboard`)
        .then(({ data }) => {
          if (data?.latestAssessment) {
            setHasBackendAssessment(true);
            setGuidanceStatusState("complete");
          } else if (data?.status === "IN_PROGRESS" || data?.status === "DRAFT") {
            setGuidanceStatusState("in_progress");
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await apiGet<IdentityMe>("/identity/me");
        if (data) {
          const f = {
            email: data.email || "",
            name: data.name || "",
            firstName: data.firstName || "",
            lastName: data.lastName || "",
            phone: data.phone || "",
          };
          setForm(f);
          setInitialForm(f);
          setAvatarUrl(data.avatarUrl || null);
        }
      } catch (e) {
        console.error("Failed to load profile:", e);
      }
      setLoading(false);
    };
    load();
  }, []);

  if (showGuidanceWizard) {
    return (
      <BusinessGuidanceWizard
        onClose={() => {
          setShowGuidanceWizard(false);
          const s = getGuidanceStatus();
          setGuidanceStatusState(s);
          if (s === "complete") handleTabChange("guidance");
        }}
        onComplete={() => {
          setShowGuidanceWizard(false);
          setGuidanceStatusState("complete");
          handleTabChange("guidance");
          if (businessId) {
            apiGet<{ status: string; latestAssessment: unknown }>(`/business-guidance/${businessId}/dashboard`)
              .then(({ data }) => {
                if (data?.latestAssessment) setHasBackendAssessment(true);
              })
              .catch(() => {});
            const draft = loadGuidanceDraft();
            const updates: Record<string, unknown> = {};
            if (draft.industry) updates.industry = draft.industry;
            if (draft.businessStage) {
              const stageMap: Record<string, string> = {
                "idea": "IDEA", "pre-launch": "STARTUP", "launched": "STARTUP",
                "growing": "GROWTH", "scaling": "SCALING", "established": "ESTABLISHED",
              };
              updates.businessStage = stageMap[draft.businessStage] || draft.businessStage.toUpperCase();
            }
            if (draft.teamSize !== null && draft.teamSize !== undefined) {
              const ts = Number(draft.teamSize);
              if (ts <= 1) updates.teamSize = "SOLO";
              else if (ts <= 5) updates.teamSize = "SMALL_TEAM";
              else if (ts <= 15) updates.teamSize = "GROWING";
              else if (ts <= 50) updates.teamSize = "MEDIUM";
              else updates.teamSize = "LARGE";
            }
            if (draft.founderLocation) {
              const parts = draft.founderLocation.split(",").map((s: string) => s.trim());
              if (parts.length >= 2) {
                updates.city = parts[0];
                updates.country = parts[parts.length - 1];
              } else if (parts.length === 1) {
                updates.country = parts[0];
              }
            }
            if (draft.businessName) updates.name = draft.businessName;
            if (draft.offerDescription) updates.description = draft.offerDescription;
            if (Object.keys(updates).length > 0) {
              apiPatch(`/identity/businesses/${businessId}`, updates)
                .then((res) => {
                  if (!res.error) setRefreshKey((k) => k + 1);
                })
                .catch(() => {});
            }
          }
        }}
      />
    );
  }

  if (loading) return (
    <div className="max-w-2xl mx-auto">
      <SkeletonProfile />
    </div>
  );

  const maxWidth = activeTab === "documents" ? "max-w-4xl" : "max-w-2xl";

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className={`space-y-6 ${maxWidth} mx-auto transition-all`}>
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
          <User className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your profile, documents, and business guidance</p>
        </div>
        <ProfileCompletenessRing percentage={profileCompleteness} />
      </motion.div>

      <motion.div variants={fadeUp} className="flex gap-1 p-1 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}>
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px]"
              style={{
                background: isActive ? "hsl(var(--kf-card))" : "transparent",
                color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
                boxShadow: isActive ? "0 1px 3px hsl(0 0% 0% / 0.1)" : "none",
                border: isActive ? "1px solid hsl(var(--kf-border) / 0.3)" : "1px solid transparent",
              }}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.id === "guidance" && guidanceStatus === "complete" && (
                <span className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-success))" }} />
              )}
            </button>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTab === "guidance" && (
          <motion.div key="guidance" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {guidanceStatus === "complete" || hasBackendAssessment ? (
              <GuidanceDashboard onEditProfile={() => setShowGuidanceWizard(true)} />
            ) : (
              <GuidanceCard onLaunchWizard={() => setShowGuidanceWizard(true)} />
            )}
          </motion.div>
        )}

        {activeTab === "documents" && (
          <motion.div key="documents" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <DocumentsTab businessId={businessId} />
          </motion.div>
        )}

        {activeTab === "profile" && (
          <motion.div key="profile" variants={stagger} initial="hidden" animate="show" exit={{ opacity: 0, y: -8 }} className="space-y-6">
            <AnimatePresence>
              {status && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
                  style={{
                    border: `1px solid ${status.type === "success" ? "hsl(var(--kf-success) / 0.4)" : "hsl(var(--kf-error) / 0.4)"}`,
                    background: status.type === "success" ? "hsl(var(--kf-success) / 0.08)" : "hsl(var(--kf-error) / 0.08)",
                    color: status.type === "success" ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))",
                  }}
                >
                  {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  {status.message}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div variants={fadeUp} className="kf-card p-6">
              <PersonalInfoSection
                form={form}
                initialForm={initialForm}
                avatarUrl={avatarUrl}
                isDirty={isDirty}
                onFormChange={(updater) => setForm(updater)}
                onSaved={(newForm, newAvatar) => {
                  setInitialForm({ ...newForm });
                  if (newAvatar !== undefined) setAvatarUrl(newAvatar);
                }}
                onStatus={setStatus}
              />
            </motion.div>

            <motion.div variants={fadeUp} className="kf-card p-6">
              <MyBusinessSection
                key={`biz-info-${refreshKey}`}
                businessId={businessId}
                onDirtyChange={handleBizInfoDirtyChange}
                onStatus={setStatus}
              />
            </motion.div>

            <motion.div variants={fadeUp} className="kf-card p-6">
              <ProfessionalProfileSection
                key={`prof-${refreshKey}`}
                businessId={businessId}
                userName={form.name || `${form.firstName} ${form.lastName}`.trim()}
                onCompletenessChange={setProfileCompleteness}
                onDirtyChange={handleBizDirtyChange}
                onStatus={setStatus}
              />
            </motion.div>

            <motion.div variants={fadeUp}>
              <SecuritySection onStatus={setStatus} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
