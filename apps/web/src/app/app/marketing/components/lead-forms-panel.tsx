"use client";

import React, { useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Pencil,
  Users,
  Eye,
  Copy,
  Check,
  ChevronDown,
  X,
  FileText,
  ToggleLeft,
  ToggleRight,
  Code,
  Sparkles,
  Loader2,
  ArrowUp,
  ArrowDown,
  EyeOff,
  Download,
  Search,
  Tag,
} from "lucide-react";
import {
  LeadForm,
  LeadFormSubmission,
  createLeadForm,
  updateLeadForm,
  deleteLeadForm,
  fetchLeadFormSubmissions,
} from "@/lib/client";
import { FormsEmptyState } from "./marketing-empty-states";
import { MarketingBulkBar } from "./marketing-bulk-bar";
import { toast } from "sonner";
import { moduleEvents } from "@/lib/module-events";

const FIELD_TYPES = ["text", "email", "phone", "select", "textarea", "number", "date", "checkbox", "radio", "url", "hidden"];

const FORM_FILTER_PILLS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

type FormField = { name: string; type: string; label: string; required: boolean; options?: string[]; condition?: { field: string; value: string } };

interface LeadFormsPanelProps {
  businessId: string | null;
  forms: LeadForm[];
  setForms: React.Dispatch<React.SetStateAction<LeadForm[]>>;
  onViewContact?: (contactId: string) => void;
  onAiOptimize?: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}

