"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Copy,
  MessageCircle,
  Pin,
  PinOff,
  ListPlus,
  StickyNote,
  Check,
  Trash2,
  ChevronDown,
  Pencil,
  X,
} from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactDetailData, ContactNote } from "./contact-detail";
import {
  NOTE_CATEGORIES,
  NOTE_TEMPLATES,
  getCategoryConfig,
  type NoteCategory,
} from "./tab-constants";
import { AiNoteAnalyzeButton } from "./ai-note-intelligence";

interface NotesTabPanelProps {
  contact: ContactDetailData;
  notes: ContactNote[];
  onAddNote?: (body: string, source?: string) => Promise<void>;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onUpdateNote?: (noteId: string, data: { body?: string; source?: string }) => Promise<void>;
}

export function NotesTabPanel({ contact, notes, onAddNote, onAddTask, onDeleteNote, onUpdateNote }: NotesTabPanelProps) {
  const [newNote, setNewNote] = useState("");
  const [noteCategory, setNoteCategory] = useState<NoteCategory>("general");
  const [composerOpen, setComposerOpen] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [notesLimit, setNotesLimit] = useState(20);
  const [noteSearch, setNoteSearch] = useState("");
  const [noteFilter, setNoteFilter] = useState<NoteCategory | "all">("all");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [taskCreatedId, setTaskCreatedId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteBody, setEditNoteBody] = useState("");
  const [editNoteCategory, setEditNoteCategory] = useState<NoteCategory>("general");
  const [editNoteLoading, setEditNoteLoading] = useState(false);

  const waPhone = getContactPhone(contact);

  const startEditNote = (note: ContactNote) => {
    setEditingNoteId(note.id);
    setEditNoteBody(note.body);
    setEditNoteCategory((note.source as NoteCategory) || "general");
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditNoteBody("");
    setEditNoteCategory("general");
  };

  const handleSaveEditNote = async () => {
    if (!editingNoteId || !editNoteBody.trim() || !onUpdateNote) return;
    setEditNoteLoading(true);
    try {
      await onUpdateNote(editingNoteId, { body: editNoteBody.trim(), source: editNoteCategory });
      cancelEditNote();
      toast.success("Note updated");
    } catch {
      toast.error("Failed to update note");
    } finally {
      setEditNoteLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !onAddNote) return;
    setNoteLoading(true);
    try {
      await onAddNote(newNote.trim(), noteCategory);
      setNewNote("");
      setNoteCategory("general");
      setComposerOpen(false);
    } catch {
      toast.error("Failed to save note");
    } finally {
      setNoteLoading(false);
    }
  };

  const applyTemplate = (template: (typeof NOTE_TEMPLATES)[number]) => {
    setNoteCategory(template.category);
    setNewNote(template.body.replace("{name}", contact.firstName || "contact"));
    setComposerOpen(true);
  };

  const togglePin = (noteId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
      return next;
    });
  };

  const handleCopyNote = (noteId: string, body: string) => {
    navigator.clipboard.writeText(body);
    setCopiedId(noteId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShareWhatsApp = (body: string) => {
    if (!waPhone) return;
    window.open(buildWhatsAppLink(waPhone, body), "_blank");
  };

  const handleCreateTaskFromNote = async (noteId: string, body: string) => {
    if (!onAddTask) return;
    const title = body.length > 80 ? body.slice(0, 77) + "..." : body;
    try {
      await onAddTask(`Note: ${title}`, { priority: "NORMAL" });
      setTaskCreatedId(noteId);
      setTimeout(() => setTaskCreatedId(null), 2000);
    } catch {
      toast.error("Failed to create task from note");
    }
  };

  const filteredNotes = useMemo(() => {
    let result = [...notes];
    if (noteFilter !== "all") {
      result = result.filter((n) => getCategoryConfig(n.source).key === noteFilter);
    }
    if (noteSearch.trim()) {
      const q = noteSearch.toLowerCase();
      result = result.filter((n) => n.body.toLowerCase().includes(q));
    }
    const pinned = result.filter((n) => pinnedIds.has(n.id));
    const unpinned = result.filter((n) => !pinnedIds.has(n.id));
    return [...pinned, ...unpinned];
  }, [notes, noteFilter, noteSearch, pinnedIds]);

  const activeCategoryCount = useMemo(() => {
    const counts: Record<string, number> = {};
    notes.forEach((n) => {
      const cat = getCategoryConfig(n.source);
      counts[cat.key] = (counts[cat.key] || 0) + 1;
    });
    return counts;
  }, [notes]);

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search notes..."
            value={noteSearch}
            onChange={(e) => setNoteSearch(e.target.value)}
            className="kf-input w-full pl-8 text-sm h-8"
          />
        </div>
        {!composerOpen && onAddNote && (
          <button
            onClick={() => setComposerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3.5 h-3.5" />
            Note
          </button>
        )}
      </div>

      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setNoteFilter("all")}
          className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
            noteFilter === "all"
              ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          All ({notes.length})
        </button>
        {NOTE_CATEGORIES.map((cat) => {
          const count = activeCategoryCount[cat.key] || 0;
          if (count === 0 && noteFilter !== cat.key) return null;
          return (
            <button
              key={cat.key}
              onClick={() => setNoteFilter(noteFilter === cat.key ? "all" : cat.key)}
              className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                noteFilter === cat.key ? `${cat.bg} ${cat.color}` : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <cat.icon className="w-2.5 h-2.5" />
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {composerOpen && onAddNote && (
        <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex gap-1 flex-wrap">
                {NOTE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => setNoteCategory(cat.key)}
                    className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors ${
                      noteCategory === cat.key
                        ? `${cat.bg} ${cat.color} ring-1 ring-current/30`
                        : "bg-muted/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <cat.icon className="w-2.5 h-2.5" />
                    {cat.label}
                  </button>
                ))}
              </div>
              <button onClick={() => { setComposerOpen(false); setNewNote(""); }} className="text-muted-foreground hover:text-foreground text-xs px-1.5">
                Cancel
              </button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {NOTE_TEMPLATES.map((t) => (
                <button key={t.label} onClick={() => applyTemplate(t)} className="text-[10px] px-2 py-1 rounded-md bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              placeholder="Write a note..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="kf-input w-full min-h-[80px] resize-none text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAddNote(); }
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {typeof navigator !== "undefined" && navigator?.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to save
              </span>
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim() || noteLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {noteLoading ? "Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {filteredNotes.length === 0 ? (
        <div className="text-center py-6 space-y-2">
          <StickyNote className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {noteSearch || noteFilter !== "all" ? "No matching notes" : "No notes yet"}
          </p>
          {!composerOpen && noteFilter === "all" && !noteSearch && onAddNote && (
            <button onClick={() => setComposerOpen(true)} className="text-xs text-[hsl(var(--kf-accent2))] hover:underline">
              Add your first note
            </button>
          )}
        </div>
      ) : (
        <>
          {filteredNotes.slice(0, notesLimit).map((note) => {
            const cat = getCategoryConfig(note.source);
            const isPinned = pinnedIds.has(note.id);
            const CatIcon = cat.icon;
            return (
              <div
                key={note.id}
                className={`group rounded-xl border overflow-hidden transition-colors ${
                  isPinned ? "bg-[hsl(var(--kf-accent1))]/5 border-[hsl(var(--kf-accent1))]/20" : "bg-muted/30 border-border/50"
                }`}
              >
                {editingNoteId === note.id ? (
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1 flex-wrap">
                        {NOTE_CATEGORIES.map((c) => (
                          <button
                            key={c.key}
                            onClick={() => setEditNoteCategory(c.key)}
                            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors ${
                              editNoteCategory === c.key
                                ? `${c.bg} ${c.color} ring-1 ring-current/30`
                                : "bg-muted/50 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <c.icon className="w-2.5 h-2.5" />
                            {c.label}
                          </button>
                        ))}
                      </div>
                      <button onClick={cancelEditNote} className="p-1 rounded-md hover:bg-muted transition-colors" title="Cancel editing">
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                    <textarea
                      value={editNoteBody}
                      onChange={(e) => setEditNoteBody(e.target.value)}
                      className="kf-input w-full min-h-[80px] resize-none text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSaveEditNote(); }
                        if (e.key === "Escape") cancelEditNote();
                      }}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={cancelEditNote} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEditNote}
                        disabled={!editNoteBody.trim() || editNoteLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50"
                      >
                        {editNoteLoading ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ${cat.bg} ${cat.color}`}>
                            <CatIcon className="w-2.5 h-2.5" />
                            {cat.label}
                          </span>
                          {isPinned && <Pin className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />}
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                          {new Date(note.createdAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{note.body}</p>
                    </div>
                    <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-border/30 opacity-0 group-hover:opacity-100 transition-opacity bg-muted/20">
                      {onUpdateNote && (
                        <button onClick={() => startEditNote(note)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Edit note">
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      )}
                      <button onClick={() => togglePin(note.id)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title={isPinned ? "Unpin" : "Pin to top"}>
                        {isPinned ? <PinOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Pin className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                      <button onClick={() => handleCopyNote(note.id, note.body)} className="p-1.5 rounded-md hover:bg-muted transition-colors" title="Copy note">
                        {copiedId === note.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                      {waPhone && (
                        <button onClick={() => handleShareWhatsApp(note.body)} className="p-1.5 rounded-md hover:bg-emerald-500/10 transition-colors" title="Share via WhatsApp">
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                        </button>
                      )}
                      {onAddTask && (
                        <button onClick={() => handleCreateTaskFromNote(note.id, note.body)} className="p-1.5 rounded-md hover:bg-violet-500/10 transition-colors" title="Create task from this note">
                          {taskCreatedId === note.id ? <Check className="w-3.5 h-3.5 text-violet-400" /> : <ListPlus className="w-3.5 h-3.5 text-violet-400" />}
                        </button>
                      )}
                      <AiNoteAnalyzeButton
                        contactId={contact.id}
                        noteBody={note.body}
                        noteId={note.id}
                        onCreateTask={onAddTask}
                      />
                      <div className="flex-1" />
                      {onDeleteNote && (
                        <button onClick={async () => { try { await onDeleteNote(note.id); } catch { toast.error("Failed to delete note"); } }} className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors" title="Delete note">
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {filteredNotes.length > notesLimit && (
            <button
              onClick={() => setNotesLimit((p) => p + 20)}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1 transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              Show more ({filteredNotes.length - notesLimit} remaining)
            </button>
          )}
        </>
      )}
    </>
  );
}
