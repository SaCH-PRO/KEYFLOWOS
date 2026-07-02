"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type VoiceOrbState = "idle" | "listening" | "thinking";

interface VoiceOrbProps {
  state?: VoiceOrbState;
  size?: "sm" | "md" | "lg";
  className?: string;
  icon?: React.ReactNode;
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

export function VoiceOrb({
  state = "idle",
  size = "md",
  className,
  icon,
}: VoiceOrbProps) {
  const isListening = state === "listening";
  const isThinking = state === "thinking";

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {isListening && (
        <motion.span
          className="absolute inset-0 rounded-full opacity-40"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
          }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.15, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <motion.div
        animate={
          isListening
            ? { scale: [1, 1.1, 1] }
            : isThinking
              ? { rotate: 360 }
              : {}
        }
        transition={
          isListening
            ? { duration: 1, repeat: Infinity, ease: "easeInOut" }
            : isThinking
              ? { duration: 1.5, repeat: Infinity, ease: "linear" }
              : {}
        }
        className={cn(
          "relative rounded-full flex items-center justify-center text-white",
          SIZE_MAP[size],
        )}
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
        }}
      >
        {icon ?? <Sparkles className={ICON_SIZE_MAP[size]} />}
      </motion.div>
    </div>
  );
}
