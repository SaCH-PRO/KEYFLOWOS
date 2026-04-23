"use client";

import { useState } from "react";
import { MessageSquare, Plus, Trash2, Clock } from "lucide-react";

interface NotesTabProps {
  notes: string[];
  onNotesChange: (notes: string[]) => void;
}

export function NotesTab({ notes, onNotesChange }: NotesTabProps) {
  const [newNote, setNewNote] = useState("");

  const handleAdd = () => {
    if (!newNote.trim()) return;
    onNotesChange([newNote.trim(), ...notes]);
    setNewNote("");
  };

  const handleDelete = (index: number) => {
    onNotesChange(notes.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-card p-3 space-y-2">
        <textarea
          data-note-input
          placeholder="Add a project note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          rows={3}
          className="w-full bg-transparent text-sm focus:outline-none resize-none placeholder:text-muted-foreground/50"
        />
        <div className="flex justify-end">
          <button
            onClick={handleAdd}
            disabled={!newNote.trim()}
            className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add Note
          </button>
        </div>
      </div>

      {notes.length === 0 && (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
          <MessageSquare className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No notes yet</p>
          <p className="text-xs text-muted-foreground mt-1">Add meeting notes, client feedback, or internal reminders.</p>
          <button
            onClick={() => {
              const input = document.querySelector<HTMLTextAreaElement>('[data-note-input]');
              if (input) input.focus();
            }}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add a note
          </button>
        </div>
      )}

      <div className="space-y-2">
        {notes.map((note, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/40 bg-card p-4 group hover:border-border/60 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--kf-info) / 0.1)" }}>
                <MessageSquare className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-info))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{note}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Clock className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[10px] text-muted-foreground/50">Note #{notes.length - i}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(i)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity shrink-0"
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
