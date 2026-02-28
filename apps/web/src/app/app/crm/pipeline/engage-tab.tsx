"use client";

import { Sparkles } from "lucide-react";
import { NextActionQueue, AutopilotActions } from "@/components/contacts";
import type { NextAction } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";

interface EngageTabProps {
  nextActions: NextAction[];
  autopilotActions: AutopilotAction[];
  autopilotPaused: boolean;
  onComplete: (id: string) => Promise<void>;
  onViewContact: (id: string) => void;
  onDoAction: (action: NextAction) => void;
  onTogglePause: () => void;
  onApprove: (id: string) => Promise<void>;
  onDeny: (id: string) => Promise<void>;
}

export function EngageTab({
  nextActions, autopilotActions, autopilotPaused,
  onComplete, onViewContact, onDoAction,
  onTogglePause, onApprove, onDeny,
}: EngageTabProps) {
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
