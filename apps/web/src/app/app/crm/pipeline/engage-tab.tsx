"use client";

import { Sparkles } from "lucide-react";
import { NextActionQueue, AutopilotActions } from "@/components/contacts";
import { Skeleton } from "@/components/ui/skeleton";
import type { NextAction } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";

interface EngageTabProps {
  nextActions: NextAction[];
  autopilotActions: AutopilotAction[];
  autopilotPaused: boolean;
  loading?: boolean;
  onComplete: (id: string) => Promise<void>;
  onViewContact: (id: string) => void;
  onDoAction: (action: NextAction) => void;
  onTogglePause: () => void;
  onApprove: (id: string) => Promise<void>;
  onDeny: (id: string) => Promise<void>;
}

function EngageSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="kf-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-32" />
          </div>
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02]">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-7 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function EngageTab({
  nextActions, autopilotActions, autopilotPaused, loading,
  onComplete, onViewContact, onDoAction,
  onTogglePause, onApprove, onDeny,
}: EngageTabProps) {
  if (loading) return <EngageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <NextActionQueue
          actions={nextActions}
          onComplete={onComplete}
          onViewContact={onViewContact}
          onDoAction={onDoAction}
        />
        <AutopilotActions
          actions={autopilotActions}
          isPaused={autopilotPaused}
          onTogglePause={onTogglePause}
          onApprove={onApprove}
          onDeny={onDeny}
          onViewContact={onViewContact}
        />
      </div>
      {nextActions.length === 0 && autopilotActions.length === 0 && (
        <div className="kf-card p-8 text-center">
          <Sparkles className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium mb-1">All Caught Up</p>
          <p className="text-muted-foreground text-sm">
            No pending actions right now. Keep building your pipeline and we'll surface smart next steps.
          </p>
        </div>
      )}
    </div>
  );
}
