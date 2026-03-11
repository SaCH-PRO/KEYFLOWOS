"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Mail,
  ClipboardList,
  BarChart3,
  MessageSquare,
  Sparkles,
  FileText,
  Send,
  MailOpen,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useConnections } from "@/hooks/use-connections";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useSearchParams } from "next/navigation";
import { useModuleEvent } from "@/hooks/use-module-events";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import { useMarketingAiHub } from "./hooks/use-marketing-ai-hub";
import { useMarketing } from "./hooks/use-marketing";
import { renderMarketingToolResult } from "./components/marketing-tool-results";
import { MarketingAiSearchBar } from "./components/marketing-ai-search-bar";
import { MarketingSkeleton } from "./components/marketing-skeleton";
import { MarketingGuide } from "./components/marketing-guide";
import { CampaignsPanel } from "./components/campaigns-panel";
import { LeadFormsPanel } from "./components/lead-forms-panel";
import { CampaignActionQueue } from "./components/campaign-action-queue";
import { FormOptimizationQueue } from "./components/form-optimization-queue";
import MarketingInsightsTab from "./insights/marketing-insights-tab";
import { SocialTabContent } from "./components/social-tab-content";
import { ConnectionsDropdown } from "./components/connections-dropdown";
import { StrategyPanel } from "./components/strategy-panel";
import { MarketingBriefPanel } from "./components/marketing-brief-panel";
import { MarketingLaunchpad } from "./components/marketing-launchpad";
import type { EmailCampaign, LeadForm } from "@/lib/client";

type MarketingTab = "social" | "campaigns" | "forms" | "insights";

