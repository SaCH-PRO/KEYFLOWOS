"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Zap, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { PriorityItem, AutopilotTask, MomentumRecommendation, NudgeItem, FinancialAlert, TimeBucket } from "./types";
import { PriorityRow, TaskRow, MomentumRow, NudgeRow, AlertRow } from "./queue-rows";

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
  onDismissTask: (id: string) => void;
  onDismissAlert: (id: string) => void;
  completingTask: string | null;
  momentumActionId: string | null;
  dismissingNudge: string | null;
}

const BUCKET_LABELS: Record<TimeBucket, string> = { now: "Now", today: "Today", "this-week": "This Week" };
const BUCKET_COLORS: Record<TimeBucket, string> = { now: "hsl(var(--kf-error))", today: "hsl(var(--kf-accent1))", "this-week": "hsl(var(--kf-info))" };

export function PriorityQueue(props: PriorityQueueProps) {
  const [showAll, setShowAll] = useState(false);

  const bucketedItems = useMemo(() => {
    const now: React.ReactNode[] = [];
    const today: React.ReactNode[] = [];
    const week: React.ReactNode[] = [];

    props.financialAlerts
      .filter((a) => a.severity !== "INFO")
      .slice(0, 3)
      .forEach((alert) => {
        const target = alert.severity === "CRITICAL" ? now : today;
        target.push(<AlertRow key={`fa-${alert.id}`} alert={alert} onDismiss={() => props.onDismissAlert(alert.id)} />);
      });

    props.priorities.forEach((p) => {
      const target = p.urgency === "critical" || p.urgency === "high" ? now : p.urgency === "medium" ? today : week;
      target.push(<PriorityRow key={`pri-${p.id}`} priority={p} />);
    });

    props.nudges.forEach((n) => {
      now.push(<NudgeRow key={`nudge-${n.id}`} nudge={n} onSnooze={() => props.onNudgeSnooze(n.id)} dismissing={props.dismissingNudge === n.id} />);
    });

    props.tasks.forEach((task, idx) => {
      const target = task.priority === "HIGH" ? now : today;
      target.push(
        <TaskRow
          key={`task-${task.id}`}
          task={task}
          index={idx}
          onComplete={() => props.onCompleteTask(task.id)}
          onApprove={() => props.onApproveTask(task.id)}
          onDeny={() => props.onDenyTask(task.id)}
          onDismiss={() => props.onDismissTask(task.id)}
          completing={props.completingTask === task.id}
        />,
      );
    });

    props.momentumRecs.forEach((rec) => {
      const target = rec.priority === "urgent" || rec.priority === "high" ? today : week;
      target.push(
        <MomentumRow key={`mom-${rec.id}`} rec={rec} onAction={() => props.onMomentumAction(rec)} onSnooze={() => props.onMomentumSnooze(rec.id)} onDismiss={() => props.onMomentumDismiss(rec.id)} loading={props.momentumActionId === rec.id} />,
      );
    });

    return { now, today, week };
  }, [props]);

  const totalItems = bucketedItems.now.length + bucketedItems.today.length + bucketedItems.week.length;
  const allEmpty = totalItems === 0 && props.tasks.length === 0;
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
          <span>{props.completedToday} done today</span>
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
          {visibleNow.length > 0 && <BucketSection bucket="now" items={visibleNow} />}
          {visibleToday.length > 0 && <BucketSection bucket="today" items={visibleToday} />}
          {visibleWeek.length > 0 && <BucketSection bucket="this-week" items={visibleWeek} />}
          {hiddenCount > 0 && (
            <button onClick={() => setShowAll(true)} className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              Show {hiddenCount} more item{hiddenCount > 1 ? "s" : ""} <ChevronDown className="w-3 h-3 inline" />
            </button>
          )}
          {showAll && totalItems > 8 && (
            <button onClick={() => setShowAll(false)} className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              Show less <ChevronUp className="w-3 h-3 inline" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BucketSection({ bucket, items }: { bucket: TimeBucket; items: React.ReactNode[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BUCKET_COLORS[bucket] }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{BUCKET_LABELS[bucket]}</span>
        <span className="text-[10px] text-muted-foreground">({items.length})</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
            {item}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
