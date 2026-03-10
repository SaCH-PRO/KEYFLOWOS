"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Mail,
  ClipboardList,
  BarChart3,
  Send,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Share2,
  MessageSquare,
} from "lucide-react";
import {
  fetchCampaigns,
  fetchLeadForms,
  fetchContacts,
  fetchLeadFormSubmissions,
  fetchPosts,
  EmailCampaign,
  LeadForm,
  LeadFormSubmission,
  SocialPost,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";
import { getGmailAuthUrl } from "@/lib/client";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { TabNav } from "@/components/ui/tab-nav";
import { ConnectionBanner, ConnectionsSummary } from "@/components/ui/connection-banner";
import { useConnections } from "@/hooks/use-connections";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useRouter, useSearchParams } from "next/navigation";
import { useModuleEmit, useModuleEvent } from "@/hooks/use-module-events";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import { useMarketingAiHub } from "./hooks/use-marketing-ai-hub";
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

type MarketingTab = "campaigns" | "social" | "forms" | "insights";

const TABS: { key: MarketingTab; label: string; icon: React.ElementType }[] = [
  { key: "campaigns", label: "Campaigns", icon: Mail },
  { key: "social", label: "Social", icon: MessageSquare },
  { key: "forms", label: "Lead Forms", icon: ClipboardList },
  { key: "insights", label: "Insights", icon: BarChart3 },
];

const TAB_KEYS = TABS.map((t) => t.key);

const SOCIAL_PLATFORM_META: Record<string, { icon: React.ElementType; color: string }> = {
  facebook: { icon: Facebook, color: "#1877F2" },
  instagram: { icon: Instagram, color: "#E4405F" },
  linkedin: { icon: Linkedin, color: "#0A66C2" },
  twitter: { icon: Twitter, color: "#1DA1F2" },
};

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

