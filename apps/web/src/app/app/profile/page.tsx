"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, CheckCircle2, AlertCircle, Compass, FileText,
  ChevronDown, ChevronRight, Sparkles, TrendingUp, Zap,
  Building2, Briefcase, Shield, Target,
} from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import GuidanceCard from "./components/guidance-card";
import BusinessGuidanceWizard from "./components/guidance-wizard";
import GuidanceDashboard from "./components/guidance-dashboard";
import PersonalInfoSection from "./components/personal-info-section";
import MyBusinessSection from "./components/my-business-section";
import ProfessionalProfileSection from "./components/professional-profile-section";
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

interface CompletenessItem {
  label: string;
  done: boolean;
  tab: TabId;
  icon: React.ElementType;
}

function JourneyIndicator({
  items,
  onGoTo,
}: {
  items: CompletenessItem[];
  onGoTo: (tab: TabId) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const color =
    pct >= 80
      ? "hsl(var(--kf-success))"
      : pct >= 50
        ? "hsl(var(--kf-warning))"
        : "hsl(var(--kf-error))";

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px]"
      >
        <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" opacity="0.2" />
            <circle
              cx="20" cy="20" r="16" fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 16}
              strokeDashoffset={2 * Math.PI * 16 - (pct / 100) * 2 * Math.PI * 16}
              className="transition-all duration-700"
            />
          </svg>
          <span className="absolute text-[10px] font-bold" style={{ color }}>{pct}%</span>
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
            Business Foundation
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            {completed}/{total} steps complete
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="h-1.5 w-20 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)" }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
          </div>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-1 border-t border-[hsl(var(--border))]  pt-2">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => onGoTo(item.tab)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[hsl(var(--muted))] transition-colors min-h-[36px]"
                  >
                    {item.done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                    ) : (
                      <div
                        className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0"
                        style={{ borderColor: "hsl(var(--muted-foreground) / 0.4)" }}
                      />
                    )}
                    <Icon className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] flex-shrink-0" />
                    <span
                      className="text-xs flex-1"
                      style={{
                        color: item.done ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                        textDecoration: item.done ? "line-through" : "none",
                      }}
                    >
                      {item.label}
                    </span>
                    {!item.done && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}>
                        Quick win
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BusinessContextCard({
  form,
  businessId,
}: {
  form: { name: string; firstName: string; lastName: string };
  businessId: string | null;
}) {
  const [bizData, setBizData] = useState<{
    name?: string;
    industry?: string;
    businessStage?: string;
    teamSize?: string;
    city?: string;
    country?: string;
  } | null>(null);

  useEffect(() => {
    if (!businessId) return;
    apiGet<Record<string, unknown>>(`/identity/businesses/${businessId}`)
      .then(({ data }) => {
        if (data) setBizData(data as typeof bizData);
      })
      .catch(() => {});
  }, [businessId]);

  const items = [
    { label: "Business", value: bizData?.name, icon: Building2 },
    { label: "Industry", value: bizData?.industry, icon: Briefcase },
    { label: "Stage", value: bizData?.businessStage?.replace(/_/g, " "), icon: TrendingUp },
    { label: "Team", value: bizData?.teamSize?.replace(/_/g, " "), icon: User },
    { label: "Location", value: [bizData?.city, bizData?.country].filter(Boolean).join(", "), icon: Target },
  ].filter((i) => i.value);

  if (items.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
        border: "1px solid hsl(var(--kf-accent1) / 0.12)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
          What KEYFLOWOS sees
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
              style={{
                background: "hsl(var(--kf-card))",
                border: "1px solid hsl(var(--kf-border) / 0.2)",
              }}
            >
              <Icon className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
              <span className="text-[hsl(var(--muted-foreground))]">{item.label}:</span>
              <span className="font-medium text-[hsl(var(--foreground))]">{item.value}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2">
        This data powers AI-generated documents, guidance, and recommendations.
      </p>
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
  const [docCount, setDocCount] = useState(0);

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

  const completenessItems: CompletenessItem[] = useMemo(() => {
    const hasName = !!(form.firstName || form.name);
    const hasPhone = !!form.phone;
    return [
      { label: "Add your name", done: hasName, tab: "profile" as TabId, icon: User },
      { label: "Add phone number", done: hasPhone, tab: "profile" as TabId, icon: User },
      { label: "Complete business profile", done: profileCompleteness >= 60, tab: "profile" as TabId, icon: Building2 },
      { label: "Set industry & stage", done: profileCompleteness >= 40, tab: "profile" as TabId, icon: Briefcase },
      { label: "Generate your first document", done: docCount > 0, tab: "documents" as TabId, icon: FileText },
      { label: "Complete business guidance", done: guidanceStatus === "complete", tab: "guidance" as TabId, icon: Compass },
    ];
  }, [form, profileCompleteness, docCount, guidanceStatus]);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
    if (bid) {
      apiGet<{ status: string; latestAssessment: unknown }>(`/business-guidance/${bid}/dashboard`)
        .then(({ data }) => {
          if (data?.latestAssessment) {
            setHasBackendAssessment(true);
            setGuidanceStatusState("complete");
          } else if (data?.status === "IN_PROGRESS" || data?.status === "DRAFT" || data?.status === "SUBMITTED") {
            setGuidanceStatusState("in_progress");
          } else {
            setGuidanceStatusState("not_started");
          }
        })
        .catch(() => {
          setGuidanceStatusState("not_started");
        });
      apiGet<unknown[]>(`/documents/businesses/${bid}/instances`)
        .then(({ data }) => {
          if (data) setDocCount(data.length);
        })
        .catch(() => {});
    } else {
      setGuidanceStatusState("not_started");
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
          if (businessId) {
            apiGet<{ status: string; latestAssessment: unknown }>(`/business-guidance/${businessId}/dashboard`)
              .then(({ data }) => {
                if (data?.latestAssessment) {
                  setHasBackendAssessment(true);
                  setGuidanceStatusState("complete");
                  handleTabChange("guidance");
                } else if (data?.status === "IN_PROGRESS" || data?.status === "DRAFT" || data?.status === "SUBMITTED") {
                  setGuidanceStatusState("in_progress");
                }
              })
              .catch(() => {});
          }
        }}
        onComplete={() => {
          setShowGuidanceWizard(false);
          setGuidanceStatusState("complete");
          setHasBackendAssessment(true);
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

  const tabBadge = (tabId: TabId) => {
    if (tabId === "guidance" && guidanceStatus === "complete") {
      return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "hsl(var(--kf-success))" }} />;
    }
    if (tabId === "documents" && docCount > 0) {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}>
          {docCount}
        </span>
      );
    }
    if (tabId === "profile" && profileCompleteness > 0 && profileCompleteness < 100) {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
          background: profileCompleteness >= 80 ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-warning) / 0.15)",
          color: profileCompleteness >= 80 ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
        }}>
          {profileCompleteness}%
        </span>
      );
    }
    return null;
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className={`space-y-4 ${maxWidth} mx-auto transition-all`}>
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
          <User className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your profile, documents, and business guidance</p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <JourneyIndicator items={completenessItems} onGoTo={handleTabChange} />
      </motion.div>

      <motion.div variants={fadeUp} className="flex gap-1 p-1 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}>
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = tabBadge(tab.id);
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
              {badge}
            </button>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTab === "guidance" && (
          <motion.div key="guidance" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            {guidanceStatus === "complete" || hasBackendAssessment ? (
              <GuidanceDashboard
                onEditProfile={() => setShowGuidanceWizard(true)}
                onGoToDocuments={() => handleTabChange("documents")}
              />
            ) : (
              <GuidanceCard onLaunchWizard={() => setShowGuidanceWizard(true)} status={guidanceStatus} />
            )}
          </motion.div>
        )}

        {activeTab === "documents" && (
          <motion.div key="documents" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <DocumentsTab
              businessId={businessId}
              onGoToGuidance={() => handleTabChange("guidance")}
              guidanceComplete={guidanceStatus === "complete"}
            />
          </motion.div>
        )}

        {activeTab === "profile" && (
          <motion.div key="profile" variants={stagger} initial="hidden" animate="show" exit={{ opacity: 0, y: -8 }} className="space-y-4">
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

            <motion.div variants={fadeUp}>
              <BusinessContextCard form={form} businessId={businessId} />
            </motion.div>

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
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors min-h-[44px]"
                style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}
                onClick={() => router.push("/app/settings/security")}
              >
                <Shield className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[hsl(var(--foreground))]">Security & Preferences</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">Password, theme, and account security</div>
                </div>
                <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
