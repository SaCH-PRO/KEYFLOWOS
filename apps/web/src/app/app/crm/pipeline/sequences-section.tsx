"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch, Plus, ChevronDown, ChevronUp, Mail, Phone,
  MessageSquare, Clock, Users, Trash2, Play, Pause, X,
  ArrowUp, ArrowDown, CheckCircle2, UserPlus, Eye, Copy, Pencil,
} from "lucide-react";
import {
  fetchSequences, createSequence, fetchSequenceDetail, deleteSequence,
  enrollContactsInSequence, advanceSequenceEnrollment, unenrollFromSequence,
  fetchContacts, updateSequence, duplicateSequence,
  type CrmSequence, type CrmSequenceStep, type CrmSequenceDetail, type Contact,
} from "@/lib/client";
import { Search } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const STEP_TYPES = [
  { value: "email" as const, label: "Email", icon: Mail, color: "text-blue-400" },
  { value: "whatsapp" as const, label: "WhatsApp", icon: MessageSquare, color: "text-emerald-400" },
  { value: "call" as const, label: "Call", icon: Phone, color: "text-amber-400" },
  { value: "wait" as const, label: "Wait", icon: Clock, color: "text-muted-foreground" },
];

const TEMPLATES: { name: string; description: string; steps: CrmSequenceStep[] }[] = [
  {
    name: "New Lead Onboarding",
    description: "Welcome new leads over 14 days",
    steps: [
      { stepNumber: 1, type: "email", delayDays: 0, subject: "Welcome!", template: "Thank you for your interest. Here's what we offer..." },
      { stepNumber: 2, type: "whatsapp", delayDays: 2, template: "Hi! Just checking if you had any questions about our services." },
      { stepNumber: 3, type: "email", delayDays: 5, subject: "Special offer for you", template: "As a new lead, we'd like to offer you..." },
      { stepNumber: 4, type: "call", delayDays: 10, notes: "Personal check-in call to discuss needs" },
      { stepNumber: 5, type: "email", delayDays: 14, subject: "Let's connect", template: "We'd love to schedule a consultation..." },
    ],
  },
  {
    name: "Re-engagement",
    description: "Win back inactive contacts over 7 days",
    steps: [
      { stepNumber: 1, type: "email", delayDays: 0, subject: "We miss you!", template: "It's been a while since we connected..." },
      { stepNumber: 2, type: "whatsapp", delayDays: 3, template: "Hi! We have some exciting updates to share with you." },
      { stepNumber: 3, type: "call", delayDays: 7, notes: "Final outreach attempt — personal call" },
    ],
  },
  {
    name: "Post-Sale Follow-up",
    description: "Nurture clients over 21 days",
    steps: [
      { stepNumber: 1, type: "email", delayDays: 1, subject: "Thank you for your purchase!", template: "We appreciate your business..." },
      { stepNumber: 2, type: "whatsapp", delayDays: 7, template: "How's everything going? Let us know if you need anything." },
      { stepNumber: 3, type: "email", delayDays: 14, subject: "Quick feedback?", template: "We'd love to hear about your experience..." },
      { stepNumber: 4, type: "call", delayDays: 21, notes: "Check-in and upsell opportunity" },
    ],
  },
];

const StepIcon = React.memo(function StepIcon({ type, className }: { type: string; className?: string }) {
  const config = STEP_TYPES.find((t) => t.value === type);
  if (!config) return <Clock className={className} />;
  const Icon = config.icon;
  return <Icon className={`${className} ${config.color}`} />;
});

interface SequencesSectionProps {
  businessId: string;
}

type EditingSequence = {
  id: string;
  name: string;
  description?: string;
  steps: CrmSequenceStep[];
};

