"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Mail,
  BarChart3,
  PenSquare,
  Users,
  CalendarDays,
  Search,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useSearchParams } from "next/navigation";
import { useModuleEvent } from "@/hooks/use-module-events";
import { useMarketingAiHub } from "./hooks/use-marketing-ai-hub";
import { useMarketing } from "./hooks/use-marketing";
import { MarketingSkeleton } from "./components/marketing-skeleton";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { CampaignsPanel } from "./components/campaigns-panel";
import { LeadFormsPanel } from "./components/lead-forms-panel";
import { CampaignActionQueue } from "./components/campaign-action-queue";
import { FormOptimizationQueue } from "./components/form-optimization-queue";
import MarketingInsightsTab from "./insights/marketing-insights-tab";
import { SocialTabContent } from "./components/social-tab-content";
import { MarketingCalendarTab } from "./components/marketing-calendar-tab";
import { AudienceHealthSection } from "./components/campaign-intelligence-cards";
import { AudienceSegmentsPanel } from "./components/audience-segments-panel";
import type { EmailCampaign, LeadForm } from "@/lib/client";

type CreateMode = "email" | "social";

type MarketingTab = "create" | "calendar" | "audience" | "performance";

const TABS: { key: MarketingTab; label: string; icon: React.ElementType }[] = [
  { key: "create", label: "Create & Schedule", icon: PenSquare },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "audience", label: "Audiences & Forms", icon: Users },
  { key: "performance", label: "Performance", icon: BarChart3 },
];

const TAB_KEYS = TABS.map((t) => t.key);

const LEGACY_TAB_MAP: Record<string, MarketingTab> = {
  audiences: "audience",
  social: "create",
  campaigns: "create",
  forms: "audience",
  insights: "performance",
};

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

