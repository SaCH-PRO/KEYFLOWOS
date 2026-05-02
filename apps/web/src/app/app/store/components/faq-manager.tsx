"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HelpCircle,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Loader2,
  GripVertical,
  Edit3,
  Check,
  X,
} from "lucide-react";
import type { StorefrontConfig, FaqEntry } from "@/lib/client";

type Props = {
  config: StorefrontConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

export function FaqManager({ config, onConfigChange, onSave, saving }: Props) {
  const faqEntries: FaqEntry[] = config.faqEntries ?? [];
  const [showForm, setShowForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");

  const updateEntries = useCallback(
    (entries: FaqEntry[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
      onConfigChange("faqEntries", entries as any);
    },
    [onConfigChange]
  );

  function addEntry() {
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    const entry: FaqEntry = {
      id: `faq_${Date.now()}`,
      question: newQuestion.trim(),
      answer: newAnswer.trim(),
      order: faqEntries.length,
    };
    updateEntries([...faqEntries, entry]);
    setNewQuestion("");
    setNewAnswer("");
    setShowForm(false);
  }

  function deleteEntry(id: string) {
    updateEntries(faqEntries.filter((e) => e.id !== id));
  }

  function moveEntry(idx: number, direction: "up" | "down") {
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= faqEntries.length) return;
    const updated = [...faqEntries];
    [updated[idx], updated[swap]] = [updated[swap], updated[idx]];
    updateEntries(updated.map((e, i) => ({ ...e, order: i })));
  }

  function startEdit(entry: FaqEntry) {
    setEditingId(entry.id);
    setEditQuestion(entry.question);
    setEditAnswer(entry.answer);
  }

  function saveEdit() {
    if (!editingId) return;
    updateEntries(
      faqEntries.map((e) =>
        e.id === editingId ? { ...e, question: editQuestion.trim(), answer: editAnswer.trim() } : e
      )
    );
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent2) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent2) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent2) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}
          >
            <HelpCircle className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">FAQ Manager</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {faqEntries.length} question{faqEntries.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save FAQ"}
        </button>
      </div>

      <div className="p-5 space-y-3">
        {faqEntries.length === 0 && !showForm && (
          <div
            className="text-center py-8 rounded-xl"
            style={{
              background: "hsl(var(--kf-muted) / 0.2)",
              border: "1px dashed hsl(var(--kf-border) / 0.5)",
            }}
          >
            <HelpCircle
              className="w-8 h-8 mx-auto mb-2"
              style={{ color: "hsl(var(--kf-muted-foreground) / 0.3)" }}
            />
            <p className="text-xs text-muted-foreground">
              No FAQs yet. Add questions your customers commonly ask.
            </p>
          </div>
        )}

        <AnimatePresence>
          {faqEntries.map((entry, idx) => (
            <motion.div
              key={entry.id}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="rounded-xl px-4 py-3"
              style={{
                background: "hsl(var(--kf-accent2) / 0.04)",
                border: "1px solid hsl(var(--kf-accent2) / 0.12)",
              }}
            >
              {editingId === entry.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editQuestion}
                    onChange={(e) => setEditQuestion(e.target.value)}
                    className="kf-input w-full text-sm"
                    placeholder="Question"
                  />
                  <textarea
                    value={editAnswer}
                    onChange={(e) => setEditAnswer(e.target.value)}
                    className="kf-input w-full text-sm min-h-[60px] resize-none"
                    rows={2}
                    placeholder="Answer"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveEdit}
                      disabled={!editQuestion.trim() || !editAnswer.trim()}
                      className="kf-btn-primary text-xs inline-flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button onClick={cancelEdit} className="kf-btn-secondary text-xs inline-flex items-center gap-1">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" style={{ opacity: 0.4 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{entry.question}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{entry.answer}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => moveEntry(idx, "up")}
                      disabled={idx === 0}
                      className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors disabled:opacity-30"
                    >
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => moveEntry(idx, "down")}
                      disabled={idx === faqEntries.length - 1}
                      className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors disabled:opacity-30"
                    >
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => startEdit(entry)}
                      className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => deleteEntry(entry.id)}
                      className="p-1 rounded-md hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div
                className="rounded-xl p-4 space-y-3"
                style={{
                  background: "hsl(var(--kf-accent2) / 0.06)",
                  border: "1px solid hsl(var(--kf-accent2) / 0.15)",
                }}
              >
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Question</label>
                  <input
                    type="text"
                    value={newQuestion}
                    onChange={(e) => setNewQuestion(e.target.value)}
                    placeholder="What do customers often ask?"
                    className="kf-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Answer</label>
                  <textarea
                    value={newAnswer}
                    onChange={(e) => setNewAnswer(e.target.value)}
                    placeholder="Provide a helpful answer..."
                    className="kf-input w-full text-sm min-h-[80px] resize-none"
                    rows={3}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={addEntry}
                    disabled={!newQuestion.trim() || !newAnswer.trim()}
                    className="kf-btn-primary text-xs"
                    style={{
                      opacity: !newQuestion.trim() || !newAnswer.trim() ? 0.5 : 1,
                    }}
                  >
                    Add FAQ
                  </button>
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setNewQuestion("");
                      setNewAnswer("");
                    }}
                    className="kf-btn-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="kf-btn-secondary text-xs inline-flex items-center gap-1.5 w-full justify-center"
        >
          <Plus className="w-3.5 h-3.5" />
          Add FAQ Entry
        </button>

        {faqEntries.length > 0 && (
          <div
            className="rounded-xl p-4 space-y-2"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
            }}
          >
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Preview</p>
            {faqEntries.slice(0, 3).map((entry) => (
              <div key={entry.id} className="space-y-0.5">
                <p className="text-xs font-medium">{entry.question}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-1">{entry.answer}</p>
              </div>
            ))}
            {faqEntries.length > 3 && (
              <p className="text-[10px] text-muted-foreground">+{faqEntries.length - 3} more</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
