"use client";

import { useState } from "react";
import { FileText, Plus, Trash2, ExternalLink, Link } from "lucide-react";

export interface Deliverable {
  id: string;
  name: string;
  type: "file" | "link" | "document";
  url?: string;
}

interface DeliverablesTabProps {
  deliverables: Deliverable[];
  onDeliverablesChange: (deliverables: Deliverable[]) => void;
}

export function DeliverablesTab({ deliverables, onDeliverablesChange }: DeliverablesTabProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const handleAdd = () => {
    if (!newName.trim()) return;
    const d: Deliverable = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      type: newUrl.trim() ? "link" : "document",
      url: newUrl.trim() || undefined,
    };
    onDeliverablesChange([...deliverables, d]);
    setNewName("");
    setNewUrl("");
    setShowAdd(false);
  };

  const handleDelete = (id: string) => {
    onDeliverablesChange(deliverables.filter((d) => d.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{deliverables.length} deliverable{deliverables.length !== 1 ? "s" : ""}</span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors"
          style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
        >
          <Plus className="w-3 h-3" />
          Add Deliverable
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-primary/30 bg-card p-3 space-y-2">
          <input
            autoFocus
            placeholder="Deliverable name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 border-b border-border/30 pb-2"
          />
          <input
            placeholder="URL (optional)"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/50"
          />
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => setShowAdd(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="kf-btn-primary px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {deliverables.length === 0 && !showAdd && (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
          <FileText className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No deliverables yet</p>
          <p className="text-xs text-muted-foreground mt-1">Track files, documents, and links associated with this project.</p>
        </div>
      )}

      <div className="space-y-2">
        {deliverables.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 py-2.5 px-3 rounded-xl border border-border/40 bg-card group hover:border-border/60 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
              {d.type === "link" ? (
                <Link className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
              ) : (
                <FileText className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{d.name}</p>
              {d.url && <p className="text-[10px] text-muted-foreground truncate">{d.url}</p>}
            </div>
            {d.url && (
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              onClick={() => handleDelete(d.id)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