export const SequencesSection = React.memo(function SequencesSection({ businessId }: SequencesSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [sequences, setSequences] = useState<CrmSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<EditingSequence | null>(null);
  const [selectedSequence, setSelectedSequence] = useState<CrmSequenceDetail | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [enrollSequenceId, setEnrollSequenceId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const loadSequences = useCallback(async () => {
    setLoading(true);
    const res = await fetchSequences(businessId);
    if (res.data) setSequences(res.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { loadSequences(); }, [loadSequences]);

  const handleViewSequence = useCallback(async (id: string) => {
    const res = await fetchSequenceDetail(businessId, id);
    if (res.data) setSelectedSequence(res.data);
  }, [businessId]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    try {
      const res = await deleteSequence(businessId, id);
      if (res.data) {
        setSequences((prev) => prev.filter((s) => s.id !== id));
        if (selectedSequence?.id === id) setSelectedSequence(null);
      }
    } catch { /* swallow */ }
    setConfirmDelete(null);
  }, [businessId, selectedSequence, confirmDelete]);

  const handleDeleteRequest = useCallback((id: string, name: string) => {
    setConfirmDelete({ id, name });
  }, []);

  const handleEnrollClick = useCallback((sequenceId: string) => {
    setEnrollSequenceId(sequenceId);
    setShowContactPicker(true);
  }, []);

  const handleEnrollContacts = useCallback(async (contactIds: string[]) => {
    if (!enrollSequenceId) return;
    try {
      await enrollContactsInSequence(businessId, enrollSequenceId, contactIds);
      setShowContactPicker(false);
      setEnrollSequenceId(null);
      if (selectedSequence?.id === enrollSequenceId) {
        handleViewSequence(enrollSequenceId);
      }
      loadSequences();
    } catch { /* swallow */ }
  }, [businessId, enrollSequenceId, selectedSequence, handleViewSequence, loadSequences]);

  const handleAdvance = useCallback(async (sequenceId: string, enrollmentId: string) => {
    try {
      await advanceSequenceEnrollment(businessId, sequenceId, enrollmentId);
      handleViewSequence(sequenceId);
    } catch { /* swallow */ }
  }, [businessId, handleViewSequence]);

  const handleUnenroll = useCallback(async (sequenceId: string, enrollmentId: string) => {
    try {
      await unenrollFromSequence(businessId, sequenceId, enrollmentId);
      handleViewSequence(sequenceId);
      loadSequences();
    } catch { /* swallow */ }
  }, [businessId, handleViewSequence, loadSequences]);

  const handleCreateSequence = useCallback(async (data: { name: string; description?: string; steps: CrmSequenceStep[] }) => {
    const res = await createSequence(businessId, data);
    if (res.data) {
      setSequences((prev) => [res.data!, ...prev]);
      setShowBuilder(false);
    }
  }, [businessId]);

  const handleUpdateSequence = useCallback(async (data: { name: string; description?: string; steps: CrmSequenceStep[] }) => {
    if (!editingSequence) return;
    const res = await updateSequence(businessId, editingSequence.id, data);
    if (res.data) {
      setSequences((prev) => prev.map((s) => s.id === editingSequence.id ? { ...s, ...res.data! } : s));
      setEditingSequence(null);
      if (selectedSequence?.id === editingSequence.id) {
        handleViewSequence(editingSequence.id);
      }
    }
  }, [businessId, editingSequence, selectedSequence, handleViewSequence]);

  const handleEditClick = useCallback(async (seq: CrmSequence) => {
    const steps = Array.isArray(seq.steps) ? seq.steps : [];
    setEditingSequence({
      id: seq.id,
      name: seq.name,
      description: seq.description ?? undefined,
      steps: steps.map((s) => ({ ...s })),
    });
  }, []);

  const handleDuplicate = useCallback(async (id: string) => {
    const res = await duplicateSequence(businessId, id);
    if (res.data) {
      setSequences((prev) => [res.data!, ...prev]);
    }
  }, [businessId]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="rounded-2xl border border-border/50 bg-card overflow-hidden"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
          className="w-full flex items-center gap-3 p-4 hover:bg-white/[0.02] transition-colors cursor-pointer"
        >
          <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/15 to-purple-500/5">
            <GitBranch className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-sm font-semibold">Engagement Sequences</h3>
            <p className="text-[10px] text-muted-foreground/60">
              {sequences.length} sequence{sequences.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowBuilder(true); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/20 hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Sequence
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/50" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/50" />}
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-2">
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-xl bg-white/[0.02] animate-pulse" />
                    ))}
                  </div>
                ) : sequences.length === 0 ? (
                  <div className="text-center py-6">
                    <GitBranch className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground/60">No sequences yet. Create one to automate your engagement flow.</p>
                  </div>
                ) : (
                  sequences.map((seq) => (
                    <SequenceCard
                      key={seq.id}
                      sequence={seq}
                      onView={() => handleViewSequence(seq.id)}
                      onDelete={() => handleDeleteRequest(seq.id, seq.name)}
                      onEnroll={() => handleEnrollClick(seq.id)}
                      onEdit={() => handleEditClick(seq)}
                      onDuplicate={() => handleDuplicate(seq.id)}
                      isSelected={selectedSequence?.id === seq.id}
                    />
                  ))
                )}
              </div>

              {selectedSequence && (
                <div className="px-4 pb-4">
                  <SequenceDetailPanel
                    detail={selectedSequence}
                    onClose={() => setSelectedSequence(null)}
                    onAdvance={(enrollmentId) => handleAdvance(selectedSequence.id, enrollmentId)}
                    onUnenroll={(enrollmentId) => handleUnenroll(selectedSequence.id, enrollmentId)}
                    onEnroll={() => handleEnrollClick(selectedSequence.id)}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {showBuilder && (
        <SequenceBuilder
          onClose={() => setShowBuilder(false)}
          onSave={handleCreateSequence}
          mode="create"
        />
      )}

      {editingSequence && (
        <SequenceBuilder
          onClose={() => setEditingSequence(null)}
          onSave={handleUpdateSequence}
          mode="edit"
          initialData={editingSequence}
        />
      )}

      {showContactPicker && (
        <EnrollContactPicker
          businessId={businessId}
          onEnroll={handleEnrollContacts}
          onClose={() => { setShowContactPicker(false); setEnrollSequenceId(null); }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Sequence"
        message={`Are you sure you want to delete "${confirmDelete?.name ?? ""}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
});

const SequenceCard = React.memo(function SequenceCard({
  sequence, onView, onDelete, onEnroll, onEdit, onDuplicate, isSelected,
}: {
  sequence: CrmSequence;
  onView: () => void;
  onDelete: () => void;
  onEnroll: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  isSelected: boolean;
}) {
  const steps = Array.isArray(sequence.steps) ? sequence.steps : [];
  const statusColor = sequence.status === "active"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
    : "bg-muted/50 text-muted-foreground border-border/50";

  return (
    <div
      className={`rounded-xl border p-3 transition-all cursor-pointer hover:bg-white/[0.03] ${
        isSelected ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5" : "border-border/30 bg-white/[0.01]"
      }`}
      onClick={onView}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          {steps.slice(0, 4).map((step: CrmSequenceStep, i: number) => (
            <StepIcon key={i} type={step.type} className="w-3.5 h-3.5" />
          ))}
          {steps.length > 4 && (
            <span className="text-[10px] text-muted-foreground/50">+{steps.length - 4}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{sequence.name}</p>
          <p className="text-[10px] text-muted-foreground/60">
            {steps.length} step{steps.length !== 1 ? "s" : ""} · {sequence.enrollmentCount ?? 0} enrolled
          </p>
        </div>

        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
          {sequence.status}
        </span>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onEnroll}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            title="Enroll contacts"
          >
            <UserPlus className="w-3.5 h-3.5 text-muted-foreground/60" />
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            title="Edit sequence"
          >
            <Pencil className="w-3.5 h-3.5 text-muted-foreground/60" />
          </button>
          <button
            onClick={onDuplicate}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            title="Duplicate sequence"
          >
            <Copy className="w-3.5 h-3.5 text-muted-foreground/60" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            title="Delete sequence"
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
});

type EnrollmentStatusFilter = "all" | "active" | "completed" | "unenrolled";

const SequenceDetailPanel = React.memo(function SequenceDetailPanel({
  detail, onClose, onAdvance, onUnenroll, onEnroll,
}: {
  detail: CrmSequenceDetail;
  onClose: () => void;
  onAdvance: (enrollmentId: string) => void;
  onUnenroll: (enrollmentId: string) => void;
  onEnroll: () => void;
}) {
  const steps = Array.isArray(detail.steps) ? detail.steps : [];
  const [statusFilter, setStatusFilter] = useState<EnrollmentStatusFilter>("all");
  const [confirmUnenroll, setConfirmUnenroll] = useState<{ id: string; name: string } | null>(null);

  const filteredEnrollments = useMemo(() => {
    if (statusFilter === "all") return detail.enrollments;
    return detail.enrollments.filter((e) => e.status === statusFilter);
  }, [detail.enrollments, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { all: detail.enrollments.length, active: 0, completed: 0, unenrolled: 0 };
    for (const e of detail.enrollments) {
      if (e.status === "active") counts.active++;
      else if (e.status === "completed") counts.completed++;
      else if (e.status === "unenrolled") counts.unenrolled++;
    }
    return counts;
  }, [detail.enrollments]);

  const filterTabs: { key: EnrollmentStatusFilter; label: string }[] = [
    { key: "all", label: `All (${statusCounts.all})` },
    { key: "active", label: `Active (${statusCounts.active})` },
    { key: "completed", label: `Done (${statusCounts.completed})` },
    { key: "unenrolled", label: `Left (${statusCounts.unenrolled})` },
  ];

  const handleUnenrollConfirmed = useCallback(() => {
    if (!confirmUnenroll) return;
    onUnenroll(confirmUnenroll.id);
    setConfirmUnenroll(null);
  }, [confirmUnenroll, onUnenroll]);

  return (
    <div className="rounded-xl border border-border/30 bg-white/[0.02] p-3 space-y-3">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold flex-1">{detail.name}</span>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/[0.05]">
          <X className="w-3.5 h-3.5 text-muted-foreground/50" />
        </button>
      </div>

      {detail.description && (
        <p className="text-[10px] text-muted-foreground/60">{detail.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {steps.map((step: CrmSequenceStep, i: number) => (
          <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.03] border border-border/20">
            <StepIcon type={step.type} className="w-3 h-3" />
            <span className="text-[10px] text-muted-foreground/70">
              {STEP_TYPES.find((t) => t.value === step.type)?.label}
            </span>
            {step.delayDays > 0 && (
              <span className="text-[10px] text-muted-foreground/50">+{step.delayDays}d</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Users className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          Enrolled ({detail.enrollments.length})
        </span>
        <button
          onClick={onEnroll}
          className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
        >
          <UserPlus className="w-3 h-3" />
          Enroll
        </button>
      </div>

      {detail.enrollments.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-2 py-1 text-[10px] font-semibold rounded-lg transition-colors ${
                statusFilter === tab.key
                  ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/20"
                  : "text-muted-foreground/60 hover:bg-white/[0.04] border border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {filteredEnrollments.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/50 text-center py-3">
          {detail.enrollments.length === 0 ? "No contacts enrolled yet." : "No enrollments match this filter."}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {filteredEnrollments.map((enrollment) => (
            <div key={enrollment.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/[0.02] transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{enrollment.contactName}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/60">
                    Step {enrollment.currentStep + 1}/{steps.length}
                  </span>
                  <div className="flex-1 h-1 rounded-full bg-white/[0.05] max-w-[60px]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]"
                      style={{ width: `${steps.length > 0 ? ((enrollment.currentStep + 1) / steps.length) * 100 : 0}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    enrollment.status === "completed" ? "bg-emerald-500/15 text-emerald-400"
                    : enrollment.status === "active" ? "bg-blue-500/15 text-blue-400"
                    : "bg-muted/50 text-muted-foreground"
                  }`}>
                    {enrollment.status}
                  </span>
                </div>
              </div>
              {enrollment.status === "active" && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onAdvance(enrollment.id)}
                    className="p-1 rounded-lg hover:bg-emerald-500/10 transition-colors"
                    title="Advance to next step"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  </button>
                  <button
                    onClick={() => setConfirmUnenroll({ id: enrollment.id, name: enrollment.contactName })}
                    className="p-1 rounded-lg hover:bg-red-500/10 transition-colors"
                    title="Unenroll"
                  >
                    <X className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmUnenroll}
        title="Unenroll Contact"
        message={`Are you sure you want to unenroll "${confirmUnenroll?.name ?? ""}" from this sequence?`}
        confirmLabel="Unenroll"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleUnenrollConfirmed}
        onCancel={() => setConfirmUnenroll(null)}
      />
    </div>
  );
});

function SequenceBuilder({
  onClose, onSave, mode, initialData,
}: {
  onClose: () => void;
  onSave: (data: { name: string; description?: string; steps: CrmSequenceStep[] }) => void;
  mode: "create" | "edit";
  initialData?: { name: string; description?: string; steps: CrmSequenceStep[] };
}) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [steps, setSteps] = useState<CrmSequenceStep[]>(
    initialData?.steps?.length
      ? initialData.steps.map((s) => ({ ...s }))
      : [{ stepNumber: 1, type: "email", delayDays: 0, subject: "", template: "" }]
  );
  const [showTemplates, setShowTemplates] = useState(mode === "create" && !initialData);

  const addStep = useCallback(() => {
    setSteps((prev) => [
      ...prev,
      { stepNumber: prev.length + 1, type: "email", delayDays: 1, subject: "", template: "" },
    ]);
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepNumber: i + 1 })));
  }, []);

  const updateStep = useCallback((index: number, updates: Partial<CrmSequenceStep>) => {
    setSteps((prev) => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  }, []);

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const newSteps = [...prev];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= newSteps.length) return prev;
      [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
      return newSteps.map((s, i) => ({ ...s, stepNumber: i + 1 }));
    });
  }, []);

  const applyTemplate = useCallback((template: typeof TEMPLATES[0]) => {
    setName(template.name);
    setDescription(template.description);
    setSteps(template.steps.map((s) => ({ ...s })));
    setShowTemplates(false);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim() || undefined, steps });
  }, [name, description, steps, onSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3 }}
        className="bg-popover/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/15 to-purple-500/5">
            <GitBranch className="w-4 h-4 text-purple-400" />
          </div>
          <h2 className="text-base font-semibold flex-1">
            {mode === "edit" ? "Edit Sequence" : "Create Sequence"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.05]">
            <X className="w-4 h-4 text-muted-foreground/50" />
          </button>
        </div>

        {showTemplates && (
          <div className="mb-4 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">Start from a template</p>
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.name}
                onClick={() => applyTemplate(tmpl)}
                className="w-full text-left p-3 rounded-xl border border-border/30 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <p className="text-xs font-semibold">{tmpl.name}</p>
                <p className="text-[10px] text-muted-foreground/60">{tmpl.description} · {tmpl.steps.length} steps</p>
              </button>
            ))}
            <div className="text-center">
              <button
                onClick={() => setShowTemplates(false)}
                className="text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                or start from scratch
              </button>
            </div>
          </div>
        )}

        {!showTemplates && (
          <>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1 block">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., New Lead Onboarding"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-border/30 focus:border-[hsl(var(--kf-accent1))]/50 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1 block">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white/[0.03] border border-border/30 focus:border-[hsl(var(--kf-accent1))]/50 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Steps</span>
                <span className="text-[10px] text-muted-foreground/50">({steps.length})</span>
              </div>

              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="rounded-xl border border-border/30 bg-white/[0.02] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-muted-foreground/50 w-5 text-center">{i + 1}</span>

                      <select
                        value={step.type}
                        onChange={(e) => updateStep(i, { type: e.target.value as CrmSequenceStep["type"] })}
                        className="text-xs px-2 py-1.5 rounded-lg bg-white/[0.03] border border-border/30 focus:outline-none"
                      >
                        {STEP_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>

                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground/50" />
                        <input
                          type="number"
                          min={0}
                          value={step.delayDays}
                          onChange={(e) => updateStep(i, { delayDays: parseInt(e.target.value) || 0 })}
                          className="w-12 text-xs px-1.5 py-1 rounded-lg bg-white/[0.03] border border-border/30 focus:outline-none text-center"
                        />
                        <span className="text-[10px] text-muted-foreground/50">days</span>
                      </div>

                      <div className="ml-auto flex items-center gap-0.5">
                        <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-white/[0.05] disabled:opacity-30">
                          <ArrowUp className="w-3 h-3 text-muted-foreground/50" />
                        </button>
                        <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="p-1 rounded hover:bg-white/[0.05] disabled:opacity-30">
                          <ArrowDown className="w-3 h-3 text-muted-foreground/50" />
                        </button>
                        {steps.length > 1 && (
                          <button onClick={() => removeStep(i)} className="p-1 rounded hover:bg-red-500/10">
                            <Trash2 className="w-3 h-3 text-muted-foreground/50 hover:text-red-400" />
                          </button>
                        )}
                      </div>
                    </div>

                    {(step.type === "email" || step.type === "whatsapp") && (
                      <div className="space-y-1.5 pl-7">
                        {step.type === "email" && (
                          <input
                            value={step.subject || ""}
                            onChange={(e) => updateStep(i, { subject: e.target.value })}
                            placeholder="Subject line"
                            className="w-full text-[10px] px-2 py-1.5 rounded-lg bg-white/[0.03] border border-border/20 focus:outline-none"
                          />
                        )}
                        <textarea
                          value={step.template || ""}
                          onChange={(e) => updateStep(i, { template: e.target.value })}
                          placeholder="Message template..."
                          rows={2}
                          className="w-full text-[10px] px-2 py-1.5 rounded-lg bg-white/[0.03] border border-border/20 focus:outline-none resize-none"
                        />
                      </div>
                    )}

                    {step.type === "call" && (
                      <div className="pl-7">
                        <input
                          value={step.notes || ""}
                          onChange={(e) => updateStep(i, { notes: e.target.value })}
                          placeholder="Call notes / talking points"
                          className="w-full text-[10px] px-2 py-1.5 rounded-lg bg-white/[0.03] border border-border/20 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={addStep}
                className="w-full mt-2 py-2 text-[10px] font-semibold rounded-lg border border-dashed border-border/30 text-muted-foreground/60 hover:text-foreground hover:border-border/50 transition-colors"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Add Step
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-border/30 text-muted-foreground hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!name.trim()}
                className="flex-1 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {mode === "edit" ? "Save Changes" : "Create Sequence"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

function EnrollContactPicker({
  businessId, onEnroll, onClose,
}: {
  businessId: string;
  onEnroll: (contactIds: string[]) => void;
  onClose: () => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetchContacts(businessId, { take: 100, search: debouncedSearch.trim() || undefined });
      if (!cancelled && res.data) setContacts(res.data);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId, debouncedSearch]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-popover/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-border/30">
          <UserPlus className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold flex-1">Enroll Contacts</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/[0.05]">
            <X className="w-4 h-4 text-muted-foreground/50" />
          </button>
        </div>

        <div className="px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-white/[0.03] border border-border/30 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-1">
          {loading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-lg bg-white/[0.02] animate-pulse" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 text-center py-4">No contacts found.</p>
          ) : (
            contacts.map((c) => {
              const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
              const isSelected = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors text-left ${
                    isSelected ? "bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/20" : "hover:bg-white/[0.03] border border-transparent"
                  }`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    isSelected ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]" : "border-border/50"
                  }`}>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{name}</p>
                    {c.email && <p className="text-[10px] text-muted-foreground/50 truncate">{c.email}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground/50">{c.status}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-border/30 flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/50 flex-1">{selected.size} selected</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border/30 text-muted-foreground hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onEnroll(Array.from(selected))}
            disabled={selected.size === 0}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            Enroll ({selected.size})
          </button>
        </div>
      </motion.div>
    </div>
  );
}