export const LeadFormsPanel = React.memo(function LeadFormsPanel({
  businessId,
  forms,
  setForms,
  onViewContact,
  onAiOptimize,
  searchQuery: externalSearch,
  onSearchChange: externalSearchChange,
}: LeadFormsPanelProps) {
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingForm, setEditingForm] = useState<LeadForm | null>(null);
  const defaultFields: FormField[] = [{ name: "email", type: "email", label: "Email", required: true }];
  const [formBuilder, setFormBuilder] = useState({ name: "", description: "", fields: defaultFields, thankYouMessage: "Thank you for your submission!", redirectUrl: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedForm, setExpandedForm] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, LeadFormSubmission[]>>({});
  const [copiedEmbed, setCopiedEmbed] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [submissionSearch, setSubmissionSearch] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const initialFormRef = useRef({ name: "", description: "", fields: defaultFields, thankYouMessage: "Thank you for your submission!", redirectUrl: "" });
  const operationInFlight = saving || !!deletingId || !!togglingId || bulkLoading;
  const searchQuery = externalSearch ?? localSearch;
  const setSearchQuery = externalSearchChange ?? setLocalSearch;

  const isDirty = useCallback(() => {
    const init = initialFormRef.current;
    return (
      formBuilder.name !== init.name ||
      formBuilder.description !== init.description ||
      formBuilder.thankYouMessage !== init.thankYouMessage ||
      formBuilder.redirectUrl !== init.redirectUrl ||
      JSON.stringify(formBuilder.fields) !== JSON.stringify(init.fields)
    );
  }, [formBuilder]);

  const tryCloseModal = useCallback(() => {
    if (isDirty()) {
      setShowDiscardConfirm(true);
    } else {
      setShowFormModal(false);
    }
  }, [isDirty]);

  const filtered = useMemo(() => {
    let base = forms;
    if (statusFilter === "active") base = forms.filter(f => f.isActive);
    else if (statusFilter === "inactive") base = forms.filter(f => !f.isActive);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      base = base.filter(f => f.name.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q));
    }
    const sorted = [...base];
    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "submissions":
        sorted.sort((a, b) => (b._count?.submissions ?? 0) - (a._count?.submissions ?? 0));
        break;
      default:
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [forms, statusFilter, sortBy, searchQuery]);

  const openNewForm = useCallback(() => {
    setEditingForm(null);
    const init = { name: "", description: "", fields: [{ name: "email", type: "email", label: "Email", required: true }] as FormField[], thankYouMessage: "Thank you for your submission!", redirectUrl: "" };
    setFormBuilder(init);
    initialFormRef.current = init;
    setShowFormModal(true);
  }, []);

  const openEditForm = useCallback((f: LeadForm) => {
    setEditingForm(f);
    const init = {
      name: f.name,
      description: f.description || "",
      fields: (f.fields.length ? f.fields : [{ name: "email", type: "email", label: "Email", required: true }]) as FormField[],
      thankYouMessage: f.settings?.thankYouMessage || "Thank you for your submission!",
      redirectUrl: f.settings?.redirectUrl || "",
    };
    setFormBuilder(init);
    initialFormRef.current = init;
    setShowFormModal(true);
  }, []);

  const handleSaveForm = useCallback(async () => {
    if (!businessId || !formBuilder.name.trim()) return;
    setSaving(true);
    const data = {
      name: formBuilder.name,
      description: formBuilder.description,
      fields: formBuilder.fields.map(f => ({ ...f, name: f.label.toLowerCase().replace(/\s+/g, "_") })),
      settings: { thankYouMessage: formBuilder.thankYouMessage, redirectUrl: formBuilder.redirectUrl },
    };
    try {
      if (editingForm) {
        const res = await updateLeadForm(businessId, editingForm.id, data);
        if (res.data) {
          setForms(prev => prev.map(f => f.id === editingForm.id ? res.data! : f));
          toast.success("Form updated");
        }
      } else {
        const res = await createLeadForm(businessId, data);
        if (res.data) {
          setForms(prev => [res.data!, ...prev]);
          moduleEvents.emit("marketing:form_created", "marketing", { formId: res.data.id, name: res.data.name });
          toast.success("Form created");
        }
      }
      setShowFormModal(false);
    } catch {
      toast.error("Failed to save form");
    } finally {
      setSaving(false);
    }
  }, [businessId, formBuilder, editingForm, setForms]);

  const handleToggleForm = useCallback(async (form: LeadForm) => {
    if (!businessId) return;
    setTogglingId(form.id);
    try {
      const res = await updateLeadForm(businessId, form.id, { isActive: !form.isActive });
      if (res.data) {
        setForms(prev => prev.map(f => f.id === form.id ? res.data! : f));
        toast.success(res.data.isActive ? "Form activated" : "Form deactivated");
      }
    } catch {
      toast.error("Failed to toggle form status");
    } finally {
      setTogglingId(null);
    }
  }, [businessId, setForms]);

  const handleDeleteForm = useCallback(async (id: string) => {
    if (!businessId) return;
    setDeletingId(id);
    try {
      await deleteLeadForm(businessId, id);
      setForms(prev => prev.filter(f => f.id !== id));
      moduleEvents.emit("marketing:form_deleted", "marketing", { formId: id });
      toast.success("Form deleted");
    } catch {
      toast.error("Failed to delete form");
    } finally {
      setDeletingId(null);
    }
  }, [businessId, setForms]);

  const loadSubmissions = useCallback(async (formId: string) => {
    if (!businessId) return;
    if (expandedForm === formId) { setExpandedForm(null); return; }
    setExpandedForm(formId);
    if (!submissions[formId]) {
      try {
        const res = await fetchLeadFormSubmissions(businessId, formId);
        if (res.data) setSubmissions(prev => ({ ...prev, [formId]: res.data! }));
      } catch {
        toast.error("Failed to load submissions");
      }
    }
  }, [businessId, expandedForm, submissions]);

  const copyEmbed = useCallback((formId: string) => {
    const url = `${window.location.origin}/forms/${formId}`;
    const snippet = `<iframe src="${url}" width="100%" height="500" frameborder="0"></iframe>`;
    navigator.clipboard.writeText(snippet);
    setCopiedEmbed(formId);
    setTimeout(() => setCopiedEmbed(null), 2000);
  }, []);

  const addField = useCallback(() => {
    setFormBuilder(prev => ({
      ...prev,
      fields: [...prev.fields, { name: "", type: "text", label: "", required: false }],
    }));
  }, []);

  const removeField = useCallback((index: number) => {
    setFormBuilder(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== index) }));
  }, []);

  const updateField = useCallback((index: number, updates: Partial<FormField>) => {
    setFormBuilder(prev => ({
      ...prev,
      fields: prev.fields.map((f, i) => i === index ? { ...f, ...updates } : f),
    }));
  }, []);

  const moveField = useCallback((index: number, direction: "up" | "down") => {
    setFormBuilder(prev => {
      const fields = [...prev.fields];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= fields.length) return prev;
      [fields[index], fields[targetIndex]] = [fields[targetIndex], fields[index]];
      return { ...prev, fields };
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map(f => f.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const getFilteredSubmissions = useCallback((formId: string) => {
    const subs = submissions[formId] || [];
    const q = (submissionSearch[formId] || "").toLowerCase().trim();
    if (!q) return subs;
    return subs.filter(sub =>
      Object.values(sub.data).some(v => String(v).toLowerCase().includes(q))
    );
  }, [submissions, submissionSearch]);

  const exportSubmissionsCSV = useCallback((form: LeadForm) => {
    const subs = getFilteredSubmissions(form.id);
    if (subs.length === 0) {
      toast.error("No submissions to export");
      return;
    }
    const allKeys = new Set<string>();
    subs.forEach(sub => Object.keys(sub.data).forEach(k => allKeys.add(k)));
    const headers = ["Submitted At", "Source", ...Array.from(allKeys)];
    const escapeCSV = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };
    const rows = subs.map(sub => {
      const date = new Date(sub.createdAt).toLocaleString();
      const source = sub.source || "";
      const fields = Array.from(allKeys).map(k => String(sub.data[k] ?? ""));
      return [date, source, ...fields].map(escapeCSV).join(",");
    });
    const csv = [headers.map(escapeCSV).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${form.name.replace(/[^a-zA-Z0-9]/g, "_")}_submissions.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${subs.length} submission${subs.length > 1 ? "s" : ""}`);
  }, [getFilteredSubmissions]);

  const handleBulkDelete = useCallback(async () => {
    if (!businessId || selectedIds.size === 0) return;
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    let deleted = 0;
    for (const id of ids) {
      try {
        await deleteLeadForm(businessId, id);
        deleted++;
      } catch {}
    }
    setForms(prev => prev.filter(f => !selectedIds.has(f.id)));
    ids.forEach(id => moduleEvents.emit("marketing:form_deleted", "marketing", { formId: id }));
    setSelectedIds(new Set());
    setBulkLoading(false);
    toast.success(`${deleted} form${deleted > 1 ? "s" : ""} deleted`);
  }, [businessId, selectedIds, setForms]);

  const handleBulkActivate = useCallback(async () => {
    if (!businessId || selectedIds.size === 0) return;
    setBulkLoading(true);
    const ids = Array.from(selectedIds).filter(id => !forms.find(f => f.id === id)?.isActive);
    let count = 0;
    for (const id of ids) {
      try {
        const res = await updateLeadForm(businessId, id, { isActive: true });
        if (res.data) {
          setForms(prev => prev.map(f => f.id === id ? res.data! : f));
          count++;
        }
      } catch {}
    }
    setSelectedIds(new Set());
    setBulkLoading(false);
    if (count > 0) toast.success(`${count} form${count > 1 ? "s" : ""} activated`);
    else toast.info("No inactive forms to activate");
  }, [businessId, selectedIds, forms, setForms]);

  const handleBulkDeactivate = useCallback(async () => {
    if (!businessId || selectedIds.size === 0) return;
    setBulkLoading(true);
    const ids = Array.from(selectedIds).filter(id => forms.find(f => f.id === id)?.isActive);
    let count = 0;
    for (const id of ids) {
      try {
        const res = await updateLeadForm(businessId, id, { isActive: false });
        if (res.data) {
          setForms(prev => prev.map(f => f.id === id ? res.data! : f));
          count++;
        }
      } catch {}
    }
    setSelectedIds(new Set());
    setBulkLoading(false);
    if (count > 0) toast.success(`${count} form${count > 1 ? "s" : ""} deactivated`);
    else toast.info("No active forms to deactivate");
  }, [businessId, selectedIds, forms, setForms]);

  const captureMetrics = useMemo(() => {
    const active = forms.filter(f => f.isActive).length;
    const total = forms.length;
    const totalSubs = forms.reduce((sum, f) => sum + (f._count?.submissions ?? 0), 0);
    const avgRate = total > 0 ? Math.round(totalSubs / total) : 0;
    return { active, total, totalSubs, avgRate };
  }, [forms]);

  return (
    <>
      <div className="space-y-4">
        <button data-marketing-new-form onClick={openNewForm} className="hidden" aria-hidden="true" tabIndex={-1} />
        {forms.map(f => (
          <button key={`trigger-${f.id}`} data-form-edit={f.id} onClick={() => openEditForm(f)} className="hidden" aria-hidden="true" tabIndex={-1} />
        ))}

        {forms.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-muted/10 border border-border/20 p-2.5 text-center">
              <div className="text-sm font-bold text-foreground">{captureMetrics.totalSubs}</div>
              <div className="text-[10px] text-muted-foreground">Total Leads</div>
            </div>
            <div className="rounded-lg bg-muted/10 border border-border/20 p-2.5 text-center">
              <div className="text-sm font-bold" style={{ color: "hsl(var(--kf-accent2))" }}>{captureMetrics.active}</div>
              <div className="text-[10px] text-muted-foreground">Active Forms</div>
            </div>
            <div className="rounded-lg bg-muted/10 border border-border/20 p-2.5 text-center">
              <div className="text-sm font-bold text-muted-foreground">{captureMetrics.avgRate}</div>
              <div className="text-[10px] text-muted-foreground">Avg / Form</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search forms..."
            className="flex-1 bg-muted/30 border border-border/40 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))] placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {FORM_FILTER_PILLS.map(pill => (
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
            <option value="submissions">Submissions</option>
          </select>
        </div>
        <p className="text-[11px] text-muted-foreground">{filtered.length} forms</p>
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <MarketingBulkBar
              selectedCount={selectedIds.size}
              totalCount={filtered.length}
              mode="forms"
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onBulkDelete={handleBulkDelete}
              onBulkActivate={handleBulkActivate}
              onBulkDeactivate={handleBulkDeactivate}
              loading={bulkLoading}
            />
          )}
        </AnimatePresence>
        {forms.length === 0 ? (
          <FormsEmptyState onAction={openNewForm} />
        ) : (
          filtered.map(form => (
            <motion.div key={form.id} layout className="kf-card border border-border/40 rounded-xl overflow-hidden" style={{ borderLeft: `3px solid ${form.isActive ? "#22c55e" : "#94a3b8"}` }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(form.id)}
                      onChange={() => toggleSelect(form.id)}
                      className="w-3.5 h-3.5 rounded border-border/60 accent-[hsl(var(--kf-accent1))] cursor-pointer"
                      aria-label={`Select ${form.name}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-sm font-semibold truncate">{form.name}</h3>
                      <button
                        onClick={() => handleToggleForm(form)}
                        disabled={operationInFlight}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full transition-colors disabled:opacity-40"
                        style={{
                          background: form.isActive ? "#22c55e20" : "#94a3b820",
                          color: form.isActive ? "#22c55e" : "#94a3b8",
                        }}
                        aria-label={form.isActive ? "Deactivate form" : "Activate form"}
                      >
                        {togglingId === form.id ? <Loader2 className="w-3 h-3 animate-spin" /> : form.isActive ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                        {form.isActive ? "Active" : "Inactive"}
                      </button>
                    </div>
                    {form.description && <p className="text-xs text-muted-foreground mb-2">{form.description}</p>}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {form.fields.length} fields</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {form._count?.submissions ?? 0} submissions</span>
                      {(() => {
                        const emailField = form.fields.find((f: FormField) => f.type === "email");
                        const hasName = form.fields.some((f: FormField) => f.type === "text" && /name/i.test(f.label));
                        const hasPhone = form.fields.some((f: FormField) => f.type === "phone");
                        const segments: string[] = [];
                        if (emailField) segments.push("Email");
                        if (hasName) segments.push("Name");
                        if (hasPhone) segments.push("Phone");
                        return segments.length > 0 ? (
                          <span className="flex items-center gap-1 text-[hsl(var(--kf-accent2))]">
                            <Tag className="w-3 h-3" /> Captures {segments.join(", ")}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {onAiOptimize && (
                      <button onClick={onAiOptimize} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors disabled:opacity-40" aria-label="AI Optimize" title="AI Optimize">
                        <Sparkles className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => loadSubmissions(form.id)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40" title="View submissions" aria-label="View submissions">
                      {expandedForm === form.id ? <ChevronDown className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button onClick={() => copyEmbed(form.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Copy embed code" aria-label="Copy embed code">
                      {copiedEmbed === form.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Code className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEditForm(form)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40" aria-label="Edit form">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmDeleteId(form.id)} disabled={operationInFlight} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40" aria-label="Delete form">
                      {deletingId === form.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {expandedForm === form.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 pt-2 border-t border-border/20">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Submissions</h4>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => exportSubmissionsCSV(form)}
                            disabled={(submissions[form.id] || []).length === 0}
                            className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Download submissions CSV"
                            title="Download CSV"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download CSV
                          </button>
                          <div className="bg-muted/30 rounded-lg px-2.5 py-1 text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                            <Code className="w-3 h-3" />
                            <span className="truncate max-w-[200px]">{`<iframe src="${typeof window !== 'undefined' ? window.location.origin : ''}/forms/${form.id}" ...>`}</span>
                            <button onClick={() => copyEmbed(form.id)} className="hover:text-foreground" aria-label="Copy embed"><Copy className="w-3 h-3" /></button>
                          </div>
                        </div>
                      </div>
                      {(submissions[form.id] || []).length > 0 && (
                        <div className="mb-3 relative">
                          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                          <input
                            type="text"
                            value={submissionSearch[form.id] || ""}
                            onChange={e => setSubmissionSearch(prev => ({ ...prev, [form.id]: e.target.value }))}
                            placeholder="Search submissions by field values..."
                            className="w-full bg-muted/30 border border-border/40 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))] placeholder:text-muted-foreground/50"
                          />
                        </div>
                      )}
                      {(submissions[form.id] || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">No submissions yet</p>
                      ) : getFilteredSubmissions(form.id).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">No submissions match your search</p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {getFilteredSubmissions(form.id).map(sub => (
                            <div key={sub.id} className="bg-muted/20 rounded-lg p-3 text-xs">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-muted-foreground">{new Date(sub.createdAt).toLocaleString()}</span>
                                {sub.source && <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted/30 rounded">{sub.source}</span>}
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                {Object.entries(sub.data).map(([key, value]) => (
                                  <div key={key}>
                                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}: </span>
                                    <span className="text-foreground">{value}</span>
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
      </div>

      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)} />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative kf-card border border-border rounded-2xl p-6 max-w-sm w-full">
              <div className="text-center">
                <Trash2 className="w-10 h-10 mx-auto mb-3 text-red-400" />
                <h3 className="text-lg font-semibold mb-2">Delete Form?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { handleDeleteForm(confirmDeleteId); setConfirmDeleteId(null); }} disabled={!!deletingId} className="px-4 py-2 rounded-xl text-sm font-medium flex-1 bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
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
        {showFormModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={tryCloseModal}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-lg kf-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-border/40">
                <h2 className="text-lg font-semibold">{editingForm ? "Edit Form" : "New Lead Form"}</h2>
                <button onClick={tryCloseModal} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Form Name</label>
                  <input
                    value={formBuilder.name}
                    onChange={e => setFormBuilder(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Contact Us"
                    className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
                  <textarea
                    value={formBuilder.description}
                    onChange={e => setFormBuilder(p => ({ ...p, description: e.target.value }))}
                    rows={2}
                    placeholder="Optional description..."
                    className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))] resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-muted-foreground">Fields</label>
                    <button onClick={addField} className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors" aria-label="Add field">
                      <Plus className="w-3 h-3" /> Add Field
                    </button>
                  </div>
                  <div className="space-y-2">
                    {formBuilder.fields.map((field, i) => (
                      <div key={i} className="bg-muted/20 border border-border/40 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col gap-0.5">
                            <button onClick={() => moveField(i, "up")} disabled={i === 0} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20" aria-label="Move up">
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button onClick={() => moveField(i, "down")} disabled={i === formBuilder.fields.length - 1} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20" aria-label="Move down">
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                          <input
                            value={field.label}
                            onChange={e => updateField(i, { label: e.target.value })}
                            placeholder="Field label"
                            className="flex-1 bg-transparent border border-border/40 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                          />
                          <select
                            value={field.type}
                            onChange={e => updateField(i, { type: e.target.value, ...(e.target.value !== "select" && e.target.value !== "radio" ? { options: undefined } : {}) })}
                            className="bg-muted/30 border border-border/40 rounded px-2 py-1.5 text-xs focus:outline-none"
                          >
                            {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <button
                            onClick={() => updateField(i, { required: !field.required })}
                            className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                              field.required ? "bg-amber-500/20 text-amber-400" : "bg-muted/30 text-muted-foreground"
                            }`}
                          >
                            {field.required ? "Required" : "Optional"}
                          </button>
                          <button onClick={() => removeField(i)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors" aria-label="Remove field">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {(field.type === "select" || field.type === "radio") && (
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Options (comma-separated)</label>
                            <input
                              value={(field.options || []).join(", ")}
                              onChange={e => updateField(i, { options: e.target.value.split(",").map(o => o.trim()).filter(Boolean) })}
                              placeholder="e.g. Option A, Option B, Option C"
                              className="w-full bg-transparent border border-border/40 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                            />
                          </div>
                        )}
                        {field.type === "checkbox" && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Check className="w-3 h-3" /> Renders as a toggle/checkbox with label</p>
                        )}
                        {field.type === "hidden" && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><EyeOff className="w-3 h-3" /> Hidden field — captures UTM params or pre-set values automatically</p>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateField(i, { condition: field.condition ? undefined : { field: "", value: "" } })}
                            className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${
                              field.condition ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "bg-muted/30 text-muted-foreground"
                            }`}
                          >
                            <Eye className="w-3 h-3" /> {field.condition ? "Conditional: On" : "Conditional"}
                          </button>
                        </div>
                        {field.condition && (
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-muted-foreground whitespace-nowrap">Show when</span>
                            <select
                              value={field.condition.field}
                              onChange={e => updateField(i, { condition: { ...field.condition!, field: e.target.value } })}
                              className="bg-muted/30 border border-border/40 rounded px-1.5 py-1 text-[10px] focus:outline-none flex-1"
                            >
                              <option value="">Select field...</option>
                              {formBuilder.fields.filter((_, fi) => fi !== i).map(f => (
                                <option key={f.label} value={f.label.toLowerCase().replace(/\s+/g, "_")}>{f.label || "(unnamed)"}</option>
                              ))}
                            </select>
                            <span className="text-muted-foreground">=</span>
                            <input
                              value={field.condition.value}
                              onChange={e => updateField(i, { condition: { ...field.condition!, value: e.target.value } })}
                              placeholder="value"
                              className="bg-transparent border border-border/40 rounded px-1.5 py-1 text-[10px] focus:outline-none flex-1 focus:border-[hsl(var(--kf-accent1))]"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/40 pt-4 space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground">Settings</h4>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Thank You Message</label>
                    <input
                      value={formBuilder.thankYouMessage}
                      onChange={e => setFormBuilder(p => ({ ...p, thankYouMessage: e.target.value }))}
                      className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Redirect URL (optional)</label>
                    <input
                      value={formBuilder.redirectUrl}
                      onChange={e => setFormBuilder(p => ({ ...p, redirectUrl: e.target.value }))}
                      placeholder="https://..."
                      className="w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 p-4 border-t border-border/40">
                <button onClick={handleSaveForm} disabled={!formBuilder.name.trim() || saving} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 flex-1 flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingForm ? "Save Changes" : "Create Form"}
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
                  <button onClick={() => { setShowDiscardConfirm(false); setShowFormModal(false); }} className="px-4 py-2 rounded-xl text-sm font-medium flex-1 bg-red-500 text-white hover:bg-red-600 transition-colors">
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
