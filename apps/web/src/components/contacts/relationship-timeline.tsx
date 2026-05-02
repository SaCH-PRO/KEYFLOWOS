"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Phone,
  FileText,
  DollarSign,
  Calendar,
  Gift,
  Star,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronRight,
} from "lucide-react";

export interface JourneyMilestone {
  id: string;
  type: "first_contact" | "call" | "quote_sent" | "quote_accepted" | "payment" | "booking" | "completed" | "milestone" | "note";
  title: string;
  description?: string;
  date: string;
  value?: number;
  isNext?: boolean;
}

interface RelationshipTimelineProps {
  contactName: string;
  milestones: JourneyMilestone[];
  onAddMilestone?: () => void;
}

const MILESTONE_CONFIG: Record<JourneyMilestone["type"], { icon: typeof MessageSquare; color: string }> = {
  first_contact: { icon: Sparkles, color: "hsl(var(--kf-accent1))" },
  call: { icon: Phone, color: "hsl(var(--kf-accent2))" },
  quote_sent: { icon: FileText, color: "hsl(217 91% 60%)" },
  quote_accepted: { icon: CheckCircle2, color: "hsl(142 76% 36%)" },
  payment: { icon: DollarSign, color: "hsl(142 76% 36%)" },
  booking: { icon: Calendar, color: "hsl(var(--kf-accent2))" },
  completed: { icon: Star, color: "hsl(45 93% 47%)" },
  milestone: { icon: Gift, color: "hsl(var(--kf-accent1))" },
  note: { icon: MessageSquare, color: "hsl(var(--kf-muted-foreground))" },
};

export function RelationshipTimeline({ contactName, milestones, onAddMilestone }: RelationshipTimelineProps) {
  const sortedMilestones = useMemo(() => {
    return [...milestones].sort((a, b) => {
      if (a.isNext) return 1;
      if (b.isNext) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [milestones]);

  const nextMilestone = sortedMilestones.find((m) => m.isNext);
  const pastMilestones = sortedMilestones.filter((m) => !m.isNext);

  const daysUntilNext = useMemo(() => {
    if (!nextMilestone) return null;
    const diff = new Date(nextMilestone.date).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }, [nextMilestone]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Journey with {contactName.split(" ")[0]}
        </h3>
        {onAddMilestone && (
          <button
            onClick={onAddMilestone}
            className="text-xs text-[hsl(var(--kf-accent2))] hover:underline"
          >
            Add Milestone
          </button>
        )}
      </div>

      <div className="relative pl-6 space-y-4">
        <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent2))] to-muted" />

        {pastMilestones.map((milestone, index) => {
          const config = MILESTONE_CONFIG[milestone.type];
          const Icon = config.icon;

          return (
            <motion.div
              key={milestone.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="relative flex gap-3"
            >
              <div
                className="absolute left-[-18px] p-1.5 rounded-full bg-background border-2 z-10"
                style={{ borderColor: config.color }}
              >
                <Icon className="w-3 h-3" style={{ color: config.color }} />
              </div>

              <div className="flex-1 ml-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{milestone.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(milestone.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                {milestone.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{milestone.description}</p>
                )}
                {milestone.value && (
                  <p className="text-xs font-medium mt-0.5" style={{ color: config.color }}>
                    TTD {milestone.value.toLocaleString()}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}

        {nextMilestone && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative flex gap-3"
          >
            <div className="absolute left-[-18px] p-1.5 rounded-full bg-background border-2 border-dashed border-[hsl(var(--kf-accent1))] z-10">
              <Calendar className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
            </div>

            <div className="flex-1 ml-4 p-3 rounded-xl bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm flex items-center gap-1">
                  <ChevronRight className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                  NEXT: {nextMilestone.title}
                </span>
                <span className="text-xs font-medium text-[hsl(var(--kf-accent1))]">
                  {daysUntilNext !== null && daysUntilNext > 0
                    ? `${daysUntilNext} days away`
                    : daysUntilNext === 0
                    ? "Today!"
                    : "Overdue"}
                </span>
              </div>
              {nextMilestone.description && (
                <p className="text-xs text-muted-foreground mt-1">{nextMilestone.description}</p>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
