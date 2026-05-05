"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { WonLostReason } from "@/lib/client";

interface ReasonPickerProps {
  open: boolean;
  kind: "WON" | "LOST";
  reasons: WonLostReason[];
  onCancel: () => void;
  onSubmit: (payload: { reasonId: string | null; reasonNotes: string }) => Promise<void>;
}

export function ReasonPickerModal({ open, kind, reasons, onCancel, onSubmit }: ReasonPickerProps) {
  const [reasonId, setReasonId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReasonId(""); setNotes(""); setBusy(false); } }, [open]);
  if (!open) return null;
  const filtered = reasons.filter((r) => r.kind === kind);
  const canSubmit = !busy && (reasonId !== "" || notes.trim().length > 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h2 className="text-sm font-semibold">{kind === "WON" ? "Mark deal as won" : "Mark deal as lost"}</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Reason</label>
            <select value={reasonId} onChange={(e) => setReasonId(e.target.value)}
              className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5">
              <option value="">— Select a reason —</option>
              {filtered.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3}
              className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5"
              placeholder="Any extra context for win/loss analysis…" />
          </div>
          {!canSubmit && <p className="text-xs text-muted-foreground/80">Pick a reason or add notes to continue.</p>}
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-border">
          <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted">Cancel</button>
          <button disabled={!canSubmit}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ reasonId: reasonId || null, reasonNotes: notes.trim() }); }
              finally { setBusy(false); }
            }}
            className={`text-sm px-3 py-1.5 rounded-md text-white ${kind === "WON" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"} disabled:opacity-50`}>
            {busy ? "Saving…" : kind === "WON" ? "Mark won" : "Mark lost"}
          </button>
        </div>
      </div>
    </div>
  );
}
