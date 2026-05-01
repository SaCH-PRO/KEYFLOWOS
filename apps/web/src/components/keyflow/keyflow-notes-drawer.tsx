"use client";

import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Sparkles,
  Pin,
  PinOff,
  Trash2,
  Save,
  RefreshCw,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchKeyflowNotes,
  createKeyflowNote,
  updateKeyflowNote,
  deleteKeyflowNote,
  generateKeyflowNoteBrief,
  type KeyflowNote,
} from "@/lib/client";

export interface KeyflowNotesTarget {
  type: string;
  id: string;
  label: string;
}

interface Props {
  businessId: string;
  open: boolean;
  target: KeyflowNotesTarget | null;
  onClose: () => void;
}

export function KeyflowNotesDrawer({ businessId, open, target, onClose }: Props) {
  const [notes, setNotes] = useState<KeyflowNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [briefingId, setBriefingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    const res = await fetchKeyflowNotes(businessId, target.type, target.id);
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setNotes(res.data?.items ?? []);
  }, [businessId, target]);

  useEffect(() => {
    if (!open || !target) return;
    setDraft("");
    void load();
  }, [open, target, load]);

  const handleSave = async () => {
    if (!target || !draft.trim()) return;
    setSaving(true);
    const res = await createKeyflowNote(businessId, {
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label,
      body: draft.trim(),
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Note saved");
    setDraft("");
    void load();
  };

  const togglePinned = async (note: KeyflowNote) => {
    const res = await updateKeyflowNote(businessId, note.id, { pinned: !note.pinned });
    if (res.error) {
      toast.error(res.error);
      return;
    }
    void load();
  };

  const remove = async (note: KeyflowNote) => {
    if (!confirm("Delete this note?")) return;
    const res = await deleteKeyflowNote(businessId, note.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Note deleted");
    void load();
  };

  const generateBrief = async (note: KeyflowNote) => {
    setBriefingId(note.id);
    const res = await generateKeyflowNoteBrief(businessId, note.id);
    setBriefingId(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("AI brief ready");
    void load();
  };

  return (
    <AnimatePresence>
      {open && target && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[55]"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[460px] z-[56] flex flex-col"
            style={{
              background: "hsl(var(--card))",
              borderLeft: "1px solid hsl(var(--border))",
            }}
          >
            <div className="p-4 border-b border-border flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent1)/0.2), hsl(var(--kf-accent2)/0.2))",
                }}
              >
                <StickyNote
                  className="w-4 h-4"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Keyflow Notes · {target.type.replace(/_/g, " ")}
                </div>
                <div className="text-sm font-semibold truncate">{target.label}</div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-muted/50 flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 border-b border-border space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Capture a quick note or instruction…"
                rows={3}
                className="kf-input w-full text-sm resize-none"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={!draft.trim() || saving}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                  style={{
                    background:
                      "linear-gradient(to right, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    color: "white",
                  }}
                >
                  {saving ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  Save note
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Loading notes…
                </div>
              ) : notes.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">
                  No notes yet. Capture the first one above.
                </div>
              ) : (
                notes.map((n) => (
                  <div
                    key={n.id}
                    className="kf-card p-3 space-y-2"
                    style={
                      n.pinned
                        ? {
                            border: "1px solid hsl(var(--kf-accent1) / 0.4)",
                            background: "hsl(var(--kf-accent1) / 0.04)",
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => togglePinned(n)}
                          className="p-1 rounded hover:bg-muted/50"
                          aria-label={n.pinned ? "Unpin" : "Pin"}
                        >
                          {n.pinned ? (
                            <PinOff className="w-3 h-3" />
                          ) : (
                            <Pin className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          onClick={() => remove(n)}
                          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{n.body}</div>
                    {n.aiBrief ? (
                      <div
                        className="p-2 rounded-lg text-xs"
                        style={{
                          background:
                            "linear-gradient(to right, hsl(var(--kf-accent1)/0.08), hsl(var(--kf-accent2)/0.08))",
                          border: "1px solid hsl(var(--kf-accent1)/0.2)",
                        }}
                      >
                        <div className="flex items-center gap-1 mb-1">
                          <Sparkles
                            className="w-3 h-3"
                            style={{ color: "hsl(var(--kf-accent1))" }}
                          />
                          <span
                            className="text-[10px] uppercase tracking-wide font-semibold"
                            style={{ color: "hsl(var(--kf-accent1))" }}
                          >
                            AI Brief
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap">{n.aiBrief}</div>
                      </div>
                    ) : (
                      <button
                        onClick={() => generateBrief(n)}
                        disabled={briefingId === n.id}
                        className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        {briefingId === n.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        Generate AI brief
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
