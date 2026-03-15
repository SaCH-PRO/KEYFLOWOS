"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  AlertTriangle,
  AlertCircle,
  Clock,
  Check,
  X,
  Zap,
  CheckCircle2,
  Sparkles,
  Loader2,
  HeartPulse,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  Package,
  Send,
  Award,
  Clock3,
  ShieldAlert,
  FileWarning,
  Bell,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type {
  PriorityItem,
  AutopilotTask,
  MomentumRecommendation,
  NudgeItem,
  FinancialAlert,
  TimeBucket,
} from "./types";
import { formatTTD } from "./types";

interface PriorityQueueProps {
  priorities: PriorityItem[];
  tasks: AutopilotTask[];
  momentumRecs: MomentumRecommendation[];
  nudges: NudgeItem[];
  financialAlerts: FinancialAlert[];
  completedToday: number;
  businessId: string | null;
  onCompleteTask: (taskId: string) => Promise<void>;
  onApproveTask: (taskId: string) => Promise<void>;
  onDenyTask: (taskId: string) => Promise<void>;
  onMomentumAction: (rec: MomentumRecommendation) => Promise<void>;
  onMomentumSnooze: (id: string) => Promise<void>;
  onMomentumDismiss: (id: string) => Promise<void>;
  onNudgeSnooze: (id: string) => Promise<void>;
  completingTask: string | null;
  momentumActionId: string | null;
  dismissingNudge: string | null;
}

const BUCKET_LABELS: Record<TimeBucket, string> = {
  now: "Now",
  today: "Today",
  "this-week": "This Week",
};

const BUCKET_COLORS: Record<TimeBucket, string> = {
  now: "hsl(var(--kf-error))",
  today: "hsl(var(--kf-accent1))",
  "this-week": "hsl(var(--kf-info))",
};

interface QueueItem {
  id: string;
  type: string;
  bucket: TimeBucket;
  render: React.ReactNode;
}

function PriorityRow({ priority }: { priority: PriorityItem }) {
  const urgencyColors: Record<string, { border: string; text: string }> = {
    critical: { border: "hsl(var(--kf-error) / 0.4)", text: "hsl(var(--kf-error))" },
    high: { border: "hsl(var(--kf-accent1) / 0.4)", text: "hsl(var(--kf-accent1))" },
    medium: { border: "hsl(var(--kf-warning) / 0.4)", text: "hsl(var(--kf-warning))" },
    low: { border: "hsl(var(--kf-info) / 0.4)", text: "hsl(var(--kf-info))" },
  };
  const colors = urgencyColors[priority.urgency] || urgencyColors.low;

  return (
    <div
      className="flex items-center gap-3 p-3 kf-radius-md border transition-all hover:bg-muted/10"
      style={{ borderColor: colors.border }}
    >
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colors.text }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{priority.title}</p>
        <p className="kf-text-caption text-muted-foreground truncate">
          {priority.contactName && <span>{priority.contactName} · </span>}
          {priority.description}
        </p>
      </div>
      {priority.amount != null && (
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: colors.text }}>
          {formatTTD(priority.amount)}
        </span>
      )}
      <Link
        href={priority.actionHref}
        className="text-xs font-medium px-3 py-1.5 kf-radius-sm transition-all hover:scale-105 flex-shrink-0 text-white"
        style={{ backgroundColor: colors.text }}
      >
        {priority.actionLabel}
      </Link>
    </div>
  );
}

