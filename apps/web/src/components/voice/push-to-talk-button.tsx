"use client";

import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface PushToTalkButtonProps {
  recording: boolean;
  onClick: () => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_MAP = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-14 h-14",
};

const ICON_SIZE_MAP = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-7 h-7",
};

export function PushToTalkButton({
  recording,
  onClick,
  disabled,
  size = "md",
  className,
}: PushToTalkButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full flex items-center justify-center flex-shrink-0 transition-all text-white disabled:opacity-50",
        SIZE_MAP[size],
        className,
      )}
      style={{
        background: recording
          ? "hsl(var(--kf-error))"
          : "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
      }}
      aria-label={recording ? "Stop recording" : "Start recording"}
    >
      {recording ? (
        <MicOff className={ICON_SIZE_MAP[size]} />
      ) : (
        <Mic className={ICON_SIZE_MAP[size]} />
      )}
    </button>
  );
}
