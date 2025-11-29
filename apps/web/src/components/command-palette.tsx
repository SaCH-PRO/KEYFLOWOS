"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Action = {
  label: string;
  hint?: string;
  onSelect: () => void;
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const actions: Action[] = [
    { label: "Go to Cockpit", hint: "Dashboard", onSelect: () => router.push("/app") },
    { label: "Go to CRM", hint: "Contacts", onSelect: () => router.push("/app/crm") },
    { label: "Go to Commerce", hint: "Invoices & Products", onSelect: () => router.push("/app/commerce") },
    { label: "Go to Bookings", hint: "Schedule", onSelect: () => router.push("/app/bookings") },
    { label: "Go to Studio", hint: "Blueprint workspace", onSelect: () => router.push("/app/studio") },
    {
      label: "Open Public Booking Page",
      hint: "Client-facing",
      onSelect: () => window.open("/public/book", "_blank"),
    },
    {
      label: "Open Public Pay Page",
      hint: "Invoice payment",
      onSelect: () => window.open("/public/pay", "_blank"),
    },
  ];

  const filtered = useMemo(() => {
    if (!query) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()) || a.hint?.toLowerCase().includes(query.toLowerCase()));
  }, [actions, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-24" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-border/80 bg-slate-950/90 shadow-2xl shadow-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="Command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No matches</div>
          )}
          {filtered.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                action.onSelect();
                onClose();
              }}
              className={cn(
                "w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-primary/10 transition-colors text-sm",
              )}
            >
              <div>
                <div className="text-foreground">{action.label}</div>
                {action.hint && <div className="text-[11px] text-muted-foreground">{action.hint}</div>}
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="border-t border-border/60 px-4 py-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Enter to run · Esc to close</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
            <Link2 className="w-3 h-3" /> Cmd/Ctrl + K
          </span>
        </div>
      </div>
    </div>
  );
}
