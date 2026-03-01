"use client";

import React, { memo, useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Tag,
  TrendingUp,
  Clock,
  X,
  GripVertical,
  Heart,
} from "lucide-react";
import type { Contact } from "@/lib/client";
import { updateContact } from "@/lib/client";
import { toast } from "sonner";
import { PipelineDetailPanel } from "./pipeline-detail-panel";
import type { PipelineState } from "./use-contacts-pipeline";
import { CONTACT_STATUSES } from "@/lib/crm-constants";
import { relativeTime, getScoreStyle, STATUS_CONFIG, STATUS_COLORS } from "@/lib/crm-utils";

const STATUSES = CONTACT_STATUSES;

function formatCurrency(value: number): string {
  return `TTD ${value.toLocaleString("en-TT")}`;
}

interface KanbanCardProps {
  contact: Contact;
  onDragStart: (e: React.DragEvent, contactId: string) => void;
  onClick: (contactId: string) => void;
  onKeyboardMove?: (contactId: string, direction: "left" | "right") => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}

const KanbanCard = memo(function KanbanCardInner({
  contact,
  onDragStart,
  onClick,
  onKeyboardMove,
  isFavorite,
  onToggleFavorite,
}: KanbanCardProps) {
  const fullName =
    `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
  const initials =
    `${contact.firstName?.[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const leadScore = contact.meta?.leadScore;
  const hasLeadScore = leadScore != null && leadScore > 0;
  const scoreStyle = hasLeadScore ? getScoreStyle(leadScore!) : null;
  const totalRevenue = contact.meta?.totalRevenue;
  const lastInteraction = contact.meta?.lastInteractionAt;
  const statusColor = STATUS_COLORS[contact.status ?? "LEAD"] ?? STATUS_COLORS.LEAD;

  const statusLabel = STATUS_CONFIG[contact.status ?? "LEAD"]?.label ?? contact.status ?? "Lead";
  const cardAriaLabel = `${fullName} - ${statusLabel}${hasLeadScore ? ` - Lead Score: ${leadScore}` : ""}`;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      onKeyboardMove?.(contact.id, e.key === "ArrowLeft" ? "left" : "right");
    }
  }, [contact.id, onKeyboardMove]);

  return (
    <div
      role="article"
      aria-label={cardAriaLabel}
      tabIndex={0}
      draggable
      onDragStart={(e) => onDragStart(e, contact.id)}
      onClick={() => onClick(contact.id)}
      onKeyDown={handleKeyDown}
      className="rounded-xl border border-border/50 bg-card p-3 cursor-grab active:cursor-grabbing hover:bg-white/[0.03] transition-all group focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/50"
    >
      <div className="flex items-start gap-2.5">
        <div
          className="h-8 w-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
          style={{ background: statusColor }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="text-xs font-semibold truncate">{fullName}</h4>
            {onToggleFavorite && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(contact.id); }}
                className={`p-0.5 rounded transition-colors flex-shrink-0 ${isFavorite ? "text-rose-400" : "text-muted-foreground/50 opacity-0 group-hover:opacity-100"}`}
                title={isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Heart className={`w-3 h-3 ${isFavorite ? "fill-current" : ""}`} />
              </button>
            )}
            {hasLeadScore && scoreStyle && (
              <span
                className={`text-[10px] font-bold px-1 py-px rounded ${scoreStyle.bg} ${scoreStyle.text} flex-shrink-0`}
              >
                {leadScore}
              </span>
            )}
          </div>

          {(contact.companyName || contact.jobTitle) && (
            <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5 flex items-center gap-1">
              <Building2 className="w-3 h-3 flex-shrink-0" />
              {contact.jobTitle && contact.companyName
                ? `${contact.jobTitle} at ${contact.companyName}`
                : contact.companyName || contact.jobTitle}
            </p>
          )}

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {totalRevenue != null && totalRevenue > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" />
                {formatCurrency(totalRevenue)}
              </span>
            )}
            {lastInteraction && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {relativeTime(lastInteraction)}
              </span>
            )}
          </div>

          {contact.tags && contact.tags.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {contact.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-muted-foreground/70 border border-border/30"
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                </span>
              ))}
              {contact.tags.length > 2 && (
                <span className="text-[10px] text-muted-foreground/50 font-medium">
                  +{contact.tags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
});

interface KanbanColumnProps {
  status: string;
  contacts: Contact[];
  onDragStart: (e: React.DragEvent, contactId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, status: string) => void;
  onCardClick: (contactId: string) => void;
  onKeyboardMove?: (contactId: string, direction: "left" | "right") => void;
  dragOverStatus: string | null;
  favoriteIds?: Set<string>;
  onToggleFavorite?: (id: string) => void;
}

const KanbanColumn = memo(function KanbanColumnInner({
  status,
  contacts,
  onDragStart,
  onDragOver,
  onDrop,
  onCardClick,
  onKeyboardMove,
  dragOverStatus,
  favoriteIds,
  onToggleFavorite,
}: KanbanColumnProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.LEAD;
  const totalValue = contacts.reduce(
    (sum, c) => sum + (c.meta?.totalRevenue ?? 0),
    0
  );
  const isDragOver = dragOverStatus === status;

  return (
    <div
      role="list"
      aria-roledescription="column"
      aria-label={`${config.label} — ${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, status)}
      className={`rounded-xl border bg-card flex flex-col min-h-[300px] transition-all ${
        isDragOver ? "border-border ring-1 ring-[hsl(var(--kf-accent1))]/30" : "border-border/50"
      }`}
    >
      <div
        className={`px-3.5 py-2.5 rounded-t-xl bg-gradient-to-r ${config.gradient} border-b border-border/30`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className={`text-xs font-bold ${config.text}`}>
              {config.label}
            </h3>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${config.bg} ${config.text}`}
            >
              {contacts.length}
            </span>
          </div>
          {totalValue > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground/60">
              {formatCurrency(totalValue)}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-16rem)]">
        {contacts.length === 0 && (
          <div className="flex items-center justify-center h-20 text-[11px] text-muted-foreground/40">
            Drop contacts here
          </div>
        )}
        {contacts.map((contact) => (
          <KanbanCard
            key={contact.id}
            contact={contact}
            onDragStart={onDragStart}
            onClick={onCardClick}
            onKeyboardMove={onKeyboardMove}
            isFavorite={favoriteIds?.has(contact.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </div>
  );
});

interface PipelineKanbanProps {
  state: PipelineState;
}

function PipelineKanbanInner({ state }: PipelineKanbanProps) {
  const {
    businessId,
    displayContacts,
    contacts,
    detailPanelProps,
    selectContact,
  } = state;

  const [draggedContactId, setDraggedContactId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const groupedContacts = useMemo(() => {
    const groups: Record<string, Contact[]> = {
      LEAD: [],
      PROSPECT: [],
      CLIENT: [],
      LOST: [],
    };
    for (const c of displayContacts) {
      const status = c.status ?? "LEAD";
      if (groups[status]) {
        groups[status].push(c);
      } else {
        groups.LEAD.push(c);
      }
    }
    return groups;
  }, [displayContacts]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, contactId: string) => {
      setDraggedContactId(contactId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", contactId);
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = (e.currentTarget as HTMLElement).closest(
      "[data-status]"
    ) as HTMLElement | null;
    if (target) {
      setDragOverStatus(target.dataset.status ?? null);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, newStatus: string) => {
      e.preventDefault();
      setDragOverStatus(null);
      const contactId =
        e.dataTransfer.getData("text/plain") || draggedContactId;
      if (!contactId || !businessId) return;

      const contact = contacts.find((c) => c.id === contactId);
      if (!contact || contact.status === newStatus) return;

      const previousStatus = contact.status;
      const contactName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed";
      const newLabel = STATUS_CONFIG[newStatus]?.label ?? newStatus;

      try {
        await updateContact({ businessId, contactId, status: newStatus });
        void state.loadContacts();
        void state.loadFlowData();
        toast(`${contactName} moved to ${newLabel}`, {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await updateContact({ businessId, contactId, status: previousStatus });
                void state.loadContacts();
                void state.loadFlowData();
                toast.success("Status change undone");
              } catch {
                toast.error("Failed to undo status change");
              }
            },
          },
        });
      } catch {
        toast.error("Failed to update contact status");
      }
      setDraggedContactId(null);
    },
    [draggedContactId, businessId, contacts, state]
  );

  const handleKeyboardMove = useCallback(
    async (contactId: string, direction: "left" | "right") => {
      if (!businessId) return;
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact) return;

      const currentIndex = STATUSES.indexOf((contact.status ?? "LEAD") as typeof STATUSES[number]);
      if (currentIndex === -1) return;

      const newIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= STATUSES.length) return;

      const newStatus = STATUSES[newIndex];
      const previousStatus = contact.status ?? "LEAD";
      const newLabel = STATUS_CONFIG[newStatus]?.label ?? newStatus;

      try {
        await updateContact({ businessId, contactId, status: newStatus });
        void state.loadContacts();
        void state.loadFlowData();
        toast.success(`Contact moved to ${newLabel}`, {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await updateContact({ businessId, contactId, status: previousStatus });
                void state.loadContacts();
                void state.loadFlowData();
              } catch {
                toast.error("Failed to undo status change");
              }
            },
          },
        });
      } catch {
        toast.error("Failed to update contact status");
      }
    },
    [businessId, contacts, state]
  );

  const handleCardClick = useCallback(
    (contactId: string) => {
      selectContact(contactId);
      setShowDetailModal(true);
    },
    [selectContact]
  );

  const handleCloseModal = useCallback(() => {
    setShowDetailModal(false);
  }, []);

  return (
    <div>
      <span className="sr-only">
        Kanban board with {STATUSES.length} columns: {STATUSES.map(s => STATUS_CONFIG[s]?.label ?? s).join(", ")}. Drag and drop contacts between columns to change their status.
      </span>
      <div
        role="region"
        aria-roledescription="kanban board"
        aria-label="Contact pipeline board"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {STATUSES.map((status) => (
          <div key={status} data-status={status}>
            <KanbanColumn
              status={status}
              contacts={groupedContacts[status]}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onCardClick={handleCardClick}
              onKeyboardMove={handleKeyboardMove}
              dragOverStatus={dragOverStatus}
              favoriteIds={state.favoriteIds}
              onToggleFavorite={state.handleToggleFavorite}
            />
          </div>
        ))}
      </div>

      <AnimatePresence>
        {showDetailModal && detailPanelProps.contact && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={handleCloseModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-background rounded-2xl border border-border/50 w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                <h3 className="text-sm font-semibold">Contact Details</h3>
                <button
                  onClick={handleCloseModal}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto max-h-[calc(85vh-3.5rem)] p-4">
                <PipelineDetailPanel
                  {...detailPanelProps}
                  onClose={handleCloseModal}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const PipelineKanban = memo(PipelineKanbanInner);