const TABS: { key: MarketingTab; label: string; icon: React.ElementType }[] = [
  { key: "social", label: "Social", icon: MessageSquare },
  { key: "campaigns", label: "Campaigns", icon: Mail },
  { key: "forms", label: "Lead Forms", icon: ClipboardList },
  { key: "insights", label: "Insights", icon: BarChart3 },
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
  const { gmailConnected, gmailEmail, socialConnections, loading: connectionsLoading } = useConnections();

  const [activeTab, setActiveTab] = useState<MarketingTab>("social");
  const [showGuide, setShowGuide] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
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
        itemCount: activeTab === "campaigns" ? mk.campaigns.length : activeTab === "social" ? mk.socialPosts.length : mk.forms.length,
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
    if (key === "social") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: TAB_KEYS,
    activeTab,
    onTabChange: handleTabChange,
  });

  useModuleEvent("marketing:create_campaign_for_segment", useCallback(() => {
    handleTabChange("campaigns");
    const el = document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]");
    el?.click();
  }, [handleTabChange]));

  const handleNewItem = useCallback(() => {
    if (activeTab === "campaigns") document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click();
    else if (activeTab === "social") document.querySelector<HTMLButtonElement>("[data-social-new-post]")?.click();
    else if (activeTab === "forms") document.querySelector<HTMLButtonElement>("[data-marketing-new-form]")?.click();
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

  const handleAiAssistantAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("filter_status:")) handleTabChange("campaigns");
    else if (actionKey.startsWith("switch_tab:")) handleTabChange(actionKey.split(":")[1]);
    else if (actionKey.startsWith("tool:")) handleAiAction(actionKey.split(":")[1]);
  }, [handleTabChange, handleAiAction]);

  const toggleGuide = useCallback(() => setShowGuide((prev) => !prev), []);

  const marketingShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Marketing Navigation",
      shortcuts: [
        { key: "1", description: "Social tab", action: () => handleTabChange("social") },
        { key: "2", description: "Campaigns tab", action: () => handleTabChange("campaigns") },
        { key: "3", description: "Lead Forms tab", action: () => handleTabChange("forms") },
        { key: "4", description: "Insights tab", action: () => handleTabChange("insights") },
        { key: "n", description: "New item", action: handleNewItem },
        { key: "r", description: "Refresh data", action: () => { void mk.loadData(); } },
        { key: "f", description: "Focus search", action: () => document.querySelector<HTMLInputElement>("[data-marketing-ai-search]")?.focus() },
        { key: "g", description: "Toggle guide", action: toggleGuide },
        { key: "b", description: "Marketing brief", action: () => setShowBrief(true) },
        { key: "s", shift: true, description: "AI Strategy", action: () => setShowStrategy(true) },
        { key: "a", shift: true, description: "Toggle AI Hub", action: () => marketingAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => {
          if (marketingAi.hubMode === "tool-result") marketingAi.clearToolResult();
          else if (marketingAi.panelOpen) marketingAi.setOpen(false);
          else if (showStrategy) setShowStrategy(false);
          else if (showBrief) setShowBrief(false);
          else setShowGuide(false);
        } },
      ],
    },
  ], [handleTabChange, handleNewItem, mk.loadData, toggleGuide, marketingAi.togglePanel, marketingAi.panelOpen, marketingAi.setOpen, marketingAi.hubMode, marketingAi.clearToolResult, showStrategy, showBrief]);

  useKeyboardShortcuts(marketingShortcuts, !mk.loading);

  if (mk.loading) {
    const resolvedTab = (searchParams.get("tab") as MarketingTab) || "social";
    return (
      <div className="space-y-6">
        <PageHeader icon={Megaphone} title="Marketing" subtitle="Campaigns, lead forms & insights" />
        <MarketingSkeleton activeTab={TAB_KEYS.includes(resolvedTab) ? resolvedTab : "social"} />
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-label="Marketing">
      <PageHeader
        icon={Megaphone}
        title="Marketing"
        subtitle={`${mk.stats.totalCampaigns} campaigns · ${mk.stats.totalPosts} posts · ${mk.forms.length} lead forms`}
        actionLabel={activeTab === "social" ? "New Post" : activeTab === "campaigns" ? "New Campaign" : activeTab === "forms" ? "New Form" : undefined}
        onAction={activeTab === "insights" ? undefined : handleNewItem}
        titleExtra={
          <MarketingGuide isOpen={showGuide} onToggle={toggleGuide} onTabChange={handleTabChange} />
        }
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBrief(true)}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 text-[hsl(var(--kf-accent2))] transition-colors"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Brief</span>
            </button>
            <button
              onClick={() => setShowStrategy(true)}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">AI Strategy</span>
            </button>
            <ConnectionsDropdown
              gmailConnected={gmailConnected}
              gmailEmail={gmailEmail}
              socialConnections={socialConnections}
              onGmailConnect={mk.handleGmailConnect}
              loading={connectionsLoading}
            />
          </div>
        }
      />

      <MarketingAiSearchBar businessId={mk.businessId} />

      <MarketingLaunchpad
        campaigns={mk.campaigns}
        forms={mk.forms}
        socialPosts={mk.socialPosts}
        gmailConnected={gmailConnected}
        onTabChange={handleTabChange}
        onGmailConnect={mk.handleGmailConnect}
        onShowStrategy={() => setShowStrategy(true)}
        onOpenAiHub={() => marketingAi.togglePanel()}
        onNewCampaign={() => document.querySelector<HTMLButtonElement>("[data-marketing-new-campaign]")?.click()}
        onNewForm={() => document.querySelector<HTMLButtonElement>("[data-marketing-new-form]")?.click()}
        onNewPost={() => document.querySelector<HTMLButtonElement>("[data-social-new-post]")?.click()}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Total Campaigns",
            value: mk.stats.totalCampaigns,
            icon: Send,
            gradient: "from-[hsl(var(--kf-accent1)/0.15)] to-[hsl(var(--kf-accent1)/0.05)]",
            iconBg: "from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]",
          },
          {
            label: "Avg Open Rate",
            value: `${mk.stats.avgOpenRate.toFixed(1)}%`,
            icon: MailOpen,
            gradient: "from-emerald-500/15 to-emerald-600/5",
            iconBg: "from-emerald-500 to-green-600",
          },
          {
            label: "Leads Captured",
            value: mk.stats.totalLeads,
            icon: Users,
            gradient: "from-amber-500/15 to-amber-600/5",
            iconBg: "from-amber-500 to-orange-600",
          },
          {
            label: "Active Forms",
            value: mk.stats.activeForms,
            icon: ClipboardList,
            gradient: "from-[hsl(var(--kf-accent2)/0.15)] to-[hsl(var(--kf-accent2)/0.05)]",
            iconBg: "from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]",
          },
        ].map((card) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className={`rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br ${card.gradient} p-4 flex items-start gap-3`}
          >
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center shrink-0`}>
              <card.icon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{card.label}</p>
              <p className="text-xl font-bold truncate">{card.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {marketingAi.panelOpen && (
          <AiCommandHub ai={marketingAi} moduleName="Marketing" onAction={handleAiAssistantAction} toolResultRenderer={renderMarketingToolResult} />
        )}
      </AnimatePresence>
      <AiHubTrigger ai={marketingAi} moduleName="Marketing" />

      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} layoutId="marketing-tab-pill" />

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={directionRef.current}>
          <motion.div
            key={activeTab}
            custom={directionRef.current}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
          >
            {activeTab === "campaigns" && (
              <div className="space-y-4">
                <CampaignActionQueue campaigns={mk.campaigns} onEdit={handleEditCampaign} onSend={handleSendCampaign} onAiWrite={() => handleAiAction("campaign-content-generator")} />
                <CampaignsPanel
                  businessId={mk.businessId}
                  campaigns={mk.campaigns}
                  setCampaigns={mk.setCampaigns}
                  availableTags={mk.availableTags}
                  onCampaignCreated={mk.handleCampaignCreated}
                  onCampaignSent={mk.handleCampaignSent}
                  onViewContact={mk.handleViewContact}
                  onAiWrite={() => handleAiAction("campaign-content-generator")}
                />
              </div>
            )}
            {activeTab === "social" && (
              <SocialTabContent businessId={mk.businessId} onPostsLoaded={mk.handleSocialPostsLoaded} />
            )}
            {activeTab === "forms" && (
              <div className="space-y-4">
                <FormOptimizationQueue forms={mk.forms} onAiOptimize={() => handleAiAction("lead-form-optimizer")} onEdit={handleEditForm} onToggle={mk.handleToggleForm} />
                <LeadFormsPanel
                  businessId={mk.businessId}
                  forms={mk.forms}
                  setForms={mk.setForms}
                  onViewContact={mk.handleViewContact}
                  onAiOptimize={() => handleAiAction("lead-form-optimizer")}
                />
              </div>
            )}
            {activeTab === "insights" && (
              <div className="space-y-4">
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => handleAiAction("campaign-performance")}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                    aria-label="AI Analyze"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    AI Analyze
                  </button>
                </div>
                <MarketingInsightsTab campaigns={mk.campaigns} forms={mk.forms} submissions={mk.submissions} socialPosts={mk.socialPosts} stats={mk.stats} />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <StrategyPanel businessId={mk.businessId} isOpen={showStrategy} onClose={() => setShowStrategy(false)} />
      <MarketingBriefPanel businessId={mk.businessId} isOpen={showBrief} onClose={() => setShowBrief(false)} />
    </div>
  );
}