export default function MarketingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emitEvent = useModuleEmit();
  const marketingAi = useMarketingAiHub();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MarketingTab>("campaigns");
  const [loading, setLoading] = useState(true);
  const { gmailConnected, gmailEmail, socialConnections, loading: connectionsLoading } = useConnections();
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const initialTabSet = useRef(false);

  useEffect(() => {
    if (initialTabSet.current) return;
    const tabParam = searchParams.get("tab");
    if (tabParam && TAB_KEYS.includes(tabParam as MarketingTab)) {
      setActiveTab(tabParam as MarketingTab);
      initialTabSet.current = true;
    }
  }, [searchParams]);

  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, LeadFormSubmission[]>>({});
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const directionRef = useRef<number>(0);

  const handleGmailConnect = useCallback(async () => {
    if (!businessId) return;
    const res = await getGmailAuthUrl(businessId);
    if (res?.data?.url) window.location.href = res.data.url;
  }, [businessId]);

  const socialSummary = useMemo(() => ["facebook", "instagram", "linkedin", "twitter"].map((platform) => {
    const conn = socialConnections.find((c) => c.platform.toLowerCase() === platform);
    const meta = SOCIAL_PLATFORM_META[platform] || { icon: Share2, color: "#6366f1" };
    return {
      name: platform.charAt(0).toUpperCase() + platform.slice(1),
      icon: meta.icon,
      color: meta.color,
      connected: conn?.status === "CONNECTED",
    };
  }), [socialConnections]);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadData = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [campaignsRes, formsRes, contactsRes, postsRes] = await Promise.all([
        fetchCampaigns(businessId),
        fetchLeadForms(businessId),
        fetchContacts(businessId, { take: 200 }),
        fetchPosts(businessId),
      ]);
      if (campaignsRes.data) setCampaigns(campaignsRes.data);
      if (postsRes.data) setSocialPosts(postsRes.data);
      if (formsRes.data) {
        setForms(formsRes.data);
        const subsMap: Record<string, LeadFormSubmission[]> = {};
        await Promise.all(
          formsRes.data.map(async (f) => {
            try {
              const subRes = await fetchLeadFormSubmissions(businessId, f.id);
              if (subRes.data) subsMap[f.id] = subRes.data;
            } catch {
              toast.error(`Failed to load submissions for form "${f.name}"`);
            }
          })
        );
        setSubmissions(subsMap);
      }
      if (contactsRes.data?.contacts) {
        const tags = new Set<string>();
        contactsRes.data.contacts.forEach(c => c.tags?.forEach(t => tags.add(t)));
        setAvailableTags(Array.from(tags));
      }
    } catch {
      toast.error("Failed to load marketing data");
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleTabChange = useCallback((key: string) => {
    const newIndex = TAB_KEYS.indexOf(key as MarketingTab);
    const oldIndex = TAB_KEYS.indexOf(activeTab);
    directionRef.current = newIndex > oldIndex ? 1 : -1;
    setActiveTab(key as MarketingTab);
    emitEvent("module:tab_changed", "marketing", { tab: key });
    const url = new URL(window.location.href);
    if (key === "campaigns") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", key);
    }
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, emitEvent]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: TAB_KEYS,
    activeTab,
    onTabChange: handleTabChange,
  });

  const handleSocialPostsLoaded = useCallback((posts: SocialPost[]) => {
    setSocialPosts(posts);
  }, []);

  useEffect(() => {
    if (businessId) {
      marketingAi.updateMarketingContext({
        businessId,
        activeView: activeTab,
        itemCount: activeTab === "campaigns" ? campaigns.length : activeTab === "social" ? socialPosts.length : forms.length,
        campaigns,
        forms,
      });
    }
  }, [businessId, activeTab, campaigns.length, forms.length, socialPosts.length, marketingAi.updateMarketingContext]);

  useModuleEvent("marketing:create_campaign_for_segment", useCallback((event: any) => {
    const { segmentTags, segmentStatus } = event.data ?? {};
    handleTabChange("campaigns");
    const el = document.querySelector<HTMLButtonElement>('[data-marketing-new-campaign]');
    el?.click();
  }, [handleTabChange]));

  const handleViewContact = useCallback((contactId: string) => {
    emitEvent("marketing:view_contact", "marketing", { contactId });
    router.push(`/app/crm/contacts/${contactId}`);
  }, [emitEvent, router]);

  const handleCampaignCreated = useCallback((campaign: EmailCampaign) => {
    emitEvent("marketing:campaign_created", "marketing", { campaignId: campaign.id, name: campaign.name });
  }, [emitEvent]);

  const handleCampaignSent = useCallback((campaign: EmailCampaign) => {
    emitEvent("marketing:campaign_sent", "marketing", { campaignId: campaign.id, name: campaign.name, recipientCount: campaign.totalRecipients });
  }, [emitEvent]);

  const handleAiWrite = useCallback(() => {
    if (!marketingAi.panelOpen) marketingAi.setOpen(true);
    marketingAi.executeTool("campaign-content-generator");
  }, [marketingAi]);

  const handleAiOptimizeForm = useCallback(() => {
    if (!marketingAi.panelOpen) marketingAi.setOpen(true);
    marketingAi.executeTool("lead-form-optimizer");
  }, [marketingAi]);

  const handleAiAnalyze = useCallback(() => {
    if (!marketingAi.panelOpen) marketingAi.setOpen(true);
    marketingAi.executeTool("campaign-performance");
  }, [marketingAi]);

  const handleAiAssistantAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("filter_status:")) {
      handleTabChange("campaigns");
    } else if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.split(":")[1];
      handleTabChange(t);
    } else if (actionKey.startsWith("tool:")) {
      const toolId = actionKey.split(":")[1];
      if (!marketingAi.panelOpen) marketingAi.setOpen(true);
      marketingAi.executeTool(toolId);
    }
  }, [handleTabChange, marketingAi]);

  const handleNewItem = useCallback(() => {
    if (activeTab === "campaigns") {
      const el = document.querySelector<HTMLButtonElement>('[data-marketing-new-campaign]');
      el?.click();
    } else if (activeTab === "social") {
      const el = document.querySelector<HTMLButtonElement>('[data-social-new-post]');
      el?.click();
    } else if (activeTab === "forms") {
      const el = document.querySelector<HTMLButtonElement>('[data-marketing-new-form]');
      el?.click();
    }
  }, [activeTab]);

  const handleEditCampaign = useCallback((campaign: EmailCampaign) => {
    const el = document.querySelector<HTMLButtonElement>(`[data-campaign-edit="${campaign.id}"]`);
    el?.click();
  }, []);

  const handleSendCampaign = useCallback((id: string) => {
    const el = document.querySelector<HTMLButtonElement>(`[data-campaign-send="${id}"]`);
    el?.click();
  }, []);

  const handleEditForm = useCallback((form: LeadForm) => {
    const el = document.querySelector<HTMLButtonElement>(`[data-form-edit="${form.id}"]`);
    el?.click();
  }, []);

  const handleToggleForm = useCallback(async (form: LeadForm) => {
    const { updateLeadForm: updateFormApi } = await import("@/lib/client");
    if (!businessId) return;
    try {
      const res = await updateFormApi(businessId, form.id, { isActive: !form.isActive });
      if (res.data) {
        setForms(prev => prev.map(f => f.id === form.id ? res.data! : f));
        toast.success(res.data.isActive ? "Form activated" : "Form deactivated");
      }
    } catch {
      toast.error("Failed to toggle form status");
    }
  }, [businessId]);

  const toggleGuide = useCallback(() => setShowGuide(prev => !prev), []);

  const marketingShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Marketing Navigation",
      shortcuts: [
        { key: "1", description: "Campaigns tab", action: () => handleTabChange("campaigns") },
        { key: "2", description: "Social tab", action: () => handleTabChange("social") },
        { key: "3", description: "Lead Forms tab", action: () => handleTabChange("forms") },
        { key: "4", description: "Insights tab", action: () => handleTabChange("insights") },
        { key: "n", description: "New campaign/form", action: handleNewItem },
        { key: "r", description: "Refresh data", action: () => { void loadData(); } },
        { key: "f", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('[data-marketing-ai-search]'); el?.focus(); } },
        { key: "g", description: "Toggle guide", action: toggleGuide },
        { key: "a", shift: true, description: "Toggle AI Hub", action: () => marketingAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => {
          if (marketingAi.hubMode === "tool-result") marketingAi.clearToolResult();
          else if (marketingAi.panelOpen) marketingAi.setOpen(false);
          else { setShowGuide(false); setShowContactPicker(false); }
        } },
      ],
    },
  ], [handleTabChange, handleNewItem, loadData, toggleGuide, marketingAi.togglePanel, marketingAi.panelOpen, marketingAi.setOpen, marketingAi.hubMode, marketingAi.clearToolResult]);

  useKeyboardShortcuts(marketingShortcuts, !loading);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Megaphone}
          title="Marketing"
          subtitle="Campaigns, lead forms & insights"
        />
        <MarketingSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-label="Marketing">
      <PageHeader
        icon={Megaphone}
        title="Marketing"
        subtitle={`${campaigns.length} campaigns · ${socialPosts.length} posts · ${forms.length} lead forms`}
        actionLabel={activeTab === "campaigns" ? "New Campaign" : activeTab === "social" ? "New Post" : activeTab === "forms" ? "New Form" : undefined}
        onAction={activeTab === "insights" ? undefined : handleNewItem}
        titleExtra={
          <MarketingGuide
            isOpen={showGuide}
            onToggle={toggleGuide}
            onTabChange={handleTabChange}
          />
        }
        rightSlot={
          <button
            onClick={() => setShowContactPicker(true)}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Broadcast"
          >
            <Send className="w-4 h-4" />
            Broadcast
          </button>
        }
      />

      <MarketingAiSearchBar businessId={businessId} />

      {!connectionsLoading && (
        <div className="space-y-3">
          <ConnectionsSummary
            connections={socialSummary}
            onManage={() => router.push("/app/settings/connections")}
          />
          <ConnectionBanner
            icon={Mail}
            color="#EA4335"
            title="Gmail"
            description="Connect Gmail to send email campaigns directly from your business email."
            connected={gmailConnected}
            connectedDetail={gmailEmail ? `Sending as ${gmailEmail}` : "Gmail connected"}
            onConnect={handleGmailConnect}
            loading={connectionsLoading}
            compact
          />
        </div>
      )}

      <AnimatePresence>
        {marketingAi.panelOpen && (
          <AiCommandHub
            ai={marketingAi}
            moduleName="Marketing"
            onAction={handleAiAssistantAction}
            toolResultRenderer={renderMarketingToolResult}
          />
        )}
      </AnimatePresence>
      <AiHubTrigger ai={marketingAi} moduleName="Marketing" />

      <TabNav
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        layoutId="marketing-tab-pill"
      />

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
                <CampaignActionQueue
                  campaigns={campaigns}
                  onEdit={handleEditCampaign}
                  onSend={handleSendCampaign}
                  onAiWrite={handleAiWrite}
                />
                <CampaignsPanel
                  businessId={businessId}
                  campaigns={campaigns}
                  setCampaigns={setCampaigns}
                  availableTags={availableTags}
                  onCampaignCreated={handleCampaignCreated}
                  onCampaignSent={handleCampaignSent}
                  onViewContact={handleViewContact}
                  onAiWrite={handleAiWrite}
                />
              </div>
            )}
            {activeTab === "social" && (
              <SocialTabContent
                businessId={businessId}
                onPostsLoaded={handleSocialPostsLoaded}
              />
            )}
            {activeTab === "forms" && (
              <div className="space-y-4">
                <FormOptimizationQueue
                  forms={forms}
                  onAiOptimize={handleAiOptimizeForm}
                  onEdit={handleEditForm}
                  onToggle={handleToggleForm}
                />
                <LeadFormsPanel
                  businessId={businessId}
                  forms={forms}
                  setForms={setForms}
                  onViewContact={handleViewContact}
                  onAiOptimize={handleAiOptimizeForm}
                />
              </div>
            )}
            {activeTab === "insights" && (
              <div className="space-y-4">
                <div className="flex items-center justify-end">
                  <button
                    onClick={handleAiAnalyze}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                    aria-label="AI Analyze"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    AI Analyze
                  </button>
                </div>
                <MarketingInsightsTab
                  campaigns={campaigns}
                  forms={forms}
                  submissions={submissions}
                  socialPosts={socialPosts}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
