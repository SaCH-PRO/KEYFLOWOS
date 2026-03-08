"use client";

import React, { useState, useCallback } from "react";
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
} from "lucide-react";
import {
  EmailCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
} from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#94a3b8",
  SCHEDULED: "#f59e0b",
  SENT: "#22c55e",
  SENDING: "#3b82f6",
};

interface CampaignsPanelProps {
  businessId: string | null;
  campaigns: EmailCampaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<EmailCampaign[]>>;
  availableTags: string[];
  onCampaignCreated?: (campaign: EmailCampaign) => void;
  onCampaignSent?: (campaign: EmailCampaign) => void;
  onViewContact?: (contactId: string) => void;
  onAiWrite?: () => void;
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
}: CampaignsPanelProps) {
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaign | null>(null);
  const [campaignForm, setCampaignForm] = useState({ name: "", subject: "", body: "", segmentType: "all", tags: [] as string[], status: "" });
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);

  const openNewCampaign = useCallback(() => {
    setEditingCampaign(null);
    setCampaignForm({ name: "", subject: "", body: "", segmentType: "all", tags: [], status: "" });
    setShowCampaignModal(true);
  }, []);

  const openEditCampaign = useCallback((c: EmailCampaign) => {
    setEditingCampaign(c);
    const segType = c.segmentFilter?.tags?.length ? "tags" : c.segmentFilter?.status ? "status" : "all";
    setCampaignForm({
      name: c.name,
      subject: c.subject,
      body: c.body,
      segmentType: segType,
      tags: c.segmentFilter?.tags || [],
      status: c.segmentFilter?.status || "",
    });
    setShowCampaignModal(true);
  }, []);

  const handleSaveCampaign = useCallback(async () => {
    if (!businessId || !campaignForm.name.trim() || !campaignForm.subject.trim()) return;
    const segmentFilter: { tags?: string[]; status?: string } = {};
    if (campaignForm.segmentType === "tags" && campaignForm.tags.length) segmentFilter.tags = campaignForm.tags;
    if (campaignForm.segmentType === "status" && campaignForm.status) segmentFilter.status = campaignForm.status;

    const data = { name: campaignForm.name, subject: campaignForm.subject, body: campaignForm.body, segmentFilter };
    if (editingCampaign) {
      const res = await updateCampaign(businessId, editingCampaign.id, data);
      if (res.data) setCampaigns(prev => prev.map(c => c.id === editingCampaign.id ? res.data! : c));
    } else {
      const res = await createCampaign(businessId, data);
      if (res.data) {
        setCampaigns(prev => [res.data!, ...prev]);
        onCampaignCreated?.(res.data);
      }
    }
    setShowCampaignModal(false);
  }, [businessId, campaignForm, editingCampaign, setCampaigns, onCampaignCreated]);

  const handleDeleteCampaign = useCallback(async (id: string) => {
    if (!businessId) return;
    await deleteCampaign(businessId, id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
  }, [businessId, setCampaigns]);

  const handleSendCampaign = useCallback(async (id: string) => {
    if (!businessId) return;
    const res = await sendCampaign(businessId, id);
    if (res.data) {
      setCampaigns(prev => prev.map(c => c.id === id ? res.data! : c));
      onCampaignSent?.(res.data);
    }
    setConfirmSendId(null);
  }, [businessId, setCampaigns, onCampaignSent]);

  const toggleTag = useCallback((tag: string) => {
    setCampaignForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));
  }, []);

  return (
    <>
      <div className="space-y-4">
        {campaigns.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No campaigns yet"
            description="Create your first email campaign to start reaching your contacts."
            actionLabel="New Campaign"
            onAction={openNewCampaign}
          />
        ) : (
          campaigns.map(campaign => (
            <motion.div key={campaign.id} layout className="kf-card border border-border/40 rounded-xl overflow-hidden">
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
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {campaign.totalRecipients} recipients</span>
                      {campaign.status === "SENT" && (
                        <>
                          <span className="flex items-center gap-1"><Send className="w-3 h-3" /> {campaign.sentCount} sent</span>
                          <span className="flex items-center gap-1"><MailOpen className="w-3 h-3" /> {campaign.openCount} opened</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {onAiWrite && campaign.status === "DRAFT" && (
                      <button onClick={onAiWrite} className="p-1.5 rounded-lg text-muted-foreground hover:text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors" aria-label="AI Write" title="AI Write">
                        <Sparkles className="w-4 h-4" />
                      </button>
                    )}
                    {campaign.status === "DRAFT" && (
                      <>
                        <button onClick={() => openEditCampaign(campaign)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" aria-label="Edit campaign">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setConfirmSendId(campaign.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" aria-label="Send campaign">
                          <Send className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {campaign.status === "SENT" && (
                      <button onClick={() => setExpandedCampaign(expandedCampaign === campaign.id ? null : campaign.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" aria-label="Toggle stats">
                        {expandedCampaign === campaign.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    )}
                    <button onClick={() => handleDeleteCampaign(campaign.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors" aria-label="Delete campaign">
                      <Trash2 className="w-4 h-4" />
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowCampaignModal(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-lg kf-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-border/40">
                <h2 className="text-lg font-semibold">{editingCampaign ? "Edit Campaign" : "New Campaign"}</h2>
                <button onClick={() => setShowCampaignModal(false)} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-5 h-5" /></button>
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
                  <textarea
                    value={campaignForm.body}
                    onChange={e => setCampaignForm(p => ({ ...p, body: e.target.value }))}
                    rows={6}
                    placeholder="Write your email content here..."
                    className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
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
                <button onClick={handleSaveCampaign} disabled={!campaignForm.name.trim() || !campaignForm.subject.trim()} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 flex-1">
                  {editingCampaign ? "Save Changes" : "Create Campaign"}
                </button>
                <button onClick={() => setShowCampaignModal(false)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmSendId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmSendId(null)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative kf-card border border-border rounded-2xl p-6 max-w-sm w-full">
              <div className="text-center">
                <Send className="w-10 h-10 mx-auto mb-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h3 className="text-lg font-semibold mb-2">Send Campaign?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This will send the email to all matching recipients. This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => handleSendCampaign(confirmSendId)} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium flex-1">
                    Yes, Send Now
                  </button>
                  <button onClick={() => setConfirmSendId(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 flex-1">
                    Cancel
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