export default function MarketingPage() {
  const searchParams = useSearchParams();
  const mk = useMarketing();
  const marketingAi = useMarketingAiHub();

  const [activeTab, setActiveTab] = useState<MarketingTab>("create");
  const [createMode, setCreateMode] = useState<CreateMode>("email");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const initialTabSet = useRef(false);
  const directionRef = useRef<number>(0);

  useEffect(() => {
    if (initialTabSet.current) return;
    const tabParam = searchParams.get("tab");
    if (tabParam) {
      if (tabParam === "social") {
        setActiveTab("create");
        setCreateMode("social");
        initialTabSet.current = true;
      } else {
        const mapped = LEGACY_TAB_MAP[tabParam] || tabParam;
        if (TAB_KEYS.includes(mapped as MarketingTab)) {
          setActiveTab(mapped as MarketingTab);
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
      });
    }
  }, [mk.businessId, activeTab, mk.dataVersion, mk.campaigns, mk.forms, mk.socialPosts, mk.crossModuleSignals, marketingAi.updateMarketingContext]);

  const handleTabChange = useCallback((key: string) => {
    const resolved = LEGACY_TAB_MAP[key] || key;
    const newIndex = TAB_KEYS.indexOf(resolved as MarketingTab);
    const oldIndex = TAB_KEYS.indexOf(activeTab);
    directionRef.current = newIndex > oldIndex ? 1 : -1;
    setActiveTab(resolved as MarketingTab);
    const url = new URL(window.location.href);
    if (resolved === "create") url.searchParams.delete("tab");
    else url.searchParams.set("tab", resolved);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab]);

  const { swipeHandlers } = useSwipeTabs({ tabs: TAB_KEYS, activeTab, onTabChange: handleTabChange });

  useModuleEvent("marketing:create_campaign_for_segment", useCallback(() => {
    handleTabChange("create");
    document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click();
  }, [handleTabChange]));

  const handleNewItem = useCallback(() => {
    if (activeTab === "create") {
      if (createMode === "social") {
        document.querySelector<HTMLButtonElement>("[data-social-new-post]")?.click();
      } else {
        document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click();
      }
    } else if (activeTab === "audience") {
      document.querySelector<HTMLButtonElement>("[data-marketing-new-form]")?.click();
    }
  }, [activeTab, createMode]);

  const handleEditCampaign = useCallback((campaign: EmailCampaign) => {
    document.querySelector<HTMLButtonElement>(`[data-campaign-edit="${campaign.id}"]`)?.click();
  }, []);

  const handleSendCampaign = useCallback((id: string) => {
    document.querySelector<HTMLButtonElement>(`[data-campaign-send="${id}"]`)?.click();
  }, []);

  const handleEditForm = useCallback((form: LeadForm) => {
    document.querySelector<HTMLButtonElement>(`[data-form-edit="${form.id}"]`)?.click();
  }, []);

  const handleAiAction = useCallback((toolId: string) => {
    marketingAi.executeTool(toolId);
  }, [marketingAi]);

  const shortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Marketing",
      shortcuts: [
        { key: "1", description: "Create & Schedule", action: () => handleTabChange("create") },
        { key: "2", description: "Calendar", action: () => handleTabChange("calendar") },
        { key: "3", description: "Audiences & Forms", action: () => handleTabChange("audience") },
        { key: "4", description: "Performance", action: () => handleTabChange("performance") },
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
        <PageHeader icon={Megaphone} title="Marketing" subtitle="Create, engage & measure" />
        <MarketingSkeleton activeTab="social" />
      </div>
    );
  }

  const actionLabel = activeTab === "create"
    ? (createMode === "email" ? "New Campaign" : "New Post")
    : activeTab === "audience" ? "New Form" : undefined;

  return (
    <div className="space-y-6" aria-label="Marketing">
      <PageHeader
        icon={Megaphone}
        title="Marketing"
        subtitle="Create, engage & measure"
        actionLabel={actionLabel}
        onAction={actionLabel ? handleNewItem : undefined}
        titleExtra={
          <FeatureGuide
            featureKey="marketing"
            title="Getting Started with Marketing"
            description="Create campaigns, capture leads, and grow your audience."
            steps={[
              { title: "Create & Schedule", description: "Build email campaigns, compose social posts, and schedule content from one surface." },
              { title: "Calendar", description: "View all scheduled campaigns and posts on a unified content calendar." },
              { title: "Audiences & Forms", description: "Manage lead forms and audience segments for targeted outreach." },
              { title: "Performance", description: "Track campaign performance, open rates, leads, and conversion funnels." },
            ]}
          />
        }
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
                  placeholder="Search marketing..."
                  className="bg-transparent text-xs w-36 focus:outline-none placeholder:text-muted-foreground/50"
                />
                <button onClick={() => { setShowSearch(false); setSearchQuery(""); }} className="p-0.5 hover:text-foreground text-muted-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button onClick={() => setShowSearch(true)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Search marketing">
                <Search className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        }
      />


      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} layoutId="marketing-tab-pill" />

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={directionRef.current}>
          <motion.div key={activeTab} custom={directionRef.current} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}>
            {activeTab === "create" && (
              <div className="space-y-6">
                <CampaignActionQueue campaigns={mk.campaigns} onEdit={handleEditCampaign} onSend={handleSendCampaign} onAiWrite={() => handleAiAction("campaign-content-generator")} />
                <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/20 border border-border/30 w-fit">
                  <button
                    onClick={() => setCreateMode("email")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      createMode === "email"
                        ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" /> Email Campaign
                  </button>
                  <button
                    onClick={() => setCreateMode("social")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      createMode === "social"
                        ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <PenSquare className="w-3.5 h-3.5" /> Social Post
                  </button>
                </div>
                <AnimatePresence mode="wait">
                  {createMode === "email" ? (
                    <motion.div key="email" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                      <CampaignsPanel businessId={mk.businessId} campaigns={mk.campaigns} setCampaigns={mk.setCampaigns} availableTags={mk.availableTags} onCampaignCreated={mk.handleCampaignCreated} onCampaignSent={mk.handleCampaignSent} onViewContact={mk.handleViewContact} onAiWrite={() => handleAiAction("campaign-content-generator")} />
                    </motion.div>
                  ) : (
                    <motion.div key="social" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                      <SocialTabContent businessId={mk.businessId} onPostsLoaded={mk.handleSocialPostsLoaded} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {activeTab === "calendar" && (
              <MarketingCalendarTab campaigns={mk.campaigns} socialPosts={mk.socialPosts} onTabChange={handleTabChange} />
            )}
            {activeTab === "audience" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <AudienceHealthSection businessId={mk.businessId} />
                  <AudienceSegmentsPanel businessId={mk.businessId} />
                </div>
                <div className="space-y-4">
                  <FormOptimizationQueue forms={mk.forms} onAiOptimize={() => handleAiAction("lead-form-optimizer")} onEdit={handleEditForm} onToggle={mk.handleToggleForm} />
                  <LeadFormsPanel businessId={mk.businessId} forms={mk.forms} setForms={mk.setForms} onViewContact={mk.handleViewContact} onAiOptimize={() => handleAiAction("lead-form-optimizer")} />
                </div>
              </div>
            )}
            {activeTab === "performance" && (
              <MarketingInsightsTab campaigns={mk.campaigns} forms={mk.forms} submissions={mk.submissions} socialPosts={mk.socialPosts} stats={mk.stats} businessId={mk.businessId} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
