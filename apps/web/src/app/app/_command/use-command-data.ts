"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  fetchCockpitSummary,
  fetchGamificationStats,
  CockpitSummary,
  GamificationStats,
  updateStreak,
  fetchTodaysTasks,
  updateAutopilotTaskStatus,
  approveAutopilotTask,
  denyAutopilotTask,
  fetchMomentumRecommendations,
  actionMomentumRecommendation,
  snoozeMomentumRecommendation,
  dismissMomentumRecommendation,
  generateMomentumDraft,
  MomentumRecommendation,
  fetchCampaignBriefings,
  CampaignBriefing,
  fetchConciergeNudges,
  snoozeConciergeNudge,
  NudgeItem,
  fetchFinancialPulse,
  FinancialPulse,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId, getUserDisplayName } from "@/lib/workspace";
import type { AutopilotTask } from "./types";

export function useCommandData() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [cockpit, setCockpit] = useState<CockpitSummary | null>(null);
  const [gamification, setGamification] = useState<GamificationStats | null>(null);
  const [tasks, setTasks] = useState<AutopilotTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState<string | null>(null);
  const [momentumRecs, setMomentumRecs] = useState<MomentumRecommendation[]>([]);
  const [momentumActionId, setMomentumActionId] = useState<string | null>(null);
  const [campaignBriefings, setCampaignBriefings] = useState<CampaignBriefing[]>([]);
  const [nudges, setNudges] = useState<NudgeItem[]>([]);
  const [dismissingNudge, setDismissingNudge] = useState<string | null>(null);
  const [financialPulse, setFinancialPulse] = useState<FinancialPulse | null>(null);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); return; }
      const stored = getStoredBusinessId();
      if (stored) setBusinessId(stored);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [cockpitResult, gamificationResult, tasksResult, momentumResult, briefingsResult, financialResult] = await Promise.all([
          fetchCockpitSummary(businessId),
          fetchGamificationStats(businessId),
          fetchTodaysTasks(businessId),
          fetchMomentumRecommendations(businessId, 5),
          fetchCampaignBriefings(businessId),
          fetchFinancialPulse(businessId),
        ]);
        if (cockpitResult.data) setCockpit(cockpitResult.data as CockpitSummary);
        if (gamificationResult.data) setGamification(gamificationResult.data);
        if (tasksResult.data) setTasks(tasksResult.data as AutopilotTask[]);
        if (momentumResult.data) setMomentumRecs(momentumResult.data);
        if (briefingsResult.data) setCampaignBriefings(briefingsResult.data);
        if (financialResult.data) setFinancialPulse(financialResult.data);
        void updateStreak(businessId);
        fetchConciergeNudges(businessId).then(res => {
          if (res.data) setNudges(res.data);
        }).catch(() => {});
      } catch (err) {
        console.error("Dashboard load error:", err);
        setError("Failed to load dashboard. Please refresh the page.");
      }
      setLoading(false);
    };
    void load();
    if (typeof window !== "undefined") {
      const handler = () => void load();
      window.addEventListener("kf:invoicePaid", handler);
      window.addEventListener("kf:bookingCreated", handler);
      window.addEventListener("kf:taskCompleted", handler);
      return () => {
        window.removeEventListener("kf:invoicePaid", handler);
        window.removeEventListener("kf:bookingCreated", handler);
        window.removeEventListener("kf:taskCompleted", handler);
      };
    }
  }, [businessId]);

  const handleCompleteTask = useCallback(async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await updateAutopilotTaskStatus(taskId, "COMPLETED", businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      window.dispatchEvent(new CustomEvent("kf:taskCompleted"));
    } catch (err) { console.error("Failed to complete task:", err); }
    setCompletingTask(null);
  }, [businessId]);

  const handleApproveTask = useCallback(async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await approveAutopilotTask(taskId, "user", businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      window.dispatchEvent(new CustomEvent("kf:taskCompleted"));
    } catch (err) { console.error("Failed to approve task:", err); }
    setCompletingTask(null);
  }, [businessId]);

  const handleDenyTask = useCallback(async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await denyAutopilotTask(taskId, businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) { console.error("Failed to deny task:", err); }
    setCompletingTask(null);
  }, [businessId]);

  const handleMomentumAction = useCallback(async (rec: MomentumRecommendation) => {
    if (!businessId) return;
    setMomentumActionId(rec.id);
    try {
      const contactId = rec.contact?.id || rec.contactId;
      const contactName = rec.contact
        ? `${rec.contact.firstName ?? ""} ${rec.contact.lastName ?? ""}`.trim() || "Contact"
        : "Contact";
      const [actionResult, draftResult] = await Promise.all([
        actionMomentumRecommendation(rec.id, businessId),
        generateMomentumDraft(rec.id, {
          contactId,
          contactName,
          type: rec.type,
          description: rec.description,
          momentumScore: rec.momentumScore ?? undefined,
        }, businessId),
      ]);
      if (actionResult.error) {
        console.error("Failed to action momentum rec:", actionResult.error);
      } else {
        setMomentumRecs(prev => prev.filter(r => r.id !== rec.id));
        const draft = draftResult.data;
        if (contactId) {
          const draftParam = draft?.message ? `&momentumDraft=${encodeURIComponent(draft.message)}` : "";
          router.push(`/app/crm?contact=${contactId}${draftParam}`);
        }
      }
    } catch (err) { console.error("Failed to action momentum rec:", err); }
    setMomentumActionId(null);
  }, [businessId, router]);

  const handleMomentumSnooze = useCallback(async (id: string) => {
    if (!businessId) return;
    setMomentumActionId(id);
    try {
      const result = await snoozeMomentumRecommendation(id, 7, businessId);
      if (!result.error) setMomentumRecs(prev => prev.filter(r => r.id !== id));
    } catch (err) { console.error("Failed to snooze momentum rec:", err); }
    setMomentumActionId(null);
  }, [businessId]);

  const handleMomentumDismiss = useCallback(async (id: string) => {
    if (!businessId) return;
    setMomentumActionId(id);
    try {
      const result = await dismissMomentumRecommendation(id, businessId);
      if (!result.error) setMomentumRecs(prev => prev.filter(r => r.id !== id));
    } catch (err) { console.error("Failed to dismiss momentum rec:", err); }
    setMomentumActionId(null);
  }, [businessId]);

  const handleNudgeSnooze = useCallback(async (id: string) => {
    if (!businessId) return;
    setDismissingNudge(id);
    await snoozeConciergeNudge(businessId, id, 3);
    setNudges(prev => prev.filter(n => n.id !== id));
    setDismissingNudge(null);
  }, [businessId]);

  const todayRevenue = cockpit?.stats?.todayRevenue ?? 0;
  const monthlyRevenue = cockpit?.stats?.monthlyRevenue ?? 0;
  const pendingInvoices = cockpit?.stats?.pendingInvoices ?? 0;
  const todayBookings = cockpit?.stats?.todayBookings ?? 0;
  const completedBookingsToday = cockpit?.stats?.completedBookingsToday ?? 0;
  const completedToday = gamification?.dailyTasksCompleted ?? 0;
  const priorities = cockpit?.priorities ?? [];
  const financialAlerts = (financialPulse?.alerts ?? []).filter((a) => !dismissedAlertIds.has(a.id));
  const momentum = cockpit?.momentum ?? 0;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const displayName = getUserDisplayName();

  const aiNudges = useMemo<NudgeItem[]>(() => {
    const items: NudgeItem[] = [];
    if (pendingInvoices > 3) {
      items.push({
        id: "ai-nudge-overdue-invoices",
        type: "ai-suggestion",
        title: "Revenue at risk",
        body: `You have ${pendingInvoices} pending invoices. Ask AI for a recovery strategy.`,
        ctaLabel: "Ask AI",
        ctaHref: "/app/commerce",
        snoozable: true,
      });
    }
    if (momentumRecs.length > 2) {
      items.push({
        id: "ai-nudge-momentum",
        type: "ai-suggestion",
        title: "Client momentum dropping",
        body: `${momentumRecs.length} contacts need attention. Ask AI for prioritised next steps.`,
        ctaLabel: "Ask AI",
        ctaHref: "/app/crm/pipeline",
        snoozable: true,
      });
    }
    if (campaignBriefings.length > 0) {
      const recent = campaignBriefings[0];
      if (recent && (recent as CampaignBriefing & { metrics?: { openRate?: number } }).metrics?.openRate !== undefined) {
        items.push({
          id: "ai-nudge-campaign",
          type: "ai-suggestion",
          title: "Campaign insights ready",
          body: "AI has analysed your latest campaign performance. Review recommendations.",
          ctaLabel: "View Insights",
          ctaHref: "/app/marketing",
          snoozable: true,
        });
      }
    }
    return items;
  }, [pendingInvoices, momentumRecs.length, campaignBriefings]);

  const allNudges = useMemo(() => [...nudges, ...aiNudges], [nudges, aiNudges]);

  return {
    businessId,
    loading,
    error,
    greeting,
    displayName,
    todayRevenue,
    monthlyRevenue,
    pendingInvoices,
    todayBookings,
    completedBookingsToday,
    completedToday,
    momentum,
    priorities,
    tasks,
    momentumRecs,
    nudges: allNudges,
    financialAlerts,
    financialPulse,
    campaignBriefings,
    completingTask,
    momentumActionId,
    dismissingNudge,
    handleCompleteTask,
    handleApproveTask,
    handleDenyTask,
    handleMomentumAction,
    handleMomentumSnooze,
    handleMomentumDismiss,
    handleNudgeSnooze,
    gamification,
    handleDismissTask: (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id)),
    handleDismissAlert: (id: string) => setDismissedAlertIds((prev) => new Set(prev).add(id)),
    handleDismissPriority: (id: string) => setCockpit((prev) => prev ? { ...prev, priorities: prev.priorities.filter((p) => p.id !== id) } : prev),
  };
}
