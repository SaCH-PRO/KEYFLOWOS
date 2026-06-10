"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactNotes, addContactNote, deleteContactNote, updateContactNote } from "@/lib/client";
import { Button, Card } from "@keyflow/ui";
import { StickyNote, Trash2, Plus, Calendar, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Note {
  id: string;
  body: string;
  source?: string | null;
  createdAt: string;
}

function fmtDate(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

export default function ContactNotesPage() {
  const { contactId } = useParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetchContactNotes(contactId as string);
    setNotes(res.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchContactNotes(contactId as string);
      if (!cancelled) {
        setNotes(res.data ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contactId]);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    const res = await addContactNote(contactId as string, newNote.trim());
    setSaving(false);
    if (res.data) {
      setNewNote("");
      toast.success("Note added");
      load();
    } else {
      toast.error(res.error ?? "Failed to add note");
    }
  };

  const handleDelete = async (noteId: string) => {
    const res = await deleteContactNote(noteId);
    if (res.data) {
      toast.success("Note deleted");
      load();
    } else {
      toast.error(res.error ?? "Failed to delete note");
    }
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditBody(note.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBody("");
  };

  const saveEdit = async (noteId: string) => {
    if (!editBody.trim()) return;
    setEditSaving(true);
    const res = await updateContactNote(noteId, { body: editBody.trim() });
    setEditSaving(false);
    if (res.data) {
      toast.success("Note updated");
      setEditingId(null);
      load();
    } else {
      toast.error(res.error ?? "Failed to update note");
    }
  };

  if (loading) return <div className="p-4">Loading notes...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StickyNote className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Notes</h3>
        <span className="ml-auto text-sm text-muted-foreground">{notes.length} note{notes.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="flex gap-2">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Write a new note..."
          rows={2}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
        />
        <Button onClick={handleAdd} disabled={saving || !newNote.trim()} className="self-end">
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No notes yet. Add your first note above.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <Card key={note.id}>
              <div className="p-4">
                {editingId === note.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveEdit(note.id)}
                        disabled={editSaving || !editBody.trim()}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {editSaving ? "Saving…" : <><Check className="h-3 w-3" /> Save</>}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => startEdit(note)}
                          title="Edit note"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-destructive"
                          onClick={() => handleDelete(note.id)}
                          title="Delete note"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {timeAgo(note.createdAt)}
                      {note.source && <span className="ml-2 rounded bg-muted px-1.5 py-0.5">{note.source}</span>}
                    </div>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
