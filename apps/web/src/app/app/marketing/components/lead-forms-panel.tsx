"use client";

import React, { useState, useCallback } from "react";
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
  ClipboardList,
  Code,
  Sparkles,
} from "lucide-react";
import {
  LeadForm,
  LeadFormSubmission,
  createLeadForm,
  updateLeadForm,
  deleteLeadForm,
  fetchLeadFormSubmissions,
} from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";

const FIELD_TYPES = ["text", "email", "phone", "select", "textarea"];

type FormField = { name: string; type: string; label: string; required: boolean };

interface LeadFormsPanelProps {
  businessId: string | null;
  forms: LeadForm[];
  setForms: React.Dispatch<React.SetStateAction<LeadForm[]>>;
  onViewContact?: (contactId: string) => void;
  onAiOptimize?: () => void;
}

export const LeadFormsPanel = React.memo(function LeadFormsPanel({
  businessId,
  forms,
  setForms,
  onViewContact,
  onAiOptimize,
}: LeadFormsPanelProps) {
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingForm, setEditingForm] = useState<LeadForm | null>(null);
  const [formBuilder, setFormBuilder] = useState({ name: "", description: "", fields: [{ name: "email", type: "email", label: "Email", required: true }] as FormField[], thankYouMessage: "Thank you for your submission!", redirectUrl: "" });
  const [expandedForm, setExpandedForm] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, LeadFormSubmission[]>>({});
  const [copiedEmbed, setCopiedEmbed] = useState<string | null>(null);

  const openNewForm = useCallback(() => {
    setEditingForm(null);
    setFormBuilder({ name: "", description: "", fields: [{ name: "email", type: "email", label: "Email", required: true }], thankYouMessage: "Thank you for your submission!", redirectUrl: "" });
    setShowFormModal(true);
  }, []);

  const openEditForm = useCallback((f: LeadForm) => {
    setEditingForm(f);
    setFormBuilder({
      name: f.name,
      description: f.description || "",
      fields: f.fields.length ? f.fields : [{ name: "email", type: "email", label: "Email", required: true }],
      thankYouMessage: f.settings?.thankYouMessage || "Thank you for your submission!",
      redirectUrl: f.settings?.redirectUrl || "",
    });
    setShowFormModal(true);
  }, []);

  const handleSaveForm = useCallback(async () => {
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
  }, [businessId, formBuilder, editingForm, setForms]);

  const handleToggleForm = useCallback(async (form: LeadForm) => {
    if (!businessId) return;
    const res = await updateLeadForm(businessId, form.id, { isActive: !form.isActive });
    if (res.data) setForms(prev => prev.map(f => f.id === form.id ? res.data! : f));
  }, [businessId, setForms]);

  const handleDeleteForm = useCallback(async (id: string) => {
    if (!businessId) return;
    await deleteLeadForm(businessId, id);
    setForms(prev => prev.filter(f => f.id !== id));
  }, [businessId, setForms]);

  const loadSubmissions = useCallback(async (formId: string) => {
    if (!businessId) return;
    if (expandedForm === formId) { setExpandedForm(null); return; }
    setExpandedForm(formId);
    if (!submissions[formId]) {
      const res = await fetchLeadFormSubmissions(businessId, formId);
      if (res.data) setSubmissions(prev => ({ ...prev, [formId]: res.data! }));
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

  return (
    <>
      <div className="space-y-4">
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
            <motion.div key={form.id} layout className="kf-card border border-border/40 rounded-xl overflow-hidden">
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
                        aria-label={form.isActive ? "Deactivate form" : "Activate form"}
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
                    {onAiOptimize && (
                      <button onClick={onAiOptimize} className="p-1.5 rounded-lg text-muted-foreground hover:text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors" aria-label="AI Optimize" title="AI Optimize">
                        <Sparkles className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => loadSubmissions(form.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="View submissions" aria-label="View submissions">
                      {expandedForm === form.id ? <ChevronDown className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button onClick={() => copyEmbed(form.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Copy embed code" aria-label="Copy embed code">
                      {copiedEmbed === form.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Code className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEditForm(form)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" aria-label="Edit form">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDeleteForm(form.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors" aria-label="Delete form">
                      <Trash2 className="w-4 h-4" />
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
                        <div className="bg-muted/30 rounded-lg px-2.5 py-1 text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                          <Code className="w-3 h-3" />
                          <span className="truncate max-w-[200px]">{`<iframe src="${typeof window !== 'undefined' ? window.location.origin : ''}/forms/${form.id}" ...>`}</span>
                          <button onClick={() => copyEmbed(form.id)} className="hover:text-foreground" aria-label="Copy embed"><Copy className="w-3 h-3" /></button>
                        </div>
                      </div>
                      {(submissions[form.id] || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">No submissions yet</p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {(submissions[form.id] || []).map(sub => (
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
        {showFormModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowFormModal(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-lg kf-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-border/40">
                <h2 className="text-lg font-semibold">{editingForm ? "Edit Form" : "New Lead Form"}</h2>
                <button onClick={() => setShowFormModal(false)} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-5 h-5" /></button>
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
                          <input
                            value={field.label}
                            onChange={e => updateField(i, { label: e.target.value })}
                            placeholder="Field label"
                            className="flex-1 bg-transparent border border-border/40 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                          />
                          <select
                            value={field.type}
                            onChange={e => updateField(i, { type: e.target.value })}
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
                <button onClick={handleSaveForm} disabled={!formBuilder.name.trim()} className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 flex-1">
                  {editingForm ? "Save Changes" : "Create Form"}
                </button>
                <button onClick={() => setShowFormModal(false)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
