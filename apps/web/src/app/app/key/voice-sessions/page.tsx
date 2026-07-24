"use client";

import { useEffect, useState } from "react";
import { Mic, Clock, Calendar, ArrowLeft, ChevronRight, Headphones } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchVoiceSessions, type VoiceSession } from "@/lib/client";

function formatDuration(start: string, end?: string | null): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : s;
  const diff = Math.max(0, Math.round((e - s) / 1000));
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export default function VoiceSessionsPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VoiceSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!businessId) return;
      setLoading(true);
      const res = await fetchVoiceSessions(businessId, { limit: 50 });
      if (!cancelled) {
        if (res.data) setSessions(res.data.items ?? []);
        setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [businessId]);

  return (
    <UnifiedPageShell
      title="Voice Sessions"
      subtitle="History of your voice conversations with KEY"
      icon={Headphones}
      maxWidth="5xl"
    >
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-16 bg-muted rounded-lg" />
            <div className="h-16 bg-muted rounded-lg" />
            <div className="h-16 bg-muted rounded-lg" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12">
            <Mic className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No voice sessions yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Start a conversation using the voice button in KEY Worker.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className="w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-colors hover:bg-muted/40"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]">
                  <Mic className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {s.summary || "Voice session"}
                    </span>
                    <span
                      className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                        s.status === "ENDED"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(s.startedAt).toLocaleDateString()}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(s.startedAt, s.endedAt)}
                    </span>
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {s.mode.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
              onClick={() => setSelected(null)}
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 250 }}
              className="fixed inset-x-0 bottom-0 z-[61] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[520px] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden"
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                maxHeight: "85vh",
              }}
            >
              <div className="p-4 flex items-center gap-3 border-b border-border">
                <button
                  onClick={() => setSelected(null)}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                  aria-label="Back to sessions"
                  title="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {selected.summary || "Voice session"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(selected.startedAt).toLocaleString()} ·{" "}
                    {formatDuration(selected.startedAt, selected.endedAt)}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selected.transcript ? (
                  <div className="space-y-2">
                    <h4 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      Transcript
                    </h4>
                    <div className="p-3 rounded-xl bg-muted/40 text-sm leading-relaxed whitespace-pre-wrap">
                      {selected.transcript}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No transcript available for this session.
                  </p>
                )}
                {selected.summary && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      Summary
                    </h4>
                    <div className="p-3 rounded-xl bg-muted/40 text-sm leading-relaxed">
                      {selected.summary}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </UnifiedPageShell>
  );
}
