"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FormInput,
  Plus,
  Trash2,
  Archive,
  RotateCcw,
  GripVertical,
  ChevronDown,
  AlertCircle,
  Check,
  X,
  Loader2,
  Type,
  Hash,
  Calendar,
  List,
  CheckSquare,
  Link,
  Mail,
  Text,
} from "lucide-react";
import {
  fetchCustomFieldDefinitions,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  archiveCustomFieldDefinition,
  restoreCustomFieldDefinition,
  deleteCustomFieldDefinition,
  type CustomFieldDefinition,
} from "@/lib/client";
import { toast } from "sonner";

const FIELD_TYPES = [
  { value: "TEXT", label: "Text", icon: Type },
  { value: "TEXTAREA", label: "Textarea", icon: Text },
  { value: "NUMBER", label: "Number", icon: Hash },
  { value: "DATE", label: "Date", icon: Calendar },
  { value: "SELECT", label: "Select", icon: List },
  { value: "MULTI_SELECT", label: "Multi Select", icon: List },
  { value: "CHECKBOX", label: "Checkbox", icon: CheckSquare },
  { value: "URL", label: "URL", icon: Link },
  { value: "EMAIL", label: "Email", icon: Mail },
] as const;

type FieldType = (typeof FIELD_TYPES)[number]["value"];

interface FormState {
  name: string;
  label: string;
  type: FieldType;
  description: string;
  placeholder: string;
  options: string;
  required: boolean;
  order: number;
}

const DEFAULT_FORM: FormState = {
  name: "",
  label: "",
  type: "TEXT",
  description: "",
  placeholder: "",
  options: "",
  required: false,
  order: 0,
};

