"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Flame,
  TrendingUp,
  AlertTriangle,
  CalendarPlus,
  Clock,
  ArrowRight,
  Phone,
  Mail,
  MessageSquare,
  CheckCircle2,
  FileText,
  DollarSign,
} from "lucide-react";
import type { ContactCardData } from "@/components/contacts/contact-card";
import type { NextAction } from "@/components/contacts/next-action-queue";
import { ContactCard } from "@/components/contacts/contact-card";

interface FocusViewProps {
  contacts: ContactCardData[];
  nextActions: NextAction[];
  onViewContact: (id: string) => void;
  onDoAction: (action: NextAction) => void;
  onCompleteNextAction: (id: string) => Promise<void>;
  loading?: boolean;
}

const ACTION_ICONS: Record<NextAction["type"], typeof MessageSquare> = {
  follow_up: MessageSquare,
  send_quote: FileText,
  call: Phone,
  email: Mail,
  payment_reminder: DollarSign,
  task: CheckCircle2,
};

const ACTION_LABELS: Record<NextAction["type"], string> = {
  follow_up: "Follow Up",
  send_quote: "Send Quote",
  call: "Call",
  email: "Email",
  payment_reminder: "Payment",
  task: "Task",
};

const PRIORITY_ORDER: Record<NextAction["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function FocusView({
  contacts,
  nextActions,
  onViewContact,
  onDoAction,
  onCompleteNextAction,
  loading,
}: FocusViewProps) {
  const sortedActions = useMemo(() => {
    return [...nextActions].sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        (b.value ?? 0) - (a.value ?? 0)
    );
  }, [nextActions]);

  const actionContactMap = useMemo(() => {
    const map = new Map<string, ContactCardData>();
    for (const c of contacts) {
      map.set(c.id, c);
    }
    return map;
  }, [contacts]);

  const todayActions = sortedActions.filter((a) => {
    if (!a.dueDate) return a.priority === "urgent" || a.priority === "high";
    const due = new Date(a.dueDate);
    const now = new Date();
    return (
      due.toDateString() === now.toDateString() ||
      a.priority === "urgent" ||
      a.priority === "high"
    );
  });

  const thisWeekActions = sortedActions.filter((a) => {
    if (todayActions.includes(a)) return false;
    if (!a.dueDate) return a.priority === "medium";
    const due = new Date(a.dueDate);
    const now = new Date();
    const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  });

  const contactsWithActions = useMemo(() => {
    const ids = new Set(sortedActions.map((a) => a.contactId));
    const prioritized = contacts.filter((c) => ids.has(c.id));
    const rest = contacts.filter((c) => !ids.has(c.id));
    return { prioritized, rest };
  }, [contacts, sortedActions]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-card/40 border border-border/20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Next Action Queue */}
      {sortedActions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Next Actions
            </h2>
            <span className="text-[10px] text-muted-foreground/50 ml-1">
              {sortedActions.length} pending
            </span>
          </div>

          <div className="grid gap-2">
            {todayActions.slice(0, 5).map((action) => {
              const Icon = ACTION_ICONS[action.type];
              const contact = actionContactMap.get(action.contactId);
              return (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group flex items-start gap-3 p-3.5 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 transition-all cursor-pointer"
                  onClick={() => onDoAction(action)}
                >
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      action.priority === "urgent"
                        ? "bg-red-500/10 text-red-400"
                        : action.priority === "high"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {ACTION_LABELS[action.type]}
                      </span>
                      {action.priority === "urgent" && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                          URGENT
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {contact?.firstName} {contact?.lastName}
                      {contact?.companyName ? ` · ${contact.companyName}` : ""}
                    </p>
                    <p className="text-xs text-foreground/70 mt-1 line-clamp-1">
                      {action.description}
                    </p>
                    {action.bestChannel && (
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        Best via {action.bestChannel}
                        {action.bestTimeWindowLabel ? ` · ${action.bestTimeWindowLabel}` : ""}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void onCompleteNextAction(action.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-white/[0.06] text-muted-foreground/60 hover:text-emerald-400 shrink-0"
                    title="Complete"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0 mt-1" />
                </motion.div>
              );
            })}

            {thisWeekActions.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">
                  This week
                </p>
                <div className="grid gap-2">
                  {thisWeekActions.slice(0, 3).map((action) => {
                    const Icon = ACTION_ICONS[action.type];
                    const contact = actionContactMap.get(action.contactId);
                    return (
                      <motion.div
                        key={action.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="group flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/20 hover:bg-card/40 transition-all cursor-pointer"
                        onClick={() => onDoAction(action)}
                      >
                        <div className="p-1.5 rounded-lg bg-white/[0.04] text-muted-foreground/60 shrink-0">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {ACTION_LABELS[action.type]} — {contact?.firstName} {contact?.lastName}
                          </p>
                          <p className="text-[11px] text-muted-foreground/60 truncate">
                            {action.description}
                          </p>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors shrink-0" />
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Prioritized contacts */}
      {contactsWithActions.prioritized.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contacts Requiring Action
            </h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {contactsWithActions.prioritized.slice(0, 8).map((contact, i) => (
              <motion.div
                key={contact.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <ContactCard
                  contact={contact}
                  onClick={() => onViewContact(contact.id)}
                />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Remaining contacts */}
      {contactsWithActions.rest.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground/50" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              All Contacts
            </h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {contactsWithActions.rest.slice(0, 12).map((contact, i) => (
              <motion.div
                key={contact.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <ContactCard
                  contact={contact}
                  onClick={() => onViewContact(contact.id)}
                />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {contacts.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center mb-4">
            <Zap className="w-8 h-8 text-[hsl(var(--kf-accent1))]" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Nothing needs attention</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Your contacts are in good shape. Add new contacts or check back later for AI-recommended actions.
          </p>
        </div>
      )}
    </div>
  );
}
