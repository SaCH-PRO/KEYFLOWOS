"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Mail,
  ClipboardList,
  BarChart3,
  PenSquare,
  Users,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useSearchParams } from "next/navigation";
import { useModuleEvent } from "@/hooks/use-module-events";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import { useMarketingAiHub } from "./hooks/use-marketing-ai-hub";
import { useMarketing } from "./hooks/use-marketing";
import { renderMarketingToolResult } from "./components/marketing-tool-results";
import { MarketingSkeleton } from "./components/marketing-skeleton";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { CampaignsPanel } from "./components/campaigns-panel";
import { LeadFormsPanel } from "./components/lead-forms-panel";
import { CampaignActionQueue } from "./components/campaign-action-queue";
import { FormOptimizationQueue } from "./components/form-optimization-queue";
import MarketingInsightsTab from "./insights/marketing-insights-tab";
import { SocialTabContent } from "./components/social-tab-content";
import type { EmailCampaign, LeadForm } from "@/lib/client";

type MarketingTab = "create" | "audiences" | "performance";

const TABS: { key: MarketingTab; label: string; icon: React.ElementType }[] = [
  { key: "create", label: "Create & Schedule", icon: PenSquare },
  { key: "audiences", label: "Audiences & Forms", icon: Users },
  { key: "performance", label: "Performance", icon: BarChart3 },
];

const TAB_KEYS = TABS.map((t) => t.key);

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
  const [showSearch, setShowSearch] = useState(false);
  const initialTabSet = useRef(false);
  const directionRef = useRef<number>(0);

  useEffect(() => {
    if (initialTabSet.current) return;
    const tabParam = searchParams.get("tab");
    if (tabParam && TAB_KEYS.includes(tabParam as MarketingTab)) {
      setActiveTab(tabParam as MarketingTab);
      initialTabSet.current = true;
    }
  }, [searchParams]);

  useEffect(() => {
    if (mk.businessId) {
      marketingAi.updateMarketingContext({
        businessId: mk.businessId,
        activeView: activeTab,
        itemCount: activeTab === "create" ? mk.campaigns.length + mk.socialPosts.length : activeTab === "audiences" ? mk.forms.length : mk.campaigns.length,
        campaigns: mk.campaigns,
        forms: mk.forms,
        socialPosts: mk.socialPosts,
        crossModuleSignals: mk.crossModuleSignals,
      });
    }
  }, [mk.businessId, activeTab, mk.dataVersion, mk.campaigns, mk.forms, mk.socialPosts, mk.crossModuleSignals, marketingAi.updateMarketingContext]);

  const handleTabChange = useCallback((key: string) => {
    const newIndex = TAB_KEYS.indexOf(key as MarketingTab);
    const oldIndex = TAB_KEYS.indexOf(activeTab);
    directionRef.current = newIndex > oldIndex ? 1 : -1;
    setActiveTab(key as MarketingTab);
    const url = new URL(window.location.href);
    if (key === "create") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab]);

  const { swipeHandlers } = useSwipeTabs({ tabs: TAB_KEYS, activeTab, onTabChange: handleTabChange });

  useModuleEvent("marketing:create_campaign_for_segment", useCallback(() => {
    handleTabChange("create");
    document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click();
  }, [handleTabChange]));

  const handleNewItem = useCallback(() => {
    if (activeTab === "create") document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click();
    else if (activeTab === "audiences") document.querySelector<HTMLButtonElement>("[data-marketing-new-form]")?.click();
  }, [activeTab]);

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
    if (!marketingAi.panelOpen) marketingAi.setOpen(true);
    marketingAi.executeTool(toolId);
  }, [marketingAi]);

  const shortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Marketing",
      shortcuts: [
        { key: "1", description: "Create & Schedule", action: () => handleTabChange("create") },
        { key: "2", description: "Audiences & Forms", action: () => handleTabChange("audiences") },
        { key: "3", description: "Performance", action: () => handleTabChange("performance") },
        { key: "n", description: "New item", action: handleNewItem },
        { key: "r", description: "Refresh", action: () => { void mk.loadData(); } },
        { key: "a", shift: true, description: "AI Hub", action: () => marketingAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => {
          if (marketingAi.hubMode === "tool-result") marketingAi.clearToolResult();
          else if (marketingAi.panelOpen) marketingAi.setOpen(false);
        } },
      ],
    },
  ], [handleTabChange, handleNewItem, mk.loadData, marketingAi]);

  useKeyboardShortcuts(shortcuts, !mk.loading);

  if (mk.loading) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Megaphone} title="Marketing" subtitle="Create, engage & measure" />
        <MarketingSkeleton activeTab="social" />
      </div>
    );
  }

  const actionLabel = activeTab === "create" ? "New Campaign" : activeTab === "audiences" ? "New Form" : undefined;

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
              { title: "Audiences & Forms", description: "Manage lead forms and audience segments for targeted outreach." },
              { title: "Performance", description: "Track campaign performance, open rates, leads, and conversion funnels." },
            ]}
          />
        }
        rightSlot={
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" aria-label="Search marketing">
              <Search className="w-4 h-4 text-muted-foreground" />
            </button>
            <AiHubTrigger ai={marketingAi} moduleName="Marketing" />
          </div>
        }
      />

      <AnimatePresence>
        {marketingAi.panelOpen && (
          <AiCommandHub ai={marketingAi} moduleName="Marketing" onAction={(key: string) => {
            if (key.startsWith("switch_tab:")) handleTabChange(key.split(":")[1]);
            else if (key.startsWith("tool:")) handleAiAction(key.split(":")[1]);
          }} toolResultRenderer={renderMarketingToolResult} />
        )}
      </AnimatePresence>

      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} layoutId="marketing-tab-pill" />

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={directionRef.current}>
          <motion.div key={activeTab} custom={directionRef.current} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}>
            {activeTab === "create" && (
              <div className="space-y-6">
                <CampaignActionQueue campaigns={mk.campaigns} onEdit={handleEditCampaign} onSend={handleSendCampaign} onAiWrite={() => handleAiAction("campaign-content-generator")} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Mail className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} /> Email Campaigns
                    </h3>
                    <CampaignsPanel businessId={mk.businessId} campaigns={mk.campaigns} setCampaigns={mk.setCampaigns} availableTags={mk.availableTags} onCampaignCreated={mk.handleCampaignCreated} onCampaignSent={mk.handleCampaignSent} onViewContact={mk.handleViewContact} onAiWrite={() => handleAiAction("campaign-content-generator")} />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <PenSquare className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} /> Social Posts
                    </h3>
                    <SocialTabContent businessId={mk.businessId} onPostsLoaded={mk.handleSocialPostsLoaded} />
                  </div>
                </div>
              </div>
            )}
            {activeTab === "audiences" && (
              <div className="space-y-4">
                <FormOptimizationQueue forms={mk.forms} onAiOptimize={() => handleAiAction("lead-form-optimizer")} onEdit={handleEditForm} onToggle={mk.handleToggleForm} />
                <LeadFormsPanel businessId={mk.businessId} forms={mk.forms} setForms={mk.setForms} onViewContact={mk.handleViewContact} onAiOptimize={() => handleAiAction("lead-form-optimizer")} />
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
