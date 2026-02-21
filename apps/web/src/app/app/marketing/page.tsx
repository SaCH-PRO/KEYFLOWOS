"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Plus,
  Trash2,
  Pencil,
  Send,
  Mail,
  MailOpen,
  MousePointerClick,
  Users,
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  X,
  FileText,
  ToggleLeft,
  ToggleRight,
  ClipboardList,
  Code,
} from "lucide-react";
import {
  fetchCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  fetchLeadForms,
  createLeadForm,
  updateLeadForm,
  deleteLeadForm,
  fetchLeadFormSubmissions,
  fetchContacts,
  EmailCampaign,
  LeadForm,
  LeadFormSubmission,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { TabNav } from "@/components/ui/tab-nav";
import { EmptyState } from "@/components/ui/empty-state";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#94a3b8",
  SCHEDULED: "#f59e0b",
  SENT: "#22c55e",
  SENDING: "#3b82f6",
};

const FIELD_TYPES = ["text", "email", "phone", "select", "textarea"];

type FormField = { name: string; type: string; label: string; required: boolean };

export default function MarketingPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"campaigns" | "forms">("campaigns");
  const [loading, setLoading] = useState(true);

  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaign | null>(null);
  const [campaignForm, setCampaignForm] = useState({ name: "", subject: "", body: "", segmentType: "all", tags: [] as string[], status: "" });
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);

  const [forms, setForms] = useState<LeadForm[]>([]);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingForm, setEditingForm] = useState<LeadForm | null>(null);
  const [formBuilder, setFormBuilder] = useState({ name: "", description: "", fields: [{ name: "email", type: "email", label: "Email", required: true }] as FormField[], thankYouMessage: "Thank you for your submission!", redirectUrl: "" });
  const [expandedForm, setExpandedForm] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, LeadFormSubmission[]>>({});
  const [copiedEmbed, setCopiedEmbed] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadData = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [campaignsRes, formsRes, contactsRes] = await Promise.all([
        fetchCampaigns(businessId),
        fetchLeadForms(businessId),
        fetchContacts(businessId, { take: 200 }),
      ]);
      if (campaignsRes.data) setCampaigns(campaignsRes.data);
      if (formsRes.data) setForms(formsRes.data);
      if (contactsRes.data) {
        const tags = new Set<string>();
        contactsRes.data.forEach(c => c.tags?.forEach(t => tags.add(t)));
        setAvailableTags(Array.from(tags));
      }
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const openNewCampaign = () => {
    setEditingCampaign(null);
    setCampaignForm({ name: "", subject: "", body: "", segmentType: "all", tags: [], status: "" });
    setShowCampaignModal(true);
  };

  const openEditCampaign = (c: EmailCampaign) => {
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
  };

  const handleSaveCampaign = async () => {
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
      if (res.data) setCampaigns(prev => [res.data!, ...prev]);
    }
    setShowCampaignModal(false);
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!businessId) return;
    await deleteCampaign(businessId, id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
  };

  const handleSendCampaign = async (id: string) => {
    if (!businessId) return;
    const res = await sendCampaign(businessId, id);
    if (res.data) setCampaigns(prev => prev.map(c => c.id === id ? res.data! : c));
    setConfirmSendId(null);
  };

  const openNewForm = () => {
    setEditingForm(null);
    setFormBuilder({ name: "", description: "", fields: [{ name: "email", type: "email", label: "Email", required: true }], thankYouMessage: "Thank you for your submission!", redirectUrl: "" });
    setShowFormModal(true);
  };

  const openEditForm = (f: LeadForm) => {
    setEditingForm(f);
    setFormBuilder({
      name: f.name,
      description: f.description || "",
      fields: f.fields.length ? f.fields : [{ name: "email", type: "email", label: "Email", required: true }],
      thankYouMessage: f.settings?.thankYouMessage || "Thank you for your submission!",
      redirectUrl: f.settings?.redirectUrl || "",
    });
    setShowFormModal(true);
  };

  const handleSaveForm = async () => {
    if (!businessId || !formBuilder.name.trim()) return;
    const data = {
      name: formBuilder.name,
      description: formBuilder.description,
      fields: formBuilder.fields.map(f => ({ ...f, name: f.label.toLowerCase().replace(/\s+/g, "_") })),
      settings: { thankYouMessage: formBuilder.thankYouMessage, redirectUrl: formBuilder.redirectUrl },
    };
    if (editingForm) {
      const res = await updateLeadForm(businessId, editingForm.id, data);
      if (res.data) setForms(prev => prev.map(f => f.id === editingForm.id ? res.data! : f));
    } else {
      const res = await createLeadForm(businessId, data);
      if (res.data) setForms(prev => [res.data!, ...prev]);
    }
    setShowFormModal(false);
  };

  const handleToggleForm = async (form: LeadForm) => {
    if (!businessId) return;
    const res = await updateLeadForm(businessId, form.id, { isActive: !form.isActive });
    if (res.data) setForms(prev => prev.map(f => f.id === form.id ? res.data! : f));
  };

  const handleDeleteForm = async (id: string) => {
    if (!businessId) return;
    await deleteLeadForm(businessId, id);
    setForms(prev => prev.filter(f => f.id !== id));
  };

  const loadSubmissions = async (formId: string) => {
    if (!businessId) return;
    if (expandedForm === formId) { setExpandedForm(null); return; }
    setExpandedForm(formId);
    if (!submissions[formId]) {
      const res = await fetchLeadFormSubmissions(businessId, formId);
      if (res.data) setSubmissions(prev => ({ ...prev, [formId]: res.data! }));
    }
  };

  const copyEmbed = (formId: string) => {
    const url = `${window.location.origin}/forms/${formId}`;
    const snippet = `<iframe src="${url}" width="100%" height="500" frameborder="0"></iframe>`;
    navigator.clipboard.writeText(snippet);
    setCopiedEmbed(formId);
    setTimeout(() => setCopiedEmbed(null), 2000);
  };

  const addField = () => {
    setFormBuilder(prev => ({
      ...prev,
      fields: [...prev.fields, { name: "", type: "text", label: "", required: false }],
    }));
  };

  const removeField = (index: number) => {
    setFormBuilder(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== index) }));
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    setFormBuilder(prev => ({
      ...prev,
      fields: prev.fields.map((f, i) => i === index ? { ...f, ...updates } : f),
    }));
  };

  const toggleTag = (tag: string) => {
    setCampaignForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Marketing</h1>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Marketing"
        subtitle={`${campaigns.length} campaigns · ${forms.length} lead forms`}
        actionLabel={activeTab === "campaigns" ? "New Campaign" : "New Form"}
        onAction={activeTab === "campaigns" ? openNewCampaign : openNewForm}
        rightSlot={
          <button
            onClick={() => setShowContactPicker(true)}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-4 h-4" />
            Broadcast
          </button>
        }
      />

      <FeatureGuide
        featureKey="marketing"
        title="Getting Started with Marketing"
        description="Reach your audience with email campaigns and capture new leads with custom forms."
        steps={[
          { title: "Create a Campaign", description: "Write your email content, choose a subject line, and save as draft." },
          { title: "Segment Your Audience", description: "Target specific contacts by tags or status (leads, clients, etc.)." },
          { title: "Send & Track", description: "Send your campaign and monitor open rates, click-through, and delivery stats." },
          { title: "Build Lead Forms", description: "Create custom forms with fields like name, email, phone, and dropdowns." },
          { title: "Share Form Links", description: "Get a public URL or embed code to place forms on any website." },
          { title: "Auto-Add to CRM", description: "Form submissions automatically create contacts in your CRM." },
        ]}
      />

      <TabNav
        tabs={[
          { key: "campaigns", label: "Campaigns", icon: Mail },
          { key: "forms", label: "Lead Forms", icon: ClipboardList },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as "campaigns" | "forms")}
        layoutId="marketing-tab-pill"
      />

      <AnimatePresence mode="wait">
        {activeTab === "campaigns" ? (
          <motion.div key="campaigns" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
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
                <motion.div key={campaign.id} layout className="bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden">
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
                        {campaign.status === "DRAFT" && (
                          <>
                            <button onClick={() => openEditCampaign(campaign)} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => setConfirmSendId(campaign.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                              <Send className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {campaign.status === "SENT" && (
                          <button onClick={() => setExpandedCampaign(expandedCampaign === campaign.id ? null : campaign.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors">
                            {expandedCampaign === campaign.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        )}
                        <button onClick={() => handleDeleteCampaign(campaign.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {expandedCampaign === campaign.id && campaign.status === "SENT" && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="px-4 pb-4 pt-2 border-t border-white/5">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                              { label: "Recipients", value: campaign.totalRecipients, icon: Users, color: "#6366f1" },
                              { label: "Sent", value: campaign.sentCount, icon: Send, color: "#3b82f6" },
                              { label: "Opened", value: campaign.openCount, icon: MailOpen, color: "#22c55e" },
                              { label: "Clicked", value: campaign.clickCount, icon: MousePointerClick, color: "#f59e0b" },
                            ].map(stat => (
                              <div key={stat.label} className="bg-white/5 rounded-lg p-3 text-center">
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
          </motion.div>
        ) : (
          <motion.div key="forms" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            {forms.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No lead forms yet"
                description="Create a lead capture form to grow your contact list."
                actionLabel="New Form"
                onAction={openNewForm}
              />
            ) : (
              forms.map(form => (
                <motion.div key={form.id} layout className="bg-white/5 backdrop-blur border border-white/10 rounded-xl overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-sm font-semibold truncate">{form.name}</h3>
                          <button
                            onClick={() => handleToggleForm(form)}
                            className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full transition-colors"
                            style={{
                              background: form.isActive ? "#22c55e20" : "#94a3b820",
                              color: form.isActive ? "#22c55e" : "#94a3b8",
                            }}
                          >
                            {form.isActive ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                            {form.isActive ? "Active" : "Inactive"}
                          </button>
                        </div>
                        {form.description && <p className="text-xs text-muted-foreground mb-2">{form.description}</p>}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {form.fields.length} fields</span>
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {form._count?.submissions ?? 0} submissions</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => loadSubmissions(form.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors" title="View submissions">
                          {expandedForm === form.id ? <ChevronDown className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button onClick={() => copyEmbed(form.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors" title="Copy embed code">
                          {copiedEmbed === form.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Code className="w-4 h-4" />}
                        </button>
                        <button onClick={() => openEditForm(form)} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteForm(form.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {expandedForm === form.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="px-4 pb-4 pt-2 border-t border-white/5">
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Submissions</h4>
                            <div className="bg-white/5 rounded-lg px-2.5 py-1 text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                              <Code className="w-3 h-3" />
                              <span className="truncate max-w-[200px]">{`<iframe src="${typeof window !== 'undefined' ? window.location.origin : ''}/forms/${form.id}" ...>`}</span>
                              <button onClick={() => copyEmbed(form.id)} className="hover:text-white"><Copy className="w-3 h-3" /></button>
                            </div>
                          </div>
                          {(submissions[form.id] || []).length === 0 ? (
                            <p className="text-xs text-muted-foreground py-4 text-center">No submissions yet</p>
                          ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {(submissions[form.id] || []).map(sub => (
                                <div key={sub.id} className="bg-white/5 rounded-lg p-3 text-xs">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-muted-foreground">{new Date(sub.createdAt).toLocaleString()}</span>
                                    {sub.source && <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-white/5 rounded">{sub.source}</span>}
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    {Object.entries(sub.data).map(([key, value]) => (
                                      <div key={key}>
                                        <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}: </span>
                                        <span className="text-white">{value}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCampaignModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowCampaignModal(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h2 className="text-lg font-semibold">{editingCampaign ? "Edit Campaign" : "New Campaign"}</h2>
                <button onClick={() => setShowCampaignModal(false)} className="p-1 text-muted-foreground hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Name</label>
                  <input
                    value={campaignForm.name}
                    onChange={e => setCampaignForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Monthly Newsletter"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Subject Line</label>
                  <input
                    value={campaignForm.subject}
                    onChange={e => setCampaignForm(p => ({ ...p, subject: e.target.value }))}
                    placeholder="e.g. Exciting updates for you!"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Body</label>
                  <textarea
                    value={campaignForm.body}
                    onChange={e => setCampaignForm(p => ({ ...p, body: e.target.value }))}
                    rows={6}
                    placeholder="Write your email content here..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
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
                            ? "bg-white/10 text-white border border-white/20"
                            : "text-muted-foreground hover:text-white bg-white/5 border border-transparent"
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
                              : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10"
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
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none mt-2"
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
              <div className="flex gap-2 p-4 border-t border-white/5">
                <button onClick={handleSaveCampaign} disabled={!campaignForm.name.trim() || !campaignForm.subject.trim()} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 flex-1">
                  {editingCampaign ? "Save Changes" : "Create Campaign"}
                </button>
                <button onClick={() => setShowCampaignModal(false)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5 transition-colors">
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
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full">
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
                  <button onClick={() => setConfirmSendId(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5 flex-1">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFormModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowFormModal(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h2 className="text-lg font-semibold">{editingForm ? "Edit Form" : "New Lead Form"}</h2>
                <button onClick={() => setShowFormModal(false)} className="p-1 text-muted-foreground hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Form Name</label>
                  <input
                    value={formBuilder.name}
                    onChange={e => setFormBuilder(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Contact Us"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
                  <textarea
                    value={formBuilder.description}
                    onChange={e => setFormBuilder(p => ({ ...p, description: e.target.value }))}
                    rows={2}
                    placeholder="Optional description..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-muted-foreground">Fields</label>
                    <button onClick={addField} className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                      <Plus className="w-3 h-3" /> Add Field
                    </button>
                  </div>
                  <div className="space-y-2">
                    {formBuilder.fields.map((field, i) => (
                      <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            value={field.label}
                            onChange={e => updateField(i, { label: e.target.value })}
                            placeholder="Field label"
                            className="flex-1 bg-transparent border border-white/10 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                          />
                          <select
                            value={field.type}
                            onChange={e => updateField(i, { type: e.target.value })}
                            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs focus:outline-none"
                          >
                            {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <button
                            onClick={() => updateField(i, { required: !field.required })}
                            className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                              field.required ? "bg-amber-500/20 text-amber-400" : "bg-white/5 text-muted-foreground"
                            }`}
                          >
                            {field.required ? "Required" : "Optional"}
                          </button>
                          <button onClick={() => removeField(i)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/5 pt-4 space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground">Settings</h4>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Thank You Message</label>
                    <input
                      value={formBuilder.thankYouMessage}
                      onChange={e => setFormBuilder(p => ({ ...p, thankYouMessage: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Redirect URL (optional)</label>
                    <input
                      value={formBuilder.redirectUrl}
                      onChange={e => setFormBuilder(p => ({ ...p, redirectUrl: e.target.value }))}
                      placeholder="https://..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 p-4 border-t border-white/5">
                <button onClick={handleSaveForm} disabled={!formBuilder.name.trim()} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 flex-1">
                  {editingForm ? "Save Changes" : "Create Form"}
                </button>
                <button onClick={() => setShowFormModal(false)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
