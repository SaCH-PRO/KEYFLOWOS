"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Plus, Trash2, Clock, RefreshCw } from "lucide-react";
import {
  fetchKeyflowNotes,
  createKeyflowNote,
  deleteKeyflowNote,
  type KeyflowNote,
} from "@/lib/client";
import { toast } from "sonner";

interface NotesTabProps {
  businessId?: string | null;
  projectId: string;
  projectName?: string;
  onNotesChange?: (notes: string[]) => void;
}

export function NotesTab({
  businessId,
  projectId,
  projectName,
  onNotesChange,
}: NotesTabProps) {
  const [notes, setNotes] = useState<KeyflowNote[]>([]);
  // Derived, not set in the effect. True when there is a business to load for,
  // because the effect below fetches immediately and a component that renders
  // "no notes yet" for one frame before its first fetch resolves is telling the
  // user something untrue. False when there is nothing to fetch, so the empty
  // state is correct straight away and the effect has no state to set
  // synchronously — which is what react-hooks/set-state-in-effect is about.
  const [loading, setLoading] = useState(Boolean(businessId));
  const [saving, setSaving] = useState(false);
  const [newNote, setNewNote] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    // Deliberately NOT setLoading(true) here. load() is called from an effect,
    // so everything before its first await runs synchronously during that
    // effect — which is the cascading render react-hooks/set-state-in-effect
    // exists to catch. The initial state already says "loading", and the
    // refresh button below owns its own indicator.
    const res = await fetchKeyflowNotes(businessId, "Project", projectId);
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    const items = res.data?.items ?? [];
    setNotes(items);
    onNotesChange?.(items.map((n) => n.body));
  }, [businessId, projectId, onNotesChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration: load() sets state only AFTER its first await, which this rule does not model
    void load();
  }, [load]);

  const handleAdd = async () => {
    if (!businessId || !newNote.trim()) return;
    setSaving(true);
    const res = await createKeyflowNote(businessId, {
      targetType: "Project",
      targetId: projectId,
      targetLabel: projectName || "Project",
      body: newNote.trim(),
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Note saved");
    setNewNote("");
    void load();
  };

  const handleDelete = async (note: KeyflowNote) => {
    if (!businessId) return;
    if (!confirm("Delete this note?")) return;
    const res = await deleteKeyflowNote(businessId, note.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Note deleted");
    void load();
  };

  const disabled = !businessId || saving;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-card p-3 space-y-2">
        <textarea
          data-note-input
          placeholder="Add a project note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          rows={3}
          disabled={!businessId}
          className="w-full bg-transparent text-sm focus:outline-none resize-none placeholder:text-muted-foreground/50 disabled:opacity-50"
        />
        <div className="flex justify-end">
          <button
            onClick={handleAdd}
            disabled={disabled || !newNote.trim()}
            className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1"
          >
            {saving ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            Add Note
          </button>
        </div>
      </div>

      {loading && notes.length === 0 && (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
          Loading notes…
        </div>
      )}

      {!loading && notes.length === 0 && (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
          <MessageSquare className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No notes yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add meeting notes, client feedback, or internal reminders.
          </p>
          {businessId && (
            <button
              onClick={() => {
                const input = document.querySelector<HTMLTextAreaElement>("[data-note-input]");
                if (input) input.focus();
              }}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add a note
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {notes.map((note) => (
          <div
            key={note.id}
            className="rounded-xl border border-border/40 bg-card p-4 group hover:border-border/60 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "hsl(var(--kf-info) / 0.1)" }}
              >
                <MessageSquare className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-info))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {note.body}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Clock className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[10px] text-muted-foreground/50">
                    {new Date(note.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(note)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity shrink-0"
                aria-label="Delete note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
