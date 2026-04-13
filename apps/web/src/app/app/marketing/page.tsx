"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Mail,
  PenSquare,
  Users,
  CalendarDays,
  Search,
  X,
  Send,
  FileText,
  Clock,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Zap,
  LayoutList,
  DollarSign,
  Activity,
  Target,
  UserPlus,
  Layers,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressivePrompts } from "../profile/components/progressive-prompts";
import { TabNav } from "@/components/ui/tab-nav";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useSearchParams } from "next/navigation";
import { useModuleEvent } from "@/hooks/use-module-events";
import { useMarketingAiHub } from "./hooks/use-marketing-ai-hub";
import { useMarketing } from "./hooks/use-marketing";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { MarketingSkeleton } from "./components/marketing-skeleton";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { AiBadge } from "@/components/ui/ai-badge";
import { MARKETING_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { CampaignsPanel } from "./components/campaigns-panel";
import { LeadFormsPanel } from "./components/lead-forms-panel";
import { CampaignActionQueue } from "./components/campaign-action-queue";
import { FormOptimizationQueue } from "./components/form-optimization-queue";
import { SocialTabContent } from "./components/social-tab-content";
import { MarketingCalendarTab } from "./components/marketing-calendar-tab";
import { AudienceHealthSection } from "./components/campaign-intelligence-cards";
import { AudienceSegmentsPanel } from "./components/audience-segments-panel";
import { AudienceHealthDashboard } from "./components/audience-health-dashboard";
import { UnifiedComposer } from "./components/unified/unified-composer";
import { ContentStudioTab } from "./components/content-studio-tab";
import { useChannelHealth } from "@/hooks/use-channel-health";
import { listOutboundContent } from "@/lib/client";
import type { EmailCampaign, LeadForm, OutboundContent } from "@/lib/client";
import type { BusinessPulse } from "./hooks/use-marketing";

type ContentTab = "create" | "calendar" | "audience" | "studio";
type CreateSubmode = "compose" | "campaigns" | "posts" | "scheduled";

const TABS: { key: ContentTab; label: string; icon: React.ElementType; tooltip?: string }[] = [
  { key: "create", label: "Create & Schedule", icon: PenSquare, tooltip: "Compose content, manage campaigns and posts, and schedule delivery." },
  { key: "calendar", label: "Calendar", icon: CalendarDays, tooltip: "Visual calendar of all scheduled and sent content." },
  { key: "audience", label: "Audiences & Forms", icon: Users, tooltip: "Build audience segments and lead capture forms for targeting." },
  { key: "studio", label: "Studio", icon: Settings, tooltip: "Manage connected channels, health diagnostics, and sender settings." },
];

const TAB_KEYS = TABS.map((t) => t.key);

const CREATE_SUBMODES: { key: CreateSubmode; label: string; icon: React.ElementType }[] = [
  { key: "compose", label: "Compose", icon: PenSquare },
  { key: "campaigns", label: "Campaigns", icon: Mail },
  { key: "posts", label: "Posts", icon: LayoutList },
  { key: "scheduled", label: "Scheduled", icon: Clock },
];

const LEGACY_TAB_MAP: Record<string, ContentTab> = {
  audiences: "audience",
  social: "create",
  campaigns: "create",
  forms: "audience",
  insights: "create",
  performance: "create",
  connections: "studio",
  channels: "studio",
};

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

function ContentIntelligenceStrip({
  campaigns,
  socialPosts,
  onCreateCampaign,
  onCreatePost,
  onScheduleDraft,
}: {
  campaigns: EmailCampaign[];
  socialPosts: any[];
  onCreateCampaign: () => void;
  onCreatePost: () => void;
  onScheduleDraft: () => void;
}) {
  const insights = useMemo(() => {
    const items: { icon: React.ElementType; text: string; color: string; action?: () => void; actionLabel?: string }[] = [];

    const drafts = campaigns.filter((c) => c.status === "DRAFT");
    const readyDrafts = drafts.filter((c) => c.name?.trim() && c.subject?.trim() && c.body?.trim());
    const socialDrafts = socialPosts.filter((p) => p.status === "DRAFT");

    const now = new Date();
    const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

    const scheduledCampaigns = campaigns.filter((c) => c.status === "SCHEDULED" && c.scheduledAt);
    const scheduledPosts = socialPosts.filter((p) => p.status === "SCHEDULED" && p.scheduledFor);
    const upcomingCount = [...scheduledCampaigns, ...scheduledPosts].filter((item) => {
      const d = new Date((item as any).scheduledAt || (item as any).scheduledFor);
      return d >= now && d <= fiveDaysFromNow;
    }).length;

    if (upcomingCount === 0) {
      items.push({
        icon: AlertTriangle,
        text: "No content scheduled for the next 5 days",
        color: "text-amber-400",
        action: onScheduleDraft,
        actionLabel: readyDrafts.length > 0 ? "Schedule draft" : "Create content",
      });
    }

    if (readyDrafts.length > 0) {
      items.push({
        icon: Send,
        text: `${readyDrafts.length} campaign${readyDrafts.length > 1 ? "s" : ""} ready to send`,
        color: "text-emerald-400",
        action: onScheduleDraft,
        actionLabel: "Review",
      });
    }

    if (socialDrafts.length > 0) {
      items.push({
        icon: FileText,
        text: `${socialDrafts.length} social draft${socialDrafts.length > 1 ? "s" : ""} ready to schedule`,
        color: "text-blue-400",
        action: onCreatePost,
        actionLabel: "Schedule",
      });
    }

    const sentCampaigns = campaigns.filter((c) => c.status === "SENT" && c.totalRecipients > 0);
    const avgOpenRate = sentCampaigns.length > 0
      ? sentCampaigns.reduce((sum, c) => sum + (c.openCount / c.totalRecipients), 0) / sentCampaigns.length
      : 0;
    if (sentCampaigns.length >= 2 && avgOpenRate > 0.2) {
      items.push({
        icon: TrendingUp,
        text: `${Math.round(avgOpenRate * 100)}% avg open rate across ${sentCampaigns.length} campaigns`,
        color: "text-emerald-400",
      });
    }

    if (items.length === 0) {
      items.push({
        icon: Sparkles,
        text: "Start creating content to see planning insights",
        color: "text-muted-foreground",
        action: onCreateCampaign,
        actionLabel: "Get started",
      });
    }

    return items;
  }, [campaigns, socialPosts, onCreateCampaign, onCreatePost, onScheduleDraft]);

  if (insights.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-card p-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Content Intelligence</span>
      </div>
      <div className="space-y-1">
        {insights.slice(0, 4).map((insight, i) => (
          <div key={i} className="flex items-center justify-between gap-2 group">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <insight.icon className={`w-3 h-3 shrink-0 ${insight.color}`} />
              <span className="text-[11px] text-muted-foreground truncate">{insight.text}</span>
            </div>
            {insight.action && insight.actionLabel && (
              <button
                onClick={insight.action}
                className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {insight.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BusinessPulseStrip({
  pulse,
  crossModuleSignals,
  onCreateCampaign,
  onCreatePost,
}: {
  pulse: BusinessPulse;
  crossModuleSignals: { type: string; message: string; timestamp: number }[];
  onCreateCampaign: () => void;
  onCreatePost: () => void;
}) {
  const insights = useMemo(() => {
    const items: { icon: React.ElementType; text: string; color: string; action?: () => void; actionLabel?: string }[] = [];

    if (pulse.pipeline) {
      const { contactsGoingCold, newThisWeek, totalContacts, leads } = pulse.pipeline;

      if (contactsGoingCold > 0) {
        items.push({
          icon: AlertTriangle,
          text: `${contactsGoingCold} contact${contactsGoingCold > 1 ? "s" : ""} going cold — send a re-engagement campaign`,
          color: "text-red-400",
          action: onCreateCampaign,
          actionLabel: "Win back",
        });
      }

      if (newThisWeek > 0) {
        items.push({
          icon: UserPlus,
          text: `${newThisWeek} new contact${newThisWeek > 1 ? "s" : ""} this week — welcome them with targeted content`,
          color: "text-emerald-400",
          action: onCreateCampaign,
          actionLabel: "Welcome",
        });
      }

      if (leads > 0 && totalContacts > 0) {
        const leadPct = Math.round((leads / totalContacts) * 100);
        if (leadPct > 40) {
          items.push({
            icon: Target,
            text: `${leadPct}% of contacts are still leads — nurture them toward conversion`,
            color: "text-amber-400",
            action: onCreateCampaign,
            actionLabel: "Nurture",
          });
        }
      }
    }

    if (pulse.financial) {
      const { revenueGrowthPct, topServices, revenueAtRisk } = pulse.financial;

      if (revenueGrowthPct > 10) {
        items.push({
          icon: TrendingUp,
          text: `Revenue up ${Math.round(revenueGrowthPct)}% — promote your momentum with a success story`,
          color: "text-emerald-400",
          action: onCreatePost,
          actionLabel: "Share win",
        });
      } else if (revenueGrowthPct < -5) {
        items.push({
          icon: DollarSign,
          text: `Revenue down ${Math.abs(Math.round(revenueGrowthPct))}% — consider a promotional campaign`,
          color: "text-red-400",
          action: onCreateCampaign,
          actionLabel: "Promote",
        });
      }

      if (revenueAtRisk > 0) {
        items.push({
          icon: AlertTriangle,
          text: `TTD ${revenueAtRisk.toLocaleString()} revenue at risk from overdue invoices`,
          color: "text-amber-400",
          action: onCreateCampaign,
          actionLabel: "Follow up",
        });
      }

      if (topServices.length > 0) {
        const topService = topServices[0];
        items.push({
          icon: Activity,
          text: `"${topService.name}" is your top earner — create content around it`,
          color: "text-blue-400",
          action: onCreatePost,
          actionLabel: "Promote",
        });
      }
    }

    const recentSignals = crossModuleSignals.filter((s) => Date.now() - s.timestamp < 600_000);
    for (const signal of recentSignals.slice(0, 2)) {
      items.push({
        icon: Zap,
        text: signal.message,
        color: "text-purple-400",
        action: signal.type === "invoice_paid" || signal.type === "contacts_imported" ? onCreateCampaign : onCreatePost,
        actionLabel: "Act now",
      });
    }

    return items.slice(0, 4);
  }, [pulse, crossModuleSignals, onCreateCampaign, onCreatePost]);

  if (insights.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-card p-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Business Pulse</span>
      </div>
      <div className="space-y-1">
        {insights.map((insight, i) => (
          <div key={i} className="flex items-center justify-between gap-2 group">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <insight.icon className={`w-3 h-3 shrink-0 ${insight.color}`} />
              <span className="text-[11px] text-muted-foreground truncate">{insight.text}</span>
            </div>
            {insight.action && insight.actionLabel && (
              <button
                onClick={insight.action}
                className="text-[10px] font-medium text-purple-400 hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {insight.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContentPage() {
  const { getReturnLabel, navigateBack, getOriginWorkspace } = useReturnNavigation({ restoreScrollOnMount: true });
  const searchParams = useSearchParams();
  const mk = useMarketing();
  const marketingAi = useMarketingAiHub();
  const channelHealth = useChannelHealth(mk.businessId || "");
  const { setCurrentMeta } = useNavigationContext();

  const [activeTab, setActiveTab] = useState<ContentTab>("create");
  const [createSubmode, setCreateSubmode] = useState<CreateSubmode>("compose");
  const [composeType, setComposeType] = useState<"email" | "social" | "multi">("email");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [outboundContent, setOutboundContent] = useState<OutboundContent[]>([]);
  const [editingContentId, setEditingContentId] = useState<string | undefined>();
  const initialTabSet = useRef(false);
  const directionRef = useRef<number>(0);
  const composeTaskIdRef = useRef<string | null>(null);
  const composeSessionIdRef = useRef<string | null>(null);
  const [prefillContactId, setPrefillContactId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (activeTab === "create" && createSubmode === "compose") {
      if (!composeSessionIdRef.current) {
        composeSessionIdRef.current = `marketing-compose-${composeType}-${Date.now()}`;
      }
      const sessionId = composeSessionIdRef.current;
      const typeLabel = composeType === "email" ? "Email draft" : "Social post";
      const taskId = registerInterruptedTask({
        id: sessionId,
        module: "marketing",
        label: typeLabel,
        description: `Resume composing ${composeType === "email" ? "email" : "social post"}`,
        route: `/app/marketing?tab=${composeType === "email" ? "create" : "social"}`,
        draftId: null,
        originRoute: "/app/marketing",
        originLabel: "Content",
        taskIntent: `compose-${composeType}`,
        formData: { composeType },
      });
      composeTaskIdRef.current = taskId;
    }
  }, [activeTab, createSubmode, composeType]);

  useEffect(() => {
    if (initialTabSet.current) return;
    const tabParam = searchParams.get("tab");
    const contactIdParam = searchParams.get("contactId");
    if (contactIdParam) {
      setPrefillContactId(contactIdParam);
      window.history.replaceState({}, "", "/app/marketing");
    }
    if (tabParam) {
      if (tabParam === "social") {
        setActiveTab("create");
        setCreateSubmode("compose");
        setComposeType("social");
        initialTabSet.current = true;
      } else if (tabParam === "campaigns") {
        setActiveTab("create");
        setCreateSubmode("campaigns");
        initialTabSet.current = true;
      } else if (tabParam === "posts") {
        setActiveTab("create");
        setCreateSubmode("posts");
        initialTabSet.current = true;
      } else if (tabParam === "scheduled") {
        setActiveTab("create");
        setCreateSubmode("scheduled");
        initialTabSet.current = true;
      } else if (tabParam === "studio" || tabParam === "connections" || tabParam === "channels") {
        setActiveTab("studio");
        initialTabSet.current = true;
      } else {
        const mapped = LEGACY_TAB_MAP[tabParam] || tabParam;
        if (TAB_KEYS.includes(mapped as ContentTab)) {
          setActiveTab(mapped as ContentTab);
          initialTabSet.current = true;
        }
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (mk.businessId) {
      marketingAi.updateMarketingContext({
        businessId: mk.businessId,
        activeView: activeTab,
        itemCount: activeTab === "create" ? mk.campaigns.length + mk.socialPosts.length : activeTab === "audience" ? mk.forms.length : mk.campaigns.length,
        campaigns: mk.campaigns,
        forms: mk.forms,
        socialPosts: mk.socialPosts,
        crossModuleSignals: mk.crossModuleSignals,
        businessPulse: mk.businessPulse,
      });
    }
  }, [mk.businessId, activeTab, mk.dataVersion, mk.campaigns, mk.forms, mk.socialPosts, mk.crossModuleSignals, mk.businessPulse, marketingAi.updateMarketingContext]);

  useEffect(() => {
    if (!mk.businessId) return;
    void (async () => {
      const res = await listOutboundContent(mk.businessId ?? undefined);
      if (res.data) setOutboundContent(res.data);
    })();
  }, [mk.businessId, mk.dataVersion]);

  const handleTabChange = useCallback((key: string) => {
    const resolved = LEGACY_TAB_MAP[key] || key;
    const newIndex = TAB_KEYS.indexOf(resolved as ContentTab);
    const oldIndex = TAB_KEYS.indexOf(activeTab);
    directionRef.current = newIndex > oldIndex ? 1 : -1;
    setActiveTab(resolved as ContentTab);
    setCurrentMeta({ tab: resolved === "create" ? null : resolved });
    const url = new URL(window.location.href);
    if (resolved === "create") url.searchParams.delete("tab");
    else url.searchParams.set("tab", resolved);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, setCurrentMeta]);

  const { swipeHandlers } = useSwipeTabs({ tabs: TAB_KEYS, activeTab, onTabChange: handleTabChange });

  useModuleEvent("marketing:create_campaign_for_segment", useCallback(() => {
    handleTabChange("create");
    setCreateSubmode("compose");
    setComposeType("email");
    document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click();
  }, [handleTabChange]));

  useEffect(() => {
    const composeParam = searchParams.get("compose");
    const contentTypeParam = searchParams.get("contentType");
    if (composeParam === "true") {
      setActiveTab("create");
      setCreateSubmode("compose");
      if (contentTypeParam === "email") setComposeType("email");
      else if (contentTypeParam === "multi") setComposeType("multi");
      else setComposeType("social");
    }
  }, [searchParams]);

  const handleNewItem = useCallback(() => {
    if (activeTab === "create") {
      if (createSubmode === "compose") {
        setEditingContentId(undefined);
        setCreateSubmode("compose");
      } else if (createSubmode === "campaigns") {
        document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click();
      } else if (createSubmode === "posts") {
        document.querySelector<HTMLButtonElement>("[data-social-new-post]")?.click();
      }
    } else if (activeTab === "audience") {
      document.querySelector<HTMLButtonElement>("[data-marketing-new-form]")?.click();
    }
  }, [activeTab, createSubmode]);

  const handleEditCampaign = useCallback((campaign: EmailCampaign) => {
    document.querySelector<HTMLButtonElement>(`[data-campaign-edit="${campaign.id}"]`)?.click();
  }, []);

  const handleSendCampaign = useCallback((id: string) => {
    document.querySelector<HTMLButtonElement>(`[data-campaign-send="${id}"]`)?.click();
  }, []);

  const handleCampaignSentWithCompletion = useCallback((campaign: Parameters<typeof mk.handleCampaignSent>[0]) => {
    if (composeTaskIdRef.current) {
      markTaskCompleted(composeTaskIdRef.current);
      composeTaskIdRef.current = null;
    }
    composeSessionIdRef.current = null;
    mk.handleCampaignSent(campaign);
  }, [mk]);

  const handleEditForm = useCallback((form: LeadForm) => {
    document.querySelector<HTMLButtonElement>(`[data-form-edit="${form.id}"]`)?.click();
  }, []);

  const handleAiAction = useCallback(async (toolId: string) => {
    const toolName = toolId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    toast.info(`Running ${toolName}...`);
    try {
      await marketingAi.executeTool(toolId);
      toast.success(`${toolName} complete`);
    } catch {
      toast.error(`${toolName} failed. Try again.`);
    }
  }, [marketingAi]);

  const scheduledItems = useMemo(() => {
    const items: { id: string; type: "campaign" | "post" | "outbound"; title: string; scheduledFor: string; status: string; contentType?: string }[] = [];
    mk.campaigns
      .filter((c) => c.status === "SCHEDULED" && c.scheduledAt)
      .forEach((c) => items.push({ id: c.id, type: "campaign", title: c.name || "Untitled Campaign", scheduledFor: c.scheduledAt!, status: c.status }));
    mk.socialPosts
      .filter((p) => p.status === "SCHEDULED" && p.scheduledFor)
      .forEach((p) => items.push({ id: p.id, type: "post", title: (p.content ?? "").slice(0, 50) || "Untitled Post", scheduledFor: p.scheduledFor!, status: p.status }));
    outboundContent
      .filter((c) => (c.status === "SCHEDULED" || c.status === "Scheduled") && c.scheduledAt)
      .forEach((c) => items.push({ id: c.id, type: "outbound", title: c.subject || c.body?.slice(0, 50) || "Outbound Content", scheduledFor: c.scheduledAt!, status: c.status, contentType: c.contentType }));
    items.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    return items;
  }, [mk.campaigns, mk.socialPosts, outboundContent]);

  const schedulingInsights = useMemo(() => {
    const warnings: { text: string; type: "conflict" | "gap" | "cadence" }[] = [];

    const dateCounts: Record<string, number> = {};
    scheduledItems.forEach((item) => {
      const day = new Date(item.scheduledFor).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      dateCounts[day] = (dateCounts[day] || 0) + 1;
    });
    Object.entries(dateCounts).forEach(([day, count]) => {
      if (count >= 3) warnings.push({ text: `${count} items on ${day} — consider spreading content`, type: "conflict" });
    });

    if (scheduledItems.length > 0) {
      const dates = scheduledItems.map((i) => new Date(i.scheduledFor).getTime()).sort((a, b) => a - b);
      for (let i = 1; i < dates.length; i++) {
        const gap = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
        if (gap > 5) {
          const gapStart = new Date(dates[i - 1]).toLocaleDateString("en-TT", { month: "short", day: "numeric" });
          const gapEnd = new Date(dates[i]).toLocaleDateString("en-TT", { month: "short", day: "numeric" });
          warnings.push({ text: `${Math.round(gap)}-day gap between ${gapStart} and ${gapEnd}`, type: "gap" });
        }
      }
    }

    const now = Date.now();
    const thisWeekEnd = now + 7 * 24 * 60 * 60 * 1000;
    const thisWeekCount = scheduledItems.filter((i) => {
      const t = new Date(i.scheduledFor).getTime();
      return t >= now && t <= thisWeekEnd;
    }).length;
    if (thisWeekCount < 2 && scheduledItems.length > 0) {
      warnings.push({ text: `Only ${thisWeekCount} item${thisWeekCount === 1 ? "" : "s"} this week — consider increasing cadence`, type: "cadence" });
    }

    return warnings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledItems, mk.dataVersion]);

  const shortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Content",
      shortcuts: [
        { key: "1", description: "Create & Schedule", action: () => handleTabChange("create") },
        { key: "2", description: "Calendar", action: () => handleTabChange("calendar") },
        { key: "3", description: "Audiences & Forms", action: () => handleTabChange("audience") },
        { key: "4", description: "Studio", action: () => handleTabChange("studio") },
        { key: "n", description: "New item", action: handleNewItem },
        { key: "r", description: "Refresh", action: () => { void mk.loadData(); } },
        { key: "/", description: "Search", action: () => setShowSearch(true) },
        { key: "Escape", description: "Close panels", action: () => {
          if (showSearch) { setShowSearch(false); setSearchQuery(""); }
        } },
      ],
    },
  ], [handleTabChange, handleNewItem, mk.loadData, showSearch]);

  useKeyboardShortcuts(shortcuts, !mk.loading);

  if (mk.loading) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Megaphone} title="Content" subtitle="Create, schedule, target, and grow" />
        <MarketingSkeleton activeTab="social" />
      </div>
    );
  }

  const actionLabel = activeTab === "create"
    ? (createSubmode === "compose"
        ? (composeType === "email" ? "New Campaign" : "New Post")
        : createSubmode === "campaigns" ? "New Campaign"
        : createSubmode === "posts" ? "New Post"
        : undefined)
    : activeTab === "audience" ? "New Form" : undefined;

  const originWorkspace = getOriginWorkspace();
  const showCrossModuleBanner = !!prefillContactId && !!originWorkspace && originWorkspace !== "Content";

  return (
    <div className="space-y-5" aria-label="Content">
      <ResumePrompt module="marketing" />
      {showCrossModuleBanner && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
          <button
            onClick={() => navigateBack()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
            title={getReturnLabel()}
          >
            <span className="group-hover:-translate-x-0.5 transition-transform inline-flex items-center">&#8592;</span>
            <span className="max-w-[180px] truncate hidden sm:inline ml-1">{getReturnLabel()}</span>
          </button>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">
            Creating campaign for contact from {originWorkspace}
          </span>
        </div>
      )}
      <PageHeader
        icon={Megaphone}
        title="Content"
        subtitle="Create, schedule, target, and grow"
        actionLabel={actionLabel}
        onAction={actionLabel ? handleNewItem : undefined}
        titleExtra={<PageGuideTrigger moduleKey="marketing" />}
        rightSlot={
          <div className="flex items-center gap-1.5">
            {showSearch ? (
              <div className="flex items-center gap-1 bg-muted/30 border border-border/30 rounded-md px-2 py-1">
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search content..."
                  className="bg-transparent text-xs w-36 focus:outline-none placeholder:text-muted-foreground/50"
                />
                <button onClick={() => { setShowSearch(false); setSearchQuery(""); }} className="p-0.5 hover:text-foreground text-muted-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button onClick={() => setShowSearch(true)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Search content">
                <Search className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        }
      />

      <div data-walkthrough="marketing-tabs">
        <TabNav tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} layoutId="content-tab-pill" />
      </div>

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={directionRef.current}>
          <motion.div key={activeTab} custom={directionRef.current} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}>
            {activeTab === "create" && (
              <div className="space-y-4">
                <ContentIntelligenceStrip
                  campaigns={mk.campaigns}
                  socialPosts={mk.socialPosts}
                  onCreateCampaign={() => { setCreateSubmode("compose"); setComposeType("email"); setTimeout(() => document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click(), 100); }}
                  onCreatePost={() => { setCreateSubmode("compose"); setComposeType("social"); setTimeout(() => document.querySelector<HTMLButtonElement>("[data-social-new-post]")?.click(), 100); }}
                  onScheduleDraft={() => setCreateSubmode("scheduled")}
                />
                <BusinessPulseStrip
                  pulse={mk.businessPulse}
                  crossModuleSignals={mk.crossModuleSignals}
                  onCreateCampaign={() => { setCreateSubmode("compose"); setComposeType("email"); setTimeout(() => document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click(), 100); }}
                  onCreatePost={() => { setCreateSubmode("compose"); setComposeType("social"); setTimeout(() => document.querySelector<HTMLButtonElement>("[data-social-new-post]")?.click(), 100); }}
                />

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/20 border border-border/30" data-walkthrough="marketing-create">
                    {CREATE_SUBMODES.map((mode) => (
                      <button
                        key={mode.key}
                        onClick={() => setCreateSubmode(mode.key)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                          createSubmode === mode.key
                            ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <mode.icon className="w-3 h-3" /> {mode.label}
                      </button>
                    ))}
                  </div>
                  <AiBadge label="AI Content" explanation="AI can generate email subject lines, body copy, and social posts based on your business context and audience." />
                </div>

                {createSubmode === "compose" && mk.businessId && (
                  <div className="space-y-4">
                    <UnifiedComposer
                      businessId={mk.businessId}
                      editContentId={editingContentId}
                      initialContentType={composeType === "email" ? "email" : composeType === "multi" ? "multi" : "social"}
                      onContentCreated={() => { setEditingContentId(undefined); void mk.loadData(); }}
                      onClose={() => { setEditingContentId(undefined); setCreateSubmode("posts"); void mk.loadData(); }}
                      healthData={channelHealth}
                    />
                  </div>
                )}

                {createSubmode === "campaigns" && (
                  <div className="space-y-4">
                    <CampaignActionQueue campaigns={mk.campaigns} onEdit={handleEditCampaign} onSend={handleSendCampaign} onAiWrite={() => handleAiAction("campaign-content-generator")} />
                    {mk.campaigns.length > 0 && (
                      <div className="flex items-center gap-3 flex-wrap text-[10px] px-1">
                        {(() => {
                          const draft = mk.campaigns.filter((c) => c.status === "DRAFT").length;
                          const scheduled = mk.campaigns.filter((c) => c.status === "SCHEDULED").length;
                          const sent = mk.campaigns.filter((c) => c.status === "SENT").length;
                          const totalRecipients = mk.campaigns.filter((c) => c.status === "SENT").reduce((s, c) => s + (c.totalRecipients ?? 0), 0);
                          return (
                            <>
                              <span className="text-muted-foreground font-medium">{draft} Draft</span>
                              <span className="text-blue-400 font-medium">{scheduled} Scheduled</span>
                              <span className="text-emerald-400 font-medium">{sent} Sent</span>
                              {totalRecipients > 0 && (
                                <>
                                  <span className="text-muted-foreground/30">|</span>
                                  <span className="text-amber-400 font-medium">{totalRecipients.toLocaleString()} total recipients</span>
                                </>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                    <CampaignsPanel businessId={mk.businessId} campaigns={mk.campaigns} setCampaigns={mk.setCampaigns} availableTags={mk.availableTags} onCampaignCreated={mk.handleCampaignCreated} onCampaignSent={handleCampaignSentWithCompletion} onViewContact={mk.handleViewContact} onAiWrite={() => handleAiAction("campaign-content-generator")} />
                  </div>
                )}

                {createSubmode === "posts" && (
                  <div className="space-y-4">
                    {mk.socialPosts.length > 0 && (
                      <div className="flex items-center gap-3 flex-wrap text-[10px] px-1">
                        {(() => {
                          const draft = mk.socialPosts.filter((p) => p.status === "DRAFT").length;
                          const scheduled = mk.socialPosts.filter((p) => p.status === "SCHEDULED").length;
                          const posted = mk.socialPosts.filter((p) => p.status === "POSTED").length;
                          const failed = mk.socialPosts.filter((p) => p.status === "FAILED").length;
                          return (
                            <>
                              <span className="text-muted-foreground font-medium">{draft} Draft</span>
                              <span className="text-blue-400 font-medium">{scheduled} Scheduled</span>
                              <span className="text-emerald-400 font-medium">{posted} Posted</span>
                              {failed > 0 && <span className="text-red-400 font-medium">{failed} Failed</span>}
                            </>
                          );
                        })()}
                      </div>
                    )}
                    <SocialTabContent businessId={mk.businessId} onPostsLoaded={mk.handleSocialPostsLoaded} />
                  </div>
                )}

                {createSubmode === "scheduled" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 flex-wrap text-[10px] px-1">
                      <span className="text-blue-400 font-medium">{scheduledItems.length} upcoming</span>
                      {(() => {
                        const draftCampaigns = mk.campaigns.filter((c) => c.status === "DRAFT" && c.name?.trim() && c.subject?.trim() && c.body?.trim()).length;
                        const draftPosts = mk.socialPosts.filter((p) => p.status === "DRAFT").length;
                        const total = draftCampaigns + draftPosts;
                        return total > 0 ? (
                          <>
                            <span className="text-muted-foreground/30">|</span>
                            <span className="text-amber-400 font-medium">{total} draft{total > 1 ? "s" : ""} ready to schedule</span>
                          </>
                        ) : null;
                      })()}
                    </div>
                    {schedulingInsights.length > 0 && (
                      <div className="rounded-xl border border-border/30 bg-card p-2.5 space-y-1">
                        {schedulingInsights.map((insight, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <AlertTriangle className={`w-3 h-3 shrink-0 ${insight.type === "conflict" ? "text-red-400" : insight.type === "gap" ? "text-amber-400" : "text-blue-400"}`} />
                            <span className="text-muted-foreground">{insight.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {scheduledItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-14 h-14 rounded-xl bg-muted/10 border border-border/50 flex items-center justify-center mb-4">
                          <Clock className="w-7 h-7 text-muted-foreground/50" />
                        </div>
                        <h3 className="text-lg font-semibold mb-1">No Scheduled Content</h3>
                        <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                          Schedule campaigns and social posts to maintain a consistent content cadence and keep your audience engaged.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setCreateSubmode("compose"); setComposeType("email"); }}
                            className="px-3 py-2 text-xs font-medium rounded-lg bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/25 transition-colors"
                          >
                            <Mail className="w-3.5 h-3.5 inline mr-1.5" />Create Campaign
                          </button>
                          <button
                            onClick={() => { setCreateSubmode("compose"); setComposeType("social"); }}
                            className="px-3 py-2 text-xs font-medium rounded-lg bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/25 transition-colors"
                          >
                            <PenSquare className="w-3.5 h-3.5 inline mr-1.5" />Create Post
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {scheduledItems.map((item) => {
                          const scheduledDate = new Date(item.scheduledFor);
                          const isClose = scheduledDate.getTime() - Date.now() < 24 * 60 * 60 * 1000;
                          const hour = scheduledDate.getHours();
                          const dayOfWeek = scheduledDate.getDay();
                          const bestTimeHint = (() => {
                            if (item.type === "post" || item.type === "outbound") {
                              if (hour < 8 || hour > 20) return "Consider 9am-12pm for higher engagement";
                              if (dayOfWeek === 0 || dayOfWeek === 6) return "Weekday posts typically get 20% more reach";
                              if (hour >= 12 && hour <= 14) return "Lunch hours — good engagement window";
                              return null;
                            }
                            if (item.type === "campaign") {
                              if (hour < 7 || hour > 18) return "Emails sent 9-11am have higher open rates";
                              if (dayOfWeek === 1) return "Tuesdays have peak email open rates";
                              if (dayOfWeek === 5) return "Friday sends may see lower engagement";
                              return null;
                            }
                            return null;
                          })();
                          const iconMap = { campaign: { bg: "bg-blue-500/10", icon: <Mail className="w-3.5 h-3.5 text-blue-400" /> }, post: { bg: "bg-[hsl(var(--kf-accent2))]/10", icon: <PenSquare className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" /> }, outbound: { bg: "bg-[hsl(var(--kf-accent1))]/10", icon: <Layers className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" /> } };
                          const itemStyle = iconMap[item.type] || iconMap.post;
                          return (
                            <div key={item.id} className="rounded-xl border border-border/30 bg-card p-3 hover:bg-muted/10 transition-colors group">
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${itemStyle.bg}`}>
                                  {itemStyle.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{item.title}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                    <span className="capitalize">{item.type}</span>
                                    <span className="text-muted-foreground/30">·</span>
                                    <span>{scheduledDate.toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                                  </div>
                                </div>
                                {isClose && (
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                    Soon
                                  </span>
                                )}
                                {item.type === "outbound" && (
                                  <button
                                    onClick={() => { setEditingContentId(item.id); setCreateSubmode("compose"); }}
                                    className="text-[10px] text-[hsl(var(--kf-accent1))] opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>
                              {bestTimeHint && (
                                <div className="flex items-center gap-1.5 mt-2 ml-11 text-[10px] text-purple-400/80">
                                  <Sparkles className="w-3 h-3 shrink-0" />
                                  <span>{bestTimeHint}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {activeTab === "calendar" && (
              <div className="space-y-4">
                <CalendarInsightStrip campaigns={mk.campaigns} socialPosts={mk.socialPosts} />
                <MarketingCalendarTab campaigns={mk.campaigns} socialPosts={mk.socialPosts} onTabChange={handleTabChange} />
              </div>
            )}
            {activeTab === "audience" && (
              <div className="space-y-6">
                <AudienceHealthDashboard
                  businessId={mk.businessId}
                  onCreateCampaign={() => { handleTabChange("create"); setCreateSubmode("compose"); setComposeType("email"); }}
                />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <AudienceHealthSection businessId={mk.businessId} />
                  <AudienceSegmentsPanel
                    businessId={mk.businessId}
                    onCreateCampaign={() => { handleTabChange("create"); setCreateSubmode("compose"); setComposeType("email"); }}
                    onCreatePost={() => { handleTabChange("create"); setCreateSubmode("compose"); setComposeType("social"); }}
                  />
                </div>
                <div className="space-y-4" data-walkthrough="marketing-forms">
                  <FormOptimizationQueue forms={mk.forms} onAiOptimize={() => handleAiAction("lead-form-optimizer")} onEdit={handleEditForm} onToggle={mk.handleToggleForm} />
                  <LeadFormsPanel businessId={mk.businessId} forms={mk.forms} setForms={mk.setForms} onViewContact={mk.handleViewContact} onAiOptimize={() => handleAiAction("lead-form-optimizer")} />
                </div>
              </div>
            )}
            {activeTab === "studio" && (
              <ContentStudioTab businessId={mk.businessId || ""} sharedHealth={channelHealth} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <ProgressivePrompts moduleFilter={["marketingStrategy", "growth"]} />

      <PageGuide
        moduleKey="marketing"
        walkthroughSteps={MARKETING_WALKTHROUGH}
      />
    </div>
  );
}

function CalendarInsightStrip({ campaigns, socialPosts }: { campaigns: EmailCampaign[]; socialPosts: any[] }) {
  const insights = useMemo(() => {
    const items: { text: string; color?: string }[] = [];
    const now = new Date();
    const thisWeekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const scheduledThisWeek = [
      ...campaigns.filter((c) => c.status === "SCHEDULED" && c.scheduledAt && new Date(c.scheduledAt) <= thisWeekEnd),
      ...socialPosts.filter((p) => p.status === "SCHEDULED" && p.scheduledFor && new Date(p.scheduledFor) <= thisWeekEnd),
    ];

    if (scheduledThisWeek.length === 0) {
      items.push({ text: "No content scheduled this week — consider adding posts or campaigns", color: "text-amber-400" });
    } else {
      items.push({ text: `${scheduledThisWeek.length} item${scheduledThisWeek.length > 1 ? "s" : ""} scheduled this week` });
    }

    const draftCount = campaigns.filter((c) => c.status === "DRAFT").length + socialPosts.filter((p) => p.status === "DRAFT").length;
    if (draftCount > 0) {
      items.push({ text: `${draftCount} draft${draftCount > 1 ? "s" : ""} awaiting scheduling` });
    }

    const sentCount = campaigns.filter((c) => c.status === "SENT").length + socialPosts.filter((p) => p.status === "POSTED").length;
    if (sentCount > 0) {
      items.push({ text: `${sentCount} sent/posted` });
    }

    return items;
  }, [campaigns, socialPosts]);

  if (insights.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap text-[10px] px-1">
      <CalendarDays className="w-3 h-3 text-[hsl(var(--kf-accent2))]" />
      {insights.map((item, i) => (
        <span key={i} className={`font-medium ${item.color || "text-muted-foreground"}`}>{i > 0 && <span className="text-muted-foreground/30 mr-3">|</span>}{item.text}</span>
      ))}
    </div>
  );
}