export default function CustomFieldsSettingsPage() {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchCustomFieldDefinitions(undefined, { includeArchived: showArchived });
    if (res.data) {
      setDefinitions(res.data);
    } else {
      toast.error(res.error ?? "Failed to load custom fields");
    }
    setLoading(false);
  }, [showArchived]);

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, [load]);

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
  };

  const startEdit = (def: CustomFieldDefinition) => {
    const optionItems =
      def.options && typeof def.options === "object"
        ? (def.options as Record<string, unknown>).options
        : undefined;
    setEditingId(def.id);
    setForm({
      name: def.name,
      label: def.label,
      type: def.type as FieldType,
      description: def.description ?? "",
      placeholder: def.placeholder ?? "",
      options: Array.isArray(optionItems)
        ? optionItems
            .map((o) => `${(o as { label: string; value: string }).label}:${(o as { label: string; value: string }).value}`)
            .join("\n")
        : "",
      required: def.required,
      order: def.order,
    });
  };

  const parseOptions = (raw: string): Record<string, unknown> | undefined => {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return undefined;
    const options = lines.map((line) => {
      const [label, value] = line.includes(":") ? line.split(":", 2) : [line, line];
      return { label: label.trim(), value: value.trim() };
    });
    return { options };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label.trim()) {
      toast.error("Label is required");
      return;
    }
    setIsSubmitting(true);

    const payload = {
      name: form.name.trim() || form.label.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
      label: form.label.trim(),
      type: form.type,
      description: form.description.trim() || undefined,
      placeholder: form.placeholder.trim() || undefined,
      options: ["SELECT", "MULTI_SELECT"].includes(form.type) ? parseOptions(form.options) : undefined,
      required: form.required,
      order: form.order,
    };

    if (editingId) {
      const res = await updateCustomFieldDefinition(editingId, payload);
      if (res.data) {
        toast.success("Custom field updated");
        resetForm();
        load();
      } else {
        toast.error(res.error ?? "Failed to update");
      }
    } else {
      const res = await createCustomFieldDefinition(payload as Omit<CustomFieldDefinition, "id" | "businessId" | "createdAt" | "updatedAt" | "archivedAt">);
      if (res.data) {
        toast.success("Custom field created");
        resetForm();
        load();
      } else {
        toast.error(res.error ?? "Failed to create");
      }
    }
    setIsSubmitting(false);
  };

  const handleArchive = async (id: string) => {
    const res = await archiveCustomFieldDefinition(id);
    if (res.data) {
      toast.success("Archived");
      load();
    } else {
      toast.error(res.error ?? "Failed to archive");
    }
  };

  const handleRestore = async (id: string) => {
    const res = await restoreCustomFieldDefinition(id);
    if (res.data) {
      toast.success("Restored");
      load();
    } else {
      toast.error(res.error ?? "Failed to restore");
    }
  };

  const handleDelete = async (id: string) => {
    const res = await deleteCustomFieldDefinition(id);
    if (res.error === null) {
      toast.success("Deleted permanently");
      setDeleteConfirmId(null);
      load();
    } else {
      toast.error(res.error ?? "Failed to delete");
    }
  };

  const activeDefs = definitions.filter((d) => !d.archivedAt);
  const archivedDefs = definitions.filter((d) => d.archivedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FormInput className="h-5 w-5 text-muted-foreground" />
            Custom Fields
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Define structured attributes for your contacts. These appear in contact forms and detail pages.
          </p>
        </div>
        <button
          onClick={() => setShowArchived((s) => !s)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      </div>

      {/* Create / Edit Form */}
      <motion.form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border/60 bg-background/60 backdrop-blur-sm p-5 space-y-4"
        layout
      >
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
          {editingId ? "Edit Custom Field" : "New Custom Field"}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Label *</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Birthday"
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Machine Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="auto-generated from label"
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type *</label>
            <div className="relative">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as FieldType }))}
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Order</label>
            <input
              type="number"
              min={0}
              value={form.order}
              onChange={(e) => setForm((f) => ({ ...f, order: parseInt(e.target.value) || 0 }))}
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Help text shown under the field"
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Placeholder</label>
            <input
              type="text"
              value={form.placeholder}
              onChange={(e) => setForm((f) => ({ ...f, placeholder: e.target.value }))}
              placeholder="Input placeholder"
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {["SELECT", "MULTI_SELECT"].includes(form.type) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="space-y-1.5"
          >
            <label className="text-xs font-medium text-muted-foreground">Options (one per line, format: Label:Value)</label>
            <textarea
              value={form.options}
              onChange={(e) => setForm((f) => ({ ...f, options: e.target.value }))}
              placeholder={"Option 1:value1\nOption 2:value2"}
              rows={4}
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
          </motion.div>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.required}
            onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
            className="rounded border-border/60"
          />
          Required field
        </label>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {editingId ? "Update Field" : "Create Field"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          )}
        </div>
      </motion.form>

      {/* Active Fields List */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Active Fields ({activeDefs.length})
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : activeDefs.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-muted/20 p-8 text-center">
            <FormInput className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No custom fields defined yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Create your first field above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {activeDefs.map((def) => (
                <motion.div
                  key={def.id}
                  layout
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="group rounded-2xl border border-border/40 bg-background/40 backdrop-blur-sm p-4 hover:border-border/80 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <GripVertical className="h-5 w-5 text-muted-foreground/40 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{def.label}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono uppercase">
                          {def.type}
                        </span>
                        {def.required && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive font-medium">
                            Required
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 font-mono">{def.name}</div>
                      {def.description && (
                        <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(def)}
                        className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Type className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleArchive(def.id)}
                        className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Archive"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(def.id)}
                        className="p-2 rounded-xl hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Archived Fields */}
      {showArchived && archivedDefs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Archived Fields ({archivedDefs.length})
          </h3>
          <div className="space-y-2">
            {archivedDefs.map((def) => (
              <div
                key={def.id}
                className="rounded-2xl border border-border/40 bg-muted/20 p-4 opacity-70"
              >
                <div className="flex items-start gap-3">
                  <GripVertical className="h-5 w-5 text-muted-foreground/30 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm line-through">{def.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono uppercase">
                        {def.type}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">{def.name}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleRestore(def.id)}
                      className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Restore"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(def.id)}
                      className="p-2 rounded-xl hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete permanently"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AnimatePresence>
        {deleteConfirmId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setDeleteConfirmId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-xl space-y-4"
            >
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <h3 className="text-lg font-semibold">Delete Permanently?</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                This will permanently delete the custom field definition and all associated values on contacts. This action cannot be undone.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="rounded-xl border border-border/60 px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirmId)}
                  className="rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
