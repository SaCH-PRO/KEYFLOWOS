"use client";

import React, { useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Plus,
  Trash2,
  Pencil,
  Send,
  MailOpen,
  MousePointerClick,
  Users,
  ChevronDown,
  ChevronRight,
  X,
  Sparkles,
  Loader2,
  Copy,
  Clock,
  XCircle,
  Calendar,
  ShieldOff,
} from "lucide-react";
import { EmailEditor } from "./email-editor";
import {
  EmailCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  scheduleCampaign,
  cancelScheduleCampaign,
} from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#94a3b8",
  SCHEDULED: "#f59e0b",
  SENT: "#22c55e",
  SENDING: "#3b82f6",
};

const ACCENT_COLORS: Record<string, string> = {
  DRAFT: "#f59e0b",
  SENT: "#22c55e",
  SCHEDULED: "#3b82f6",
  SENDING: "#6366f1",
};

const FILTER_PILLS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "scheduled", label: "Scheduled" },
];

interface CampaignsPanelProps {
  businessId: string | null;
  campaigns: EmailCampaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<EmailCampaign[]>>;
  availableTags: string[];
  onCampaignCreated?: (campaign: EmailCampaign) => void;
  onCampaignSent?: (campaign: EmailCampaign) => void;
  onViewContact?: (contactId: string) => void;
  onAiWrite?: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export const CampaignsPanel = React.memo(function CampaignsPanel({
  businessId,
  campaigns,
  setCampaigns,
  availableTags,
  onCampaignCreated,
  onCampaignSent,
  onViewContact,
  onAiWrite,
  searchQuery: externalSearch,
  onSearchChange: externalSearchChange,
}: CampaignsPanelProps) {
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaign | null>(null);
  const [campaignForm, setCampaignForm] = useState({ name: "", subject: "", body: "", segmentType: "all", tags: [] as string[], status: "" });
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [lastSendSuppressed, setLastSendSuppressed] = useState<Record<string, number>>({});
  const initialFormRef = useRef({ name: "", subject: "", body: "", segmentType: "all", tags: [] as string[], status: "" });
  const operationInFlight = saving || sending || scheduling || !!deletingId;
  const searchQuery = externalSearch ?? localSearch;
  const setSearchQuery = externalSearchChange ?? setLocalSearch;

  const isDirty = useCallback(() => {
    const init = initialFormRef.current;
    return (
      campaignForm.name !== init.name ||
      campaignForm.subject !== init.subject ||
      campaignForm.body !== init.body ||
      campaignForm.segmentType !== init.segmentType ||
      campaignForm.status !== init.status ||
      JSON.stringify(campaignForm.tags) !== JSON.stringify(init.tags)
    );
  }, [campaignForm]);

  const tryCloseModal = useCallback(() => {
    if (isDirty()) {
      setShowDiscardConfirm(true);
    } else {
      setShowCampaignModal(false);
    }
  }, [isDirty]);

  const filtered = useMemo(() => {
    let base = statusFilter === "all" ? campaigns : campaigns.filter(c => c.status === statusFilter.toUpperCase());
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      base = base.filter(c => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q));
    }
    const sorted = [...base];
    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "recipients":
        sorted.sort((a, b) => (b.totalRecipients ?? 0) - (a.totalRecipients ?? 0));
        break;
      case "openrate":
        sorted.sort((a, b) => {
          const rateA = a.sentCount ? (a.openCount ?? 0) / a.sentCount : 0;
          const rateB = b.sentCount ? (b.openCount ?? 0) / b.sentCount : 0;
          return rateB - rateA;
        });
        break;
      default:
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [campaigns, statusFilter, sortBy, searchQuery]);

  const openNewCampaign = useCallback(() => {
    setEditingCampaign(null);
    const init = { name: "", subject: "", body: "", segmentType: "all", tags: [] as string[], status: "" };
    setCampaignForm(init);
    initialFormRef.current = init;
    setShowCampaignModal(true);
  }, []);

  const openEditCampaign = useCallback((c: EmailCampaign) => {
    setEditingCampaign(c);
    const segType = c.segmentFilter?.tags?.length ? "tags" : c.segmentFilter?.status ? "status" : "all";
    const init = {
      name: c.name,
      subject: c.subject,
      body: c.body,
      segmentType: segType,
      tags: c.segmentFilter?.tags || [],
      status: c.segmentFilter?.status || "",
    };
    setCampaignForm(init);
    initialFormRef.current = init;
    setShowCampaignModal(true);
  }, []);

  const handleSaveCampaign = useCallback(async () => {
    if (!businessId || !campaignForm.name.trim() || !campaignForm.subject.trim()) return;
    setSaving(true);
    const segmentFilter: { tags?: string[]; status?: string } = {};
    if (campaignForm.segmentType === "tags" && campaignForm.tags.length) segmentFilter.tags = campaignForm.tags;
    if (campaignForm.segmentType === "status" && campaignForm.status) segmentFilter.status = campaignForm.status;

    const data = { name: campaignForm.name, subject: campaignForm.subject, body: campaignForm.body, segmentFilter };
    try {
      if (editingCampaign) {
        const res = await updateCampaign(businessId, editingCampaign.id, data);
        if (res.data) {
          setCampaigns(prev => prev.map(c => c.id === editingCampaign.id ? res.data! : c));
          toast.success("Campaign updated");
        }
      } else {
        const res = await createCampaign(businessId, data);
        if (res.data) {
          setCampaigns(prev => [res.data!, ...prev]);
          onCampaignCreated?.(res.data);
          toast.success("Campaign created");
        }
      }
      setShowCampaignModal(false);
    } catch {
      toast.error("Failed to save campaign");
    } finally {
      setSaving(false);
    }
  }, [businessId, campaignForm, editingCampaign, setCampaigns, onCampaignCreated]);

  const handleDeleteCampaign = useCallback(async (id: string) => {
    if (!businessId) return;
    setDeletingId(id);
    try {
      await deleteCampaign(businessId, id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast.success("Campaign deleted");
    } catch {
      toast.error("Failed to delete campaign");
    } finally {
      setDeletingId(null);
    }
  }, [businessId, setCampaigns]);

  const handleSendCampaign = useCallback(async (id: string) => {
    if (!businessId) return;
    setSending(true);
    try {
      const res = await sendCampaign(businessId, id);
      if (res.data) {
        const { sent, suppressed, warning } = res.data as any;
        setLastSendSuppressed(prev => ({ ...prev, [id]: suppressed }));
        setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: "SENT", sentAt: new Date().toISOString(), totalRecipients: sent, sentCount: sent } : c));
        const campaign = campaigns.find(c => c.id === id);
        if (campaign) onCampaignSent?.({ ...campaign, status: "SENT", totalRecipients: sent, sentCount: sent });
        const msg = suppressed > 0
          ? `Campaign sent to ${sent} recipients (${suppressed} suppressed)`
          : `Campaign sent to ${sent} recipients`;
        toast.success(msg);
        if (warning) {
          toast.info(warning);
        }
      }
    } catch {
      toast.error("Failed to send campaign");
    } finally {
      setSending(false);
    }
    setConfirmSendId(null);
  }, [businessId, campaigns, setCampaigns, onCampaignSent]);

  const handleDuplicateCampaign = useCallback(async (campaign: EmailCampaign) => {
    if (!businessId) return;
    const segmentFilter: { tags?: string[]; status?: string } = {};
    if (campaign.segmentFilter?.tags?.length) segmentFilter.tags = campaign.segmentFilter.tags;
    if (campaign.segmentFilter?.status) segmentFilter.status = campaign.segmentFilter.status;
    try {
      const res = await createCampaign(businessId, {
        name: `Copy of ${campaign.name}`,
        subject: campaign.subject,
        body: campaign.body,
        segmentFilter,
      });
      if (res.data) {
        setCampaigns(prev => [res.data!, ...prev]);
        onCampaignCreated?.(res.data);
        toast.success("Campaign duplicated");
      }
    } catch {
      toast.error("Failed to duplicate campaign");
    }
  }, [businessId, setCampaigns, onCampaignCreated]);

  const handleScheduleCampaign = useCallback(async (id: string) => {
    if (!businessId || !scheduleDate) return;
    setScheduling(true);
    try {
      const res = await scheduleCampaign(businessId, id, new Date(scheduleDate).toISOString());
      if (res.data) {
        setCampaigns(prev => prev.map(c => c.id === id ? res.data! : c));
        toast.success("Campaign scheduled");
      }
    } catch {
      toast.error("Failed to schedule campaign");
    } finally {
      setScheduling(false);
      setConfirmSendId(null);
      setScheduleMode(false);
      setScheduleDate("");
    }
  }, [businessId, scheduleDate, setCampaigns]);

  const handleCancelSchedule = useCallback(async (id: string) => {
    if (!businessId) return;
    try {
      const res = await cancelScheduleCampaign(businessId, id);
      if (res.data) {
        setCampaigns(prev => prev.map(c => c.id === id ? res.data! : c));
        toast.success("Schedule cancelled");
      }
    } catch {
      toast.error("Failed to cancel schedule");
    }
  }, [businessId, setCampaigns]);

  const toggleTag = useCallback((tag: string) => {
    setCampaignForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));
  }, []);

  return (
    <>
      <div className="space-y-4">
        <button data-marketing-new-campaign onClick={openNewCampaign} className="hidden" aria-hidden="true" tabIndex={-1} />
        {campaigns.map(c => (
          <span key={`trigger-${c.id}`} className="hidden" aria-hidden="true">
            <button data-campaign-edit={c.id} onClick={() => openEditCampaign(c)} tabIndex={-1} />
            <button data-campaign-send={c.id} onClick={() => setConfirmSendId(c.id)} tabIndex={-1} />
          </span>
        ))}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search campaigns..."
            className="flex-1 bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))] placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {FILTER_PILLS.map(pill => (
              <button
                key={pill.key}
                onClick={() => setStatusFilter(pill.key)}
                className={statusFilter === pill.key
                  ? "text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
                  : "text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }
              >
                {pill.label}
              </button>
            ))}
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-muted/30 border border-border/40 rounded-lg text-xs px-2 py-1 focus:outline-none"
          >
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="recipients">Recipients</option>
            <option value="openrate">Open Rate</option>
          </select>
        </div>
        <p className="text-[11px] text-muted-foreground">{filtered.length} campaigns</p>
        {campaigns.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No campaigns yet"
            description="Create your first email campaign to start reaching your contacts."
            actionLabel="New Campaign"
            onAction={openNewCampaign}
          />
        ) : (
          filtered.map(campaign => (
            <motion.div key={campaign.id} layout className="kf-card border border-border/40 rounded-xl overflow-hidden" style={{ borderLeft: `3px solid ${ACCENT_COLORS[campaign.status] || ACCENT_COLORS.DRAFT}` }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-sm font-semibold truncate">{campaign.name}</h3>
                      <span
                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                        style={{ background: `${STATUS_COLORS[campaign.status] || STATUS_COLORS.DRAFT}20`, color: STATUS_COLORS[campaign.status] || STATUS_COLORS.DRAFT }}
                      >
                        {campaign.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{campaign.subject}</p>
                    {campaign.body && (
                      <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{stripHtml(campaign.body).slice(0, 80)}{stripHtml(campaign.body).length > 80 ? "..." : ""}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {campaign.totalRecipients} recipients</span>
                      {campaign.status === "SENT" && (
                        <>
                          <span className="flex items-center gap-1"><Send className="w-3 h-3" /> {campaign.sentCount} sent</span>
                          <span className="flex items-center gap-1"><MailOpen className="w-3 h-3" /> {campaign.openCount} opened</span>
                          {(lastSendSuppressed[campaign.id] ?? 0) > 0 && (
                            <span className="flex items-center gap-1 text-amber-400">
                              <ShieldOff className="w-3 h-3" /> {lastSendSuppressed[campaign.id]} suppressed
                            </span>
                          )}
                        </>
                      )}
                      {campaign.status === "SCHEDULED" && campaign.scheduledAt && (
                        <span className="flex items-center gap-1 text-amber-400">
                          <Clock className="w-3 h-3" />
                          {new Date(campaign.scheduledAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {onAiWrite && campaign.status === "DRAFT" && (
                      <button onClick={onAiWrite} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors disabled:opacity-40" aria-label="AI Write" title="AI Write">
                        <Sparkles className="w-4 h-4" />
                      </button>
                    )}
                    {campaign.status === "DRAFT" && (
                      <>
                        <button onClick={() => openEditCampaign(campaign)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40" aria-label="Edit campaign">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setConfirmSendId(campaign.id)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40" aria-label="Send campaign">
                          <Send className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {campaign.status === "SCHEDULED" && (
                      <button onClick={() => handleCancelSchedule(campaign.id)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40" aria-label="Cancel schedule" title="Cancel Schedule">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {campaign.status === "SENT" && (
                      <button onClick={() => setExpandedCampaign(expandedCampaign === campaign.id ? null : campaign.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" aria-label="Toggle stats">
                        {expandedCampaign === campaign.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    )}
                    <button onClick={() => handleDuplicateCampaign(campaign)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40" aria-label="Duplicate campaign" title="Duplicate">
                      <Copy className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmDeleteId(campaign.id)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40" aria-label="Delete campaign">
                      {deletingId === campaign.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {expandedCampaign === campaign.id && campaign.status === "SENT" && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 pt-2 border-t border-border/20">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: "Recipients", value: campaign.totalRecipients, icon: Users, color: "#6366f1" },
                          { label: "Sent", value: campaign.sentCount, icon: Send, color: "#3b82f6" },
                          { label: "Opened", value: campaign.openCount, icon: MailOpen, color: "#22c55e" },
                          { label: "Clicked", value: campaign.clickCount, icon: MousePointerClick, color: "#f59e0b" },
                        ].map(stat => (
                          <div key={stat.label} className="bg-muted/30 rounded-lg p-3 text-center">
                            <stat.icon className="w-4 h-4 mx-auto mb-1" style={{ color: stat.color }} />
                            <p className="text-lg font-bold">{stat.value}</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))
        )}
      </div>

      <AnimatePresence>
        {showCampaignModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={tryCloseModal}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-lg kf-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-border/40">
                <h2 className="text-lg font-semibold">{editingCampaign ? "Edit Campaign" : "New Campaign"}</h2>
                <button onClick={tryCloseModal} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Name</label>
                  <input
                    value={campaignForm.name}
                    onChange={e => setCampaignForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Monthly Newsletter"
                    className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Subject Line</label>
                  <input
                    value={campaignForm.subject}
                    onChange={e => setCampaignForm(p => ({ ...p, subject: e.target.value }))}
                    placeholder="e.g. Exciting updates for you!"
                    className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Body</label>
                  <EmailEditor
                    value={campaignForm.body}
                    onChange={(html) => setCampaignForm(p => ({ ...p, body: html }))}
                    placeholder="Write your email content here..."
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Segment</label>
                  <div className="flex gap-2 mb-2">
                    {[
                      { key: "all", label: "All Contacts" },
                      { key: "tags", label: "By Tag" },
                      { key: "status", label: "By Status" },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setCampaignForm(p => ({ ...p, segmentType: opt.key }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          campaignForm.segmentType === opt.key
                            ? "bg-muted text-foreground border border-border/60"
                            : "text-muted-foreground hover:text-foreground bg-muted/30 border border-transparent"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {campaignForm.segmentType === "tags" && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {availableTags.length > 0 ? availableTags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={`px-2.5 py-1 rounded-full text-xs transition-all ${
                            campaignForm.tags.includes(tag)
                              ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/40"
                              : "bg-muted/30 text-muted-foreground border border-border/40 hover:bg-muted/50"
                          }`}
                        >
                          {tag}
                        </button>
                      )) : (
                        <p className="text-xs text-muted-foreground">No tags found on contacts</p>
                      )}
                    </div>
                  )}
                  {campaignForm.segmentType === "status" && (
                    <select
                      value={campaignForm.status}
                      onChange={e => setCampaignForm(p => ({ ...p, status: e.target.value }))}
                      className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none mt-2"
                    >
                      <option value="">Select status...</option>
                      <option value="LEAD">Lead</option>
                      <option value="PROSPECT">Prospect</option>
                      <option value="CLIENT">Client</option>
                      <option value="LOST">Lost</option>
                    </select>
                  )}
                </div>
              </div>
              <div className="flex gap-2 p-4 border-t border-border/40">
                <button onClick={handleSaveCampaign} disabled={!campaignForm.name.trim() || !campaignForm.subject.trim() || saving} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 flex-1 flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingCampaign ? "Save Changes" : "Create Campaign"}
                </button>
                <button onClick={tryCloseModal} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative kf-card border border-border rounded-2xl p-6 max-w-sm w-full">
              <div className="text-center">
                <Trash2 className="w-10 h-10 mx-auto mb-3 text-red-400" />
                <h3 className="text-lg font-semibold mb-2">Delete Campaign?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { handleDeleteCampaign(confirmDeleteId); setConfirmDeleteId(null); }} disabled={!!deletingId} className="px-4 py-2 rounded-xl text-sm font-medium flex-1 bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                    {deletingId && <Loader2 className="w-4 h-4 animate-spin" />}
                    Delete
                  </button>
                  <button onClick={() => setConfirmDeleteId(null)} disabled={!!deletingId} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 flex-1">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmSendId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !sending && !scheduling && (() => { setConfirmSendId(null); setScheduleMode(false); setScheduleDate(""); })()} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative kf-card border border-border rounded-2xl p-6 max-w-sm w-full">
              <div className="text-center">
                {scheduleMode ? (
                  <Calendar className="w-10 h-10 mx-auto mb-3 text-amber-400" />
                ) : (
                  <Send className="w-10 h-10 mx-auto mb-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                )}
                <h3 className="text-lg font-semibold mb-2">{scheduleMode ? "Schedule Campaign" : "Send Campaign?"}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {scheduleMode
                    ? "Choose a date and time to send this campaign."
                    : "This will send the email to all matching recipients. This action cannot be undone."}
                </p>
                {scheduleMode && (
                  <div className="mb-4">
                    <input
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={e => setScheduleDate(e.target.value)}
                      min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                      className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {scheduleMode ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleScheduleCampaign(confirmSendId)} disabled={scheduling || !scheduleDate} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium flex-1 disabled:opacity-40 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600">
                        {scheduling && <Loader2 className="w-4 h-4 animate-spin" />}
                        <Clock className="w-4 h-4" />
                        Schedule
                      </button>
                      <button onClick={() => { setScheduleMode(false); setScheduleDate(""); }} disabled={scheduling} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 flex-1">
                        Back
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <button onClick={() => handleSendCampaign(confirmSendId)} disabled={sending} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium flex-1 disabled:opacity-40 flex items-center justify-center gap-2">
                          {sending && <Loader2 className="w-4 h-4 animate-spin" />}
                          Send Now
                        </button>
                        <button onClick={() => setScheduleMode(true)} disabled={sending} className="px-4 py-2 rounded-xl text-sm font-medium flex-1 border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center justify-center gap-2">
                          <Clock className="w-4 h-4" />
                          Schedule
                        </button>
                      </div>
                      <button onClick={() => { setConfirmSendId(null); setScheduleMode(false); setScheduleDate(""); }} disabled={sending} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50">
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDiscardConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative kf-card border border-border rounded-2xl p-6 max-w-sm w-full">
              <div className="text-center">
                <X className="w-10 h-10 mx-auto mb-3 text-amber-400" />
                <h3 className="text-lg font-semibold mb-2">Discard unsaved changes?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  You have unsaved changes that will be lost.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { setShowDiscardConfirm(false); setShowCampaignModal(false); }} className="px-4 py-2 rounded-xl text-sm font-medium flex-1 bg-red-500 text-white hover:bg-red-600 transition-colors">
                    Discard
                  </button>
                  <button onClick={() => setShowDiscardConfirm(false)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 flex-1">
                    Keep Editing
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
