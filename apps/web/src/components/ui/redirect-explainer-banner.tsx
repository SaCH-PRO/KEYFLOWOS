"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Info } from "lucide-react";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { cn } from "@/lib/utils";

const DELETED_TARGET_KEY = "kf-deleted-target-msg";

export function DeletedTargetBanner({ className }: { className?: string }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const msg = sessionStorage.getItem(DELETED_TARGET_KEY);
    if (msg) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
      setMessage(msg);
      sessionStorage.removeItem(DELETED_TARGET_KEY);
    }
  }, []);

  if (!message) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-xl border border-muted bg-muted/30 text-sm",
        className
      )}
      role="status"
    >
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

interface RedirectExplainerBannerProps {
  reason: string;
  missingRequirement?: string;
  postCompletionNote?: string;
  primaryCta?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  backCta?: {
    label?: string;
    href?: string;
    onClick?: () => void;
  };
  variant?: "warning" | "info" | "error";
  className?: string;
}

export function RedirectExplainerBanner({
  reason,
  missingRequirement,
  postCompletionNote,
  primaryCta,
  backCta,
  variant = "warning",
  className,
}: RedirectExplainerBannerProps) {
  const { getReturnLabel, navigateBack } = useReturnNavigation();

  const variantStyles = {
    warning: {
      border: "border-amber-500/30",
      bg: "bg-amber-500/5",
      icon: "text-amber-500",
    },
    info: {
      border: "border-blue-500/30",
      bg: "bg-blue-500/5",
      icon: "text-blue-500",
    },
    error: {
      border: "border-destructive/30",
      bg: "bg-destructive/5",
      icon: "text-destructive",
    },
  };

  const styles = variantStyles[variant];

  const resolvedBackLabel = backCta?.label ?? getReturnLabel();

  const handleBack = () => {
    if (backCta?.onClick) {
      backCta.onClick();
    } else if (backCta?.href) {
      navigateBack(backCta.href);
    } else {
      navigateBack();
    }
  };

  const handlePrimary = () => {
    if (primaryCta?.onClick) {
      primaryCta.onClick();
    } else if (primaryCta?.href) {
      navigateBack(primaryCta.href);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3",
        styles.border,
        styles.bg,
        className
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className={cn("w-4 h-4 mt-0.5 flex-shrink-0", styles.icon)} />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{reason}</p>
          {missingRequirement && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Required: </span>
              {missingRequirement}
            </p>
          )}
          {postCompletionNote && (
            <p className="text-xs text-muted-foreground/80 italic">{postCompletionNote}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {primaryCta && (
          <button
            onClick={handlePrimary}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg kf-btn-primary"
          >
            {primaryCta.label}
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          {resolvedBackLabel}
        </button>
      </div>
    </div>
  );
}
