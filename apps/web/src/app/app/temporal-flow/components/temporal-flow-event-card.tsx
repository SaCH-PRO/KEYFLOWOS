"use client";

import { Calendar, CheckCircle, Clock, ExternalLink } from "lucide-react";
import { TemporalFlowEvent, resolveTemporalFlowEvent } from "@/lib/api/temporal-flow";
import { getStoredBusinessId } from "@/lib/workspace";

interface EventCardProps {
  event: TemporalFlowEvent;
  onResolved?: () => void;
}

const sourceColor: Record<string, string> = {
  APP: "hsl(210 80% 60%)",
  KEY: "hsl(260 70% 60%)",
  GOOGLE_CALENDAR: "hsl(0 70% 55%)",
  WHATSAPP: "hsl(145 70% 45%)",
  EMAIL: "hsl(35 90% 55%)",
  INSTAGRAM: "hsl(320 80% 60%)",
  SHOPIFY: "hsl(160 70% 45%)",
};

const importanceBadge: Record<string, string> = {
  LOW: "bg-muted/40 text-muted-foreground",
  NORMAL: "bg-blue-500/10 text-blue-600",
  HIGH: "bg-amber-500/10 text-amber-600",
  CRITICAL: "bg-red-500/10 text-red-600",
};

function formatWhen(event: TemporalFlowEvent) {
  const date = event.startsAt ? new Date(event.startsAt) : new Date(event.occurredAt);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: event.startsAt ? "numeric" : undefined,
    minute: event.startsAt ? "numeric" : undefined,
  });
}

export function TemporalFlowEventCard({ event, onResolved }: EventCardProps) {
  const businessId = getStoredBusinessId() ?? "";

  const handleResolve = async () => {
    if (!businessId) return;
    await resolveTemporalFlowEvent(businessId, event.id);
    onResolved?.();
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
              style={{ background: sourceColor[event.source] ?? "hsl(var(--kf-muted))", color: "#fff" }}
            >
              {event.source}
            </span>
            {event.module && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{event.module}</span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${importanceBadge[event.importance] ?? importanceBadge.NORMAL}`}>
              {event.importance}
            </span>
            {event.genomeImpactPotential && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">Genome</span>
            )}
          </div>
          <h3 className="font-semibold mt-2">{event.title}</h3>
          {event.summary && <p className="text-sm text-muted-foreground mt-0.5">{event.summary}</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatWhen(event)}
            </span>
            {event.type && <span className="font-mono">{event.type}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {event.externalUrl && (
            <a
              href={event.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-md hover:bg-muted"
              title="Open external"
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </a>
          )}
          {event.status !== "RESOLVED" && event.status !== "DISMISSED" && (
            <button
              onClick={handleResolve}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-emerald-600"
              title="Mark resolved"
            >
              <CheckCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {event.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