function TaskRow({
  task,
  index,
  onComplete,
  onApprove,
  onDeny,
  completing,
}: {
  task: AutopilotTask;
  index: number;
  onComplete: () => void;
  onApprove: () => void;
  onDeny: () => void;
  completing: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border border-border group transition-all hover:bg-muted/10">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${task.priority !== "HIGH" ? "bg-muted text-muted-foreground" : ""}`}
        style={
          task.priority === "HIGH"
            ? { backgroundColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1))" }
            : undefined
        }
      >
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {task.category}
          </span>
          {task.autoExecutable && (
            <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "hsl(var(--kf-info) / 0.1)", color: "hsl(var(--kf-info))" }}>
              <Sparkles className="w-2.5 h-2.5" />Auto
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {task.requiresApproval && task.status === "AWAITING_APPROVAL" ? (
          <>
            <button
              onClick={onDeny}
              disabled={completing}
              className="p-1.5 kf-radius-sm transition-colors disabled:opacity-50 hover:bg-muted/30"
              style={{ color: "hsl(var(--kf-error))" }}
              title="Deny"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={onApprove}
              disabled={completing}
              className="p-1.5 kf-radius-sm transition-colors disabled:opacity-50 hover:bg-muted/30"
              style={{ color: "hsl(var(--kf-success))" }}
              title="Approve"
            >
              <Check className="w-4 h-4" />
            </button>
          </>
        ) : (
          <button
            onClick={onComplete}
            disabled={completing}
            className="p-1.5 kf-radius-sm transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
            style={{ color: "hsl(var(--kf-success))" }}
            title="Mark as done"
          >
            {completing ? (
              <Clock className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function MomentumRow({
  rec,
  onAction,
  onSnooze,
  onDismiss,
  loading,
}: {
  rec: MomentumRecommendation;
  onAction: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
  loading: boolean;
}) {
  const contactName = rec.contact
    ? `${rec.contact.firstName ?? ""} ${rec.contact.lastName ?? ""}`.trim() || "Unnamed"
    : "Contact";
  const typeIcons: Record<string, React.ReactNode> = {
    churn_risk: <TrendingDown className="w-3 h-3" />,
    check_in: <MessageCircle className="w-3 h-3" />,
    upsell: <TrendingUp className="w-3 h-3" />,
    package_offer: <Package className="w-3 h-3" />,
    re_engage: <Send className="w-3 h-3" />,
    birthday: <Award className="w-3 h-3" />,
  };

  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border border-border transition-all hover:bg-muted/10">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: "hsl(var(--kf-accent2) / 0.2)", color: "hsl(var(--kf-accent2))" }}
      >
        {typeIcons[rec.type] || <HeartPulse className="w-3 h-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{rec.title}</p>
        <p className="kf-text-caption text-muted-foreground truncate">
          {contactName}
          {rec.momentumScore != null && ` · Score: ${rec.momentumScore}`}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onAction}
          disabled={loading}
          className="text-[10px] font-medium px-3 py-1.5 kf-radius-sm transition-all hover:scale-105 text-white"
          style={{ backgroundColor: "hsl(var(--kf-accent2))" }}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Act"}
        </button>
        <button
          onClick={onSnooze}
          disabled={loading}
          className="text-[10px] font-medium px-2 py-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
          title="Snooze 7 days"
        >
          <Clock3 className="w-3 h-3" />
        </button>
        <button
          onClick={onDismiss}
          disabled={loading}
          className="text-[10px] font-medium px-2 py-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function NudgeRow({
  nudge,
  onSnooze,
  dismissing,
}: {
  nudge: NudgeItem;
  onSnooze: () => void;
  dismissing: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 p-3 kf-radius-md border transition-all"
      style={{ borderColor: "hsl(var(--kf-accent2) / 0.2)", backgroundColor: "hsl(var(--kf-accent2) / 0.03)" }}
    >
      <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{nudge.title}</p>
        <p className="kf-text-caption text-muted-foreground truncate">{nudge.body}</p>
      </div>
      <Link
        href={nudge.ctaHref}
        className="text-xs font-medium px-3 py-1.5 kf-radius-sm text-white transition-all hover:scale-105 flex-shrink-0"
        style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
      >
        {nudge.ctaLabel}
      </Link>
      {nudge.snoozable && (
        <button
          onClick={onSnooze}
          disabled={dismissing}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 kf-radius-sm hover:bg-muted/30 transition-all flex-shrink-0"
        >
          {dismissing ? "..." : "Later"}
        </button>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: FinancialAlert }) {
  const alertIcons: Record<string, React.ReactNode> = {
    COMPLIANCE: <ShieldAlert className="w-3.5 h-3.5" />,
    PAYMENT: <FileWarning className="w-3.5 h-3.5" />,
    APPROVAL: <Bell className="w-3.5 h-3.5" />,
  };
  const isError = alert.severity === "CRITICAL";

  return (
    <Link
      href={alert.action || "/app/commerce"}
      className="flex items-center gap-3 p-3 kf-radius-md border transition-all hover:bg-muted/10"
      style={{
        borderColor: isError ? "hsl(var(--kf-error) / 0.3)" : "hsl(var(--kf-accent1) / 0.3)",
      }}
    >
      <div style={{ color: isError ? "hsl(var(--kf-error))" : "hsl(var(--kf-accent1))" }}>
        {alertIcons[alert.type] || <AlertCircle className="w-3.5 h-3.5" />}
      </div>
      <p className="text-sm flex-1 min-w-0 truncate">{alert.message}</p>
    </Link>
  );
}

export function PriorityQueue({
  priorities,
  tasks,
  momentumRecs,
  nudges,
  financialAlerts,
  completedToday,
  businessId,
  onCompleteTask,
  onApproveTask,
  onDenyTask,
  onMomentumAction,
  onMomentumSnooze,
  onMomentumDismiss,
  onNudgeSnooze,
  completingTask,
  momentumActionId,
  dismissingNudge,
}: PriorityQueueProps) {
  const [showAll, setShowAll] = useState(false);

  const bucketedItems = useMemo(() => {
    const now: React.ReactNode[] = [];
    const today: React.ReactNode[] = [];
    const week: React.ReactNode[] = [];

    financialAlerts
      .filter((a) => a.severity !== "INFO")
      .slice(0, 3)
      .forEach((alert) => {
        const target = alert.severity === "CRITICAL" ? now : today;
        target.push(<AlertRow key={`fa-${alert.id}`} alert={alert} />);
      });

    priorities.forEach((p) => {
      const target = p.urgency === "critical" || p.urgency === "high" ? now : p.urgency === "medium" ? today : week;
      target.push(<PriorityRow key={`pri-${p.id}`} priority={p} />);
    });

    nudges.forEach((n) => {
      now.push(
        <NudgeRow
          key={`nudge-${n.id}`}
          nudge={n}
          onSnooze={() => onNudgeSnooze(n.id)}
          dismissing={dismissingNudge === n.id}
        />,
      );
    });

    tasks.forEach((task, idx) => {
      const target = task.priority === "HIGH" ? now : today;
      target.push(
        <TaskRow
          key={`task-${task.id}`}
          task={task}
          index={idx}
          onComplete={() => onCompleteTask(task.id)}
          onApprove={() => onApproveTask(task.id)}
          onDeny={() => onDenyTask(task.id)}
          completing={completingTask === task.id}
        />,
      );
    });

    momentumRecs.forEach((rec) => {
      const target = rec.priority === "urgent" || rec.priority === "high" ? today : week;
      target.push(
        <MomentumRow
          key={`mom-${rec.id}`}
          rec={rec}
          onAction={() => onMomentumAction(rec)}
          onSnooze={() => onMomentumSnooze(rec.id)}
          onDismiss={() => onMomentumDismiss(rec.id)}
          loading={momentumActionId === rec.id}
        />,
      );
    });

    return { now, today, week };
  }, [
    priorities,
    tasks,
    momentumRecs,
    nudges,
    financialAlerts,
    completingTask,
    momentumActionId,
    dismissingNudge,
    onCompleteTask,
    onApproveTask,
    onDenyTask,
    onMomentumAction,
    onMomentumSnooze,
    onMomentumDismiss,
    onNudgeSnooze,
  ]);

  const totalItems = bucketedItems.now.length + bucketedItems.today.length + bucketedItems.week.length;
  const allEmpty = totalItems === 0 && tasks.length === 0;

  const visibleNow = showAll ? bucketedItems.now : bucketedItems.now.slice(0, 5);
  const visibleToday = showAll ? bucketedItems.today : bucketedItems.today.slice(0, 5);
  const visibleWeek = showAll ? bucketedItems.week : bucketedItems.week.slice(0, 3);
  const hiddenCount = totalItems - visibleNow.length - visibleToday.length - visibleWeek.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h2 className="kf-text-emphasis font-semibold">What Needs Attention</h2>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CheckCircle2 className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />
          <span>{completedToday} done today</span>
        </div>
      </div>

      {allEmpty ? (
        <div className="kf-card p-8 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2" style={{ color: "hsl(var(--kf-success))" }} />
          <h3 className="text-sm font-semibold mb-0.5">All Caught Up!</h3>
          <p className="kf-text-caption text-muted-foreground">No items needing attention right now.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleNow.length > 0 && (
            <BucketSection bucket="now" items={visibleNow} />
          )}
          {visibleToday.length > 0 && (
            <BucketSection bucket="today" items={visibleToday} />
          )}
          {visibleWeek.length > 0 && (
            <BucketSection bucket="this-week" items={visibleWeek} />
          )}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Show {hiddenCount} more item{hiddenCount > 1 ? "s" : ""}{" "}
              <ChevronDown className="w-3 h-3 inline" />
            </button>
          )}
          {showAll && totalItems > 8 && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Show less <ChevronUp className="w-3 h-3 inline" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BucketSection({
  bucket,
  items,
}: {
  bucket: TimeBucket;
  items: React.ReactNode[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: BUCKET_COLORS[bucket] }}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {BUCKET_LABELS[bucket]}
        </span>
        <span className="text-[10px] text-muted-foreground">({items.length})</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.03 * i }}
          >
            {item}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
