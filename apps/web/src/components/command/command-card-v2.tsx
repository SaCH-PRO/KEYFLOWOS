"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ShieldAlert,
  Bot,
  User,
  RotateCcw,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import type { CommandItem } from "@/lib/api/command";

type V2AccentColor = "orange" | "teal" | "violet" | "gold" | "rose" | "mint" | "sky" | "muted";

interface CommandCardProps {
  item: CommandItem;
  selected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onDismiss?: (id: string) => void | Promise<void>;
  onApprove?: (id: string) => void | Promise<void>;
  onExecute?: (id: string) => void | Promise<void>;
  onComplete?: (id: string) => void | Promise<void>;
  onAssign?: (id: string) => void | Promise<void>;
  onSnooze?: (id: string) => void | Promise<void>;
  onReopen?: (id: string) => void | Promise<void>;
}

const CATEGORY_COLORS: Record<string, V2AccentColor> = {
  MONEY: "mint",
  TIME: "sky",
  PEOPLE: "gold",
  WORK: "violet",
  SALES: "orange",
  MARKETING: "orange",
  GOVERNANCE: "rose",
  STRATEGY: "teal",
  SYSTEM: "muted",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_APPROVAL: "Needs Approval",
  EXECUTED: "Executed",
  DISMISSED: "Dismissed",
  SNOOZED: "Snoozed",
  FAILED: "Failed",
  COMPLETED: "Completed",
};

const STATUS_BADGE_COLOR: Record<string, V2AccentColor> = {
  OPEN: "sky",
  IN_PROGRESS: "gold",
  WAITING_APPROVAL: "rose",
  EXECUTED: "violet",
  DISMISSED: "muted",
  SNOOZED: "muted",
  FAILED: "rose",
  COMPLETED: "mint",
};

export function CommandCardV2({
  item,
  selected,
  onSelect,
  onDismiss,
  onApprove,
  onExecute,
  onComplete,
  onAssign,
  onSnooze,
  onReopen,
}: CommandCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const color = CATEGORY_COLORS[item.category] ?? "orange";

  const handleAction = async (action: string, handler?: (id: string) => void | Promise<void>) => {
    if (!handler) return;
    setLoading(action);
    try {
      await handler(item.id);
    } finally {
      setLoading(null);
    }
  };

  const isDone =
    item.status === "COMPLETED" ||
    item.status === "EXECUTED" ||
    item.status === "DISMISSED" ||
    item.status === "SNOOZED";

  return (
    <Surface
      className={cn(
        "p-3 md:p-4 transition-all hover:shadow-md",
        "border-l-[3px]",
        color === "orange" && "border-l-primary",
        color === "teal" && "border-l-secondary",
        color === "violet" && "border-l-violet",
        color === "gold" && "border-l-gold",
        color === "rose" && "border-l-rose",
        color === "mint" && "border-l-mint",
        color === "sky" && "border-l-sky",
        color === "muted" && "border-l-muted-foreground",
      )}
    >
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        {onSelect && (
          <div className="pt-1 pr-1 flex-shrink-0">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(item.id, e.target.checked)}
              className="w-4 h-4 cursor-pointer rounded border-gray-300"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color={color}>{item.category}</Badge>
            <Badge color={STATUS_BADGE_COLOR[item.status] ?? "muted"} variant="status">
              {STATUS_LABELS[item.status] ?? item.status}
            </Badge>
            {item.riskTier >= 3 && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-rose">
                <ShieldAlert className="w-3 h-3" />
                High Risk
              </span>
            )}
          </div>
          <button
            onClick={() => router.push(`/app/command-center/${item.id}`)}
            className="text-left w-full group"
          >
            <h4 className="font-semibold mt-1 truncate text-sm md:text-base group-hover:underline decoration-primary">
              {item.title}
            </h4>
          </button>
          {item.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {item.expectedValue != null && (
              <span className="hidden md:inline-flex text-[10px] font-medium font-mono text-mint">
                {item.currency} {item.expectedValue}
              </span>
            )}
            {item.dueAt && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                <Clock className="w-3 h-3" />
                Due {new Date(item.dueAt).toLocaleDateString()}
              </span>
            )}
            {item.executableByKey && (
              <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-primary">
                <Bot className="w-3 h-3" />
                KEY can handle
              </span>
            )}
            {item.ownerType === "USER" && item.ownerId && (
              <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <User className="w-3 h-3" />
                Assigned
              </span>
            )}
            <button
              onClick={() => router.push(`/app/command-center/${item.id}`)}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Details
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {!isDone ? (
          <div className="flex flex-wrap gap-1 md:flex-nowrap md:items-center flex-shrink-0">
            {onComplete && (
              <Button
                onClick={() => void handleAction("complete", onComplete)}
                isLoading={loading === "complete"}
                disabled={!!loading}
                variant="primary"
                className="h-8 px-2.5 text-xs"
                leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                Done
              </Button>
            )}
            {item.requiresApproval && onApprove && (
              <Button
                onClick={() => void handleAction("approve", onApprove)}
                isLoading={loading === "approve"}
                disabled={!!loading}
                variant="soft"
                className="h-8 px-2.5 text-xs text-mint bg-mint/10 hover:bg-mint/15 border-mint/20"
                leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                Approve
              </Button>
            )}
            {item.executableByKey && onExecute && (
              <Button
                onClick={() => void handleAction("execute", onExecute)}
                isLoading={loading === "execute"}
                disabled={!!loading}
                variant="glow"
                className="h-8 px-2.5 text-xs"
                leftIcon={<Zap className="w-3.5 h-3.5" />}
              >
                Execute
              </Button>
            )}
            {onAssign && (
              <Button
                onClick={() => void handleAction("assign", onAssign)}
                isLoading={loading === "assign"}
                disabled={!!loading}
                variant="icon"
                className="h-8 w-8"
                aria-label="Assign"
                title="Assign"
              >
                <UserPlus className="w-3.5 h-3.5" />
              </Button>
            )}
            {onSnooze && (
              <Button
                onClick={() => void handleAction("snooze", onSnooze)}
                isLoading={loading === "snooze"}
                disabled={!!loading}
                variant="icon"
                className="h-8 w-8"
                aria-label="Snooze 24h"
                title="Snooze 24h"
              >
                <Clock className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              onClick={() => void handleAction("dismiss", onDismiss)}
              isLoading={loading === "dismiss"}
              disabled={!!loading}
              variant="icon"
              className="h-8 w-8"
              aria-label="Dismiss"
              title="Dismiss"
            >
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1 md:flex-nowrap md:items-center flex-shrink-0">
            {onReopen && (
              <Button
                onClick={() => void handleAction("reopen", onReopen)}
                isLoading={loading === "reopen"}
                disabled={!!loading}
                variant="icon"
                className="h-8 w-8"
                aria-label="Reopen"
                title="Reopen"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    </Surface>
  );
}
