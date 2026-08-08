"use client";

import { CheckCircle, Clock, ExternalLink, AlertTriangle } from "lucide-react";
import { TemporalFlowEvent, resolveTemporalFlowEvent } from "@/lib/api/temporal-flow";
import { getStoredBusinessId } from "@/lib/workspace";

interface EventCardProps {
  event: TemporalFlowEvent;
  onResolved?: () => void;
}

const sourceMeta: Record<string, { color: string; label: string }> = {
  APP: { color: "hsl(210 80% 60%)", label: "App" },
  KEY: { color: "hsl(260 70% 60%)", label: "KEY" },
  GOOGLE_CALENDAR: { color: "hsl(0 70% 55%)", label: "Calendar" },
  WHATSAPP: { color: "hsl(145 70% 45%)", label: "WhatsApp" },
  EMAIL: { color: "hsl(35 90% 55%)", label: "Email" },
  INSTAGRAM: { color: "hsl(320 80% 60%)", label: "Instagram" },
  SHOPIFY: { color: "hsl(160 70% 45%)", label: "Shopify" },
  MANUAL: { color: "hsl(var(--kf-accent1))", label: "Manual" },
};

const importanceMeta: Record<string, { color: string; bg: string }> = {
  LOW: { color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted) / 0.15)" },
  NORMAL: { color: "hsl(210 80% 60%)", bg: "hsl(210 80% 60% / 0.1)" },
  HIGH: { color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
  CRITICAL: { color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.1)" },
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

function isOverdue(event: TemporalFlowEvent) {
  if (event.status === "RESOLVED" || event.status === "DISMISSED") return false;
  const date = event.startsAt ? new Date(event.startsAt) : new Date(event.occurredAt);
  return date.getTime() < Date.now() - 60 * 60 * 1000;
}

export function TemporalFlowEventCard({ event, onResolved }: EventCardProps) {
  const businessId = getStoredBusinessId() ?? "";
  const source = sourceMeta[event.source] ?? { color: "hsl(var(--kf-muted))", label: event.source };
  const importance = importanceMeta[event.importance] ?? importanceMeta.NORMAL;
  const overdue = isOverdue(event);

  const handleResolve = async () => {
    if (!businessId) return;
    await resolveTemporalFlowEvent(businessId, event.id);
    onResolved?.();
  };

  return (
    <div
      className="rounded-xl border border-border/40 bg-card/40 p-4 hover:bg-card/70 hover:border-border/60 hover:shadow-sm transition-all relative overflow-hidden"
      style={{ borderLeft: `3px solid ${importance.color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md"
              style={{ background: `${source.color}15`, color: source.color }}
            >
              {source.label}
            </span>
            {event.module && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{event.module}</span>
            )}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
              style={{ background: importance.bg, color: importance.color }}
            >
              {event.importance}
            </span>
            {event.genomeImpactPotential && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-success))]/10 text-[hsl(var(--kf-success))]">
                Genome
              </span>
            )}
          </div>
          <h3 className="font-semibold text-sm mt-2">{event.title}</h3>
          {event.summary && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{event.summary}</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className={`flex items-center gap-1 ${overdue ? "text-[hsl(var(--kf-warning))] font-medium" : ""}`}>
              {overdue ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              {formatWhen(event)}
            </span>
            {event.type && <span className="font-mono text-[10px] opacity-70">{event.type}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {event.externalUrl && (
            <a
              href={event.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              title="Open external"
              aria-label="Open external link"
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </a>
          )}
          {event.status !== "RESOLVED" && event.status !== "DISMISSED" && (
            <button
              onClick={handleResolve}
              className="p-1.5 rounded-lg hover:bg-[hsl(var(--kf-success))]/10 text-muted-foreground hover:text-[hsl(var(--kf-success))] transition-colors"
              title="Mark resolved"
              aria-label="Mark resolved"
            >
              <CheckCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {event.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/50 text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
