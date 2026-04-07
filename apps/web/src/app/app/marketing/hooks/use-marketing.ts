"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchCampaigns,
  fetchLeadForms,
  fetchContacts,
  fetchLeadFormSubmissions,
  fetchPosts,
  fetchMarketingStats as fetchMarketingStatsApi,
  getGmailAuthUrl,
  type EmailCampaign,
  type LeadForm,
  type LeadFormSubmission,
  type SocialPost,
  type MarketingStats as ServerMarketingStats,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";
import { useModuleEmit, useModuleEvent } from "@/hooks/use-module-events";
import { useRouter } from "next/navigation";

export interface MarketingStats {
  totalCampaigns: number;
  sentCampaigns: number;
  draftCampaigns: number;
  scheduledCampaigns: number;
  avgOpenRate: number;
  avgClickRate: number;
  totalLeads: number;
  activeForms: number;
  totalPosts: number;
}

export interface CrossModuleSignal {
  id: string;
  type: "new_contacts" | "invoice_paid" | "booking_created" | "contacts_imported";
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface UseMarketingReturn {
  businessId: string | null;
  loading: boolean;
  campaigns: EmailCampaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<EmailCampaign[]>>;
  forms: LeadForm[];
  setForms: React.Dispatch<React.SetStateAction<LeadForm[]>>;
  submissions: Record<string, LeadFormSubmission[]>;
  socialPosts: SocialPost[];
  setSocialPosts: React.Dispatch<React.SetStateAction<SocialPost[]>>;
  availableTags: string[];
  stats: MarketingStats;
  crossModuleSignals: CrossModuleSignal[];
  dataVersion: number;
  loadData: () => Promise<void>;
  loadCampaigns: () => Promise<void>;
  loadForms: () => Promise<void>;
  handleGmailConnect: () => Promise<void>;
  handleViewContact: (contactId: string) => void;
  handleCampaignCreated: (campaign: EmailCampaign) => void;
  handleCampaignSent: (campaign: EmailCampaign) => void;
  handleCampaignDeleted: (campaignId: string) => void;
  handleCampaignScheduled: (campaign: EmailCampaign) => void;
  handleFormCreated: (form: LeadForm) => void;
  handleFormDeleted: (formId: string) => void;
  handleToggleForm: (form: LeadForm) => Promise<void>;
  handleSocialPostCreated: (post: SocialPost) => void;
  handleSocialPostPublished: (post: SocialPost) => void;
  handleSocialPostsLoaded: (posts: SocialPost[]) => void;
}

function computeStats(
  campaigns: EmailCampaign[],
  forms: LeadForm[],
  submissions: Record<string, LeadFormSubmission[]>,
  socialPosts: SocialPost[],
): MarketingStats {
  const sent = campaigns.filter((c) => c.status === "SENT");
  const totalRecipients = sent.reduce((sum, c) => sum + (c.totalRecipients ?? 0), 0);
  const totalOpens = sent.reduce((sum, c) => sum + (c.openCount ?? 0), 0);
  const totalClicks = sent.reduce((sum, c) => sum + (c.clickCount ?? 0), 0);
  const totalLeads = Object.values(submissions).reduce((sum, s) => sum + s.length, 0);

  return {
    totalCampaigns: campaigns.length,
    sentCampaigns: sent.length,
    draftCampaigns: campaigns.filter((c) => c.status === "DRAFT").length,
    scheduledCampaigns: campaigns.filter((c) => c.status === "SCHEDULED").length,
    avgOpenRate: totalRecipients > 0 ? (totalOpens / totalRecipients) * 100 : 0,
    avgClickRate: totalRecipients > 0 ? (totalClicks / totalRecipients) * 100 : 0,
    totalLeads,
    activeForms: forms.filter((f) => f.isActive).length,
    totalPosts: socialPosts.length,
  };
}

export function useMarketing(): UseMarketingReturn {
  const router = useRouter();
  const emitEvent = useModuleEmit();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, LeadFormSubmission[]>>({});
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [crossModuleSignals, setCrossModuleSignals] = useState<CrossModuleSignal[]>([]);
  const [serverStats, setServerStats] = useState<ServerMarketingStats | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const signalTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bumpVersion = useCallback(() => setDataVersion((v) => v + 1), []);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const addSignal = useCallback((signal: Omit<CrossModuleSignal, "id" | "timestamp">) => {
    const newSignal: CrossModuleSignal = {
      ...signal,
      id: `${signal.type}-${Date.now()}`,
      timestamp: Date.now(),
    };
    setCrossModuleSignals((prev) => [newSignal, ...prev].slice(0, 10));
  }, []);

  const loadCampaigns = useCallback(async () => {
    if (!businessId) return;
    const res = await fetchCampaigns(businessId);
    if (res.data) setCampaigns(res.data);
  }, [businessId]);

  const loadForms = useCallback(async () => {
    if (!businessId) return;
    const res = await fetchLeadForms(businessId);
    if (res.data) {
      setForms(res.data);
      const subsMap: Record<string, LeadFormSubmission[]> = {};
      await Promise.all(
        res.data.map(async (f) => {
          try {
            const subRes = await fetchLeadFormSubmissions(businessId, f.id);
            if (subRes.data) subsMap[f.id] = subRes.data;
          } catch {}
        }),
      );
      setSubmissions(subsMap);
    }
  }, [businessId]);

  const loadData = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [campaignsRes, formsRes, contactsRes, postsRes, statsRes] = await Promise.all([
        fetchCampaigns(businessId),
        fetchLeadForms(businessId),
        fetchContacts(businessId, { take: 200 }),
        fetchPosts(businessId),
        fetchMarketingStatsApi(businessId).catch(() => ({ data: null, error: "Failed" })),
      ]);
      if (statsRes.data) setServerStats(statsRes.data);
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
            } catch {}
          }),
        );
        setSubmissions(subsMap);
      }
      if (contactsRes.data?.contacts) {
        const tags = new Set<string>();
        contactsRes.data.contacts.forEach((c) => c.tags?.forEach((t) => tags.add(t)));
        setAvailableTags(Array.from(tags));
      }
    } catch {
      toast.error("Failed to load marketing data");
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGmailConnect = useCallback(async () => {
    if (!businessId) return;
    const res = await getGmailAuthUrl(businessId);
    if (res?.data?.url) window.location.href = res.data.url;
  }, [businessId]);

  const handleViewContact = useCallback(
    (contactId: string) => {
      emitEvent("marketing:view_contact", "marketing", { contactId });
      router.push(`/app/crm/contacts/${contactId}`);
    },
    [emitEvent, router],
  );

  const handleCampaignCreated = useCallback(
    (campaign: EmailCampaign) => {
      emitEvent("marketing:campaign_created", "marketing", {
        campaignId: campaign.id,
        name: campaign.name,
      });
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleCampaignSent = useCallback(
    (campaign: EmailCampaign) => {
      emitEvent("marketing:campaign_sent", "marketing", {
        campaignId: campaign.id,
        name: campaign.name,
        recipientCount: campaign.totalRecipients,
      });
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleCampaignDeleted = useCallback(
    (campaignId: string) => {
      emitEvent("marketing:campaign_deleted", "marketing", { campaignId });
      setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleCampaignScheduled = useCallback(
    (campaign: EmailCampaign) => {
      emitEvent("marketing:campaign_scheduled", "marketing", {
        campaignId: campaign.id,
        name: campaign.name,
      });
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleFormCreated = useCallback(
    (form: LeadForm) => {
      emitEvent("marketing:form_created", "marketing", {
        formId: form.id,
        name: form.name,
      });
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleFormDeleted = useCallback(
    (formId: string) => {
      emitEvent("marketing:form_deleted", "marketing", { formId });
      setForms((prev) => prev.filter((f) => f.id !== formId));
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleToggleForm = useCallback(
    async (form: LeadForm) => {
      const { updateLeadForm: updateFormApi } = await import("@/lib/client");
      if (!businessId) return;
      try {
        const res = await updateFormApi(businessId, form.id, { isActive: !form.isActive });
        if (res.data) {
          setForms((prev) => prev.map((f) => (f.id === form.id ? res.data! : f)));
          toast.success(res.data.isActive ? "Form activated" : "Form deactivated");
          bumpVersion();
        }
      } catch {
        toast.error("Failed to toggle form status");
      }
    },
    [businessId, bumpVersion],
  );

  const handleSocialPostCreated = useCallback(
    (post: SocialPost) => {
      emitEvent("marketing:social_post_created", "marketing", {
        postId: post.id,
      });
      setSocialPosts((prev) => [post, ...prev]);
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleSocialPostPublished = useCallback(
    (post: SocialPost) => {
      emitEvent("marketing:social_post_published", "marketing", {
        postId: post.id,
      });
      bumpVersion();
    },
    [emitEvent, bumpVersion],
  );

  const handleSocialPostsLoaded = useCallback((posts: SocialPost[]) => {
    setSocialPosts(posts);
  }, []);

  useModuleEvent(
    "contact:created",
    useCallback(() => {
      addSignal({
        type: "new_contacts",
        message: "New contact added — consider a welcome campaign",
      });
    }, [addSignal]),
  );

  useModuleEvent(
    "contact:imported",
    useCallback(
      (event: any) => {
        const count = event?.data?.count ?? "multiple";
        addSignal({
          type: "contacts_imported",
          message: `${count} contacts imported — create a targeted campaign`,
          data: { count },
        });
      },
      [addSignal],
    ),
  );

  useModuleEvent(
    "commerce:invoice_paid",
    useCallback(() => {
      addSignal({
        type: "invoice_paid",
        message: "Invoice paid — send a thank-you or follow-up campaign",
      });
    }, [addSignal]),
  );

  useModuleEvent(
    "booking:created",
    useCallback(() => {
      addSignal({
        type: "booking_created",
        message: "New booking — consider a confirmation or reminder campaign",
      });
    }, [addSignal]),
  );

  useEffect(() => {
    return () => {
      if (signalTimeoutRef.current) clearTimeout(signalTimeoutRef.current);
    };
  }, []);

  const stats = (() => {
    const local = computeStats(campaigns, forms, submissions, socialPosts);
    if (serverStats) {
      return {
        ...local,
        totalCampaigns: serverStats.totalCampaigns ?? local.totalCampaigns,
        sentCampaigns: serverStats.sentCount ?? local.sentCampaigns,
        avgOpenRate: serverStats.avgOpenRate ?? local.avgOpenRate,
        avgClickRate: serverStats.avgClickRate ?? local.avgClickRate,
        totalLeads: serverStats.totalLeads ?? local.totalLeads,
        activeForms: serverStats.activeFormsCount ?? local.activeForms,
      };
    }
    return local;
  })();

  return {
    businessId,
    loading,
    campaigns,
    setCampaigns,
    forms,
    setForms,
    submissions,
    socialPosts,
    setSocialPosts,
    availableTags,
    stats,
    crossModuleSignals,
    dataVersion,
    loadData,
    loadCampaigns,
    loadForms,
    handleGmailConnect,
    handleViewContact,
    handleCampaignCreated,
    handleCampaignSent,
    handleCampaignDeleted,
    handleCampaignScheduled,
    handleFormCreated,
    handleFormDeleted,
    handleToggleForm,
    handleSocialPostCreated,
    handleSocialPostPublished,
    handleSocialPostsLoaded,
  };
}
