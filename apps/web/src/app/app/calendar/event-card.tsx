"use client";

import {
  ExternalLink,
  MessageSquare,
  CheckCircle2,
  Clock,
  Send,
  Receipt,
  CalendarClock,
  Lock,
  RefreshCw,
} from "lucide-react";
import type { CalendarEvent } from "@/lib/client";
import { fmtMoney, fmtTime, moduleMeta, reschedulePolicy } from "./calendar-utils";

interface Props {
  event: CalendarEvent;
  onOpen?: (ev: CalendarEvent) => void;
  onQuickAction?: (ev: CalendarEvent, action: string) => void;
  onDragStart?: (ev: CalendarEvent, e: React.DragEvent) => void;
  draggable?: boolean;
  compact?: boolean;
}

export function EventCard({
  event,
  onOpen,
  onQuickAction,
  onDragStart,
  draggable = true,
  compact = false,
}: Props) {
  const meta = moduleMeta(event.module);
  const start = new Date(event.startAt);
  const end = event.endAt ? new Date(event.endAt) : null;
  const time = event.allDay
    ? "All day"
    : end
      ? `${fmtTime(start)} – ${fmtTime(end)}`
      : fmtTime(start);
  const policy = reschedulePolicy(event);
  const isDraggable = draggable && !policy.locked;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={isDraggable}
      onDragStart={isDraggable ? (e) => onDragStart?.(event, e) : undefined}
      onClick={() => onOpen?.(event)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(event);
        }
      }}
      className={`group relative rounded-lg border border-border/40 bg-card/40 hover:bg-card/80 transition-colors cursor-pointer overflow-hidden ${
        compact ? "p-1.5" : "p-2.5"
      }`}
      style={{ borderLeft: `3px solid ${event.color || meta.color}` }}
      title={policy.locked ? policy.reason : policy.needsConfirm ? `${policy.reason} (drag to reschedule with confirmation)` : "Drag to reschedule"}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{
                background: `${meta.color}1f`,
                color: meta.color,
              }}
            >
              {meta.label}
            </span>
            <span className={`font-medium truncate ${compact ? "text-[11px]" : "text-xs"}`}>
              {event.title}
            </span>
            {event.status !== "SCHEDULED" && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
                {event.status.toLowerCase()}
              </span>
            )}
            {policy.locked && (
              <Lock
                className="w-3 h-3 text-muted-foreground/60"
                aria-label="Locked from rescheduling"
              />
            )}
            {(event.syncStatus === "SYNCED" || event.googleEventId) && (
              <RefreshCw
                className="w-3 h-3 text-emerald-400/70"
                aria-label="Synced to Google"
              />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {time}
            </span>
            {event.amount !== null && event.amount !== undefined && event.amount > 0 && (
              <span className="text-emerald-400/90 font-medium">
                {fmtMoney(event.amount, event.currency)}
              </span>
            )}
            {event.contactId && <span className="truncate">· {event.contactId.slice(0, 8)}</span>}
            {event.assigneeId && (
              <span className="truncate">· @{event.assigneeId.slice(0, 8)}</span>
            )}
          </div>
        </div>
      </div>

      {!compact && onQuickAction && (
        <div
          className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {event.sourceUrl && (
            <button
              onClick={() => onQuickAction(event, "open-source")}
              className="text-[10px] px-1.5 py-0.5 rounded kf-btn-secondary inline-flex items-center gap-1"
              title="Open source object"
            >
              <ExternalLink className="w-3 h-3" />
              Open
            </button>
          )}
          {event.contactId && (
            <button
              onClick={() => onQuickAction(event, "message")}
              className="text-[10px] px-1.5 py-0.5 rounded kf-btn-secondary inline-flex items-center gap-1"
            >
              <MessageSquare className="w-3 h-3" />
              Message
            </button>
          )}
          {!policy.locked && (
            <button
              onClick={() => onQuickAction(event, "reschedule")}
              className="text-[10px] px-1.5 py-0.5 rounded kf-btn-secondary inline-flex items-center gap-1"
            >
              <CalendarClock className="w-3 h-3" />
              Reschedule
            </button>
          )}
          {event.status !== "COMPLETED" && (
            <button
              onClick={() => onQuickAction(event, "complete")}
              className="text-[10px] px-1.5 py-0.5 rounded kf-btn-secondary inline-flex items-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" />
              Done
            </button>
          )}
          {event.type === "FOLLOW_UP" ? (
            <button
              onClick={() => onQuickAction(event, "send-reminder")}
              className="text-[10px] px-1.5 py-0.5 rounded kf-btn-secondary inline-flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
              Remind
            </button>
          ) : null}
          {event.type === "INVOICE_DUE" || event.type === "INVOICE_OVERDUE" ? (
            <button
              onClick={() => onQuickAction(event, "send-invoice")}
              className="text-[10px] px-1.5 py-0.5 rounded kf-btn-secondary inline-flex items-center gap-1"
            >
              <Receipt className="w-3 h-3" />
              Invoice
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
